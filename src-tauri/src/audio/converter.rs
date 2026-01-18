//! Audio format conversion module for uploaded files.
//!
//! Converts various audio formats to 16-bit mono WAV at 16kHz for Whisper transcription.

use std::path::Path;
use std::process::Command;

use super::AudioError;

/// Supported input formats for upload
const SUPPORTED_EXTENSIONS: &[&str] = &["mp3", "m4a", "wav", "webm", "ogg", "flac", "aac", "wma"];

/// Check if a file has a supported audio format
pub fn is_supported_format(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Convert an audio file to 16-bit mono WAV at 16kHz for Whisper.
///
/// If the input is already a WAV file, it will be re-encoded to ensure
/// the correct format (16kHz, mono, 16-bit).
///
/// Requires FFmpeg to be installed on the system.
pub fn convert_to_wav(input_path: &Path, output_path: &Path) -> Result<(), AudioError> {
    let input_str = input_path
        .to_str()
        .ok_or_else(|| AudioError::IoError(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Invalid input path",
        )))?;

    let output_str = output_path
        .to_str()
        .ok_or_else(|| AudioError::IoError(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Invalid output path",
        )))?;

    // Use FFmpeg for conversion
    // -i: input file
    // -ar 16000: resample to 16kHz (Whisper requirement)
    // -ac 1: convert to mono
    // -sample_fmt s16: 16-bit signed integer samples
    // -y: overwrite output file without asking
    let output = Command::new("ffmpeg")
        .args([
            "-i", input_str,
            "-ar", "16000",
            "-ac", "1",
            "-sample_fmt", "s16",
            "-y",
            output_str,
        ])
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                Ok(())
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(AudioError::IoError(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("FFmpeg conversion failed: {}", stderr),
                )))
            }
        }
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                Err(AudioError::IoError(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "FFmpeg not found. Please install FFmpeg to upload non-WAV audio files.",
                )))
            } else {
                Err(AudioError::IoError(e))
            }
        }
    }
}

/// Get the duration of an audio file in milliseconds.
///
/// Uses hound for WAV files, falls back to FFprobe for other formats.
pub fn get_audio_duration_ms(path: &Path) -> Result<i64, AudioError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "wav" {
        // Use hound for WAV files (faster, no external dependency)
        get_wav_duration_ms(path)
    } else {
        // Use FFprobe for other formats
        get_ffprobe_duration_ms(path)
    }
}

/// Get WAV file duration using hound
fn get_wav_duration_ms(path: &Path) -> Result<i64, AudioError> {
    let reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    let num_samples = reader.len() as u64;
    let duration_ms = (num_samples * 1000) / (spec.sample_rate as u64 * spec.channels as u64);
    Ok(duration_ms as i64)
}

/// Get audio duration using FFprobe
fn get_ffprobe_duration_ms(path: &Path) -> Result<i64, AudioError> {
    let path_str = path
        .to_str()
        .ok_or_else(|| AudioError::IoError(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Invalid path",
        )))?;

    let output = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path_str,
        ])
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let duration_str = String::from_utf8_lossy(&result.stdout);
                let duration_secs: f64 = duration_str
                    .trim()
                    .parse()
                    .map_err(|_| AudioError::IoError(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "Failed to parse duration",
                    )))?;
                Ok((duration_secs * 1000.0) as i64)
            } else {
                Err(AudioError::IoError(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "FFprobe failed to get duration",
                )))
            }
        }
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                // FFprobe not available, return 0 (unknown duration)
                Ok(0)
            } else {
                Err(AudioError::IoError(e))
            }
        }
    }
}

/// Check if FFmpeg is available on the system
pub fn is_ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supported_formats() {
        assert!(is_supported_format(Path::new("test.mp3")));
        assert!(is_supported_format(Path::new("test.M4A")));
        assert!(is_supported_format(Path::new("test.wav")));
        assert!(is_supported_format(Path::new("test.WEBM")));
        assert!(!is_supported_format(Path::new("test.txt")));
        assert!(!is_supported_format(Path::new("test.pdf")));
    }
}
