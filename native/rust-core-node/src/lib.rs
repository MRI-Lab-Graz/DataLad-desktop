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
}

#[napi(js_name = "createAdapter")]
pub fn create_adapter() -> Adapter {
    Adapter::new()
}
