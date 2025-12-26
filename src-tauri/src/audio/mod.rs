pub mod recorder;

pub use recorder::{start_recording, stop_recording, RecordingState};

use thiserror::Error;

#[derive(Error, Debug)]
pub enum AudioError {
    #[error("No input device available")]
    NoInputDevice,

    #[error("Already recording")]
    AlreadyRecording,

    #[error("Not recording")]
    NotRecording,

    #[error("Unsupported audio format")]
    UnsupportedFormat,

    #[error("Failed to acquire lock")]
    LockError,

    #[error("Audio device error: {0}")]
    DeviceError(#[from] cpal::DevicesError),

    #[error("Audio stream error: {0}")]
    StreamError(#[from] cpal::BuildStreamError),

    #[error("Audio play error: {0}")]
    PlayError(#[from] cpal::PlayStreamError),

    #[error("Default stream config error: {0}")]
    DefaultStreamConfigError(#[from] cpal::DefaultStreamConfigError),

    #[error("WAV file error: {0}")]
    WavError(#[from] hound::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}
