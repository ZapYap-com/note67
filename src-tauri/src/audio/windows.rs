//! Windows system audio capture using WASAPI loopback.
//!
//! WASAPI loopback recording allows capturing all audio output from the system,
//! which we use to record meeting participants' voices.

#![cfg(target_os = "windows")]

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use hound::{WavSpec, WavWriter};
use wasapi::{Device, Direction, SampleType, ShareMode};

use super::system_audio::{SystemAudioCapture, SystemAudioResult};
use crate::audio::AudioError;

/// Shared state for audio writing, accessible from the capture thread
struct AudioWriterState {
    writer: Option<WavWriter<std::io::BufWriter<std::fs::File>>>,
    output_path: PathBuf,
    is_active: bool,
}

/// Global state for the audio writer
static AUDIO_WRITER: OnceLock<Mutex<Option<AudioWriterState>>> = OnceLock::new();

fn get_audio_writer() -> &'static Mutex<Option<AudioWriterState>> {
    AUDIO_WRITER.get_or_init(|| Mutex::new(None))
}

/// Global buffer for system audio samples (for live transcription)
static SYSTEM_AUDIO_BUFFER: OnceLock<Mutex<Vec<f32>>> = OnceLock::new();

fn get_system_audio_buffer() -> &'static Mutex<Vec<f32>> {
    SYSTEM_AUDIO_BUFFER.get_or_init(|| Mutex::new(Vec::new()))
}

/// Take all samples from the system audio buffer (clears the buffer)
pub fn take_system_audio_samples() -> Vec<f32> {
    match get_system_audio_buffer().lock() {
        Ok(mut buffer) => std::mem::take(&mut *buffer),
        _ => Vec::new(),
    }
}

/// Clear the system audio buffer
#[allow(dead_code)]
pub fn clear_system_audio_buffer() {
    if let Ok(mut buffer) = get_system_audio_buffer().lock() {
        buffer.clear();
    }
}

/// Initialize COM if not already initialized (safe to call multiple times)
fn ensure_com_initialized() -> bool {
    // initialize_mta returns HRESULT directly
    // S_OK (0) = success, S_FALSE (1) = already initialized, negative = error
    // Try to proceed even on error - COM might already be initialized differently
    let _ = wasapi::initialize_mta();
    true
}

/// Get the default audio render device (speakers/headphones)
fn get_default_render_device() -> Result<Device, AudioError> {
    // Ensure COM is initialized before device enumeration
    ensure_com_initialized();

    // Use get_default_device to get the actual Windows default, not just index 0
    wasapi::get_default_device(&Direction::Render).map_err(|e| {
        AudioError::PermissionDenied(format!("Failed to get default device: {}", e))
    })
}

/// Downsample audio from source rate to 16kHz mono for Whisper
fn downsample_to_16k_mono(samples: &[f32], src_rate: u32, channels: u16) -> Vec<f32> {
    // Convert stereo to mono by averaging channels
    let mono: Vec<f32> = if channels >= 2 {
        samples
            .chunks(channels as usize)
            .map(|chunk| chunk.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        samples.to_vec()
    };

    // Downsample: src_rate -> 16000
    // Use simple decimation (take every Nth sample where N = src_rate / 16000)
    let ratio = src_rate as f32 / 16000.0;
    let output_len = (mono.len() as f32 / ratio) as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_idx = (i as f32 * ratio) as usize;
        if src_idx < mono.len() {
            output.push(mono[src_idx]);
        }
    }

    output
}

/// Windows system audio capture implementation using WASAPI loopback
pub struct WindowsSystemAudioCapture {
    is_capturing: Arc<AtomicBool>,
    capture_thread: Mutex<Option<JoinHandle<()>>>,
}

impl WindowsSystemAudioCapture {
    pub fn new() -> Result<Self, AudioError> {
        Ok(Self {
            is_capturing: Arc::new(AtomicBool::new(false)),
            capture_thread: Mutex::new(None),
        })
    }

    /// Check if WASAPI loopback is available (Windows Vista+)
    pub fn is_available() -> bool {
        get_default_render_device().is_ok()
    }

