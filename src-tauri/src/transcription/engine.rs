//! The speech-to-text engines note67 can run.
//!
//! Two families, behind one type:
//!
//! - **Whisper** (whisper.cpp, via `whisper-rs`): 99 languages, told which one
//!   to use. What note67 has always shipped.
//! - **Parakeet** (NVIDIA/Moondream, via `wavo`): 25 European languages,
//!   several times faster, and it detects which of its languages is being
//!   spoken on its own — there is no way to tell it one.
//!
//! The asymmetry in language support is the whole reason this file exists.
//! Whisper covers every language note67 offers; Parakeet covers nine of them.
//! A model that cannot transcribe the chosen language must say so rather than
//! write confident nonsense in the wrong script, so every entry point here
//! checks [`ModelSize::supports_language`] first.

use std::path::Path;

use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, get_lang_str,
};

use super::TranscriptionError;
use super::model::{EngineKind, ModelSize};

use serde::{Deserialize, Serialize};

/// A segment of transcribed text with timestamps
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionSegment {
    pub start_time: f64,
    pub end_time: f64,
    pub text: String,
}

/// Result of a transcription
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub segments: Vec<TranscriptionSegment>,
    pub full_text: String,
    pub language: Option<String>,
}

/// Parakeet emits tokens, not segments. Without sentence-ending punctuation to
/// break on, close a segment anyway after this long so a monologue still
/// carries usable timestamps.
const PARAKEET_SEGMENT_MAX_SECS: f64 = 15.0;

/// A loaded model, ready to transcribe.
///
/// `Send + Sync`: both `WhisperContext` and `wavo::Model` are, so one loaded
/// engine is shared between the live path and the file path instead of each
/// loading its own copy of the weights.
pub struct Engine {
    size: ModelSize,
    inner: EngineInner,
}

enum EngineInner {
    Whisper(WhisperContext),
    Parakeet(wavo::Model),
}

impl Engine {
    /// Load `size` from `model_path`.
    pub fn load(size: ModelSize, model_path: &Path) -> Result<Self, TranscriptionError> {
        if !model_path.exists() {
            return Err(TranscriptionError::ModelNotFound(
                model_path.to_string_lossy().to_string(),
            ));
        }

        let inner = match size.engine_kind() {
            EngineKind::Whisper => {
                let path = model_path.to_str().ok_or_else(|| {
                    TranscriptionError::ModelLoadError(
                        "the model's path is not valid UTF-8".to_string(),
                    )
                })?;
                let ctx =
                    WhisperContext::new_with_params(path, WhisperContextParameters::default())
                        .map_err(|e| TranscriptionError::ModelLoadError(e.to_string()))?;
                EngineInner::Whisper(ctx)
            }
            EngineKind::Parakeet => {
                // Backend::Auto: the GPU (Metal, Vulkan or DX12), falling back
                // to wavo's own CPU kernels when there is no usable GPU, so
                // this does not fail on a machine without one.
                //
                // Not the Neural Engine: that needs the weights converted for
                // Core ML in a separate step first, which note67 doesn't do.
                // Metal is already several times faster than Whisper here, so
                // the ANE is a speed-up left on the table, not a gap.
                let model = wavo::Model::load(model_path)
                    .map_err(|e| TranscriptionError::ModelLoadError(e.to_string()))?;
                EngineInner::Parakeet(model)
            }
        };

        Ok(Self { size, inner })
    }

    /// Fail before transcribing if this model cannot write the chosen language.
    ///
    /// Whisper told the wrong language writes that language anyway, as a rough
    /// translation; Parakeet has no language input at all. Either way the user
    /// gets a transcript that looks fine and is wrong, so refuse instead.
    fn check_language(&self, language: Option<&str>) -> Result<(), TranscriptionError> {
        let Some(code) = language else {
            // Auto-detect. Parakeet picks among its own languages, Whisper
            // among all of its: nothing to refuse.
            return Ok(());
        };
        if self.size.supports_language(code) {
            return Ok(());
        }
        Err(TranscriptionError::LanguageNotSupported {
            model: self.size.as_str().to_string(),
            language: code.to_string(),
        })
    }

    /// Transcribe one pass of 16 kHz mono samples, as the live path does with
    /// each chunk. `time_offset` is added to every timestamp.
    pub fn transcribe_samples(
        &self,
        samples: &[f32],
        time_offset: f64,
        language: Option<&str>,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        self.check_language(language)?;

        match &self.inner {
            EngineInner::Whisper(ctx) => whisper_pass(ctx, samples, time_offset, language),
            EngineInner::Parakeet(model) => {
                let transcript = model
                    .transcribe(samples)
                    .map_err(|e| TranscriptionError::TranscriptionFailed(e.to_string()))?;
                Ok(parakeet_result(
                    &transcript,
                    time_offset,
                    audio_secs(samples),
                    language,
                ))
            }
        }
    }

