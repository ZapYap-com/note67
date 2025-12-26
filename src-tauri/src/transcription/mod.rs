pub mod live;
pub mod model;
pub mod transcriber;

pub use live::{AudioSource, LiveTranscriptionState, TranscriptionUpdateEvent};
pub use model::{ModelInfo, ModelManager, ModelSize};
pub use transcriber::{TranscriptionResult, TranscriptionSegment, Transcriber};

use thiserror::Error;

#[derive(Error, Debug)]
pub enum TranscriptionError {
    #[error("Model not found: {0}")]
    ModelNotFound(String),

    #[error("Model download failed: {0}")]
    DownloadError(String),

    #[error("Failed to load model: {0}")]
    ModelLoadError(String),

    #[error("Transcription failed: {0}")]
    TranscriptionFailed(String),

    #[error("Audio file not found: {0}")]
    AudioNotFound(String),

    #[error("Unsupported audio format")]
    UnsupportedFormat,

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Already transcribing")]
    AlreadyTranscribing,

    #[error("Not transcribing")]
    NotTranscribing,
}