    /// Run the capture loop in a separate thread
    fn run_capture_loop(
        is_capturing: Arc<AtomicBool>,
        output_path: PathBuf,
    ) -> Result<(), AudioError> {
        // Initialize COM for this thread (get_default_render_device also does this,
        // but we call it explicitly here for the capture thread)
        if !ensure_com_initialized() {
            return Err(AudioError::PermissionDenied(
                "Failed to initialize COM for capture thread".to_string(),
            ));
        }

        // Get default render device
        let device = get_default_render_device()?;

        // Get the audio client for loopback capture
        let mut audio_client = device.get_iaudioclient().map_err(|e| {
            AudioError::PermissionDenied(format!("Failed to get audio client: {}", e))
        })?;

        // Get the mix format (native format of the device)
        let wave_format = audio_client.get_mixformat().map_err(|e| {
            AudioError::PermissionDenied(format!("Failed to get mix format: {}", e))
        })?;

        let sample_rate = wave_format.get_samplespersec();
        let channels = wave_format.get_nchannels();

        // Get the default device period for buffer sizing
        let default_period = audio_client.get_periods().map_err(|e| {
            AudioError::PermissionDenied(format!("Failed to get device periods: {}", e))
        })?;

        // Initialize the audio client in loopback mode with event callback
        // Direction::Capture adds AUDCLNT_STREAMFLAGS_EVENTCALLBACK which requires an event handle
        audio_client
            .initialize_client(
                &wave_format,
                default_period.0 as i64, // Use default period
                &Direction::Capture, // Need Capture to get capture client
                &ShareMode::Shared,
                true, // Enable loopback mode
            )
            .map_err(|e| {
                AudioError::PermissionDenied(format!("Failed to initialize audio client: {}", e))
            })?;

        // Set up event handle for event-driven capture (required when using EVENTCALLBACK flag)
        let _event_handle = audio_client.set_get_eventhandle().map_err(|e| {
            AudioError::PermissionDenied(format!("Failed to set event handle: {}", e))
        })?;

        // Get the capture client
        let capture_client = audio_client.get_audiocaptureclient().map_err(|e| {
            AudioError::PermissionDenied(format!("Failed to get capture client: {}", e))
        })?;

        // Create WAV writer with standard format (48kHz stereo 16-bit)
        let spec = WavSpec {
            channels: 2,
            sample_rate: 48000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        let writer = WavWriter::create(&output_path, spec).map_err(|e| {
            AudioError::IoError(std::io::Error::other(format!("Failed to create WAV file: {}", e)))
        })?;

        // Set up global audio writer state
        {
            let mut guard = get_audio_writer().lock().map_err(|_| AudioError::LockError)?;
            *guard = Some(AudioWriterState {
                writer: Some(writer),
                output_path: output_path.clone(),
                is_active: true,
            });
        }

        // Ensure stream is in clean state before starting
        let _ = audio_client.stop_stream(); // Ignore error if not running
        let _ = audio_client.reset_stream(); // Reset to clean state

        // Start the audio stream
        audio_client.start_stream().map_err(|e| {
            AudioError::PermissionDenied(format!("Failed to start audio stream: {}", e))
        })?;

        // Determine the sample format
        let sample_type = wave_format.get_subformat().map_err(|e| {
            AudioError::PermissionDenied(format!("Failed to get sample format: {}", e))
        })?;

        // Buffer for reading audio data
        let mut audio_data: VecDeque<u8> = VecDeque::new();

        // Capture loop - use polling mode (event-driven may not work well with loopback)
        while is_capturing.load(Ordering::Relaxed) {
            // Use short sleep for polling instead of event waiting
            // Event-driven mode may not work correctly for loopback capture
            thread::sleep(Duration::from_millis(10));

            // Read available frames
            if let Ok(Some(frames)) = capture_client.get_next_nbr_frames() {
                if frames > 0 {
                    // Read the audio data into the buffer
                    if capture_client
                        .read_from_device_to_deque(&mut audio_data)
                        .is_ok()
                    {
                        // Convert VecDeque to Vec for processing
                        let data: Vec<u8> = audio_data.drain(..).collect();
                        if !data.is_empty() {
                            // Process the audio data
                            process_audio_data(&data, sample_rate, channels, &sample_type);
                        }
                    }
                }
            }
        }

        // Stop the stream
        let _ = audio_client.stop_stream();

        // Finalize WAV file
        {
            let mut guard = get_audio_writer().lock().map_err(|_| AudioError::LockError)?;
            if let Some(ref mut state) = *guard {
                state.is_active = false;
                if let Some(writer) = state.writer.take() {
                    let _ = writer.finalize();
                }
            }
        }

        Ok(())
    }
}

/// Process audio data from WASAPI and write to file/buffer
/// Data is interleaved: [L0, R0, L1, R1, ...] for stereo
fn process_audio_data(data: &[u8], sample_rate: u32, channels: u16, sample_type: &SampleType) {
    if data.is_empty() {
        return;
    }

    // Determine bytes per sample
    let bytes_per_sample = match sample_type {
        SampleType::Float => 4,
        SampleType::Int => 2,
    };

    let bytes_per_frame = bytes_per_sample * channels as usize;
    let num_frames = data.len() / bytes_per_frame;

    if num_frames == 0 {
        return;
    }

    // Convert raw bytes to f32 samples (interleaved)
    let float_samples: Vec<f32> = match sample_type {
        SampleType::Float => data
            .chunks_exact(4)
            .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
            .collect(),
        SampleType::Int => data
            .chunks_exact(2)
            .map(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]) as f32 / 32768.0)
            .collect(),
    };

    // Write to WAV file
    if let Ok(mut guard) = get_audio_writer().lock() {
        if let Some(ref mut state) = *guard {
            if state.is_active {
                if let Some(ref mut writer) = state.writer {
                    // Extract left and right channels from interleaved data
                    let mut left_samples = Vec::with_capacity(num_frames);
                    let mut right_samples = Vec::with_capacity(num_frames);

                    for frame in float_samples.chunks(channels as usize) {
                        let left = frame.first().copied().unwrap_or(0.0);
                        let right = if channels >= 2 {
                            frame.get(1).copied().unwrap_or(left)
                        } else {
                            left
                        };
                        left_samples.push(left);
                        right_samples.push(right);
                    }

                    // Resample if needed (device might not be 48kHz)
                    let (left_resampled, right_resampled) = if sample_rate != 48000 {
                        let ratio = sample_rate as f32 / 48000.0;
                        let new_len = (num_frames as f32 / ratio) as usize;

                        let resample = |src: &[f32]| -> Vec<f32> {
                            (0..new_len)
                                .map(|i| {
                                    let src_idx = (i as f32 * ratio) as usize;
                                    src.get(src_idx).copied().unwrap_or(0.0)
                                })
                                .collect()
                        };

                        (resample(&left_samples), resample(&right_samples))
                    } else {
                        (left_samples, right_samples)
                    };

                    // Write interleaved stereo samples
                    for i in 0..left_resampled.len().min(right_resampled.len()) {
                        let left_sample = left_resampled[i];
                        let right_sample = right_resampled[i];

                        let left_i16 = (left_sample.clamp(-1.0, 1.0) * 32767.0) as i16;
                        let right_i16 = (right_sample.clamp(-1.0, 1.0) * 32767.0) as i16;

                        let _ = writer.write_sample(left_i16);
                        let _ = writer.write_sample(right_i16);
                    }
                }
            }
        }
    }

    // Push to system audio buffer for live transcription (downsampled to 16kHz mono)
    if let Ok(mut buffer) = get_system_audio_buffer().lock() {
        let downsampled = downsample_to_16k_mono(&float_samples, sample_rate, channels);
        buffer.extend(downsampled);
    }
}

