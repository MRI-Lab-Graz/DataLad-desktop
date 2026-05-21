use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunOptions {
    pub cwd: Option<String>,
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommandResult {
    pub command: String,
    pub args: Vec<String>,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub failed: bool,
}

pub trait CommandRunner {
    fn run(&self, command: &str, args: &[String], options: &RunOptions) -> CommandResult;
}

#[derive(Debug, Clone, Default)]
pub struct ProcessRunner;

impl CommandRunner for ProcessRunner {
    fn run(&self, command: &str, args: &[String], options: &RunOptions) -> CommandResult {
        let mut cmd = Command::new(command);
        cmd.args(args);

        if let Some(cwd) = &options.cwd {
            cmd.current_dir(cwd);
        }

        if !options.env.is_empty() {
            cmd.envs(&options.env);
        }

        let output = cmd.output();

        match output {
            Ok(output) => {
                let exit_code = output.status.code().unwrap_or(1);
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();

                CommandResult {
                    command: command.to_string(),
                    args: args.to_vec(),
                    exit_code,
                    stdout,
                    stderr,
                    failed: exit_code != 0,
                }
            }
            Err(error) => CommandResult {
                command: command.to_string(),
                args: args.to_vec(),
                exit_code: 127,
                stdout: String::new(),
                stderr: error.to_string(),
                failed: true,
            },
        }
    }
}
