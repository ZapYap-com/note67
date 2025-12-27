use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU8, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Instant;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat};
use hound::{WavSpec, WavWriter};
use serde::{Deserialize, Serialize};

use crate::audio::AudioError;

/// Recording phase for pause/resume functionality
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum RecordingPhase {
    Idle = 0,
    Recording = 1,
    Paused = 2,
}

impl RecordingPhase {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => RecordingPhase::Recording,
            2 => RecordingPhase::Paused,
            _ => RecordingPhase::Idle,
        }
    }
}

/// Shared state that can be accessed across threads
pub struct RecordingState {
    pub is_recording: AtomicBool,
    pub audio_level: AtomicU32,
    pub output_path: std::sync::Mutex<Option<PathBuf>>,
    /// Buffer for live transcription - stores raw f32 samples
    pub audio_buffer: std::sync::Mutex<Vec<f32>>,
    /// Sample rate of the recorded audio (set when recording starts)
    pub sample_rate: AtomicU32,
    /// Number of channels (set when recording starts)
    pub channels: AtomicU32,

    // === Pause/Resume/Continue fields ===
    /// Current recording phase (Idle, Recording, Paused)
    pub phase: AtomicU8,
    /// Current segment index (0-based)
    pub current_segment_index: AtomicU32,
    /// Start offset in milliseconds from the note start (for continued recordings)
    pub segment_start_offset_ms: AtomicI64,
    /// When the current segment started recording (for duration calculation)
    pub segment_start_time: std::sync::Mutex<Option<Instant>>,
    /// Current note ID being recorded
    pub current_note_id: std::sync::Mutex<Option<String>>,
    /// Current segment ID in database (for updating duration)
    pub current_segment_db_id: AtomicI64,
}

impl RecordingState {
    pub fn new() -> Self {
        Self {
            is_recording: AtomicBool::new(false),
            audio_level: AtomicU32::new(0),
            output_path: std::sync::Mutex::new(None),
            audio_buffer: std::sync::Mutex::new(Vec::new()),
            sample_rate: AtomicU32::new(0),
            channels: AtomicU32::new(0),
            // Pause/Resume/Continue fields
            phase: AtomicU8::new(RecordingPhase::Idle as u8),
            current_segment_index: AtomicU32::new(0),
            segment_start_offset_ms: AtomicI64::new(0),
            segment_start_time: std::sync::Mutex::new(None),
            current_note_id: std::sync::Mutex::new(None),
            current_segment_db_id: AtomicI64::new(0),
        }
    }

    /// Get the current recording phase
    pub fn get_phase(&self) -> RecordingPhase {
        RecordingPhase::from_u8(self.phase.load(Ordering::SeqCst))
    }

    /// Set the recording phase
    pub fn set_phase(&self, phase: RecordingPhase) {
        self.phase.store(phase as u8, Ordering::SeqCst);
    }

    /// Get the elapsed time since segment start in milliseconds
    pub fn get_segment_elapsed_ms(&self) -> i64 {
        if let Ok(start_time) = self.segment_start_time.lock() {
            if let Some(start) = *start_time {
                return start.elapsed().as_millis() as i64;
            }
        }
        0
    }

    /// Reset state for a new recording session
    pub fn reset_for_new_session(&self) {
        self.current_segment_index.store(0, Ordering::SeqCst);
        self.segment_start_offset_ms.store(0, Ordering::SeqCst);
        self.current_segment_db_id.store(0, Ordering::SeqCst);
        if let Ok(mut start_time) = self.segment_start_time.lock() {
            *start_time = None;
        }
        if let Ok(mut note_id) = self.current_note_id.lock() {
            *note_id = None;
        }
    }

    /// Take all samples from the buffer (clears the buffer)
    pub fn take_audio_buffer(&self) -> Vec<f32> {
        match self.audio_buffer.lock() { Ok(mut buffer) => {
            std::mem::take(&mut *buffer)
        } _ => {
            Vec::new()
        }}
    }

    /// Get the current buffer length without clearing
    #[allow(dead_code)]
    pub fn buffer_len(&self) -> usize {
        match self.audio_buffer.lock() { Ok(buffer) => {
            buffer.len()
        } _ => {
            0
        }}
    }
}

impl Default for RecordingState {
    fn default() -> Self {
        Self::new()
    }
}

/// Start recording audio to the specified path
/// Returns immediately, recording happens in a background thread
pub fn start_recording(state: Arc<RecordingState>, output_path: PathBuf) -> Result<(), AudioError> {
    let current_phase = state.get_phase();
    if current_phase == RecordingPhase::Recording {
        return Err(AudioError::AlreadyRecording);
    }

    // Store output path
    {
        let mut path = state.output_path.lock().map_err(|_| AudioError::LockError)?;
        *path = Some(output_path.clone());
    }

    // Set segment start time
    {
        let mut start_time = state.segment_start_time.lock().map_err(|_| AudioError::LockError)?;
        *start_time = Some(Instant::now());
    }

    state.is_recording.store(true, Ordering::SeqCst);
    state.set_phase(RecordingPhase::Recording);

    let state_clone = state.clone();

    // Spawn recording thread
    thread::spawn(move || {
        if let Err(e) = run_recording(state_clone, output_path) {
            eprintln!("Recording error: {}", e);
        }
    });

    Ok(())
}

