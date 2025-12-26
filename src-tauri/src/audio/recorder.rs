use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat};
use hound::{WavSpec, WavWriter};

use crate::audio::AudioError;

/// Shared state that can be accessed across threads
pub struct RecordingState {
    pub is_recording: AtomicBool,
    pub audio_level: AtomicU32,
    pub output_path: std::sync::Mutex<Option<PathBuf>>,
}

impl RecordingState {
    pub fn new() -> Self {
        Self {
            is_recording: AtomicBool::new(false),
            audio_level: AtomicU32::new(0),
            output_path: std::sync::Mutex::new(None),
        }
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
    if state.is_recording.load(Ordering::SeqCst) {
        return Err(AudioError::AlreadyRecording);
    }

    // Store output path
    {
        let mut path = state.output_path.lock().map_err(|_| AudioError::LockError)?;
        *path = Some(output_path.clone());
    }

    state.is_recording.store(true, Ordering::SeqCst);

    let state_clone = state.clone();

    // Spawn recording thread
    thread::spawn(move || {
        if let Err(e) = run_recording(state_clone, output_path) {
            eprintln!("Recording error: {}", e);
        }
    });

    Ok(())
}

/// Stop recording
pub fn stop_recording(state: &RecordingState) -> Result<Option<PathBuf>, AudioError> {
    state.is_recording.store(false, Ordering::SeqCst);
    state.audio_level.store(0, Ordering::SeqCst);

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