impl SystemAudioCapture for WindowsSystemAudioCapture {
    fn is_supported() -> bool {
        Self::is_available()
    }

    fn has_permission(&self) -> SystemAudioResult<bool> {
        // Windows doesn't require special permissions for loopback capture
        Ok(true)
    }

    fn request_permission(&self) -> SystemAudioResult<bool> {
        // No permission needed on Windows
        Ok(true)
    }

    fn start(&self, output_path: PathBuf) -> SystemAudioResult<()> {
        if self.is_capturing.load(Ordering::SeqCst) {
            return Err(AudioError::AlreadyRecording);
        }

        // Check if WASAPI is available
        if !Self::is_available() {
            return Err(AudioError::UnsupportedPlatform);
        }

        self.is_capturing.store(true, Ordering::SeqCst);

        // Clone for the capture thread
        let is_capturing = Arc::clone(&self.is_capturing);

        // Spawn capture thread
        let handle = thread::Builder::new()
            .name("wasapi-loopback-capture".to_string())
            .spawn(move || {
                let _ = Self::run_capture_loop(is_capturing, output_path);
            })
            .map_err(AudioError::IoError)?;

        // Store thread handle
        {
            let mut guard = self.capture_thread.lock().map_err(|_| AudioError::LockError)?;
            *guard = Some(handle);
        }

        Ok(())
    }

    fn stop(&self) -> SystemAudioResult<Option<PathBuf>> {
        if !self.is_capturing.load(Ordering::SeqCst) {
            return Ok(None);
        }

        // Signal capture thread to stop
        self.is_capturing.store(false, Ordering::SeqCst);

        // Wait for thread to finish
        let handle = {
            let mut guard = self.capture_thread.lock().map_err(|_| AudioError::LockError)?;
            guard.take()
        };

        if let Some(handle) = handle {
            let _ = handle.join();
        }

        // Get the output path from writer state
        let output_path = {
            let guard = get_audio_writer().lock().map_err(|_| AudioError::LockError)?;
            guard.as_ref().map(|state| state.output_path.clone())
        };

        Ok(output_path)
    }

    fn is_capturing(&self) -> bool {
        self.is_capturing.load(Ordering::Relaxed)
    }
}

impl Default for WindowsSystemAudioCapture {
    fn default() -> Self {
        Self::new().expect("Failed to create WindowsSystemAudioCapture")
    }
}
