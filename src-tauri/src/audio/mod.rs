pub mod recorder;
pub mod system_audio;

#[cfg(target_os = "macos")]
pub mod macos;

pub use recorder::{start_recording, stop_recording, RecordingState};
pub use system_audio::{create_system_audio_capture, is_system_audio_available, SystemAudioCapture};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Audio source type for recording
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AudioSource {
    /// User's microphone input
    Microphone,
    /// System audio output (other participants)
    SystemAudio,
}

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

    #[error("System audio capture is not supported on this platform")]
    UnsupportedPlatform,

    #[error("Permission denied for audio capture: {0}")]
    PermissionDenied(String),

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
