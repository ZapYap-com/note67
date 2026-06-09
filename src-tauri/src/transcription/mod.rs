pub mod live;
pub mod model;
pub mod transcriber;

pub use live::{AudioSource, LiveTranscriptionState, TranscriptionUpdateEvent};
pub use model::{ModelInfo, ModelManager, ModelSize};
pub use transcriber::{TranscriptionResult, TranscriptionSegment, Transcriber};

/// Whether a transcript segment should be dropped rather than saved/displayed.
///
/// Catches the junk Whisper emits when fed near-silence or low-level noise:
/// - explicit non-speech markers (`[blank_audio]`, `[music]`, ...)
/// - segments with no alphanumeric content (`.`, `-`, `...`, `--`, `♪`)
/// - bare numbers (`3`, `3.`) — common stray outputs on silence
/// - well-known silence hallucinations that make up the ENTIRE segment
///   ("thank you", "thanks for watching", "you", "hello", "professor", ...).
///   Matching the whole normalized segment keeps real speech that merely contains
///   these words inside a longer sentence.
/// - long segments carrying only one or two words (e.g. "Professor" stretched
///   over 19s) — far below any real speaking rate, so almost always a stuck
///   hallucination over silence/echo.
pub fn should_skip_segment(text: &str, start_time: f64, end_time: f64) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }

    let text_lower = trimmed.to_lowercase();

    // Explicit non-speech markers emitted by Whisper
    if text_lower.contains("[blank_audio]")
        || text_lower.contains("[inaudible]")
        || text_lower.contains("[ inaudible ]")
        || text_lower.contains("[silence]")
        || text_lower.contains("[music]")
        || text_lower.contains("[applause]")
        || text_lower.contains("[laughter]")
        || text_lower.contains("[audio out]")
    {
        return true;
    }

    // Punctuation/symbol-only segments (".", "-", "...", "--", etc.)
    if !trimmed.chars().any(|c| c.is_alphanumeric()) {
        return true;
    }

    // Normalize for whole-segment matching: drop punctuation (keeping apostrophes
    // for contractions) and collapse whitespace, so "Thank you." and "thank you"
    // both reduce to "thank you".
    let normalized: String = text_lower
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '\'' { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    // Bare number segments ("3", "3.", "100")
    if !normalized.contains(' ') && normalized.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }

    // Whole-segment silence hallucinations
    if matches!(
        normalized.as_str(),
        "thank you"
            | "thank you very much"
            | "thank you so much"
            | "thank you all"
            | "thank you for watching"
            | "thanks for watching"
            | "thanks"
            | "you"
            | "bye"
            | "bye bye"
            | "hello"
            | "professor"
            | "please subscribe"
            | "subscribe"
    ) {
        return true;
    }

    // Long segment carrying almost no words = stuck hallucination over silence
    let word_count = normalized.split_whitespace().count();
    if word_count <= 2 && (end_time - start_time) >= 6.0 {
        return true;
    }

    false
}

/// Whether a mic segment is likely an echo of system audio (the mic re-capturing
/// the speaker output when not using headphones). Two signals:
/// 1. Time-overlap: the mic segment sits largely inside a system-audio speaking
///    window (overlap >= 1s covering >= 50% of the mic segment). In listen mode
///    the user rarely talks over the system for most of a segment, so heavy
///    overlap almost always means echo — even when Whisper garbled the words.
/// 2. Word match: the first few words match a time-overlapping system segment
///    (catches partial-overlap echoes that the time test alone would miss).
pub fn is_echo_of_system(
    mic_text: &str,
    mic_start: f64,
    mic_end: f64,
    system_segments: &[(f64, f64, String)], // (start, end, text)
) -> bool {
    if system_segments.is_empty() {
        return false;
    }

    let mic_dur = (mic_end - mic_start).max(0.001);
    let mic_lower = mic_text.to_lowercase();
    let mic_words: Vec<&str> = mic_lower.split_whitespace().take(5).collect();
    if mic_words.is_empty() {
        return false;
    }

    for (sys_start, sys_end, sys_text) in system_segments {
        // Must overlap by at least 1 second to be considered.
        let overlap = mic_end.min(*sys_end) - mic_start.max(*sys_start);
        if overlap < 1.0 {
            continue;
        }

        // Time-overlap suppression: most of the mic segment lies inside a system
        // speaking window -> treat as echo regardless of the (often garbled) text.
        if overlap / mic_dur >= 0.5 {
            return true;
        }

        // Word-match fallback for partial-overlap echoes.
        let sys_lower = sys_text.to_lowercase();
        let sys_words: Vec<&str> = sys_lower.split_whitespace().take(5).collect();
        let matches = mic_words.iter().filter(|w| sys_words.contains(w)).count();
        if matches >= 3 || (matches >= 2 && mic_words.len() <= 3) {
            return true;
        }
    }
    false
}

use thiserror::Error;

#[derive(Error, Debug)]
pub enum TranscriptionError {
    #[error("Model not found: {0}")]
    ModelNotFound(String),

    #[error("Model download failed: {0}")]
    DownloadError(String),

    #[error("Failed to load model: {0}")]
    ModelLoadError(String),

    #[error("Transcription failed: {0}")]
    TranscriptionFailed(String),

    #[error("Audio file not found: {0}")]
    AudioNotFound(String),

    #[allow(dead_code)]
    #[error("Unsupported audio format")]
    UnsupportedFormat,

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Already transcribing")]
    AlreadyTranscribing,

    #[allow(dead_code)]
    #[error("Not transcribing")]
    NotTranscribing,
}

#[cfg(test)]
mod tests {
    use super::{is_echo_of_system, should_skip_segment};

    #[test]
    fn skips_artifacts_and_silence_hallucinations() {
        // (text, start, end) — short duration so the long/low-word rule isn't the cause
        for junk in [
            "", "   ", ".", "-", "...", "--", "[BLANK_AUDIO]", "[music]", "♪", "Thank you.",
            "thank you", "Thank you!", "You", "you", "Thanks for watching!", "Bye bye.", "Hello.",
            "Professor", "3.", "3", "100",
        ] {
            assert!(should_skip_segment(junk, 0.0, 1.0), "expected to skip: {junk:?}");
        }
    }

    #[test]
    fn skips_long_segments_with_almost_no_words() {
        // "Professor" stretched over 19s (the real-world stuck-hallucination case)
        assert!(should_skip_segment("Professor", 47.0, 66.0));
        assert!(should_skip_segment("Okay now", 10.0, 20.0));
    }

    #[test]
    fn keeps_real_speech() {
        for real in [
            "Thank you for joining the meeting today",
            "Let's get started.",
            "I said thank you to him",
            "you know what I mean",
            "The number is 5",
        ] {
            assert!(!should_skip_segment(real, 0.0, 3.0), "expected to keep: {real:?}");
        }
        // Short one-word segments are fine; only the long ones are dropped.
        assert!(!should_skip_segment("Okay", 5.0, 5.6));
    }

    #[test]
    fn echo_suppressed_by_time_overlap_even_when_garbled() {
        let system = vec![(21.02, 26.12, "give people the on-ramp into the economy".to_string())];
        // Mic segment garbled but sitting inside the system speaking window
        assert!(is_echo_of_system(
            "pubs little green tomatoes plumbing businesses",
            22.94,
            26.44,
            &system,
        ));
    }

    #[test]
    fn non_overlapping_mic_speech_is_kept() {
        let system = vec![(21.0, 26.0, "give people the on-ramp into the economy".to_string())];
        // Real interjection well after the system segment -> not echo
        assert!(!is_echo_of_system("that's a great point", 40.0, 43.0, &system));
    }
}
