use crate::diagnostics::{
    format_environment_diagnostics, EnvironmentDiagnostics, EnvironmentIssue, ToolStatus,
};
use crate::process_runner::{CommandResult, CommandRunner, ProcessRunner, RunOptions};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

pub const ADAPTER_INTERFACE_VERSION: &str = "0.5.0";

const CURATED_COMMANDS: [&str; 8] = [
    "cloneInstall",
    "createProject",
    "get",
    "save",
    "update",
    "push",
    "createBranch",
    "switchBranch",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommandSchemaContract {
    pub required: Vec<String>,
    pub optional: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdapterInterfaceContract {
    pub version: String,
    #[serde(rename = "classificationValues")]
    pub classification_values: Vec<String>,
    pub commands: HashMap<String, CommandSchemaContract>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserError {
    pub code: String,
    pub title: String,
    pub message: String,
    #[serde(rename = "technicalDetails")]
    pub technical_details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommandWarning {
    pub code: String,
    pub severity: String,
    pub message: String,
    #[serde(rename = "actionHint", skip_serializing_if = "Option::is_none")]
    pub action_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdapterCommandResult {
    pub ok: bool,
    #[serde(rename = "commandName")]
    pub command_name: String,
    pub command: String,
    pub args: Vec<String>,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub failed: bool,
    #[serde(rename = "userError")]
    pub user_error: Option<UserError>,
    pub warnings: Vec<CommandWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectClassificationSource {
    pub dataset: String,
    pub subdatasets: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectDetectionResult {
    #[serde(rename = "projectPath")]
    pub project_path: String,
    pub classification: String,
    pub reason: String,
    #[serde(rename = "classificationSource", skip_serializing_if = "Option::is_none")]
    pub classification_source: Option<ProjectClassificationSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatasetEntry {
    pub path: String,
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BranchListResult {
    #[serde(rename = "projectPath")]
    pub project_path: String,
    #[serde(rename = "currentBranch")]
    pub current_branch: Option<String>,
    #[serde(rename = "detachedHead")]
    pub detached_head: bool,
    pub branches: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LastCommitResult {
    #[serde(rename = "hasCommit")]
    pub has_commit: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<i64>,
    #[serde(rename = "commitHash", skip_serializing_if = "Option::is_none")]
    pub commit_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkingTreeFileEntry {
    pub path: String,
    pub status: String,
    #[serde(rename = "statusCode")]
    pub status_code: String,
    pub staged: bool,
    pub unstaged: bool,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkingTreeStatusResult {
    #[serde(rename = "projectPath")]
    pub project_path: String,
    pub clean: bool,
    #[serde(rename = "totalChanged")]
    pub total_changed: usize,
    #[serde(rename = "stagedCount")]
    pub staged_count: usize,
    #[serde(rename = "unstagedCount")]
    pub unstaged_count: usize,
    #[serde(rename = "untrackedCount")]
    pub untracked_count: usize,
    #[serde(rename = "conflictCount")]
    pub conflict_count: usize,
    pub files: Vec<WorkingTreeFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecentCommitEntry {
    pub timestamp: i64,
    #[serde(rename = "commitHash")]
    pub commit_hash: String,
    pub author: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecentCommitsResult {
    #[serde(rename = "projectPath")]
    pub project_path: String,
    pub commits: Vec<RecentCommitEntry>,
}

struct DatasetProbe {
    is_dataset: Option<bool>,
    source: String,
    reason: Option<String>,
}

struct SubdatasetProbe {
    has_subdatasets: Option<bool>,
    source: String,
    reason: Option<String>,
}

struct CommandSpec {
    command: String,
    args: Vec<String>,
    options: RunOptions,
}

pub struct DataLadAdapterCore<R: CommandRunner> {
    runner: R,
}

impl<R: CommandRunner> DataLadAdapterCore<R> {
    pub fn new(runner: R) -> Self {
        Self { runner }
    }

    pub fn check_environment(&self) -> EnvironmentDiagnostics {
        let python = self.check_python();
        let datalad = self.check_tool("datalad", &["--version"]);
        let git_annex = self.check_tool("git", &["annex", "version"]);

        let mut issues = Vec::new();

        if !python.available {
            issues.push(EnvironmentIssue {
                code: "PYTHON_MISSING".to_string(),
                message: "Python 3 is required but not available.".to_string(),
            });
        }

        if !datalad.available {
            issues.push(EnvironmentIssue {
                code: "DATALAD_MISSING".to_string(),
                message: "DataLad is not available in PATH.".to_string(),
            });
        }

        if !git_annex.available {
            issues.push(EnvironmentIssue {
                code: "GIT_ANNEX_MISSING".to_string(),
                message: "git-annex support is not available.".to_string(),
            });
        }

        format_environment_diagnostics(python, datalad, git_annex, issues)
    }

    pub fn get_interface_contract(&self) -> AdapterInterfaceContract {
        let mut commands = HashMap::new();

        for command_name in CURATED_COMMANDS {
            if let Some((required, optional)) = command_schema(command_name) {
                commands.insert(
                    command_name.to_string(),
                    CommandSchemaContract {
                        required: required.iter().map(|value| value.to_string()).collect(),
                        optional: optional.iter().map(|value| value.to_string()).collect(),
                    },
                );
            }
        }

        AdapterInterfaceContract {
            version: ADAPTER_INTERFACE_VERSION.to_string(),
            classification_values: vec![
                "git".to_string(),
                "dataset".to_string(),
                "superdataset".to_string(),
            ],
            commands,
        }
    }

    pub fn run_command(
        &self,
        command_name: &str,
        request: &Value,
    ) -> Result<AdapterCommandResult, String> {
        if !CURATED_COMMANDS.contains(&command_name) {
            return Err(format!("Unsupported command: {}", command_name));
        }

        assert_command_request(command_name, request)?;

        let command_spec = self.build_command(command_name, request)?;
        let run_result = self
            .runner
            .run(&command_spec.command, &command_spec.args, &command_spec.options);
        let warnings = self.extract_command_warnings(command_name, &run_result);
        let user_error = if run_result.failed {
            Some(map_command_error(command_name, &run_result))
        } else {
            None
        };

        Ok(build_command_result(
            command_name,
            run_result,
            user_error,
            warnings,
        ))
    }

    pub fn detect_project(&self, project_path: &str) -> Result<ProjectDetectionResult, String> {
        self.ensure_git_project(project_path)?;

        let has_datalad_config = file_exists(Path::new(project_path).join(".datalad").join("config"));
        let dataset_probe = self.probe_datalad_dataset(project_path);

        let is_dataset = dataset_probe.is_dataset.unwrap_or(has_datalad_config);

        if !is_dataset {
            let reason = dataset_probe.reason.unwrap_or_else(|| {
                if has_datalad_config {
                    "DataLad metadata probe failed and no supported fallback confirmed dataset state."
                        .to_string()
                } else {
                    "DataLad probe did not detect a dataset.".to_string()
                }
            });

            return Ok(ProjectDetectionResult {
                project_path: project_path.to_string(),
                classification: "git".to_string(),
                reason,
                classification_source: None,
            });
        }

        let subdataset_probe = self.probe_subdatasets(project_path);
        let has_subdatasets = subdataset_probe
            .has_subdatasets
            .unwrap_or_else(|| self.has_registered_subdatasets(project_path));

        let classification = if has_subdatasets {
            "superdataset"
        } else {
            "dataset"
        }
        .to_string();

        let reason = if has_subdatasets {
            subdataset_probe.reason.unwrap_or_else(|| {
                "DataLad subdataset probe detected child datasets.".to_string()
            })
        } else {
            dataset_probe.reason.unwrap_or_else(|| {
                "DataLad dataset detected with no child datasets.".to_string()
            })
        };

        Ok(ProjectDetectionResult {
            project_path: project_path.to_string(),
            classification,
            reason,
            classification_source: Some(ProjectClassificationSource {
                dataset: dataset_probe.source,
                subdatasets: subdataset_probe.source,
            }),
        })
    }

    pub fn list_datasets(&self, project_path: &str) -> Result<Vec<DatasetEntry>, String> {
        self.ensure_git_project(project_path)?;

        let mut datasets = vec![DatasetEntry {
            path: project_path.to_string(),
            relative_path: ".".to_string(),
            kind: "root".to_string(),
        }];

        for relative_path in read_subdataset_paths_from_gitmodules(project_path) {
            let path = Path::new(project_path)
                .join(&relative_path)
                .to_string_lossy()
                .to_string();

            datasets.push(DatasetEntry {
                path,
                relative_path,
                kind: "subdataset".to_string(),
            });
        }

        Ok(datasets)
    }

    pub fn list_branches(&self, project_path: &str) -> Result<BranchListResult, String> {
        self.ensure_git_project(project_path)?;

        let args = vec![
            "-C".to_string(),
            project_path.to_string(),
            "branch".to_string(),
            "--format=%(refname:short)".to_string(),
        ];
        let branch_result = self.runner.run("git", &args, &RunOptions::default());

        if branch_result.failed {
            let message = non_empty(&branch_result.stderr)
                .or_else(|| non_empty(&branch_result.stdout))
                .unwrap_or_else(|| "unknown error".to_string());
            return Err(format!(
                "Could not list branches for project: {} ({})",
                project_path, message
            ));
        }

        let current_args = vec![
            "-C".to_string(),
            project_path.to_string(),
            "branch".to_string(),
            "--show-current".to_string(),
        ];
        let current_result = self.runner.run("git", &current_args, &RunOptions::default());

        let mut branches = branch_result
            .stdout
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(|line| line.to_string())
            .collect::<Vec<_>>();
        branches.sort();

        let current_branch = first_line(&current_result.stdout).map(|line| line.to_string());

        Ok(BranchListResult {
            project_path: project_path.to_string(),
            detached_head: current_branch.is_none(),
            current_branch,
            branches,
        })
    }

    pub fn get_last_commit(&self, project_path: &str) -> LastCommitResult {
        if self.ensure_git_project(project_path).is_err() {
            return LastCommitResult {
                has_commit: false,
                reason: Some("not-git".to_string()),
                timestamp: None,
                commit_hash: None,
                subject: None,
                message: None,
            };
        }

        let args = vec![
            "-C".to_string(),
            project_path.to_string(),
            "log".to_string(),
            "-1".to_string(),
            "--format=%ct%x00%h%x00%s%x00%B".to_string(),
        ];
        let result = self.runner.run("git", &args, &RunOptions::default());

        if result.failed {
            let diagnostics = format!("{}\n{}", result.stderr, result.stdout).to_lowercase();
            let reason = if diagnostics.contains("does not have any commits yet")
                || diagnostics.contains("has no commits yet")
            {
                "no-commits"
            } else {
                "unavailable"
            };

            return LastCommitResult {
                has_commit: false,
                reason: Some(reason.to_string()),
                timestamp: None,
                commit_hash: None,
                subject: None,
                message: None,
            };
        }

        let parts = result.stdout.split('\0').collect::<Vec<_>>();
        if parts.len() < 3 {
            return LastCommitResult {
                has_commit: false,
                reason: Some("unavailable".to_string()),
                timestamp: None,
                commit_hash: None,
                subject: None,
                message: None,
            };
        }

        let timestamp = parts[0].trim().parse::<i64>().ok();
        if timestamp.is_none() {
            return LastCommitResult {
                has_commit: false,
                reason: Some("unavailable".to_string()),
                timestamp: None,
                commit_hash: None,
                subject: None,
                message: None,
            };
        }

        let message = if parts.len() > 3 {
            Some(parts[3..].join("\0").trim().to_string())
        } else {
            Some(String::new())
        };

        LastCommitResult {
            has_commit: true,
            reason: None,
            timestamp,
            commit_hash: Some(parts[1].trim().to_string()),
            subject: Some(parts[2].trim().to_string()),
            message,
        }
    }

    pub fn get_working_tree_status(
        &self,
        project_path: &str,
    ) -> Result<WorkingTreeStatusResult, String> {
        self.ensure_git_project(project_path)?;

        let args = vec![
            "-C".to_string(),
            project_path.to_string(),
            "-c".to_string(),
            "core.quotePath=false".to_string(),
            "status".to_string(),
            "--porcelain".to_string(),
            "--untracked-files=all".to_string(),
        ];
        let result = self.runner.run("git", &args, &RunOptions::default());

        if result.failed {
            let message = non_empty(&result.stderr)
                .or_else(|| non_empty(&result.stdout))
                .unwrap_or_else(|| "unknown error".to_string());
            return Err(format!(
                "Could not read working tree status for project: {} ({})",
                project_path, message
            ));
        }

        let mut files_by_path = HashMap::<String, WorkingTreeFileEntry>::new();
        let mut staged_count = 0;
        let mut unstaged_count = 0;
        let mut untracked_count = 0;
        let mut conflict_count = 0;

        for line in result.stdout.lines() {
            if line.len() < 3 {
                continue;
            }

            let status_code = line[0..2].to_string();
            let path_portion = line[3..].trim();
            if path_portion.is_empty() {
                continue;
            }

            let normalized_path = normalize_status_path(path_portion, &status_code);
            if normalized_path.is_empty() {
                continue;
            }

            let staged = !matches!(status_code.chars().next(), Some(' ') | Some('?'));
            let unstaged = !matches!(status_code.chars().nth(1), Some(' ') | Some('?'));
            let conflicted = status_code.contains('U') || status_code == "AA" || status_code == "DD";
            let status = map_status_code(&status_code);

            if staged {
                staged_count += 1;
            }

            if unstaged {
                unstaged_count += 1;
            }

            if status_code == "??" {
                untracked_count += 1;
            }

            if conflicted {
                conflict_count += 1;
            }

            if let Some(existing) = files_by_path.get_mut(&normalized_path) {
                existing.status = merge_status_priority(&existing.status, status);
                existing.status_code = status_code;
                existing.staged = existing.staged || staged;
                existing.unstaged = existing.unstaged || unstaged;
                existing.conflicted = existing.conflicted || conflicted;
                continue;
            }

            files_by_path.insert(
                normalized_path.clone(),
                WorkingTreeFileEntry {
                    path: normalized_path,
                    status: status.to_string(),
                    status_code,
                    staged,
                    unstaged,
                    conflicted,
                },
            );
        }

        let mut files = files_by_path.into_values().collect::<Vec<_>>();
        files.sort_by(|left, right| left.path.cmp(&right.path));

        Ok(WorkingTreeStatusResult {
            project_path: project_path.to_string(),
            clean: files.is_empty(),
            total_changed: files.len(),
            staged_count,
            unstaged_count,
            untracked_count,
            conflict_count,
            files,
        })
    }

    pub fn list_recent_commits(
        &self,
        project_path: &str,
        options: Option<&Value>,
    ) -> Result<RecentCommitsResult, String> {
        self.ensure_git_project(project_path)?;

        let limit = parse_recent_commit_limit(options);
        let args = vec![
            "-C".to_string(),
            project_path.to_string(),
            "log".to_string(),
            "-n".to_string(),
            limit.to_string(),
            "--format=%ct%x00%h%x00%an%x00%s".to_string(),
        ];
        let result = self.runner.run("git", &args, &RunOptions::default());

        if result.failed {
            let diagnostics = format!("{}\n{}", result.stderr, result.stdout).to_lowercase();
            if diagnostics.contains("does not have any commits yet")
                || diagnostics.contains("has no commits yet")
            {
                return Ok(RecentCommitsResult {
                    project_path: project_path.to_string(),
                    commits: Vec::new(),
                });
            }

            let message = non_empty(&result.stderr)
                .or_else(|| non_empty(&result.stdout))
                .unwrap_or_else(|| "unknown error".to_string());
            return Err(format!(
                "Could not list recent commits for project: {} ({})",
                project_path, message
            ));
        }

        let mut commits = Vec::new();
        for line in result.stdout.lines() {
            if line.trim().is_empty() {
                continue;
            }

            let parts = line.split('\0').collect::<Vec<_>>();
            if parts.len() < 4 {
                continue;
            }

            let Some(timestamp) = parts[0].trim().parse::<i64>().ok() else {
                continue;
            };

            commits.push(RecentCommitEntry {
                timestamp,
                commit_hash: parts[1].trim().to_string(),
                author: parts[2].trim().to_string(),
                subject: parts[3].trim().to_string(),
            });
        }

        Ok(RecentCommitsResult {
            project_path: project_path.to_string(),
            commits,
        })
    }

    fn check_python(&self) -> ToolStatus {
        let mut attempted_details = Vec::new();

        for candidate in python_candidates() {
            let args = candidate
                .args
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>();
            let result = self.runner.run(candidate.command, &args, &RunOptions::default());

            if result.failed {
                let details = non_empty(&result.stderr).or_else(|| non_empty(&result.stdout));
                if let Some(details) = details {
                    attempted_details.push(format!("{}: {}", candidate.label, details));
                }
                continue;
            }

            let version_line = first_line(&result.stdout).or_else(|| first_line(&result.stderr));
            if let Some(version_line) = version_line {
                if version_line.starts_with("Python 3") {
                    return ToolStatus {
                        available: true,
                        version: Some(version_line.to_string()),
                        details: None,
                    };
                }

                attempted_details.push(format!(
                    "{}: {}",
                    candidate.label,
                    version_line
                ));
            } else {
                attempted_details.push(format!(
                    "{}: returned an unknown version string",
                    candidate.label
                ));
            }
        }

        ToolStatus {
            available: false,
            version: None,
            details: if attempted_details.is_empty() {
                Some("No supported Python 3 command was found in PATH.".to_string())
            } else {
                Some(attempted_details.join(" | "))
            },
        }
    }

    fn check_tool(&self, command: &str, args: &[&str]) -> ToolStatus {
        let args = args.iter().map(|value| value.to_string()).collect::<Vec<_>>();
        let result = self.runner.run(command, &args, &RunOptions::default());

        if result.failed {
            return ToolStatus {
                available: false,
                version: None,
                details: non_empty(&result.stderr).or_else(|| non_empty(&result.stdout)),
            };
        }

        ToolStatus {
            available: true,
            version: first_line(&result.stdout)
                .or_else(|| first_line(&result.stderr))
                .map(|line| line.to_string()),
            details: None,
        }
    }

    fn ensure_git_project(&self, project_path: &str) -> Result<(), String> {
        let args = vec![
            "-C".to_string(),
            project_path.to_string(),
            "rev-parse".to_string(),
            "--is-inside-work-tree".to_string(),
        ];
        let result = self.runner.run("git", &args, &RunOptions::default());

        if result.failed {
            return Err(format!("Path is not a git repository: {}", project_path));
        }

        Ok(())
    }

    fn probe_datalad_dataset(&self, project_path: &str) -> DatasetProbe {
        let args = vec![
            "-C".to_string(),
            project_path.to_string(),
            "status".to_string(),
            "--dataset".to_string(),
            ".".to_string(),
            "--json".to_string(),
        ];
        let result = self.runner.run("datalad", &args, &RunOptions::default());

        if !result.failed {
            return DatasetProbe {
                is_dataset: Some(true),
                source: "datalad-status-probe".to_string(),
                reason: Some("DataLad status probe succeeded.".to_string()),
            };
        }

        if looks_like_no_dataset(&result.stderr) {
            return DatasetProbe {
                is_dataset: Some(false),
                source: "datalad-status-probe".to_string(),
                reason: Some(
                    "DataLad status reported that this repository is not a dataset.".to_string(),
                ),
            };
        }

        DatasetProbe {
            is_dataset: None,
            source: "metadata-fallback".to_string(),
            reason: None,
        }
    }

    fn probe_subdatasets(&self, project_path: &str) -> SubdatasetProbe {
        let args = vec![
            "-C".to_string(),
            project_path.to_string(),
            "subdatasets".to_string(),
            "--result-renderer".to_string(),
            "disabled".to_string(),
        ];
        let result = self.runner.run("datalad", &args, &RunOptions::default());

        if result.failed {
            return SubdatasetProbe {
                has_subdatasets: None,
                source: "metadata-fallback".to_string(),
                reason: None,
            };
        }

        let has_subdatasets = !result.stdout.trim().is_empty();
        SubdatasetProbe {
            has_subdatasets: Some(has_subdatasets),
            source: "datalad-subdatasets-probe".to_string(),
            reason: Some(if has_subdatasets {
                "DataLad subdatasets probe found at least one child dataset.".to_string()
            } else {
                "DataLad subdatasets probe found no child datasets.".to_string()
            }),
        }
    }

    fn has_registered_subdatasets(&self, project_path: &str) -> bool {
        let gitmodules_path = Path::new(project_path).join(".gitmodules");
        if !file_exists(&gitmodules_path) {
            return false;
        }

        if let Ok(content) = fs::read_to_string(gitmodules_path) {
            return content.contains("[submodule \"");
        }

        false
    }

    fn extract_command_warnings(
        &self,
        command_name: &str,
        run_result: &CommandResult,
    ) -> Vec<CommandWarning> {
        let stderr = run_result.stderr.trim();
        if stderr.is_empty() {
            return vec![];
        }

        let mut warnings = Vec::new();
        let stderr_lower = stderr.to_lowercase();

        if stderr_lower.contains("remote origin not usable by git-annex") {
            warnings.push(CommandWarning {
                code: "ORIGIN_NOT_ANNEX_REMOTE".to_string(),
                severity: "info".to_string(),
                message: "The origin remote is usable for Git metadata but does not provide git-annex content endpoints.".to_string(),
                action_hint: None,
            });
        }

        if stderr_lower.contains("/config") && stderr_lower.contains("download failed") && stderr_lower.contains("not found") {
            warnings.push(CommandWarning {
                code: "REMOTE_CONFIG_NOT_FOUND".to_string(),
                severity: "info".to_string(),
                message: "A remote git-annex config endpoint was not found. Dataset metadata clone can still succeed.".to_string(),
                action_hint: None,
            });
        }

        if let Some(sibling_name) = extract_sibling_name(stderr) {
            warnings.push(CommandWarning {
                code: "SIBLING_NOT_AUTO_ENABLED".to_string(),
                severity: "info".to_string(),
                message: format!(
                    "Sibling {} was discovered but not auto-enabled. Enable it if you need data from that source.",
                    sibling_name
                ),
                action_hint: Some(format!(
                    "datalad siblings -d \"<dataset-path>\" enable -s {}",
                    sibling_name
                )),
            });
        }

        if warnings.is_empty() && command_name == "cloneInstall" {
            warnings.push(CommandWarning {
                code: "CLONE_STDERR_OUTPUT".to_string(),
                severity: "info".to_string(),
                message:
                    "Clone completed with additional command output in stderr. Review details if needed."
                        .to_string(),
                action_hint: None,
            });
        }

        warnings
    }

    fn build_command(&self, command_name: &str, request: &Value) -> Result<CommandSpec, String> {
        match command_name {
            "cloneInstall" => Ok(CommandSpec {
                command: "datalad".to_string(),
                args: vec![
                    "clone".to_string(),
                    "-r".to_string(),
                    "--".to_string(),
                    request_required_string(request, "source")?,
                    request_required_string(request, "targetPath")?,
                ],
                options: RunOptions::default(),
            }),
            "createProject" => Ok(CommandSpec {
                command: "datalad".to_string(),
                args: vec![
                    "create".to_string(),
                    "--".to_string(),
                    request_required_string(request, "targetPath")?,
                ],
                options: RunOptions::default(),
            }),
            "get" => {
                let project_path = request_required_string(request, "projectPath")?;
                let mut args = vec![
                    "-C".to_string(),
                    project_path.clone(),
                    "get".to_string(),
                ];
                let paths = request_optional_paths(request)?;
                if !paths.is_empty() {
                    args.push("--".to_string());
                    args.extend(paths);
                }

                Ok(CommandSpec {
                    command: "datalad".to_string(),
                    args,
                    options: RunOptions {
                        cwd: Some(project_path),
                        env: HashMap::new(),
                    },
                })
            }
            "save" => {
                let project_path = request_required_string(request, "projectPath")?;
                let message = request_required_string(request, "message")?;
                let mut args = vec![
                    "-C".to_string(),
                    project_path.clone(),
                    "save".to_string(),
                    "-m".to_string(),
                    message,
                ];
                let paths = request_optional_paths(request)?;
                if !paths.is_empty() {
                    args.push("--".to_string());
                    args.extend(paths);
                }

                Ok(CommandSpec {
                    command: "datalad".to_string(),
                    args,
                    options: RunOptions {
                        cwd: Some(project_path),
                        env: HashMap::new(),
                    },
                })
            }
            "update" => {
                let project_path = request_required_string(request, "projectPath")?;
                Ok(CommandSpec {
                    command: "datalad".to_string(),
                    args: vec![
                        "-C".to_string(),
                        project_path.clone(),
                        "update".to_string(),
                        "--merge".to_string(),
                    ],
                    options: RunOptions {
                        cwd: Some(project_path),
                        env: HashMap::new(),
                    },
                })
            }
            "push" => {
                let project_path = request_required_string(request, "projectPath")?;
                Ok(CommandSpec {
                    command: "datalad".to_string(),
                    args: vec!["-C".to_string(), project_path.clone(), "push".to_string()],
                    options: RunOptions {
                        cwd: Some(project_path),
                        env: HashMap::new(),
                    },
                })
            }
            "createBranch" => {
                let project_path = request_required_string(request, "projectPath")?;
                let branch_name = request_required_string(request, "branchName")?;
                Ok(CommandSpec {
                    command: "git".to_string(),
                    args: vec![
                        "-C".to_string(),
                        project_path.clone(),
                        "checkout".to_string(),
                        "-b".to_string(),
                        branch_name,
                    ],
                    options: RunOptions {
                        cwd: Some(project_path),
                        env: HashMap::new(),
                    },
                })
            }
            "switchBranch" => {
                let project_path = request_required_string(request, "projectPath")?;
                let branch_name = request_required_string(request, "branchName")?;
                Ok(CommandSpec {
                    command: "git".to_string(),
                    args: vec![
                        "-C".to_string(),
                        project_path.clone(),
                        "checkout".to_string(),
                        branch_name,
                    ],
                    options: RunOptions {
                        cwd: Some(project_path),
                        env: HashMap::new(),
                    },
                })
            }
            _ => Err(format!("Unsupported command: {}", command_name)),
        }
    }
}

impl Default for DataLadAdapterCore<ProcessRunner> {
    fn default() -> Self {
        Self {
            runner: ProcessRunner,
        }
    }
}

struct PythonCandidate {
    command: &'static str,
    args: &'static [&'static str],
    label: &'static str,
}

fn python_candidates() -> Vec<PythonCandidate> {
    let mut candidates = vec![
        PythonCandidate {
            command: "python3",
            args: &["--version"],
            label: "python3 --version",
        },
        PythonCandidate {
            command: "python",
            args: &["--version"],
            label: "python --version",
        },
    ];

    if cfg!(target_os = "windows") {
        candidates.insert(
            0,
            PythonCandidate {
                command: "py",
                args: &["-3", "--version"],
                label: "py -3 --version",
            },
        );
    }

    candidates
}

fn first_line(text: &str) -> Option<&str> {
    text.lines().next().map(str::trim).filter(|line| !line.is_empty())
}

fn normalize_status_path(path_portion: &str, status_code: &str) -> String {
    let next_path = if (status_code.contains('R') || status_code.contains('C'))
        && path_portion.contains(" -> ")
    {
        path_portion
            .rsplit(" -> ")
            .next()
            .unwrap_or(path_portion)
    } else {
        path_portion
    };

    next_path
        .replace('\\', "/")
        .trim_start_matches("./")
        .trim()
        .to_string()
}

fn map_status_code(status_code: &str) -> &'static str {
    if status_code == "??" {
        return "untracked";
    }

    if status_code.contains('U') {
        return "conflict";
    }

    if status_code.contains('D') {
        return "deleted";
    }

    if status_code.contains('R') {
        return "renamed";
    }

    if status_code.contains('A') {
        return "added";
    }

    if status_code.contains('M') {
        return "modified";
    }

    "changed"
}

fn status_priority(status: &str) -> usize {
    match status {
        "conflict" => 6,
        "deleted" => 5,
        "renamed" => 4,
        "added" => 3,
        "modified" => 2,
        "untracked" => 1,
        _ => 0,
    }
}

fn merge_status_priority(left: &str, right: &str) -> String {
    if status_priority(right) > status_priority(left) {
        right.to_string()
    } else {
        left.to_string()
    }
}

fn parse_recent_commit_limit(options: Option<&Value>) -> i64 {
    let requested_limit = options
        .and_then(|value| value.get("limit"))
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|text| text.parse::<i64>().ok()))
        })
        .unwrap_or(20);

    requested_limit.clamp(1, 100)
}

fn non_empty(text: &str) -> Option<String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn build_command_result(
    command_name: &str,
    run_result: CommandResult,
    user_error: Option<UserError>,
    warnings: Vec<CommandWarning>,
) -> AdapterCommandResult {
    AdapterCommandResult {
        ok: !run_result.failed,
        command_name: command_name.to_string(),
        command: run_result.command,
        args: run_result.args,
        exit_code: run_result.exit_code,
        stdout: run_result.stdout,
        stderr: run_result.stderr,
        failed: run_result.failed,
        user_error,
        warnings,
    }
}

fn command_schema(command_name: &str) -> Option<(&'static [&'static str], &'static [&'static str])> {
    match command_name {
        "cloneInstall" => Some((&["source", "targetPath"], &[])),
        "createProject" => Some((&["targetPath"], &[])),
        "get" => Some((&["projectPath"], &["paths"])),
        "save" => Some((&["projectPath", "message"], &["paths"])),
        "update" => Some((&["projectPath"], &[])),
        "push" => Some((&["projectPath"], &[])),
        "createBranch" => Some((&["projectPath", "branchName"], &[])),
        "switchBranch" => Some((&["projectPath", "branchName"], &[])),
        _ => None,
    }
}

fn assert_command_request(command_name: &str, request: &Value) -> Result<(), String> {
    let (required, _) = command_schema(command_name)
        .ok_or_else(|| format!("Unsupported command: {}", command_name))?;

    if !request.is_object() {
        return Err(format!(
            "Invalid request for {}: request must be an object",
            command_name
        ));
    }

    for field in required {
        let value = request.get(*field);
        if value.is_none() {
            return Err(format!(
                "Invalid request for {}: missing required field {}",
                command_name, field
            ));
        }

        let is_empty = value
            .and_then(Value::as_str)
            .map(str::trim)
            .map(str::is_empty)
            .unwrap_or(false);
        if is_empty {
            return Err(format!(
                "Invalid request for {}: missing required field {}",
                command_name, field
            ));
        }
    }

    if let Some(paths) = request.get("paths") {
        if !paths.is_array() {
            return Err(format!(
                "Invalid request for {}: paths must be an array",
                command_name
            ));
        }
    }

    if matches!(command_name, "createBranch" | "switchBranch") {
        if let Some(branch_name) = request.get("branchName").and_then(Value::as_str) {
            if branch_name.trim().starts_with('-') {
                return Err(format!(
                    "Invalid request for {}: branchName cannot start with -",
                    command_name
                ));
            }
        }
    }

    Ok(())
}

fn request_required_string(request: &Value, field: &str) -> Result<String, String> {
    let value = request
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Missing or invalid field: {}", field))?;
    Ok(value.to_string())
}

fn request_optional_paths(request: &Value) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    if let Some(paths) = request.get("paths") {
        let values = paths
            .as_array()
            .ok_or_else(|| "Invalid request: paths must be an array".to_string())?;
        for path in values {
            let value = path
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Invalid request: each path must be a non-empty string".to_string())?;
            result.push(value.to_string());
        }
    }

    Ok(result)
}

fn map_command_error(command_name: &str, run_result: &CommandResult) -> UserError {
    let stderr = run_result.stderr.to_lowercase();
    let stdout = run_result.stdout.to_lowercase();
    let details = run_result.stderr.trim().to_string();

    // datalad reports this particular failure as a create(error) result line
    // on stdout, not stderr, so this one check needs to look at both streams.
    if command_name == "createProject"
        && (stdout.contains("not empty")
            || stdout.contains("non-empty")
            || stdout.contains("already exists")
            || stdout.contains("refuse to create")
            || stderr.contains("not empty")
            || stderr.contains("non-empty")
            || stderr.contains("already exists")
            || stderr.contains("refuse to create"))
    {
        let fallback_details = if details.is_empty() {
            run_result.stdout.trim().to_string()
        } else {
            details.clone()
        };
        return UserError {
            code: "TARGET_NOT_EMPTY".to_string(),
            title: "Folder already has content".to_string(),
            message: "DataLad will not create a new project inside a folder that already has files in it. Choose an empty or brand-new folder.".to_string(),
            technical_details: fallback_details,
        };
    }

    if command_name == "createBranch" && stderr.contains("already exists") {
        return UserError {
            code: "BRANCH_EXISTS".to_string(),
            title: "Branch already exists".to_string(),
            message:
                "A branch with this name already exists. Pick a different name or switch to the existing branch.".to_string(),
            technical_details: details,
        };
    }

    if command_name == "switchBranch"
        && (stderr.contains("pathspec")
            || stderr.contains("did not match any file")
            || stderr.contains("unknown revision"))
    {
        return UserError {
            code: "BRANCH_NOT_FOUND".to_string(),
            title: "Branch was not found".to_string(),
            message: "The selected branch does not exist in this project.".to_string(),
            technical_details: details,
        };
    }

    if (command_name == "createBranch" || command_name == "switchBranch")
        && (stderr.contains("local changes")
            || stderr.contains("would be overwritten")
            || stderr.contains("please commit your changes"))
    {
        return UserError {
            code: "WORKTREE_DIRTY".to_string(),
            title: "Please save or stash changes first".to_string(),
            message:
                "Branch changes are blocked because local edits would be overwritten. Save your work first, then try again.".to_string(),
            technical_details: details,
        };
    }

    if stderr.contains("command not found") || stderr.contains("enoent") || stderr.contains("not recognized") {
        return UserError {
            code: "TOOLING_MISSING".to_string(),
            title: "DataLad tooling is not available".to_string(),
            message: "The required DataLad tooling is missing on this system. Install DataLad and git-annex, then try again.".to_string(),
            technical_details: details,
        };
    }

    if stderr.contains("no configured push target")
        || stderr.contains("no sibling")
        || stderr.contains("no remote")
        || stderr.contains("could not determine remote")
    {
        return UserError {
            code: "REMOTE_MISSING".to_string(),
            title: "No publish destination is configured".to_string(),
            message: "This project does not have a configured remote destination for publishing.".to_string(),
            technical_details: details,
        };
    }

    if stderr.contains("authentication")
        || stderr.contains("permission denied")
        || stderr.contains("forbidden")
        || stderr.contains("unauthorized")
    {
        return UserError {
            code: "AUTH_FAILED".to_string(),
            title: "Authentication failed".to_string(),
            message:
                "DataLad Desktop could not authenticate with the remote destination. Check your credentials and try again.".to_string(),
            technical_details: details,
        };
    }

    if command_name == "get"
        && (stderr.contains("not available")
            || stderr.contains("cannot get")
            || stderr.contains("not present"))
    {
        return UserError {
            code: "CONTENT_UNAVAILABLE".to_string(),
            title: "Requested content is not available".to_string(),
            message: "The requested file content is currently unavailable from known remotes.".to_string(),
            technical_details: details,
        };
    }

    UserError {
        code: "UNKNOWN".to_string(),
        title: "DataLad command failed".to_string(),
        message: "DataLad Desktop could not finish this action. Please try again or review the technical details.".to_string(),
        technical_details: details,
    }
}

fn looks_like_no_dataset(stderr: &str) -> bool {
    let normalized = stderr.to_lowercase();
    normalized.contains("nodatasetfound")
        || normalized.contains("not a dataset")
        || normalized.contains("no dataset found")
        || normalized.contains("could not find dataset")
}

fn extract_sibling_name(stderr: &str) -> Option<String> {
    for line in stderr.lines() {
        let line_lower = line.to_lowercase();
        if line_lower.contains("dataset sibling") && line_lower.contains("not auto-enabled") {
            let tokens = line.split_whitespace().collect::<Vec<_>>();
            for index in 0..tokens.len() {
                if tokens[index].eq_ignore_ascii_case("sibling") && index + 1 < tokens.len() {
                    let candidate = tokens[index + 1]
                        .trim_matches(|character: char| character == ',' || character == ';' || character == '.')
                        .to_string();
                    if !candidate.is_empty() {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    None
}

fn file_exists(path: impl AsRef<Path>) -> bool {
    fs::metadata(path).is_ok()
}

fn read_subdataset_paths_from_gitmodules(project_path: &str) -> Vec<String> {
    let gitmodules_path = Path::new(project_path).join(".gitmodules");
    if !file_exists(&gitmodules_path) {
        return Vec::new();
    }

    let content = match fs::read_to_string(gitmodules_path) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };

    let mut results = Vec::new();
    let mut seen = HashSet::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("path") {
            continue;
        }

        let mut parts = trimmed.splitn(2, '=');
        let left = parts.next().unwrap_or("").trim();
        let right = parts.next().unwrap_or("").trim();
        if left == "path" && !right.is_empty() {
            let value = right.to_string();
            if seen.insert(value.clone()) {
                results.push(value);
            }
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process_runner::{CommandResult, CommandRunner, RunOptions};
    use serde_json::{json, to_value};
    use std::collections::HashMap;
    use std::fs::{create_dir_all, write};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Default)]
    struct FakeRunner {
        responses: HashMap<String, CommandResult>,
    }

    impl FakeRunner {
        fn with_response(mut self, command: &str, args: &[&str], response: CommandResult) -> Self {
            let key = format!("{}::{}", command, args.join(" "));
            self.responses.insert(key, response);
            self
        }

        fn with_response_owned(
            mut self,
            command: &str,
            args: Vec<String>,
            response: CommandResult,
        ) -> Self {
            let key = format!("{}::{}", command, args.join(" "));
            self.responses.insert(key, response);
            self
        }
    }

    impl CommandRunner for FakeRunner {
        fn run(&self, command: &str, args: &[String], _options: &RunOptions) -> CommandResult {
            let key = format!("{}::{}", command, args.join(" "));
            self.responses.get(&key).cloned().unwrap_or(CommandResult {
                command: command.to_string(),
                args: args.to_vec(),
                exit_code: 127,
                stdout: String::new(),
                stderr: "unmocked command".to_string(),
                failed: true,
            })
        }
    }

    fn ok_result(command: &str, args: &[&str], stdout: &str) -> CommandResult {
        CommandResult {
            command: command.to_string(),
            args: args.iter().map(|value| value.to_string()).collect(),
            exit_code: 0,
            stdout: stdout.to_string(),
            stderr: String::new(),
            failed: false,
        }
    }

    fn err_result(command: &str, args: &[&str], stderr: &str) -> CommandResult {
        CommandResult {
            command: command.to_string(),
            args: args.iter().map(|value| value.to_string()).collect(),
            exit_code: 127,
            stdout: String::new(),
            stderr: stderr.to_string(),
            failed: true,
        }
    }

    fn ok_result_owned(command: &str, args: &[String], stdout: &str) -> CommandResult {
        CommandResult {
            command: command.to_string(),
            args: args.to_vec(),
            exit_code: 0,
            stdout: stdout.to_string(),
            stderr: String::new(),
            failed: false,
        }
    }

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let now_nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be monotonic")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "{}-{}-{}",
            prefix,
            std::process::id(),
            now_nanos
        ));
        create_dir_all(&path).expect("temp dir should be created");
        path
    }

    #[test]
    fn check_environment_reports_missing_tools() {
        let runner = FakeRunner::default()
            .with_response(
                "python3",
                &["--version"],
                ok_result("python3", &["--version"], "Python 3.11.0\n"),
            )
            .with_response(
                "datalad",
                &["--version"],
                err_result("datalad", &["--version"], "command not found: datalad"),
            )
            .with_response(
                "git",
                &["annex", "version"],
                err_result("git", &["annex", "version"], "git: annex is not a git command"),
            );

        let adapter = DataLadAdapterCore::new(runner);
        let diagnostics = adapter.check_environment();

        assert!(!diagnostics.supported);
        assert!(diagnostics.python.available);
        assert!(!diagnostics.datalad.available);
        assert!(!diagnostics.git_annex.available);
        assert_eq!(diagnostics.report.severity, "warning");
    }

    #[test]
    fn interface_contract_serialization_matches_expected_fields() {
        let adapter = DataLadAdapterCore::new(FakeRunner::default());
        let contract = adapter.get_interface_contract();

        let serialized = to_value(&contract).expect("serialization should succeed");
        let object = serialized
            .as_object()
            .expect("serialized contract should be an object");

        assert!(object.contains_key("classificationValues"));
        assert!(!object.contains_key("classification_values"));

        let commands = object
            .get("commands")
            .and_then(Value::as_object)
            .expect("commands should be an object");

        assert!(commands.contains_key("save"));
        assert!(commands.contains_key("cloneInstall"));
    }

    #[test]
    fn run_command_executes_save_with_paths() {
        let project_path = "/tmp/project";
        let request = json!({
            "projectPath": project_path,
            "message": "checkpoint",
            "paths": ["a.txt", "b.txt"]
        });

        let runner = FakeRunner::default().with_response(
            "datalad",
            &[
                "-C",
                project_path,
                "save",
                "-m",
                "checkpoint",
                "--",
                "a.txt",
                "b.txt",
            ],
            ok_result(
                "datalad",
                &[
                    "-C",
                    project_path,
                    "save",
                    "-m",
                    "checkpoint",
                    "--",
                    "a.txt",
                    "b.txt",
                ],
                "saved",
            ),
        );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter
            .run_command("save", &request)
            .expect("run_command should succeed");

        assert!(result.ok);
        assert_eq!(result.command_name, "save");
        assert_eq!(result.command, "datalad");
        assert_eq!(result.exit_code, 0);
        assert_eq!(result.user_error, None);
    }

    #[test]
    fn run_command_success_serialization_matches_expected_fields() {
        let request = json!({
            "source": "https://example.org/ds.git",
            "targetPath": "/tmp/ds"
        });

        let runner = FakeRunner::default().with_response(
            "datalad",
            &["clone", "-r", "--", "https://example.org/ds.git", "/tmp/ds"],
            CommandResult {
                command: "datalad".to_string(),
                args: vec![
                    "clone".to_string(),
                    "-r".to_string(),
                    "--".to_string(),
                    "https://example.org/ds.git".to_string(),
                    "/tmp/ds".to_string(),
                ],
                exit_code: 0,
                stdout: "install(ok): /tmp/ds (dataset)".to_string(),
                stderr: "additional clone note".to_string(),
                failed: false,
            },
        );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter
            .run_command("cloneInstall", &request)
            .expect("run_command should succeed");

        assert!(result.ok);
        assert_eq!(result.command_name, "cloneInstall");
        assert_eq!(result.exit_code, 0);
        assert_eq!(result.warnings.len(), 1);
        assert_eq!(result.warnings[0].code, "CLONE_STDERR_OUTPUT");

        let serialized = to_value(&result).expect("serialization should succeed");
        let serialized_obj = serialized
            .as_object()
            .expect("serialized result should be an object");

        assert!(serialized_obj.contains_key("commandName"));
        assert!(serialized_obj.contains_key("exitCode"));
        assert!(serialized_obj.contains_key("userError"));
        assert!(!serialized_obj.contains_key("command_name"));
        assert!(!serialized_obj.contains_key("exit_code"));

        assert_eq!(
            serialized_obj.get("commandName").and_then(Value::as_str),
            Some("cloneInstall")
        );
        assert_eq!(
            serialized_obj.get("exitCode").and_then(Value::as_i64),
            Some(0)
        );
        assert!(
            serialized_obj
                .get("userError")
                .expect("userError key should exist")
                .is_null()
        );
    }

    #[test]
    fn run_command_failure_serialization_matches_expected_fields() {
        let request = json!({
            "projectPath": "/tmp/project"
        });

        let runner = FakeRunner::default().with_response(
            "datalad",
            &["-C", "/tmp/project", "push"],
            CommandResult {
                command: "datalad".to_string(),
                args: vec![
                    "-C".to_string(),
                    "/tmp/project".to_string(),
                    "push".to_string(),
                ],
                exit_code: 1,
                stdout: String::new(),
                stderr: "No configured push target for this dataset".to_string(),
                failed: true,
            },
        );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter
            .run_command("push", &request)
            .expect("run_command should return structured error result");

        assert!(!result.ok);
        assert!(result.failed);
        assert_eq!(result.command_name, "push");
        assert_eq!(
            result
                .user_error
                .as_ref()
                .map(|error| error.code.as_str()),
            Some("REMOTE_MISSING")
        );

        let serialized = to_value(&result).expect("serialization should succeed");
        let user_error = serialized
            .get("userError")
            .and_then(Value::as_object)
            .expect("userError object should be present");

        assert_eq!(
            user_error.get("code").and_then(Value::as_str),
            Some("REMOTE_MISSING")
        );
        assert!(user_error.contains_key("technicalDetails"));
        assert!(!user_error.contains_key("technical_details"));
    }

    #[test]
    fn detect_project_classifies_git_when_no_dataset() {
        let project_path = "/tmp/project";

        let runner = FakeRunner::default()
            .with_response(
                "git",
                &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                ok_result(
                    "git",
                    &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                    "true\n",
                ),
            )
            .with_response(
                "datalad",
                &["-C", project_path, "status", "--dataset", ".", "--json"],
                err_result(
                    "datalad",
                    &["-C", project_path, "status", "--dataset", ".", "--json"],
                    "NoDatasetFound: no dataset found at this location",
                ),
            );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter
            .detect_project(project_path)
            .expect("detect_project should succeed");

        assert_eq!(result.classification, "git");
    }

    #[test]
    fn detect_project_classifies_superdataset_from_probe() {
        let project_path = "/tmp/project";

        let runner = FakeRunner::default()
            .with_response(
                "git",
                &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                ok_result(
                    "git",
                    &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                    "true\n",
                ),
            )
            .with_response(
                "datalad",
                &["-C", project_path, "status", "--dataset", ".", "--json"],
                ok_result(
                    "datalad",
                    &["-C", project_path, "status", "--dataset", ".", "--json"],
                    "{\"status\":\"ok\"}\n",
                ),
            )
            .with_response(
                "datalad",
                &[
                    "-C",
                    project_path,
                    "subdatasets",
                    "--result-renderer",
                    "disabled",
                ],
                ok_result(
                    "datalad",
                    &[
                        "-C",
                        project_path,
                        "subdatasets",
                        "--result-renderer",
                        "disabled",
                    ],
                    "inputs\n",
                ),
            );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter
            .detect_project(project_path)
            .expect("detect_project should succeed");

        assert_eq!(result.classification, "superdataset");
        assert_eq!(
            result
                .classification_source
                .as_ref()
                .map(|source| source.subdatasets.clone()),
            Some("datalad-subdatasets-probe".to_string())
        );
    }

    #[test]
    fn run_command_extracts_clone_warnings() {
        let request = json!({
            "source": "https://example.org/ds.git",
            "targetPath": "/tmp/ds"
        });

        let stderr = [
            "[INFO] Remote origin not usable by git-annex; setting annex-ignore",
            "[INFO] https://example.org/ds.git/config download failed: Not Found",
            "[INFO] access to 1 dataset sibling s3-BACKUP not auto-enabled",
        ]
        .join("\n");

        let runner = FakeRunner::default().with_response(
            "datalad",
            &["clone", "-r", "--", "https://example.org/ds.git", "/tmp/ds"],
            CommandResult {
                command: "datalad".to_string(),
                args: vec![
                    "clone".to_string(),
                    "-r".to_string(),
                    "--".to_string(),
                    "https://example.org/ds.git".to_string(),
                    "/tmp/ds".to_string(),
                ],
                exit_code: 0,
                stdout: "install(ok): /tmp/ds (dataset)".to_string(),
                stderr,
                failed: false,
            },
        );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter
            .run_command("cloneInstall", &request)
            .expect("run_command should succeed");

        let warning_codes = result
            .warnings
            .iter()
            .map(|warning| warning.code.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            warning_codes,
            vec![
                "ORIGIN_NOT_ANNEX_REMOTE",
                "REMOTE_CONFIG_NOT_FOUND",
                "SIBLING_NOT_AUTO_ENABLED"
            ]
        );
    }

    #[test]
    fn run_command_builds_a_datalad_create_call_for_create_project() {
        let runner = FakeRunner::default().with_response(
            "datalad",
            &["create", "--", "/tmp/new-proj"],
            CommandResult {
                command: "datalad".to_string(),
                args: vec![
                    "create".to_string(),
                    "--".to_string(),
                    "/tmp/new-proj".to_string(),
                ],
                exit_code: 0,
                stdout: "create(ok): /tmp/new-proj (dataset)".to_string(),
                stderr: String::new(),
                failed: false,
            },
        );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter
            .run_command("createProject", &json!({ "targetPath": "/tmp/new-proj" }))
            .expect("run_command should succeed");

        assert!(!result.failed);
    }

    #[test]
    fn run_command_maps_create_project_failure_to_target_not_empty() {
        let runner = FakeRunner::default().with_response(
            "datalad",
            &["create", "--", "/tmp/existing"],
            CommandResult {
                command: "datalad".to_string(),
                args: vec![
                    "create".to_string(),
                    "--".to_string(),
                    "/tmp/existing".to_string(),
                ],
                exit_code: 1,
                stdout: "create(error): /tmp/existing (dataset) [will not create a dataset in a non-empty directory, use `--force` option to ignore]".to_string(),
                stderr: String::new(),
                failed: true,
            },
        );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter
            .run_command("createProject", &json!({ "targetPath": "/tmp/existing" }))
            .expect("run_command should return a result even on failure");

        assert!(result.failed);
        let user_error = result.user_error.expect("failed result should carry a user error");
        assert_eq!(user_error.code, "TARGET_NOT_EMPTY");
    }

    #[test]
    fn run_command_rejects_branch_names_that_start_with_dash() {
        let adapter = DataLadAdapterCore::new(FakeRunner::default());
        let error = adapter
            .run_command(
                "createBranch",
                &json!({
                    "projectPath": "/tmp/project",
                    "branchName": "--orphan"
                }),
            )
            .expect_err("run_command should reject branch names that look like flags");

        assert!(error.contains("branchName cannot start with -"));
    }

    #[test]
    fn list_branches_returns_sorted_branches_and_current() {
        let project_path = "/tmp/project";

        let runner = FakeRunner::default()
            .with_response(
                "git",
                &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                ok_result(
                    "git",
                    &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                    "true\n",
                ),
            )
            .with_response(
                "git",
                &["-C", project_path, "branch", "--format=%(refname:short)"],
                ok_result(
                    "git",
                    &["-C", project_path, "branch", "--format=%(refname:short)"],
                    "feature-z\nmain\nfeature-a\n",
                ),
            )
            .with_response(
                "git",
                &["-C", project_path, "branch", "--show-current"],
                ok_result(
                    "git",
                    &["-C", project_path, "branch", "--show-current"],
                    "main\n",
                ),
            );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter
            .list_branches(project_path)
            .expect("list_branches should succeed");

        assert_eq!(result.current_branch.as_deref(), Some("main"));
        assert!(!result.detached_head);
        assert_eq!(result.branches, vec!["feature-a", "feature-z", "main"]);
    }

    #[test]
    fn get_last_commit_parses_commit_payload() {
        let project_path = "/tmp/project";

        let runner = FakeRunner::default()
            .with_response(
                "git",
                &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                ok_result(
                    "git",
                    &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                    "true\n",
                ),
            )
            .with_response(
                "git",
                &["-C", project_path, "log", "-1", "--format=%ct%x00%h%x00%s%x00%B"],
                ok_result(
                    "git",
                    &["-C", project_path, "log", "-1", "--format=%ct%x00%h%x00%s%x00%B"],
                    "1716200000\0a1b2c3d\0checkpoint\0checkpoint\n\nwith details\n",
                ),
            );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter.get_last_commit(project_path);

        assert!(result.has_commit);
        assert_eq!(result.timestamp, Some(1716200000));
        assert_eq!(result.commit_hash.as_deref(), Some("a1b2c3d"));
        assert_eq!(result.subject.as_deref(), Some("checkpoint"));
        assert_eq!(result.message.as_deref(), Some("checkpoint\n\nwith details"));
    }

    #[test]
    fn get_last_commit_reports_no_commits_reason() {
        let project_path = "/tmp/project";

        let runner = FakeRunner::default()
            .with_response(
                "git",
                &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                ok_result(
                    "git",
                    &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                    "true\n",
                ),
            )
            .with_response(
                "git",
                &["-C", project_path, "log", "-1", "--format=%ct%x00%h%x00%s%x00%B"],
                err_result(
                    "git",
                    &["-C", project_path, "log", "-1", "--format=%ct%x00%h%x00%s%x00%B"],
                    "fatal: your current branch main does not have any commits yet",
                ),
            );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter.get_last_commit(project_path);

        assert!(!result.has_commit);
        assert_eq!(result.reason.as_deref(), Some("no-commits"));
    }

    #[test]
    fn list_datasets_serialization_matches_expected_fields() {
        let project_dir = unique_temp_dir("dlad-rust-list-datasets");
        let project_path = project_dir.to_string_lossy().to_string();

        write(
            project_dir.join(".gitmodules"),
            "[submodule \"inputs\"]\n\tpath = inputs\n\turl = ../inputs.git\n"
                .to_string()
                + "[submodule \"derivatives\"]\n\tpath = derivatives/fmriprep\n\turl = ../derivatives.git\n",
        )
        .expect(".gitmodules should be written");

        let rev_parse_args = vec![
            "-C".to_string(),
            project_path.clone(),
            "rev-parse".to_string(),
            "--is-inside-work-tree".to_string(),
        ];

        let runner = FakeRunner::default().with_response_owned(
            "git",
            rev_parse_args.clone(),
            ok_result_owned("git", &rev_parse_args, "true\n"),
        );

        let adapter = DataLadAdapterCore::new(runner);
        let datasets = adapter
            .list_datasets(&project_path)
            .expect("list_datasets should succeed");

        assert_eq!(datasets.len(), 3);
        assert_eq!(datasets[0].relative_path, ".");

        let serialized = to_value(&datasets).expect("serialization should succeed");
        let list = serialized
            .as_array()
            .expect("serialized datasets should be an array");
        let first = list[0]
            .as_object()
            .expect("serialized dataset entry should be an object");

        assert!(first.contains_key("relativePath"));
        assert!(!first.contains_key("relative_path"));
        assert_eq!(first.get("kind").and_then(Value::as_str), Some("root"));

        let second = list[1]
            .as_object()
            .expect("serialized dataset entry should be an object");
        assert_eq!(
            second.get("relativePath").and_then(Value::as_str),
            Some("inputs")
        );
    }

    #[test]
    fn list_branches_serialization_matches_expected_fields() {
        let project_path = "/tmp/project";

        let runner = FakeRunner::default()
            .with_response(
                "git",
                &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                ok_result(
                    "git",
                    &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                    "true\n",
                ),
            )
            .with_response(
                "git",
                &["-C", project_path, "branch", "--format=%(refname:short)"],
                ok_result(
                    "git",
                    &["-C", project_path, "branch", "--format=%(refname:short)"],
                    "feature-z\nmain\nfeature-a\n",
                ),
            )
            .with_response(
                "git",
                &["-C", project_path, "branch", "--show-current"],
                ok_result(
                    "git",
                    &["-C", project_path, "branch", "--show-current"],
                    "main\n",
                ),
            );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter
            .list_branches(project_path)
            .expect("list_branches should succeed");

        let serialized = to_value(&result).expect("serialization should succeed");
        let object = serialized
            .as_object()
            .expect("serialized branch result should be an object");

        assert!(object.contains_key("projectPath"));
        assert!(object.contains_key("currentBranch"));
        assert!(object.contains_key("detachedHead"));
        assert!(!object.contains_key("project_path"));
        assert!(!object.contains_key("current_branch"));
        assert!(!object.contains_key("detached_head"));
        assert_eq!(
            object.get("currentBranch").and_then(Value::as_str),
            Some("main")
        );
    }

    #[test]
    fn get_last_commit_serialization_matches_expected_fields() {
        let project_path = "/tmp/project";

        let runner = FakeRunner::default()
            .with_response(
                "git",
                &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                ok_result(
                    "git",
                    &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                    "true\n",
                ),
            )
            .with_response(
                "git",
                &["-C", project_path, "log", "-1", "--format=%ct%x00%h%x00%s%x00%B"],
                ok_result(
                    "git",
                    &["-C", project_path, "log", "-1", "--format=%ct%x00%h%x00%s%x00%B"],
                    "1716200000\0a1b2c3d\0checkpoint\0checkpoint\n\nwith details\n",
                ),
            );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter.get_last_commit(project_path);

        let serialized = to_value(&result).expect("serialization should succeed");
        let object = serialized
            .as_object()
            .expect("serialized commit result should be an object");

        assert!(object.contains_key("hasCommit"));
        assert!(object.contains_key("commitHash"));
        assert!(!object.contains_key("has_commit"));
        assert!(!object.contains_key("commit_hash"));
        assert!(!object.contains_key("reason"));
        assert_eq!(
            object.get("commitHash").and_then(Value::as_str),
            Some("a1b2c3d")
        );
    }

    #[test]
    fn get_last_commit_no_commit_serialization_includes_reason() {
        let project_path = "/tmp/project";

        let runner = FakeRunner::default()
            .with_response(
                "git",
                &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                ok_result(
                    "git",
                    &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                    "true\n",
                ),
            )
            .with_response(
                "git",
                &["-C", project_path, "log", "-1", "--format=%ct%x00%h%x00%s%x00%B"],
                err_result(
                    "git",
                    &["-C", project_path, "log", "-1", "--format=%ct%x00%h%x00%s%x00%B"],
                    "fatal: your current branch main does not have any commits yet",
                ),
            );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter.get_last_commit(project_path);

        let serialized = to_value(&result).expect("serialization should succeed");
        let object = serialized
            .as_object()
            .expect("serialized commit result should be an object");

        assert_eq!(object.get("hasCommit").and_then(Value::as_bool), Some(false));
        assert_eq!(object.get("reason").and_then(Value::as_str), Some("no-commits"));
        assert!(!object.contains_key("commitHash"));
    }

    #[test]
    fn detect_project_serialization_uses_classification_source_key() {
        let project_path = "/tmp/project";

        let runner = FakeRunner::default()
            .with_response(
                "git",
                &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                ok_result(
                    "git",
                    &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                    "true\n",
                ),
            )
            .with_response(
                "datalad",
                &["-C", project_path, "status", "--dataset", ".", "--json"],
                ok_result(
                    "datalad",
                    &["-C", project_path, "status", "--dataset", ".", "--json"],
                    "{\"status\":\"ok\"}\n",
                ),
            )
            .with_response(
                "datalad",
                &["-C", project_path, "subdatasets", "--result-renderer", "disabled"],
                ok_result(
                    "datalad",
                    &["-C", project_path, "subdatasets", "--result-renderer", "disabled"],
                    "inputs\n",
                ),
            );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter
            .detect_project(project_path)
            .expect("detect_project should succeed");

        let serialized = to_value(&result).expect("serialization should succeed");
        let object = serialized
            .as_object()
            .expect("serialized detect_project result should be an object");

        assert!(object.contains_key("projectPath"));
        assert!(object.contains_key("classificationSource"));
        assert!(!object.contains_key("project_path"));
        assert!(!object.contains_key("classification_source"));

        let source = object
            .get("classificationSource")
            .and_then(Value::as_object)
            .expect("classificationSource should be present for dataset classifications");
        assert_eq!(
            source.get("dataset").and_then(Value::as_str),
            Some("datalad-status-probe")
        );
        assert_eq!(
            source.get("subdatasets").and_then(Value::as_str),
            Some("datalad-subdatasets-probe")
        );
    }

    #[test]
    fn detect_project_git_serialization_omits_classification_source() {
        let project_path = "/tmp/project";

        let runner = FakeRunner::default()
            .with_response(
                "git",
                &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                ok_result(
                    "git",
                    &["-C", project_path, "rev-parse", "--is-inside-work-tree"],
                    "true\n",
                ),
            )
            .with_response(
                "datalad",
                &["-C", project_path, "status", "--dataset", ".", "--json"],
                err_result(
                    "datalad",
                    &["-C", project_path, "status", "--dataset", ".", "--json"],
                    "NoDatasetFound: no dataset found at this location",
                ),
            );

        let adapter = DataLadAdapterCore::new(runner);
        let result = adapter
            .detect_project(project_path)
            .expect("detect_project should succeed");

        let serialized = to_value(&result).expect("serialization should succeed");
        let object = serialized
            .as_object()
            .expect("serialized detect_project result should be an object");

        assert_eq!(
            object.get("classification").and_then(Value::as_str),
            Some("git")
        );
        assert!(!object.contains_key("classificationSource"));
    }
}
