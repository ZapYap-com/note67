//! macOS system audio capture using ScreenCaptureKit.
//!
//! ScreenCaptureKit (available macOS 12.3+, audio capture macOS 13.0+) provides
//! the ability to capture system audio output, which we use to record
//! meeting participants' voices.

#![cfg(target_os = "macos")]

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use hound::{WavSpec, WavWriter};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};
use objc2_foundation::{NSArray, NSError};

use super::system_audio::{SystemAudioCapture, SystemAudioResult};
use crate::audio::AudioError;

// ScreenCaptureKit minimum version check (audio capture requires macOS 13.0+)
fn is_macos_13_or_later() -> bool {
    let version = macos_version();
    version.0 >= 13
}

fn macos_version() -> (u32, u32, u32) {
    use std::process::Command;

    let output = Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_else(|| "10.0.0".to_string());

    let parts: Vec<u32> = output
        .trim()
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();

    (
        parts.first().copied().unwrap_or(10),
        parts.get(1).copied().unwrap_or(0),
        parts.get(2).copied().unwrap_or(0),
    )
}

/// State for an active system audio capture session
struct CaptureState {
    output_path: PathBuf,
    writer: Option<WavWriter<std::io::BufWriter<std::fs::File>>>,
}

/// macOS system audio capture implementation using ScreenCaptureKit
pub struct MacOSSystemAudioCapture {
    is_capturing: AtomicBool,
    capture_state: Mutex<Option<CaptureState>>,
    // Note: We don't store the SCStream directly due to thread safety constraints.
    // Instead, we manage the capture lifecycle through the capture_state.
}

// Safety: MacOSSystemAudioCapture uses atomic operations and mutex for thread safety.
// The SCStream is not stored directly to avoid Send/Sync issues with Objective-C objects.
unsafe impl Send for MacOSSystemAudioCapture {}
unsafe impl Sync for MacOSSystemAudioCapture {}

impl MacOSSystemAudioCapture {
    pub fn new() -> Self {
        Self {
            is_capturing: AtomicBool::new(false),
            capture_state: Mutex::new(None),
        }
    }

    /// Check if ScreenCaptureKit is available (macOS 13.0+ for audio)
    fn check_availability() -> Result<(), AudioError> {
        if !is_macos_13_or_later() {
            return Err(AudioError::UnsupportedPlatform);
        }

        // Check if ScreenCaptureKit framework classes are available
        unsafe {
            let sc_class: *const AnyObject = msg_send![class!(SCStream), class];
            if sc_class.is_null() {
                return Err(AudioError::UnsupportedPlatform);
            }
        }

        Ok(())
    }

    /// Get shareable content synchronously (blocks until complete)
    fn get_shareable_content_sync() -> Result<Retained<AnyObject>, AudioError> {
        Self::check_availability()?;

        use std::sync::mpsc;
        let (tx, rx) = mpsc::channel();

        unsafe {
            let sc_class = class!(SCShareableContent);

            // Create a block for the completion handler
            let tx_clone = tx.clone();
            let block = block2::RcBlock::new(move |content: *mut AnyObject, error: *mut NSError| {
                if !error.is_null() {
                    let _ = tx_clone.send(Err(AudioError::PermissionDenied(
                        "Failed to get shareable content".to_string(),
                    )));
                } else if content.is_null() {
                    let _ = tx_clone.send(Err(AudioError::PermissionDenied(
                        "No shareable content available".to_string(),
                    )));
                } else {
                    // Retain the content before sending
                    if let Some(retained) = Retained::retain(content) {
                        let _ = tx_clone.send(Ok(retained));
                    } else {
                        let _ = tx_clone.send(Err(AudioError::PermissionDenied(
                            "Failed to retain content".to_string(),
                        )));
                    }
                }
            });

            let _: () = msg_send![
                sc_class,
                getShareableContentExcludingDesktopWindows: Bool::YES,
                onScreenWindowsOnly: Bool::NO,
                completionHandler: &*block
            ];
        }

        // Wait for the callback with a timeout
        rx.recv_timeout(std::time::Duration::from_secs(10))
            .map_err(|_| AudioError::PermissionDenied("Timeout getting shareable content".to_string()))?
    }

    /// Create a content filter for audio-only capture
    fn create_audio_filter(content: &AnyObject) -> Result<Retained<AnyObject>, AudioError> {
        unsafe {
            // Get displays from content
            let displays: *mut NSArray<AnyObject> = msg_send![content, displays];
            if displays.is_null() {
                return Err(AudioError::PermissionDenied("No displays available".to_string()));
            }

            let display_count: usize = msg_send![displays, count];
            if display_count == 0 {
                return Err(AudioError::PermissionDenied("No displays available".to_string()));
            }

            // Get first display for content filter
            let display: *mut AnyObject = msg_send![displays, firstObject];
            if display.is_null() {
                return Err(AudioError::PermissionDenied("No display found".to_string()));
            }

            // Create content filter with display and empty excluded apps/windows
            let filter_class = class!(SCContentFilter);
            let empty_apps: Retained<NSArray<AnyObject>> = NSArray::new();
            let empty_windows: Retained<NSArray<AnyObject>> = NSArray::new();

            // Allocate and initialize the filter
            let filter_alloc: *mut AnyObject = msg_send![filter_class, alloc];
            let filter: *mut AnyObject = msg_send![
                filter_alloc,
                initWithDisplay: display,
                excludingApplications: &*empty_apps,
                exceptingWindows: &*empty_windows
            ];

            Retained::retain(filter)
                .ok_or_else(|| AudioError::PermissionDenied("Failed to create content filter".to_string()))
        }
    }

