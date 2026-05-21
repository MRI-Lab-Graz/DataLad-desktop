use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolStatus {
    pub available: bool,
    pub version: Option<String>,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EnvironmentIssue {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EnvironmentCheck {
    pub tool: String,
    pub label: String,
    pub status: String,
    pub version: Option<String>,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EnvironmentReport {
    pub severity: String,
    pub headline: String,
    pub summary: String,
    #[serde(rename = "checks")]
    pub checks: Vec<EnvironmentCheck>,
    #[serde(rename = "recoverySteps")]
    pub recovery_steps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EnvironmentDiagnostics {
    pub python: ToolStatus,
    pub datalad: ToolStatus,
    #[serde(rename = "gitAnnex")]
    pub git_annex: ToolStatus,
    pub supported: bool,
    pub issues: Vec<EnvironmentIssue>,
    pub report: EnvironmentReport,
}

pub fn format_environment_diagnostics(
    python: ToolStatus,
    datalad: ToolStatus,
    git_annex: ToolStatus,
    issues: Vec<EnvironmentIssue>,
) -> EnvironmentDiagnostics {
    let supported = issues.is_empty();
    let checks = vec![
        format_check("python", "Python 3", &python),
        format_check("datalad", "DataLad", &datalad),
        format_check("gitAnnex", "git-annex", &git_annex),
    ];

    let mut recovery_steps = Vec::new();
    for issue in &issues {
        if let Some(step) = recovery_for_issue(&issue.code) {
            if !recovery_steps.contains(&step.to_string()) {
                recovery_steps.push(step.to_string());
            }
        }
    }

    let report = EnvironmentReport {
        severity: if supported {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        headline: if supported {
            "DataLad environment is ready".to_string()
        } else {
            "DataLad setup needs attention".to_string()
        },
        summary: if supported {
            "All required tools are available. You can continue with DataLad project actions."
                .to_string()
        } else {
            "One or more required tools are missing. Resolve the items below before using DataLad actions."
                .to_string()
        },
        checks,
        recovery_steps,
    };

    EnvironmentDiagnostics {
        python,
        datalad,
        git_annex,
        supported,
        issues,
        report,
    }
}

fn format_check(tool: &str, label: &str, status: &ToolStatus) -> EnvironmentCheck {
    EnvironmentCheck {
        tool: tool.to_string(),
        label: label.to_string(),
        status: if status.available {
            "ok".to_string()
        } else {
            "missing".to_string()
        },
        version: status.version.clone(),
        details: status.details.clone(),
    }
}

fn recovery_for_issue(issue_code: &str) -> Option<&'static str> {
    match issue_code {
        "PYTHON_MISSING" => Some(
            "Install Python 3 and ensure one of these commands is available in PATH: python3, python, or py -3 (Windows).",
        ),
        "DATALAD_MISSING" => {
            Some("Install DataLad and confirm the datalad command works in your shell.")
        }
        "GIT_ANNEX_MISSING" => {
            Some("Install git-annex and ensure it is available to your Git installation.")
        }
        _ => None,
    }
}
