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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::to_value;

    fn available_status(version: &str) -> ToolStatus {
        ToolStatus {
            available: true,
            version: Some(version.to_string()),
            details: None,
        }
    }

    fn missing_status(details: &str) -> ToolStatus {
        ToolStatus {
            available: false,
            version: None,
            details: Some(details.to_string()),
        }
    }

    #[test]
    fn format_environment_diagnostics_builds_expected_info_report() {
        let diagnostics = format_environment_diagnostics(
            available_status("Python 3.12.2"),
            available_status("datalad 1.1.4"),
            available_status("git-annex version: 10.20240129"),
            vec![],
        );

        assert!(diagnostics.supported);
        assert_eq!(diagnostics.report.severity, "info");
        assert_eq!(diagnostics.report.recovery_steps.len(), 0);
        assert_eq!(diagnostics.report.checks.len(), 3);
        assert_eq!(diagnostics.report.checks[0].tool, "python");
        assert_eq!(diagnostics.report.checks[1].tool, "datalad");
        assert_eq!(diagnostics.report.checks[2].tool, "gitAnnex");
    }

    #[test]
    fn format_environment_diagnostics_dedupes_recovery_steps_in_issue_order() {
        let diagnostics = format_environment_diagnostics(
            missing_status("python missing"),
            missing_status("datalad missing"),
            missing_status("git-annex missing"),
            vec![
                EnvironmentIssue {
                    code: "DATALAD_MISSING".to_string(),
                    message: "DataLad missing".to_string(),
                },
                EnvironmentIssue {
                    code: "PYTHON_MISSING".to_string(),
                    message: "Python missing".to_string(),
                },
                EnvironmentIssue {
                    code: "DATALAD_MISSING".to_string(),
                    message: "DataLad still missing".to_string(),
                },
                EnvironmentIssue {
                    code: "UNKNOWN_CODE".to_string(),
                    message: "Unknown".to_string(),
                },
            ],
        );

        assert!(!diagnostics.supported);
        assert_eq!(diagnostics.report.severity, "warning");
        assert_eq!(diagnostics.report.recovery_steps.len(), 2);
        assert_eq!(
            diagnostics.report.recovery_steps[0],
            "Install DataLad and confirm the datalad command works in your shell."
        );
        assert_eq!(
            diagnostics.report.recovery_steps[1],
            "Install Python 3 and ensure one of these commands is available in PATH: python3, python, or py -3 (Windows)."
        );
    }

    #[test]
    fn diagnostics_serialization_uses_expected_json_field_names() {
        let diagnostics = format_environment_diagnostics(
            missing_status("python missing"),
            missing_status("datalad missing"),
            available_status("git-annex version: 10.20240129"),
            vec![EnvironmentIssue {
                code: "PYTHON_MISSING".to_string(),
                message: "Python missing".to_string(),
            }],
        );

        let serialized = to_value(&diagnostics).expect("serialization should succeed");
        let object = serialized
            .as_object()
            .expect("serialized diagnostics should be an object");

        assert!(object.contains_key("gitAnnex"));
        assert!(!object.contains_key("git_annex"));

        let report = object
            .get("report")
            .and_then(|value| value.as_object())
            .expect("report should be present");
        assert!(report.contains_key("checks"));
        assert!(report.contains_key("recoverySteps"));
        assert!(!report.contains_key("recovery_steps"));
    }
}
