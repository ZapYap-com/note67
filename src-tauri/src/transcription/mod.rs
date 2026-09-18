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
/// - whole-segment asterisk narration (`*Slow's voice*`, `*sighs*`) — the same
///   artifact as the bracketed markers in a different convention
/// - bare numbers (`3`, `3.`) — common stray outputs on silence
/// - well-known silence hallucinations that make up the ENTIRE segment
///   ("thank you", "thanks for watching", "you", "hello", "professor", ...).
///   Matching the whole normalized segment keeps real speech that merely contains
///   these words inside a longer sentence.
/// - long segments carrying only one or two words (e.g. "Professor" stretched
///   over 19s) — far below any real speaking rate, so almost always a stuck
///   hallucination over silence/echo.
pub fn should_skip_segment(text: &str, start_time: f64, end_time: f64) -> bool {
    should_skip_segment_inner(text, start_time, end_time, true)
}

/// Variant for callers that have already established the audio contains voice.
///
/// The whole-segment word list below ("hello", "thanks", "you", …) catches
/// Whisper hallucinating over silence. That is the right call for a whole file,
/// where such a word is almost never a real segment on its own — but wrong for
/// live 3-second chunks, which routinely contain exactly one short utterance,
/// so the entire segment *is* the word. The live path gates on RMS before
/// transcribing, so silence never gets that far and the list only removes real
/// speech. Structural checks (markers, punctuation-only, stuck hallucinations)
/// still apply.
pub fn should_skip_live_segment(text: &str, start_time: f64, end_time: f64) -> bool {
    should_skip_segment_inner(text, start_time, end_time, false)
}

