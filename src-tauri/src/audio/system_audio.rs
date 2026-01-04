//! Platform abstraction for system audio capture.
//!
//! System audio capture allows recording audio output from the system,
//! which is used to capture meeting participants' voices.

use std::path::PathBuf;
use std::sync::Arc;

use crate::audio::AudioError;

/// Result type for system audio operations
pub type SystemAudioResult<T> = Result<T, AudioError>;

/// Platform-agnostic interface for system audio capture
pub trait SystemAudioCapture: Send + Sync {
    /// Check if system audio capture is supported on this platform
    fn is_supported() -> bool
    where
        Self: Sized;

    /// Check if the app has permission to capture system audio
    fn has_permission(&self) -> SystemAudioResult<bool>;

    /// Request permission to capture system audio
    /// Returns true if permission was granted
    fn request_permission(&self) -> SystemAudioResult<bool>;

    /// Start capturing system audio to the specified file
    fn start(&self, output_path: PathBuf) -> SystemAudioResult<()>;

    /// Stop capturing system audio
    /// Returns the path to the recorded file
    fn stop(&self) -> SystemAudioResult<Option<PathBuf>>;

    /// Check if currently capturing
    fn is_capturing(&self) -> bool;
}

/// Get the system audio capture implementation for the current platform
#[cfg(target_os = "macos")]
pub fn create_system_audio_capture() -> SystemAudioResult<Arc<dyn SystemAudioCapture>> {
    use super::macos::MacOSSystemAudioCapture;
    Ok(Arc::new(MacOSSystemAudioCapture::new()))
}

#[cfg(target_os = "windows")]
pub fn create_system_audio_capture() -> SystemAudioResult<Arc<dyn SystemAudioCapture>> {
    use super::windows::WindowsSystemAudioCapture;
    eprintln!("create_system_audio_capture() called on Windows");
    match WindowsSystemAudioCapture::new() {
        Ok(capture) => {
            eprintln!("WindowsSystemAudioCapture created successfully");
            Ok(Arc::new(capture))
        }
        Err(e) => {
            eprintln!("Failed to create WindowsSystemAudioCapture: {}", e);
            Err(e)
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn create_system_audio_capture() -> SystemAudioResult<Arc<dyn SystemAudioCapture>> {
    Err(AudioError::UnsupportedPlatform)
}

/// Check if system audio capture is available on the current platform
pub fn is_system_audio_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        super::macos::MacOSSystemAudioCapture::is_supported()
    }
    #[cfg(target_os = "windows")]
    {
        let available = super::windows::WindowsSystemAudioCapture::is_supported();
        eprintln!("is_system_audio_available() on Windows: {}", available);
        available
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}