    /// Transcribe a whole recording of 16 kHz mono samples, of any length.
    ///
    /// Whisper runs its own 30-second windows, so this is the same single pass.
    /// Parakeet is given the audio through `transcribe_long`, which cuts it at
    /// its quietest moments into pieces of at most a minute and joins the
    /// results with timestamps from the start of the audio.
    pub fn transcribe_long(
        &self,
        samples: &[f32],
        language: Option<&str>,
    ) -> Result<TranscriptionResult, TranscriptionError> {
        self.check_language(language)?;

        match &self.inner {
            EngineInner::Whisper(ctx) => whisper_pass(ctx, samples, 0.0, language),
            EngineInner::Parakeet(model) => {
                // Options::default() leaves the language to the model, which is
                // the only thing Parakeet accepts: given any code at all it
                // fails, so the user's choice is enforced in check_language
                // above and deliberately not passed on here.
                let options = wavo::Options::default();
                let transcript = model
                    .transcribe_long(samples, &options, |_piece| {
                        std::ops::ControlFlow::Continue(())
                    })
                    .map_err(|e| TranscriptionError::TranscriptionFailed(e.to_string()))?;
                Ok(parakeet_result(
                    &transcript,
                    0.0,
                    audio_secs(samples),
                    language,
                ))
            }
        }
    }
}

fn audio_secs(samples: &[f32]) -> f64 {
    samples.len() as f64 / 16_000.0
}

/// One `whisper_rs` pass over 16 kHz mono samples.
fn whisper_pass(
    ctx: &WhisperContext,
    samples: &[f32],
    time_offset: f64,
    language: Option<&str>,
) -> Result<TranscriptionResult, TranscriptionError> {
    let mut state = ctx
        .create_state()
        .map_err(|e| TranscriptionError::TranscriptionFailed(e.to_string()))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(language); // None = auto-detect
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_token_timestamps(true);
    params.set_n_threads(num_cpus());

    state
        .full(params, samples)
        .map_err(|e| TranscriptionError::TranscriptionFailed(e.to_string()))?;

    let mut segments = Vec::new();
    let mut full_text = String::new();

    for segment in state.as_iter() {
        let start_time = segment.start_timestamp() as f64 / 100.0 + time_offset;
        let end_time = segment.end_timestamp() as f64 / 100.0 + time_offset;

        // Lossy: Whisper can split a multi-byte character across two segments,
        // which shouldn't fail the whole transcript.
        let text = segment
            .to_str_lossy()
            .map_err(|e| TranscriptionError::TranscriptionFailed(e.to_string()))?;

        let text = text.trim().to_string();
        if !text.is_empty() {
            if !full_text.is_empty() {
                full_text.push(' ');
            }
            full_text.push_str(&text);
            segments.push(TranscriptionSegment {
                start_time,
                end_time,
                text,
            });
        }
    }

    // The language Whisper actually used: the requested one, or what it
    // detected when asked to auto-detect.
    let language = get_lang_str(state.full_lang_id_from_state()).map(str::to_string);

    Ok(TranscriptionResult {
        segments,
        full_text,
        language,
    })
}

/// Turn a Parakeet transcript into note67's segments.
///
/// `wavo` returns tokens with a start time each and no segments, so group them
/// into lines: break on sentence-ending punctuation, and after
/// `PARAKEET_SEGMENT_MAX_SECS` regardless so speech without punctuation still
/// gets timestamps. The transcript viewer re-splits these into sentences for
/// display, so they only have to be reasonable, not perfect.
fn parakeet_result(
    transcript: &wavo::Transcript,
    time_offset: f64,
    audio_end: f64,
    requested_language: Option<&str>,
) -> TranscriptionResult {
    let (segments, full_text) = segments_from_pieces(
        transcript
            .tokens
            .iter()
            .map(|t| (t.start_ms, t.piece.as_str())),
        time_offset,
        audio_end,
    );

    TranscriptionResult {
        segments,
        full_text,
        // Parakeet v3 and ultra tell their languages apart without saying
        // which, so `transcript.language` is None for them. Report what the
        // user asked for, which is what the rest of the app stores.
        language: transcript
            .language
            .clone()
            .or_else(|| requested_language.map(str::to_string)),
    }
}

