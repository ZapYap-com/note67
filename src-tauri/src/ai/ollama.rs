use serde::{Deserialize, Serialize};
use thiserror::Error;

const OLLAMA_BASE_URL: &str = "http://localhost:11434";

#[derive(Error, Debug)]
pub enum OllamaError {
    #[error("Ollama is not running. Please start Ollama first.")]
    NotRunning,
    #[error("Model not found: {0}")]
    ModelNotFound(String),
    #[error("Request failed: {0}")]
    RequestFailed(String),
    #[error("Invalid response: {0}")]
    InvalidResponse(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
    pub modified_at: String,
    #[serde(default)]
    pub digest: String,
}

#[derive(Debug, Deserialize)]
struct ListModelsResponse {
    models: Vec<OllamaModel>,
}

#[derive(Debug, Serialize)]
struct GenerateRequest {
    model: String,
    prompt: String,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<GenerateOptions>,
}

#[derive(Debug, Serialize)]
struct GenerateOptions {
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    num_ctx: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct GenerateResponse {
    response: String,
    done: bool,
    #[serde(default)]
    context: Vec<i64>,
    #[serde(default)]
    total_duration: u64,
    #[serde(default)]
    eval_count: u32,
}

pub struct OllamaClient {
    client: reqwest::Client,
    base_url: String,
}

impl OllamaClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: OLLAMA_BASE_URL.to_string(),
        }
    }

    /// Check if Ollama is running
    pub async fn is_running(&self) -> bool {
        match self.client.get(&self.base_url).send().await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    /// List available models
    pub async fn list_models(&self) -> Result<Vec<OllamaModel>, OllamaError> {
        let url = format!("{}/api/tags", self.base_url);

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| {
                if e.is_connect() {
                    OllamaError::NotRunning
                } else {
                    OllamaError::RequestFailed(e.to_string())
                }
            })?;

        if !response.status().is_success() {
            return Err(OllamaError::RequestFailed(format!(
                "Status: {}",
                response.status()
            )));
        }

        let list: ListModelsResponse = response
            .json()
            .await
            .map_err(|e| OllamaError::InvalidResponse(e.to_string()))?;

        Ok(list.models)
    }

    /// Generate text using a model
    pub async fn generate(
        &self,
        model: &str,
        prompt: &str,
        temperature: f32,
        context_length: Option<u32>,
    ) -> Result<String, OllamaError> {
        let url = format!("{}/api/generate", self.base_url);

        let request = GenerateRequest {
            model: model.to_string(),
            prompt: prompt.to_string(),
            stream: false,
            options: Some(GenerateOptions {
                temperature,
                num_ctx: context_length,
            }),
        };

        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                if e.is_connect() {
                    OllamaError::NotRunning
                } else {
                    OllamaError::RequestFailed(e.to_string())
                }
            })?;

        if response.status().as_u16() == 404 {
            return Err(OllamaError::ModelNotFound(model.to_string()));
        }

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(OllamaError::RequestFailed(format!(
                "Status: {}, Body: {}",
                status, body
            )));
        }

        let gen_response: GenerateResponse = response
            .json()
            .await
            .map_err(|e| OllamaError::InvalidResponse(e.to_string()))?;

        Ok(gen_response.response)
    }

    /// Pull (download) a model
    pub async fn pull_model(&self, model: &str) -> Result<(), OllamaError> {
        let url = format!("{}/api/pull", self.base_url);

        #[derive(Serialize)]
        struct PullRequest {
            name: String,
            stream: bool,
        }

        let request = PullRequest {
            name: model.to_string(),
            stream: false,
        };

        let response = self
            .client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                if e.is_connect() {
                    OllamaError::NotRunning
                } else {
                    OllamaError::RequestFailed(e.to_string())
                }
            })?;

        if !response.status().is_success() {
            return Err(OllamaError::RequestFailed(format!(
                "Failed to pull model: {}",
                response.status()
            )));
        }

        Ok(())
    }
}

impl Default for OllamaClient {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ollama_client_creation() {
        let client = OllamaClient::new();
        assert_eq!(client.base_url, OLLAMA_BASE_URL);
    }
}
