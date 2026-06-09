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
/// - well-known silence hallucinations that make up the ENTIRE segment
///   ("thank you", "thanks for watching", "you", "bye", ...). Matching the whole
///   segment (punctuation stripped, whitespace collapsed) keeps real speech that
///   merely contains these words inside a longer sentence.
pub fn should_skip_segment(text: &str) -> bool {
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

    // Normalize for whole-segment hallucination matching: drop punctuation
    // (keeping apostrophes for contractions) and collapse whitespace, so
    // "Thank you." and "thank you" both reduce to "thank you".
    let normalized: String = text_lower
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '\'' { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    matches!(
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
            | "please subscribe"
            | "subscribe"
    )
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
    use super::should_skip_segment;

    #[test]
    fn skips_artifacts_and_silence_hallucinations() {
        for junk in [
            "",
            "   ",
            ".",
            "-",
            "...",
            "--",
            "[BLANK_AUDIO]",
            "[music]",
            "♪",
            "Thank you.",
            "thank you",
            "Thank you!",
            "You",
            "you",
            "Thanks for watching!",
            "Bye bye.",
        ] {
            assert!(should_skip_segment(junk), "expected to skip: {junk:?}");
        }
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
            assert!(!should_skip_segment(real), "expected to keep: {real:?}");
        }
    }
}