/// Group `(start_ms, piece)` tokens into timed segments.
///
/// Separate from [`parakeet_result`] so it can be tested: `wavo::Transcript`
/// and `wavo::Token` are `#[non_exhaustive]` and cannot be constructed here.
fn segments_from_pieces<'a>(
    tokens: impl Iterator<Item = (u32, &'a str)>,
    time_offset: f64,
    audio_end: f64,
) -> (Vec<TranscriptionSegment>, String) {
    // (start, text) first; a line's end time is the next line's start, which is
    // only known once the following line has begun.
    let mut lines: Vec<(f64, String)> = Vec::new();
    let mut text = String::new();
    let mut start: Option<f64> = None;

    for (start_ms, piece) in tokens {
        if piece.is_empty() {
            continue;
        }
        // SentencePiece marks a word start with U+2581; as plain text that is a
        // space.
        let piece = piece.replace('\u{2581}', " ");
        let token_start = start_ms as f64 / 1000.0;
        let line_start = *start.get_or_insert(token_start);

        text.push_str(&piece);

        let trimmed = text.trim_end();
        let ends_sentence = trimmed.ends_with(['.', '!', '?']);
        let overlong = token_start - line_start >= PARAKEET_SEGMENT_MAX_SECS;

        if ends_sentence || overlong {
            let line = text.trim().to_string();
            if !line.is_empty() {
                lines.push((line_start, line));
            }
            text.clear();
            start = None;
        }
    }

    // Whatever is left after the last break.
    if let Some(line_start) = start {
        let line = text.trim().to_string();
        if !line.is_empty() {
            lines.push((line_start, line));
        }
    }

    let mut segments = Vec::with_capacity(lines.len());
    let mut full_text = String::new();
    for (i, (line_start, line)) in lines.iter().enumerate() {
        // A line runs until the next one starts; the last until the audio ends.
        let end = lines
            .get(i + 1)
            .map(|(next_start, _)| *next_start)
            .unwrap_or(audio_end)
            .max(*line_start);

        if !full_text.is_empty() {
            full_text.push(' ');
        }
        full_text.push_str(line);

        segments.push(TranscriptionSegment {
            start_time: line_start + time_offset,
            end_time: end + time_offset,
            text: line.clone(),
        });
    }

    (segments, full_text)
}

/// Threads to use for CPU transcription.
pub fn num_cpus() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as i32)
        .unwrap_or(4)
        .min(8) // Cap at 8 threads for transcription
}

#[cfg(test)]
mod tests {
    use super::segments_from_pieces;

    /// `(start_ms, piece)` as `wavo` reports them: U+2581 starts a word.
    fn toks() -> Vec<(u32, &'static str)> {
        vec![
            (0, "\u{2581}Let"),
            (240, "'s"),
            (400, "\u{2581}start"),
            (720, "."),
            (1200, "\u{2581}Revenue"),
            (1600, "\u{2581}is"),
            (1840, "\u{2581}up"),
            (2080, "."),
        ]
    }

    #[test]
    fn breaks_lines_on_sentence_endings() {
        let (segments, full_text) = segments_from_pieces(toks().into_iter(), 0.0, 3.0);

        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].text, "Let's start.");
        assert_eq!(segments[1].text, "Revenue is up.");
        assert_eq!(full_text, "Let's start. Revenue is up.");
    }

    #[test]
    fn a_line_runs_until_the_next_one_starts() {
        let (segments, _) = segments_from_pieces(toks().into_iter(), 0.0, 3.0);

        assert_eq!(segments[0].start_time, 0.0);
        // Not the last token of line 1 (0.72) but the first of line 2.
        assert_eq!(segments[0].end_time, 1.2);
        assert_eq!(segments[1].start_time, 1.2);
        // The final line runs to the end of the audio.
        assert_eq!(segments[1].end_time, 3.0);
    }

    #[test]
    fn time_offset_shifts_every_timestamp() {
        // The live path transcribes chunks and offsets them into the recording.
        let (segments, _) = segments_from_pieces(toks().into_iter(), 60.0, 3.0);

        assert_eq!(segments[0].start_time, 60.0);
        assert_eq!(segments[1].end_time, 63.0);
    }

    #[test]
    fn speech_without_punctuation_still_gets_segments() {
        // A monologue Parakeet never punctuates would otherwise be one segment
        // with one timestamp, which the transcript viewer cannot place.
        let tokens: Vec<(u32, &str)> = (0..40).map(|i| (i * 1000, "\u{2581}word")).collect();
        let (segments, _) = segments_from_pieces(tokens.into_iter(), 0.0, 40.0);

        assert!(
            segments.len() > 1,
            "expected a break, got {}",
            segments.len()
        );
        for w in segments.windows(2) {
            assert!(
                w[1].start_time >= w[0].start_time,
                "segments must be ordered"
            );
        }
    }

    #[test]
    fn empty_pieces_are_skipped() {
        // A byte token can complete inside a character, leaving the piece empty.
        let tokens = vec![
            (0, "\u{2581}Hi"),
            (100, ""),
            (200, "\u{2581}there"),
            (300, "."),
        ];
        let (segments, full_text) = segments_from_pieces(tokens.into_iter(), 0.0, 1.0);

        assert_eq!(segments.len(), 1);
        assert_eq!(full_text, "Hi there.");
    }

    #[test]
    fn silence_produces_no_segments() {
        let (segments, full_text) = segments_from_pieces(std::iter::empty(), 0.0, 3.0);

        assert!(segments.is_empty());
        assert!(full_text.is_empty());
    }
}