fn should_skip_segment_inner(
    text: &str,
    start_time: f64,
    end_time: f64,
    drop_silence_fillers: bool,
) -> bool {
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

    // Whisper sometimes narrates instead of transcribing, emitting a stage
    // direction wrapped in asterisks: "*Slow's voice*", "*sighs*",
    // "*music playing*". Same class of artifact as the [bracketed] markers
    // above, just a different convention.
    //
    // Only when the WHOLE segment is one annotation. "*sighs* okay then" still
    // contains real speech, and "*a* word *b*" is not a single annotation — so
    // an interior asterisk disqualifies it.
    let unstarred = trimmed.trim_matches('*');
    if trimmed.starts_with('*')
        && trimmed.ends_with('*')
        && !unstarred.is_empty()
        && !unstarred.contains('*')
    {
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
    if drop_silence_fillers
        && matches!(
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
        )
    {
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

        let sys_lower = sys_text.to_lowercase();
        let sys_words: Vec<&str> = sys_lower.split_whitespace().take(5).collect();
        let matches = mic_words.iter().filter(|w| sys_words.contains(w)).count();

        // Heavy time overlap lowers the bar for what counts as echo, but text
        // evidence is still required. Overlap alone used to be enough, which
        // silently dropped the user's speech whenever they talked while system
        // audio was playing — normal in a meeting, not a sign of echo. Echo
        // repeats the other party's words, so that is what we look for.
        if overlap / mic_dur >= 0.5 && matches >= 2 {
            return true;
        }

        // Partial-overlap echo needs stronger text agreement.
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

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Already transcribing")]
    AlreadyTranscribing,
}

#[cfg(test)]
mod tests {
    use super::{is_echo_of_system, should_skip_live_segment, should_skip_segment};

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
    fn skips_asterisk_wrapped_narration() {
        // Whisper narrating the audio instead of transcribing it.
        for junk in [
            "*Slow's voice*",
            "*slow's voice*",
            "  *Slow's voice*  ",
            "*sighs*",
            "*music playing*",
            "**Slow's voice**",
        ] {
            assert!(should_skip_segment(junk, 0.0, 2.0), "expected to skip: {junk:?}");
            // Structural, so it applies to the live path too.
            assert!(
                should_skip_live_segment(junk, 0.0, 2.0),
                "expected live to skip: {junk:?}"
            );
        }
    }

    #[test]
    fn keeps_speech_that_merely_contains_an_annotation() {
        // Dropping the whole segment here would throw away real words.
        for real in [
            "*sighs* okay then, let's start",
            "we marked it with *stars* in the doc",
            "*a* word *b*",
        ] {
            assert!(!should_skip_segment(real, 0.0, 3.0), "expected to keep: {real:?}");
        }
    }

    #[test]
    fn live_keeps_short_utterances_the_file_filter_drops() {
        // The live regression: a 3s chunk usually holds one short utterance, so
        // the whole segment IS the word. Whisper returned exactly these for the
        // reported recording ("hello", "Hello?", "Hallo?") and every one was
        // discarded, so the mic never appeared live while system audio did.
        for word in ["hello", "Hello.", "Hello?", "thanks", "you", "bye"] {
            assert!(
                should_skip_segment(word, 0.0, 1.0),
                "whole-file filter should still drop {word:?} as a silence hallucination"
            );
            assert!(
                !should_skip_live_segment(word, 0.0, 1.0),
                "live filter must keep {word:?} — the RMS gate already proved there was voice"
            );
        }
    }

    #[test]
    fn live_filter_still_drops_structural_non_speech() {
        // Relaxing the word list must not let markers or punctuation through.
        for junk in ["", "   ", "...", "[BLANK_AUDIO]", "[music]", "-", "3"] {
            assert!(
                should_skip_live_segment(junk, 0.0, 1.0),
                "live filter should still drop {junk:?}"
            );
        }
    }

    #[test]
    fn live_filter_still_drops_stuck_hallucinations() {
        // A couple of words stretched over a long span is a stuck decode, not
        // speech, however loud the chunk was.
        assert!(should_skip_live_segment("Professor", 47.0, 66.0));
        assert!(should_skip_live_segment("Okay now", 10.0, 20.0));
    }

    #[test]
    fn echo_suppressed_when_overlap_and_words_agree() {
        let system = vec![(21.02, 26.12, "give people the on-ramp into the economy".to_string())];
        // Mic re-hears the system audio: heavy overlap AND repeated words.
        assert!(is_echo_of_system(
            "give people the on-ramp",
            22.94,
            26.44,
            &system,
        ));
    }

    #[test]
    fn simultaneous_speech_over_system_audio_is_kept() {
        // The regression this rule used to cause: talking while desktop audio
        // plays is normal in a meeting, and the mic segment must survive even
        // though it sits entirely inside the system speaking window.
        let system = vec![(21.02, 26.12, "give people the on-ramp into the economy".to_string())];
        assert!(!is_echo_of_system(
            "sorry can I jump in here for a second",
            22.94,
            26.44,
            &system,
        ));
    }

    #[test]
    fn garbled_overlap_without_shared_words_is_kept() {
        // Accepted trade-off: badly garbled echo with no word agreement is now
        // kept rather than dropped. Losing real speech is worse than an
        // occasional junk line.
        let system = vec![(21.02, 26.12, "give people the on-ramp into the economy".to_string())];
        assert!(!is_echo_of_system(
            "pubs little green tomatoes plumbing businesses",
            22.94,
            26.44,
            &system,
        ));
    }

    #[test]
    fn partial_overlap_echo_still_needs_strong_word_agreement() {
        let system = vec![(21.0, 26.0, "give people the on-ramp into the economy".to_string())];
        // Only ~1.2s of a 5s mic segment overlaps, so the heavy-overlap rule
        // does not apply; three shared words still mark it as echo.
        assert!(is_echo_of_system("give people the fastest route", 24.8, 29.8, &system));
    }

    #[test]
    fn non_overlapping_mic_speech_is_kept() {
        let system = vec![(21.0, 26.0, "give people the on-ramp into the economy".to_string())];
        // Real interjection well after the system segment -> not echo
        assert!(!is_echo_of_system("that's a great point", 40.0, 43.0, &system));
    }

    #[test]
    fn no_system_audio_means_nothing_is_echo() {
        assert!(!is_echo_of_system("anything at all", 1.0, 4.0, &[]));
    }
}