    /// Create stream configuration for audio-only capture
    fn create_stream_config() -> Result<Retained<AnyObject>, AudioError> {
        unsafe {
            let config_class = class!(SCStreamConfiguration);
            let config: *mut AnyObject = msg_send![config_class, new];

            if config.is_null() {
                return Err(AudioError::PermissionDenied(
                    "Failed to create stream configuration".to_string(),
                ));
            }

            // Enable audio capture
            let _: () = msg_send![config, setCapturesAudio: Bool::YES];
            // Exclude our own app's audio
            let _: () = msg_send![config, setExcludesCurrentProcessAudio: Bool::YES];
            // Minimal video settings (we only want audio)
            let _: () = msg_send![config, setWidth: 1_u32];
            let _: () = msg_send![config, setHeight: 1_u32];

            // Set audio configuration
            let _: () = msg_send![config, setSampleRate: 48000_i32];
            let _: () = msg_send![config, setChannelCount: 2_i32];

            Retained::retain(config)
                .ok_or_else(|| AudioError::PermissionDenied("Failed to retain config".to_string()))
        }
    }

    /// Start the capture stream
    fn start_stream(&self, filter: &AnyObject, config: &AnyObject) -> Result<(), AudioError> {
        unsafe {
            let stream_class = class!(SCStream);

            // Allocate and initialize the stream
            let stream_alloc: *mut AnyObject = msg_send![stream_class, alloc];
            let stream: *mut AnyObject = msg_send![
                stream_alloc,
                initWithFilter: filter,
                configuration: config,
                delegate: std::ptr::null::<AnyObject>()
            ];

            if stream.is_null() {
                return Err(AudioError::PermissionDenied("Failed to create stream".to_string()));
            }

            // Start capturing
            use std::sync::mpsc;
            let (tx, rx) = mpsc::channel();

            let block = block2::RcBlock::new(move |error: *mut NSError| {
                if error.is_null() {
                    let _ = tx.send(Ok(()));
                } else {
                    let _ = tx.send(Err(AudioError::PermissionDenied(
                        "Failed to start capture".to_string(),
                    )));
                }
            });

            let _: () = msg_send![stream, startCaptureWithCompletionHandler: &*block];

            rx.recv_timeout(std::time::Duration::from_secs(10))
                .map_err(|_| AudioError::PermissionDenied("Timeout starting capture".to_string()))??;

            Ok(())
        }
    }
}

impl SystemAudioCapture for MacOSSystemAudioCapture {
    fn is_supported() -> bool {
        Self::check_availability().is_ok()
    }

    fn has_permission(&self) -> SystemAudioResult<bool> {
        // Try to get shareable content - this will fail if no permission
        match Self::get_shareable_content_sync() {
            Ok(_) => Ok(true),
            Err(AudioError::PermissionDenied(_)) => Ok(false),
            Err(e) => Err(e),
        }
    }

    fn request_permission(&self) -> SystemAudioResult<bool> {
        // On macOS, requesting shareable content triggers the permission dialog
        // if permission hasn't been granted yet
        match Self::get_shareable_content_sync() {
            Ok(_) => Ok(true),
            Err(AudioError::PermissionDenied(_)) => Ok(false),
            Err(e) => Err(e),
        }
    }

    fn start(&self, output_path: PathBuf) -> SystemAudioResult<()> {
        if self.is_capturing.load(Ordering::SeqCst) {
            return Err(AudioError::AlreadyRecording);
        }

        Self::check_availability()?;

        // Get shareable content
        let content = Self::get_shareable_content_sync()?;

        // Create filter and configuration
        let filter = Self::create_audio_filter(&content)?;
        let config = Self::create_stream_config()?;

        // Create WAV writer
        let spec = WavSpec {
            channels: 2,
            sample_rate: 48000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        let writer = WavWriter::create(&output_path, spec)
            .map_err(|e| AudioError::IoError(std::io::Error::other(e.to_string())))?;

        // Store capture state
        {
            let mut state = self.capture_state.lock().map_err(|_| AudioError::LockError)?;
            *state = Some(CaptureState {
                output_path: output_path.clone(),
                writer: Some(writer),
            });
        }

        // Start the stream
        self.start_stream(&filter, &config)?;

        self.is_capturing.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn stop(&self) -> SystemAudioResult<Option<PathBuf>> {
        if !self.is_capturing.load(Ordering::SeqCst) {
            return Ok(None);
        }

        // Finalize WAV file and get path
        let output_path = {
            let mut state = self.capture_state.lock().map_err(|_| AudioError::LockError)?;
            if let Some(mut capture_state) = state.take() {
                if let Some(writer) = capture_state.writer.take() {
                    let _ = writer.finalize();
                }
                Some(capture_state.output_path)
            } else {
                None
            }
        };

        self.is_capturing.store(false, Ordering::SeqCst);
        Ok(output_path)
    }

    fn is_capturing(&self) -> bool {
        self.is_capturing.load(Ordering::SeqCst)
    }
}

impl Default for MacOSSystemAudioCapture {
    fn default() -> Self {
        Self::new()
    }
}
