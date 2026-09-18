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
    /// When the current segment started recording (for duration calculation)
    pub segment_start_time: std::sync::Mutex<Option<Instant>>,
    /// Current segment ID in database (for updating duration)
    pub current_segment_db_id: AtomicI64,
    /// Set once the recording thread has dropped the stream and finalized the
    /// WAV. Anything that reads the file after stopping must wait for this:
    /// the thread owns the writer, and hound only writes the header (and hence
    /// the sample count) on finalize.
    pub file_finalized: AtomicBool,
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
            segment_start_time: std::sync::Mutex::new(None),
            current_segment_db_id: AtomicI64::new(0),
            // Nothing has been recorded yet, so there is nothing to wait for.
            file_finalized: AtomicBool::new(true),
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
        if let Ok(start_time) = self.segment_start_time.lock()
            && let Some(start) = *start_time
        {
            return start.elapsed().as_millis() as i64;
        }
        0
    }

    /// Reset state for a new recording session
    pub fn reset_for_new_session(&self) {
        self.current_segment_db_id.store(0, Ordering::SeqCst);
        if let Ok(mut start_time) = self.segment_start_time.lock() {
            *start_time = None;
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
    state.file_finalized.store(false, Ordering::SeqCst);

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

    // A paused segment's WAV is a finished file that later gets merged and
    // retranscribed, so wait for it to close here too.
    await_file_finalized(state, std::time::Duration::from_secs(5));

    Ok(duration_ms)
}

/// Resume recording after pause - starts a new segment
pub fn resume_recording(state: Arc<RecordingState>, output_path: PathBuf) -> Result<(), AudioError> {
    let current_phase = state.get_phase();
    if current_phase != RecordingPhase::Paused {
        return Err(AudioError::NotPaused);
    }

    // Start recording with the new path
    start_recording(state, output_path)
}

/// Block until the recording thread has finalized the WAV, or `timeout` passes.
///
/// The thread owns the writer and only finalizes after it observes
/// `is_recording == false`. Callers that immediately read the file — the mixer
/// that builds the playback track — otherwise see a WAV whose header still says
/// zero samples, and silently mix in nothing. Returns whether it finalized.
fn await_file_finalized(state: &RecordingState, timeout: std::time::Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while !state.file_finalized.load(Ordering::SeqCst) {
        if Instant::now() >= deadline {
            eprintln!(
                "Timed out waiting for the recording file to finalize; playback audio may be incomplete"
            );
            return false;
        }
        thread::sleep(std::time::Duration::from_millis(5));
    }
    true
}

/// Stop recording completely - resets all state
pub fn stop_recording(state: &RecordingState) -> Result<Option<PathBuf>, AudioError> {
    state.is_recording.store(false, Ordering::SeqCst);
    state.audio_level.store(0, Ordering::SeqCst);
    state.set_phase(RecordingPhase::Idle);

    // The caller is about to read this file (to merge the playback track), so
    // it must not be handed a path to a WAV that has not been closed yet.
    await_file_finalized(state, std::time::Duration::from_secs(5));

    // Reset segment tracking
    state.reset_for_new_session();

    let path = state.output_path.lock().map_err(|_| AudioError::LockError)?;
    Ok(path.clone())
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

    // Keep thread alive while recording. Polled rather than signalled; the
    // interval is the floor on how long a stop takes, since the caller waits
    // for the finalize below.
    while state.is_recording.load(Ordering::SeqCst) {
        thread::sleep(std::time::Duration::from_millis(20));
    }

    // Finalize the WAV file
    drop(stream);
    if let Ok(mut guard) = writer.lock()
        && let Some(w) = guard.take()
    {
        let _ = w.finalize();
    }
    state.file_finalized.store(true, Ordering::SeqCst);

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
    if let Ok(mut guard) = writer.lock()
        && let Some(ref mut w) = *guard
    {
        for &sample in data {
            let sample_i16 = (sample * i16::MAX as f32) as i16;
            let _ = w.write_sample(sample_i16);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_state_does_not_wait_for_a_finalize_that_will_never_come() {
        // Nothing was recorded, so there is no thread to finalize anything.
        // Waiting here would stall every stop on a note that never recorded.
        let state = RecordingState::new();
        let started = Instant::now();
        assert!(await_file_finalized(&state, std::time::Duration::from_secs(5)));
        assert!(
            started.elapsed() < std::time::Duration::from_millis(100),
            "should have returned immediately"
        );
    }

    #[test]
    fn waits_until_the_recording_thread_signals() {
        let state = Arc::new(RecordingState::new());
        state.file_finalized.store(false, Ordering::SeqCst);

        let signaller = state.clone();
        thread::spawn(move || {
            thread::sleep(std::time::Duration::from_millis(60));
            signaller.file_finalized.store(true, Ordering::SeqCst);
        });

        let started = Instant::now();
        assert!(await_file_finalized(&state, std::time::Duration::from_secs(5)));
        assert!(
            started.elapsed() >= std::time::Duration::from_millis(50),
            "returned before the writer signalled"
        );
    }

    #[test]
    fn gives_up_rather_than_hanging_when_no_signal_arrives() {
        let state = RecordingState::new();
        state.file_finalized.store(false, Ordering::SeqCst);

        let started = Instant::now();
        assert!(!await_file_finalized(
            &state,
            std::time::Duration::from_millis(80)
        ));
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
    }
}
