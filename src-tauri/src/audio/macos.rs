//! macOS system audio capture using ScreenCaptureKit.
//!
//! ScreenCaptureKit (available macOS 12.3+, audio capture macOS 13.0+) provides
//! the ability to capture system audio output, which we use to record
//! meeting participants' voices.

#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use hound::{WavSpec, WavWriter};
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, Sel};
use objc2::{class, msg_send, sel};
// CMSampleBuffer is an opaque type, we use a raw pointer
type CMSampleBufferRef = *mut c_void;

use objc2_foundation::{NSArray, NSError, NSObject};

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

/// Shared state for audio writing, accessible from the callback
struct AudioWriterState {
    writer: Option<WavWriter<std::io::BufWriter<std::fs::File>>>,
    output_path: PathBuf,
    is_active: bool,
}

/// Global state for the audio callback (needed because ObjC callbacks can't capture Rust state directly)
static AUDIO_WRITER: std::sync::OnceLock<Mutex<Option<AudioWriterState>>> = std::sync::OnceLock::new();

fn get_audio_writer() -> &'static Mutex<Option<AudioWriterState>> {
    AUDIO_WRITER.get_or_init(|| Mutex::new(None))
}

/// Global buffer for system audio samples (for live transcription)
static SYSTEM_AUDIO_BUFFER: std::sync::OnceLock<Mutex<Vec<f32>>> = std::sync::OnceLock::new();

fn get_system_audio_buffer() -> &'static Mutex<Vec<f32>> {
    SYSTEM_AUDIO_BUFFER.get_or_init(|| Mutex::new(Vec::new()))
}

/// Take all samples from the system audio buffer (clears the buffer)
pub fn take_system_audio_samples() -> Vec<f32> {
    match get_system_audio_buffer().lock() { Ok(mut buffer) => {
        std::mem::take(&mut *buffer)
    } _ => {
        Vec::new()
    }}
}

/// Clear the system audio buffer
#[allow(dead_code)]
pub fn clear_system_audio_buffer() {
    if let Ok(mut buffer) = get_system_audio_buffer().lock() {
        buffer.clear();
    }
}