/// Pause recording - stops the current segment but keeps state for resume
pub fn pause_recording(state: &RecordingState) -> Result<i64, AudioError> {
    let current_phase = state.get_phase();
    if current_phase != RecordingPhase::Recording {
        return Err(AudioError::NotRecording);
    }

    // Calculate duration before stopping
    let duration_ms = state.get_segment_elapsed_ms();

    // Stop the recording thread
    state.is_recording.store(false, Ordering::SeqCst);
    state.audio_level.store(0, Ordering::SeqCst);
    state.set_phase(RecordingPhase::Paused);

    Ok(duration_ms)
}

/// Resume recording after pause - starts a new segment
pub fn resume_recording(state: Arc<RecordingState>, output_path: PathBuf) -> Result<(), AudioError> {
    let current_phase = state.get_phase();
    if current_phase != RecordingPhase::Paused {
        return Err(AudioError::NotPaused);
    }

    // Increment segment index
    let new_index = state.current_segment_index.fetch_add(1, Ordering::SeqCst) + 1;
    state.current_segment_index.store(new_index, Ordering::SeqCst);

    // Start recording with the new path
    start_recording(state, output_path)
}

/// Stop recording completely - resets all state
pub fn stop_recording(state: &RecordingState) -> Result<Option<PathBuf>, AudioError> {
    state.is_recording.store(false, Ordering::SeqCst);
    state.audio_level.store(0, Ordering::SeqCst);
    state.set_phase(RecordingPhase::Idle);

    // Reset segment tracking
    state.reset_for_new_session();

    let path = state.output_path.lock().map_err(|_| AudioError::LockError)?;
    Ok(path.clone())
}

/// Stop recording but preserve state for continue (used when ending a note that can be continued)
#[allow(dead_code)]
pub fn stop_recording_preserving_state(state: &RecordingState) -> Result<(Option<PathBuf>, i64), AudioError> {
    // Calculate duration before stopping
    let duration_ms = state.get_segment_elapsed_ms();

    state.is_recording.store(false, Ordering::SeqCst);
    state.audio_level.store(0, Ordering::SeqCst);
    state.set_phase(RecordingPhase::Idle);

    let path = state.output_path.lock().map_err(|_| AudioError::LockError)?;
    Ok((path.clone(), duration_ms))
}

fn run_recording(state: Arc<RecordingState>, output_path: PathBuf) -> Result<(), AudioError> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or(AudioError::NoInputDevice)?;

    let config = device.default_input_config()?;
    let sample_rate = config.sample_rate().0;
    let channels = config.channels();

    // Store sample rate and channels for live transcription
    state.sample_rate.store(sample_rate, Ordering::SeqCst);
    state.channels.store(channels as u32, Ordering::SeqCst);

    // Clear the audio buffer at start
    if let Ok(mut buffer) = state.audio_buffer.lock() {
        buffer.clear();
    }

    let spec = WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let writer = WavWriter::create(&output_path, spec)?;
    let writer = Arc::new(std::sync::Mutex::new(Some(writer)));

    let state_for_callback = state.clone();
    let writer_clone = writer.clone();

    let err_fn = |err| eprintln!("Audio stream error: {}", err);

    let stream = match config.sample_format() {
        SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _| {
                process_audio(data, &state_for_callback, &writer_clone);
            },
            err_fn,
            None,
        )?,
        SampleFormat::I16 => {
            let state_for_callback = state.clone();
            let writer_clone = writer.clone();
            device.build_input_stream(
                &config.into(),
                move |data: &[i16], _| {
                    let float_data: Vec<f32> = data.iter().map(|&s| s.to_float_sample()).collect();
                    process_audio(&float_data, &state_for_callback, &writer_clone);
                },
                err_fn,
                None,
            )?
        }
        SampleFormat::U16 => {
            let state_for_callback = state.clone();
            let writer_clone = writer.clone();
            device.build_input_stream(
                &config.into(),
                move |data: &[u16], _| {
                    let float_data: Vec<f32> = data.iter().map(|&s| s.to_float_sample()).collect();
                    process_audio(&float_data, &state_for_callback, &writer_clone);
                },
                err_fn,
                None,
            )?
        }
        _ => return Err(AudioError::UnsupportedFormat),
    };

    stream.play()?;

    // Keep thread alive while recording
    while state.is_recording.load(Ordering::SeqCst) {
        thread::sleep(std::time::Duration::from_millis(100));
    }

    // Finalize the WAV file
    drop(stream);
    if let Ok(mut guard) = writer.lock() {
        if let Some(w) = guard.take() {
            let _ = w.finalize();
        }
    }

    Ok(())
}

fn process_audio(
    data: &[f32],
    state: &Arc<RecordingState>,
    writer: &Arc<std::sync::Mutex<Option<WavWriter<std::io::BufWriter<std::fs::File>>>>>,
) {
    if !state.is_recording.load(Ordering::SeqCst) {
        return;
    }

    // Calculate RMS audio level
    let sum: f32 = data.iter().map(|s| s * s).sum();
    let rms = (sum / data.len() as f32).sqrt();
    state.audio_level.store(rms.to_bits(), Ordering::SeqCst);

    // Copy samples to buffer for live transcription
    if let Ok(mut buffer) = state.audio_buffer.lock() {
        buffer.extend_from_slice(data);
    }

    // Write to WAV file
    if let Ok(mut guard) = writer.lock() {
        if let Some(ref mut w) = *guard {
            for &sample in data {
                let sample_i16 = (sample * i16::MAX as f32) as i16;
                let _ = w.write_sample(sample_i16);
            }
        }
    }
}
