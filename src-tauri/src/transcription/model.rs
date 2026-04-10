use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;
use tokio::io::AsyncWriteExt;

use super::TranscriptionError;

/// Available Whisper model variants
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ModelSize {
    Tiny,
    TinyQ8,
    Base,
    BaseQ8,
    Small,
    SmallQ8,
    Medium,
    MediumQ8,
    Large,
    LargeTurbo,
    LargeTurboQ8,
}

impl ModelSize {
    pub fn as_str(&self) -> &'static str {
        match self {
            ModelSize::Tiny => "tiny",
            ModelSize::TinyQ8 => "tiny-q8",
            ModelSize::Base => "base",
            ModelSize::BaseQ8 => "base-q8",
            ModelSize::Small => "small",
            ModelSize::SmallQ8 => "small-q8",
            ModelSize::Medium => "medium",
            ModelSize::MediumQ8 => "medium-q8",
            ModelSize::Large => "large",
            ModelSize::LargeTurbo => "large-turbo",
            ModelSize::LargeTurboQ8 => "large-turbo-q8",
        }
    }

    /// Get download URL for the model from Hugging Face
    pub fn download_url(&self) -> &'static str {
        match self {
            ModelSize::Tiny => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
            ModelSize::TinyQ8 => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q8_0.bin",
            ModelSize::Base => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
            ModelSize::BaseQ8 => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q8_0.bin",
            ModelSize::Small => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
            ModelSize::SmallQ8 => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin",
            ModelSize::Medium => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
            ModelSize::MediumQ8 => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q8_0.bin",
            ModelSize::Large => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
            ModelSize::LargeTurbo => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
            ModelSize::LargeTurboQ8 => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin",
        }
    }

    /// Get approximate file size in MB
    pub fn size_mb(&self) -> u64 {
        match self {
            ModelSize::Tiny => 75,
            ModelSize::TinyQ8 => 44,
            ModelSize::Base => 142,
            ModelSize::BaseQ8 => 82,
            ModelSize::Small => 466,
            ModelSize::SmallQ8 => 264,
            ModelSize::Medium => 1500,
            ModelSize::MediumQ8 => 823,
            ModelSize::Large => 3100,
            ModelSize::LargeTurbo => 1620,
            ModelSize::LargeTurboQ8 => 874,
        }
    }

    /// Get filename for the model
    pub fn filename(&self) -> &'static str {
        match self {
            ModelSize::Tiny => "ggml-tiny.bin",
            ModelSize::TinyQ8 => "ggml-tiny-q8_0.bin",
            ModelSize::Base => "ggml-base.bin",
            ModelSize::BaseQ8 => "ggml-base-q8_0.bin",
            ModelSize::Small => "ggml-small.bin",
            ModelSize::SmallQ8 => "ggml-small-q8_0.bin",
            ModelSize::Medium => "ggml-medium.bin",
            ModelSize::MediumQ8 => "ggml-medium-q8_0.bin",
            ModelSize::Large => "ggml-large-v3.bin",
            ModelSize::LargeTurbo => "ggml-large-v3-turbo.bin",
            ModelSize::LargeTurboQ8 => "ggml-large-v3-turbo-q8_0.bin",
        }
    }

    pub fn all() -> &'static [ModelSize] {
        &[
            ModelSize::LargeTurbo,
            ModelSize::LargeTurboQ8,
            ModelSize::Tiny,
            ModelSize::TinyQ8,
            ModelSize::Base,
            ModelSize::BaseQ8,
            ModelSize::Small,
            ModelSize::SmallQ8,
            ModelSize::Medium,
            ModelSize::MediumQ8,
            ModelSize::Large,
        ]
    }
}

/// Information about a model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub size: ModelSize,
    pub name: String,
    pub downloaded: bool,
    pub path: Option<String>,
    pub size_mb: u64,
}

/// Manages whisper model downloads and paths
#[derive(Clone)]
pub struct ModelManager {
    models_dir: PathBuf,
}

impl ModelManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let models_dir = app_data_dir.join("models");
        Self { models_dir }
    }

    /// Get the models directory path
    #[allow(dead_code)]
    pub fn models_dir(&self) -> &PathBuf {
        &self.models_dir
    }

    /// Ensure the models directory exists
    pub async fn init(&self) -> Result<(), TranscriptionError> {
        fs::create_dir_all(&self.models_dir).await?;
        Ok(())
    }

    /// Get the path to a model file
    pub fn model_path(&self, size: ModelSize) -> PathBuf {
        self.models_dir.join(size.filename())
    }

    /// Check if a model is downloaded
    pub fn is_downloaded(&self, size: ModelSize) -> bool {
        self.model_path(size).exists()
    }

    /// Get info for all models
    pub fn list_models(&self) -> Vec<ModelInfo> {
        ModelSize::all()
            .iter()
            .map(|&size| {
                let downloaded = self.is_downloaded(size);
                let path = if downloaded {
                    Some(self.model_path(size).to_string_lossy().to_string())
                } else {
                    None
                };
                ModelInfo {
                    size,
                    name: size.as_str().to_string(),
                    downloaded,
                    path,
                    size_mb: size.size_mb(),
                }
            })
            .collect()
    }

    /// Download a model with progress callback
    pub async fn download_model<F>(
        &self,
        size: ModelSize,
        on_progress: F,
    ) -> Result<PathBuf, TranscriptionError>
    where
        F: Fn(u64, u64) + Send + 'static,
    {
        self.init().await?;

        let url = size.download_url();
        let path = self.model_path(size);

        // If already downloaded, return the path
        if path.exists() {
            return Ok(path);
        }

        // Download the model
        let response = reqwest::get(url)
            .await
            .map_err(|e| TranscriptionError::DownloadError(e.to_string()))?;

        let total_size = response.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;

        // Create temporary file
        let temp_path = path.with_extension("tmp");
        let mut file = fs::File::create(&temp_path).await?;

        // Stream the download
        use futures_util::StreamExt;
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| TranscriptionError::DownloadError(e.to_string()))?;
            file.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;
            on_progress(downloaded, total_size);
        }

        file.flush().await?;
        drop(file);

        // Rename temp file to final path
        fs::rename(&temp_path, &path).await?;

        Ok(path)
    }

    /// Delete a downloaded model
    pub async fn delete_model(&self, size: ModelSize) -> Result<(), TranscriptionError> {
        let path = self.model_path(size);
        if path.exists() {
            fs::remove_file(path).await?;
        }
        Ok(())
    }
}
