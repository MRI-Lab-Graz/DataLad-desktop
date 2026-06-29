use datalad_desktop_core::{DataLadAdapterCore, ProcessRunner};
use napi::Error;
use napi_derive::napi;
use serde_json::{to_value, Value};

#[napi]
pub struct Adapter {
    inner: DataLadAdapterCore<ProcessRunner>,
}

#[napi]
impl Adapter {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            inner: DataLadAdapterCore::default(),
        }
    }

    #[napi(js_name = "checkEnvironment")]
    pub fn check_environment(&self) -> napi::Result<Value> {
        to_value(self.inner.check_environment())
            .map_err(|error| Error::from_reason(error.to_string()))
    }

    #[napi(js_name = "detectProject")]
    pub fn detect_project(&self, project_path: String) -> napi::Result<Value> {
        let result = self
            .inner
            .detect_project(&project_path)
            .map_err(Error::from_reason)?;
        to_value(result).map_err(|error| Error::from_reason(error.to_string()))
    }

    #[napi(js_name = "runCommand")]
    pub fn run_command(&self, command_name: String, request: Value) -> napi::Result<Value> {
        let result = self
            .inner
            .run_command(&command_name, &request)
            .map_err(Error::from_reason)?;
        to_value(result).map_err(|error| Error::from_reason(error.to_string()))
    }

    #[napi(js_name = "getInterfaceContract")]
    pub fn get_interface_contract(&self) -> napi::Result<Value> {
        to_value(self.inner.get_interface_contract())
            .map_err(|error| Error::from_reason(error.to_string()))
    }

    #[napi(js_name = "listDatasets")]
    pub fn list_datasets(&self, project_path: String) -> napi::Result<Value> {
        let result = self
            .inner
            .list_datasets(&project_path)
            .map_err(Error::from_reason)?;
        to_value(result).map_err(|error| Error::from_reason(error.to_string()))
    }

    #[napi(js_name = "listBranches")]
    pub fn list_branches(&self, project_path: String) -> napi::Result<Value> {
        let result = self
            .inner
            .list_branches(&project_path)
            .map_err(Error::from_reason)?;
        to_value(result).map_err(|error| Error::from_reason(error.to_string()))
    }

    #[napi(js_name = "getLastCommit")]
    pub fn get_last_commit(&self, project_path: String) -> napi::Result<Value> {
        to_value(self.inner.get_last_commit(&project_path))
            .map_err(|error| Error::from_reason(error.to_string()))
    }

    #[napi(js_name = "getWorkingTreeStatus")]
    pub fn get_working_tree_status(&self, project_path: String) -> napi::Result<Value> {
        let result = self
            .inner
            .get_working_tree_status(&project_path)
            .map_err(Error::from_reason)?;
        to_value(result).map_err(|error| Error::from_reason(error.to_string()))
    }

    #[napi(js_name = "listRecentCommits")]
    pub fn list_recent_commits(
        &self,
        project_path: String,
        options: Option<Value>,
    ) -> napi::Result<Value> {
        let result = self
            .inner
            .list_recent_commits(&project_path, options.as_ref())
            .map_err(Error::from_reason)?;
        to_value(result).map_err(|error| Error::from_reason(error.to_string()))
    }
}

#[napi(js_name = "createAdapter")]
pub fn create_adapter() -> Adapter {
    Adapter::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn adapter_exposes_expected_contract_shape() {
        let adapter = Adapter::new();
        let contract = adapter
            .get_interface_contract()
            .expect("get_interface_contract should succeed");

        assert_eq!(
            contract.get("version").and_then(Value::as_str),
            Some("0.5.0")
        );

        let commands = contract
            .get("commands")
            .and_then(Value::as_object)
            .expect("commands object should be present");
        assert!(commands.contains_key("save"));
        assert!(commands.contains_key("cloneInstall"));
    }

    #[test]
    fn adapter_run_command_surfaces_validation_errors() {
        let adapter = Adapter::new();
        let error = adapter
            .run_command(
                "save".to_string(),
                json!({
                    "projectPath": "/tmp/project",
                    "message": "checkpoint",
                    "paths": "not-an-array"
                }),
            )
            .expect_err("run_command should return validation error");

        let error_text = error.to_string();
        assert!(error_text.contains("paths must be an array"));
    }

    #[test]
    fn adapter_check_environment_returns_diagnostics_shape() {
        let adapter = Adapter::new();
        let diagnostics = adapter
            .check_environment()
            .expect("check_environment should succeed");

        assert!(diagnostics.get("supported").is_some());
        assert!(diagnostics.get("report").is_some());
        assert!(diagnostics.get("issues").is_some());
    }
}