/// Process audio samples from CMSampleBuffer and write to WAV file
fn process_audio_buffer(sample_buffer: CMSampleBufferRef) {
    unsafe {
        unsafe extern "C" {
            fn CMSampleBufferGetDataBuffer(sbuf: CMSampleBufferRef) -> *mut c_void;
            #[allow(dead_code)]
            fn CMBlockBufferGetDataLength(block_buffer: *mut c_void) -> usize;
            fn CMBlockBufferGetDataPointer(
                block_buffer: *mut c_void,
                offset: usize,
                length_at_offset_out: *mut usize,
                total_length_out: *mut usize,
                data_pointer_out: *mut *mut u8,
            ) -> i32;
        }

        // Get the data buffer from the sample buffer
        let block_buffer = CMSampleBufferGetDataBuffer(sample_buffer);
        if block_buffer.is_null() {
            return;
        }

        // Get data pointer and length
        let mut data_ptr: *mut u8 = std::ptr::null_mut();
        let mut length_at_offset: usize = 0;
        let mut total_length: usize = 0;

        let status = CMBlockBufferGetDataPointer(
            block_buffer,
            0,
            &mut length_at_offset,
            &mut total_length,
            &mut data_ptr,
        );

        if status != 0 || data_ptr.is_null() || total_length == 0 {
            return;
        }

        // ScreenCaptureKit provides audio as 32-bit float samples in NON-INTERLEAVED (planar) format
        // First half is left channel, second half is right channel
        let sample_count = total_length / std::mem::size_of::<f32>();
        if sample_count == 0 {
            return;
        }

        let samples = std::slice::from_raw_parts(data_ptr as *const f32, sample_count);

        // Split into left and right channels (non-interleaved/planar format)
        let samples_per_channel = sample_count / 2;
        let left_channel = &samples[..samples_per_channel];
        let right_channel = &samples[samples_per_channel..];

        // Write audio data to WAV file (interleaved stereo)
        if let Ok(mut guard) = get_audio_writer().lock() {
            if let Some(ref mut state) = *guard {
                if state.is_active {
                    if let Some(ref mut writer) = state.writer {
                        // Interleave left and right channels
                        for i in 0..samples_per_channel {
                            let left = left_channel.get(i).copied().unwrap_or(0.0);
                            let right = right_channel.get(i).copied().unwrap_or(0.0);

                            // Convert f32 (-1.0 to 1.0) to i16
                            let left_i16 = (left.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                            let right_i16 = (right.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;

                            let _ = writer.write_sample(left_i16);
                            let _ = writer.write_sample(right_i16);
                        }
                    }
                }
            }
        }

        // Also push to the system audio buffer for live transcription
        // Downsample from 48kHz to 16kHz for Whisper (take every 3rd sample from left channel)
        if let Ok(mut buffer) = get_system_audio_buffer().lock() {
            for (i, &sample) in left_channel.iter().enumerate() {
                if i % 3 == 0 {
                    buffer.push(sample);
                }
            }
        }
    }
}

/// Create and register a dynamic Objective-C class that implements SCStreamOutput protocol
fn create_stream_output_class() -> *const AnyClass {
    use std::sync::Once;
    static REGISTER: Once = Once::new();
    static mut CLASS: *const AnyClass = std::ptr::null();

    REGISTER.call_once(|| {
        unsafe {
            unsafe extern "C" {
                fn objc_allocateClassPair(
                    superclass: *const AnyClass,
                    name: *const i8,
                    extra_bytes: usize,
                ) -> *mut AnyClass;
                fn objc_registerClassPair(cls: *mut AnyClass);
                fn class_addMethod(
                    cls: *mut AnyClass,
                    name: Sel,
                    imp: *const c_void,
                    types: *const i8,
                ) -> bool;
                fn class_addProtocol(cls: *mut AnyClass, protocol: *const c_void) -> bool;
                fn objc_getProtocol(name: *const i8) -> *const c_void;
            }

            // Create class inheriting from NSObject
            let superclass = class!(NSObject) as *const _ as *const AnyClass;
            let class_name = b"RustSCStreamOutput\0".as_ptr() as *const i8;
            let new_class = objc_allocateClassPair(superclass, class_name, 0);

            if new_class.is_null() {
                // Class might already exist
                CLASS = class!(RustSCStreamOutput) as *const _ as *const AnyClass;
                return;
            }

            // Add SCStreamOutput protocol
            let protocol_name = b"SCStreamOutput\0".as_ptr() as *const i8;
            let protocol = objc_getProtocol(protocol_name);
            if !protocol.is_null() {
                class_addProtocol(new_class, protocol);
            }

            // Add the stream:didOutputSampleBuffer:ofType: method
            extern "C" fn stream_did_output_sample_buffer(
                _this: &NSObject,
                _cmd: Sel,
                _stream: *mut AnyObject,
                sample_buffer: CMSampleBufferRef,
                output_type: i64,
            ) {
                // SCStreamOutputType: 0 = screen, 1 = audio
                if output_type == 1 && !sample_buffer.is_null() {
                    process_audio_buffer(sample_buffer);
                }
            }

            let method_sel = sel!(stream:didOutputSampleBuffer:ofType:);
            // v = void, @ = object (self), : = SEL, @ = object (stream), @ = object (sampleBuffer), q = int64 (type)
            let method_types = b"v@:@@q\0".as_ptr() as *const i8;
            class_addMethod(
                new_class,
                method_sel,
                stream_did_output_sample_buffer as *const c_void,
                method_types,
            );

            objc_registerClassPair(new_class);
            CLASS = new_class as *const AnyClass;
        }
    });

    unsafe { CLASS }
}

/// State for an active system audio capture session
struct CaptureSession {
    stream: Retained<AnyObject>,
    /// Keep the delegate alive while capturing (prevents deallocation)
    #[allow(dead_code)]
    output_delegate: Retained<AnyObject>,
}

/// macOS system audio capture implementation using ScreenCaptureKit
pub struct MacOSSystemAudioCapture {
    is_capturing: AtomicBool,
    session: Mutex<Option<CaptureSession>>,
}

// Safety: MacOSSystemAudioCapture uses atomic operations and mutex for thread safety.
unsafe impl Send for MacOSSystemAudioCapture {}
unsafe impl Sync for MacOSSystemAudioCapture {}

impl MacOSSystemAudioCapture {
    pub fn new() -> Self {
        Self {
            is_capturing: AtomicBool::new(false),
            session: Mutex::new(None),
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
                    match Retained::retain(content) { Some(retained) => {
                        let _ = tx_clone.send(Ok(retained));
                    } _ => {
                        let _ = tx_clone.send(Err(AudioError::PermissionDenied(
                            "Failed to retain content".to_string(),
                        )));
                    }}
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
            // Exclude our own app's audio to avoid feedback
            let _: () = msg_send![config, setExcludesCurrentProcessAudio: Bool::YES];

            // Video settings - use small but valid dimensions
            // Some versions of ScreenCaptureKit don't like 1x1
            let _: () = msg_send![config, setWidth: 2_u32];
            let _: () = msg_send![config, setHeight: 2_u32];
            // Skip setMinimumFrameInterval - not needed for audio-only capture
            // and requires CMTime which has complex encoding requirements
            let _: () = msg_send![config, setShowsCursor: Bool::NO];

            // Set audio configuration - use 48kHz stereo float
            let _: () = msg_send![config, setSampleRate: 48000_i32];
            let _: () = msg_send![config, setChannelCount: 2_i32];

            eprintln!("ScreenCaptureKit: Created stream configuration");

            Retained::retain(config)
                .ok_or_else(|| AudioError::PermissionDenied("Failed to retain config".to_string()))
        }
    }

    /// Create the stream output delegate and start capture
    fn start_capture_session(
        &self,
        filter: &AnyObject,
        config: &AnyObject,
        output_path: PathBuf,
    ) -> Result<CaptureSession, AudioError> {
        unsafe {
            eprintln!("ScreenCaptureKit: Creating stream...");
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
                eprintln!("ScreenCaptureKit: Failed to create stream");
                return Err(AudioError::PermissionDenied("Failed to create stream".to_string()));
            }
            eprintln!("ScreenCaptureKit: Stream created successfully");

            let stream = Retained::retain(stream)
                .ok_or_else(|| AudioError::PermissionDenied("Failed to retain stream".to_string()))?;

            // Create the output delegate
            eprintln!("ScreenCaptureKit: Creating output delegate...");
            let output_class = create_stream_output_class();
            if output_class.is_null() {
                eprintln!("ScreenCaptureKit: Failed to create output class");
                return Err(AudioError::PermissionDenied(
                    "Failed to create output class".to_string(),
                ));
            }

            let output_delegate: *mut AnyObject = msg_send![output_class as *const AnyObject, new];
            if output_delegate.is_null() {
                eprintln!("ScreenCaptureKit: Failed to create output delegate instance");
                return Err(AudioError::PermissionDenied(
                    "Failed to create output delegate".to_string(),
                ));
            }
            eprintln!("ScreenCaptureKit: Output delegate created");

            let output_delegate = Retained::retain(output_delegate)
                .ok_or_else(|| AudioError::PermissionDenied("Failed to retain delegate".to_string()))?;

            // Create a dispatch queue for audio callbacks
            let queue_label = b"com.note67.screencapture.audio\0".as_ptr() as *const i8;
            unsafe extern "C" {
                fn dispatch_queue_create(label: *const i8, attr: *const c_void) -> *mut c_void;
            }
            let queue = dispatch_queue_create(queue_label, std::ptr::null());
            eprintln!("ScreenCaptureKit: Dispatch queue created");

            // Add output to stream - SCStreamOutputType.audio = 1
            eprintln!("ScreenCaptureKit: Adding stream output...");
            let mut error: *mut NSError = std::ptr::null_mut();
            let success: Bool = msg_send![
                &*stream,
                addStreamOutput: &*output_delegate,
                type: 1_i64,  // SCStreamOutputType.audio
                sampleHandlerQueue: queue,
                error: &mut error
            ];

            if !success.as_bool() {
                let error_msg = if !error.is_null() {
                    let desc: *mut AnyObject = msg_send![error, localizedDescription];
                    if !desc.is_null() {
                        let utf8: *const i8 = msg_send![desc, UTF8String];
                        if !utf8.is_null() {
                            std::ffi::CStr::from_ptr(utf8).to_string_lossy().to_string()
                        } else {
                            "Unknown".to_string()
                        }
                    } else {
                        "Unknown".to_string()
                    }
                } else {
                    "Unknown".to_string()
                };
                eprintln!("ScreenCaptureKit: Failed to add stream output: {}", error_msg);
                return Err(AudioError::PermissionDenied(
                    format!("Failed to add stream output: {}", error_msg),
                ));
            }
            eprintln!("ScreenCaptureKit: Stream output added successfully");

            // Initialize the WAV writer
            let spec = WavSpec {
                channels: 2,
                sample_rate: 48000,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            };

            let writer = WavWriter::create(&output_path, spec)
                .map_err(|e| AudioError::IoError(std::io::Error::other(e.to_string())))?;

            // Set up global audio writer state
            {
                let mut guard = get_audio_writer().lock().map_err(|_| AudioError::LockError)?;
                *guard = Some(AudioWriterState {
                    writer: Some(writer),
                    output_path: output_path.clone(),
                    is_active: true,
                });
            }

            // Start capturing
            use std::sync::mpsc;
            let (tx, rx) = mpsc::channel();

            let block = block2::RcBlock::new(move |error: *mut NSError| {
                if error.is_null() {
                    let _ = tx.send(Ok(()));
                } else {
                    // Get detailed error message
                    let error_desc: *mut AnyObject = msg_send![error, localizedDescription];
                    let error_msg = if !error_desc.is_null() {
                        let utf8: *const i8 = msg_send![error_desc, UTF8String];
                        if !utf8.is_null() {
                            std::ffi::CStr::from_ptr(utf8)
                                .to_string_lossy()
                                .to_string()
                        } else {
                            "Unknown error".to_string()
                        }
                    } else {
                        "Unknown error".to_string()
                    };
                    eprintln!("ScreenCaptureKit error: {}", error_msg);
                    let _ = tx.send(Err(AudioError::PermissionDenied(format!(
                        "Failed to start capture: {}",
                        error_msg
                    ))));
                }
            });

            let _: () = msg_send![&*stream, startCaptureWithCompletionHandler: &*block];

            rx.recv_timeout(std::time::Duration::from_secs(10))
                .map_err(|_| AudioError::PermissionDenied("Timeout starting capture".to_string()))??;

            eprintln!("ScreenCaptureKit: Capture started successfully!");

            Ok(CaptureSession {
                stream,
                output_delegate,
            })
        }
    }

    /// Stop the capture session
    fn stop_capture_session(&self) -> Result<Option<PathBuf>, AudioError> {
        let session = {
            let mut guard = self.session.lock().map_err(|_| AudioError::LockError)?;
            guard.take()
        };

        let output_path = if let Some(session) = session {
            unsafe {
                // Stop the stream
                use std::sync::mpsc;
                let (tx, rx) = mpsc::channel();

                let block = block2::RcBlock::new(move |error: *mut NSError| {
                    let _ = tx.send(error.is_null());
                });

                let _: () = msg_send![&*session.stream, stopCaptureWithCompletionHandler: &*block];

                // Wait for stop to complete
                let _ = rx.recv_timeout(std::time::Duration::from_secs(5));
            }

            // Finalize WAV file and get path
            let mut guard = get_audio_writer().lock().map_err(|_| AudioError::LockError)?;
            match guard.take() { Some(mut state) => {
                state.is_active = false;
                if let Some(writer) = state.writer.take() {
                    let _ = writer.finalize();
                }
                Some(state.output_path)
            } _ => {
                None
            }}
        } else {
            None
        };

        Ok(output_path)
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

        // Start capture session with output delegate
        let session = self.start_capture_session(&filter, &config, output_path)?;

        // Store session
        {
            let mut guard = self.session.lock().map_err(|_| AudioError::LockError)?;
            *guard = Some(session);
        }

        self.is_capturing.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn stop(&self) -> SystemAudioResult<Option<PathBuf>> {
        if !self.is_capturing.load(Ordering::SeqCst) {
            return Ok(None);
        }

        let output_path = self.stop_capture_session()?;

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
