use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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

    /// SHA-256 of the file at `download_url`, from Hugging Face's LFS
    /// metadata. A download that doesn't match is discarded.
    pub fn sha256(&self) -> &'static str {
        match self {
            ModelSize::Tiny => "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
            ModelSize::TinyQ8 => "c2085835d3f50733e2ff6e4b41ae8a2b8d8110461e18821b09a15c40c42d1cca",
            ModelSize::Base => "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
            ModelSize::BaseQ8 => "c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9",
            ModelSize::Small => "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
            ModelSize::SmallQ8 => "49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f",
            ModelSize::Medium => "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
            ModelSize::MediumQ8 => "42a1ffcbe4167d224232443396968db4d02d4e8e87e213d3ee2e03095dea6502",
            ModelSize::Large => "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2",
            ModelSize::LargeTurbo => "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
            ModelSize::LargeTurboQ8 => "317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1",
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
        // error_for_status: a 404 or 5xx page used to be saved as the model,
        // and then counted as downloaded.
        let response = reqwest::get(url)
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| TranscriptionError::DownloadError(e.to_string()))?;

        let total_size = response.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;

        // Create temporary file
        let temp_path = path.with_extension("tmp");
        let mut file = fs::File::create(&temp_path).await?;

        // Stream the download
        use futures_util::StreamExt;
        let mut stream = response.bytes_stream();
        let mut hasher = Sha256::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| TranscriptionError::DownloadError(e.to_string()))?;
            hasher.update(&chunk);
            file.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;
            on_progress(downloaded, total_size);
        }

        file.flush().await?;
        drop(file);

        let digest: String = hasher
            .finalize()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect();
        if digest != size.sha256() {
            let _ = fs::remove_file(&temp_path).await;
            return Err(TranscriptionError::DownloadError(
                "The downloaded model didn't match its checksum. Try again.".to_string(),
            ));
        }

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
