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
    /// Moondream's Parakeet Ultra, run by `wavo`. Not a Whisper model: a
    /// different engine, and only 25 European languages.
    ParakeetUltra,
}

/// Which engine runs a model. They take different inputs and support
/// different languages, so the difference is not an implementation detail.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EngineKind {
    Whisper,
    Parakeet,
}

/// The 25 languages Parakeet Ultra was trained on, as note67's language codes.
///
/// Nine of them are in the list note67 offers (en, es, fr, de, pt, ru, it, nl,
/// pl); the rest of that list — Chinese, Japanese, Korean, Turkish, Arabic,
/// Hindi, Vietnamese, Thai, Indonesian, Malay and Tagalog — Parakeet cannot
/// transcribe at all, which is what the Settings screen has to make plain.
pub const PARAKEET_LANGUAGES: &[&str] = &[
    "en", "de", "fr", "es", "it", "pt", "ru", "uk", "hr", "sl", "lv", "lt", "et", "fi", "sv", "da",
    "nl", "pl", "cs", "sk", "hu", "ro", "bg", "el", "mt",
];

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
            ModelSize::ParakeetUltra => "parakeet-ultra",
        }
    }

    /// Which engine runs this model.
    pub fn engine_kind(&self) -> EngineKind {
        match self {
            ModelSize::ParakeetUltra => EngineKind::Parakeet,
            _ => EngineKind::Whisper,
        }
    }

    /// The languages this model can transcribe, or `None` when it covers every
    /// language note67 offers (every Whisper model does).
    pub fn languages(&self) -> Option<&'static [&'static str]> {
        match self.engine_kind() {
            EngineKind::Whisper => None,
            EngineKind::Parakeet => Some(PARAKEET_LANGUAGES),
        }
    }

    /// Whether this model can transcribe `code` (a note67 language code).
    pub fn supports_language(&self, code: &str) -> bool {
        match self.languages() {
            None => true,
            Some(langs) => langs.contains(&code),
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
            // transcribe.cpp's GGUF conversion, the file `wavo` loads.
            ModelSize::ParakeetUltra => "https://huggingface.co/handy-computer/parakeet-ultra-gguf/resolve/main/parakeet-ultra-Q8_0.gguf",
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
            ModelSize::ParakeetUltra => "007a59761e9258779f189df396b50d12b83bb5b79e66df4b955c230d2f2a0a59",
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
            ModelSize::ParakeetUltra => 740,
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
            ModelSize::ParakeetUltra => "parakeet-ultra-Q8_0.gguf",
        }
    }

    pub fn all() -> &'static [ModelSize] {
        &[
            ModelSize::LargeTurbo,
            ModelSize::LargeTurboQ8,
            ModelSize::ParakeetUltra,
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
    /// Which engine runs it.
    pub engine: EngineKind,
    /// The languages it can transcribe, or `None` for every language note67
    /// offers. The Settings screen uses this to say what a model cannot do
    /// before the user picks it.
    pub languages: Option<Vec<String>>,
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
                    engine: size.engine_kind(),
                    languages: size
                        .languages()
                        .map(|l| l.iter().map(|c| c.to_string()).collect()),
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

#[cfg(test)]
mod tests {
    use super::{EngineKind, ModelSize, PARAKEET_LANGUAGES};

    /// Every language note67 offers in Settings.
    const OFFERED: &[&str] = &[
        "en", "zh", "es", "fr", "de", "ja", "ko", "pt", "ru", "it", "nl", "pl", "tr", "ar", "hi",
        "vi", "th", "id", "ms", "tl",
    ];

    #[test]
    fn whisper_models_cover_every_language_offered() {
        for size in ModelSize::all() {
            if size.engine_kind() != EngineKind::Whisper {
                continue;
            }
            assert!(size.languages().is_none(), "{} should cover all", size.as_str());
            for code in OFFERED {
                assert!(size.supports_language(code), "{} / {code}", size.as_str());
            }
        }
    }

    #[test]
    fn parakeet_covers_nine_of_the_languages_offered() {
        // The whole reason the UI has to talk about languages. If this list
        // ever changes, the Settings copy ("25 European languages") and the
        // README have to change with it.
        let covered: Vec<&str> = OFFERED
            .iter()
            .copied()
            .filter(|c| ModelSize::ParakeetUltra.supports_language(c))
            .collect();
        assert_eq!(covered, ["en", "es", "fr", "de", "pt", "ru", "it", "nl", "pl"]);
    }

    #[test]
    fn parakeet_cannot_do_the_cjk_and_other_languages() {
        // Transcribing these with Parakeet would produce confident nonsense in
        // the Latin alphabet, so the engine must refuse rather than try.
        for code in ["zh", "ja", "ko", "tr", "ar", "hi", "vi", "th", "id", "ms", "tl"] {
            assert!(
                !ModelSize::ParakeetUltra.supports_language(code),
                "Parakeet must not claim {code}"
            );
        }
    }

    #[test]
    fn parakeet_lists_twenty_five_languages() {
        assert_eq!(PARAKEET_LANGUAGES.len(), 25);
        assert_eq!(
            ModelSize::ParakeetUltra.languages().map(|l| l.len()),
            Some(25)
        );
    }

    #[test]
    fn every_model_has_distinct_coherent_metadata() {
        // A copy-pasted arm (same filename or checksum as another model) would
        // make one model overwrite or fail to verify the other.
        let all = ModelSize::all();
        for (i, a) in all.iter().enumerate() {
            assert_eq!(a.sha256().len(), 64, "{}", a.as_str());
            assert!(a.download_url().starts_with("https://"), "{}", a.as_str());
            assert!(a.size_mb() > 0, "{}", a.as_str());
            for b in &all[i + 1..] {
                assert_ne!(a.filename(), b.filename(), "{} vs {}", a.as_str(), b.as_str());
                assert_ne!(a.sha256(), b.sha256(), "{} vs {}", a.as_str(), b.as_str());
                assert_ne!(a.as_str(), b.as_str(), "duplicate name");
            }
        }
    }

    #[test]
    fn the_parakeet_model_is_the_gguf_wavo_loads() {
        // wavo takes the Q8_0 GGUF; a .bin here would fail at load time.
        assert_eq!(ModelSize::ParakeetUltra.filename(), "parakeet-ultra-Q8_0.gguf");
        assert!(ModelSize::ParakeetUltra.download_url().ends_with(".gguf"));
        assert_eq!(ModelSize::ParakeetUltra.engine_kind(), EngineKind::Parakeet);
    }
}
