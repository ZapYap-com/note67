//! Hand-run checks that the engines really do turn audio into text.
//!
//! Ignored by default: they need a model on disk (740 MB for Parakeet Ultra)
//! and a real recording, so `cargo test` must not drag them in. Run them with
//! the app's own model folder and any 16 kHz-or-other WAV of speech:
//!
//! ```sh
//! NOTE67_APP_DATA_DIR="$HOME/Library/Application Support/com.note67.app" \
//! NOTE67_SPEECH_WAV=/path/to/speech.wav \
//!   cargo test --lib verification -- --ignored --nocapture
//! ```
//!
//! A missing variable skips rather than fails, so the suite stays runnable on
//! a machine that has neither.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use super::{Engine, ModelManager, ModelSize, Transcriber, TranscriptionError};

/// The app data directory to take models from, or `None` to skip.
fn app_data_dir() -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var_os("NOTE67_APP_DATA_DIR")?);
    if dir.is_dir() {
        Some(dir)
    } else {
        eprintln!("skipping: NOTE67_APP_DATA_DIR is not a directory: {dir:?}");
        None
    }
}

/// A WAV of speech to transcribe, or `None` to skip.
fn speech_wav() -> Option<PathBuf> {
    let wav = PathBuf::from(std::env::var_os("NOTE67_SPEECH_WAV")?);
    if wav.is_file() {
        Some(wav)
    } else {
        eprintln!("skipping: NOTE67_SPEECH_WAV is not a file: {wav:?}");
        None
    }
}

/// Download `size` through the app's own downloader if it isn't there yet,
/// which also exercises the checksum check.
async fn ensure_model(manager: &ModelManager, size: ModelSize) {
    // The app installs the rustls provider in `run()`, which a test never
    // reaches: without this, every download panics inside reqwest.
    crate::install_tls_provider();

    if manager.is_downloaded(size) {
        println!("{} already downloaded", size.as_str());
        return;
    }
    println!("downloading {} ({} MB)...", size.as_str(), size.size_mb());
    let last = Arc::new(AtomicU64::new(0));
    let progress_last = last.clone();
    manager
        .download_model(size, move |done, total| {
            // Every 100 MB, so a long download says something without flooding.
            let step = 100 * 1024 * 1024;
            if done / step > progress_last.load(Ordering::Relaxed) / step {
                progress_last.store(done, Ordering::Relaxed);
                println!("  {} / {} MB", done / 1_048_576, total / 1_048_576);
            }
        })
        .await
        .expect("download failed");
    println!("{} downloaded and checksum verified", size.as_str());
}

fn transcriber_for(dir: &std::path::Path, size: ModelSize) -> Transcriber {
    let path = dir.join("models").join(size.filename());
    let engine = Engine::load(size, &path).expect("engine failed to load");
    Transcriber::new(Arc::new(engine))
}

/// Words of a transcript, lowercased and stripped of punctuation, for
/// comparing two engines on the same audio.
fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '\'' { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_string)
        .collect()
}

#[tokio::test]
#[ignore = "needs a downloaded model and a speech recording"]
async fn parakeet_transcribes_real_speech() {
    let (Some(dir), Some(wav)) = (app_data_dir(), speech_wav()) else {
        return;
    };

    let manager = ModelManager::new(dir.clone());
    manager.init().await.expect("models dir");
    ensure_model(&manager, ModelSize::ParakeetUltra).await;

    let started = Instant::now();
    let transcriber = transcriber_for(&dir, ModelSize::ParakeetUltra);
    println!("loaded in {:?}", started.elapsed());

    let started = Instant::now();
    let result = transcriber
        .transcribe(&wav, Some("en"))
        .expect("transcription failed");
    let elapsed = started.elapsed();

    println!("\n--- parakeet-ultra, {elapsed:?} ---");
    for s in &result.segments {
        println!("[{:>7.2} -> {:>7.2}] {}", s.start_time, s.end_time, s.text);
    }
    println!("full text: {}", result.full_text);

    assert!(
        !result.full_text.trim().is_empty(),
        "Parakeet returned no text at all"
    );
    assert!(!result.segments.is_empty(), "no segments");

    // Timestamps have to be usable by the transcript viewer: in order, and not
    // beyond the recording.
    let mut previous = 0.0_f64;
    for s in &result.segments {
        assert!(
            s.start_time >= previous - f64::EPSILON,
            "segments out of order at {s:?}"
        );
        assert!(s.end_time >= s.start_time, "segment ends before it starts: {s:?}");
        previous = s.start_time;
    }
}

#[tokio::test]
#[ignore = "needs both models downloaded and a speech recording"]
async fn parakeet_and_whisper_agree_on_the_same_audio() {
    let (Some(dir), Some(wav)) = (app_data_dir(), speech_wav()) else {
        return;
    };

    let manager = ModelManager::new(dir.clone());
    manager.init().await.expect("models dir");
    ensure_model(&manager, ModelSize::ParakeetUltra).await;
    if !manager.is_downloaded(ModelSize::LargeTurboQ8) {
        eprintln!("skipping: large-turbo-q8 is not downloaded, nothing to compare against");
        return;
    }

    let mut texts = Vec::new();
    for size in [ModelSize::LargeTurboQ8, ModelSize::ParakeetUltra] {
        let transcriber = transcriber_for(&dir, size);
        let started = Instant::now();
        let result = transcriber
            .transcribe(&wav, Some("en"))
            .expect("transcription failed");
        println!(
            "\n--- {} in {:?} ---\n{}",
            size.as_str(),
            started.elapsed(),
            result.full_text
        );
        texts.push(result.full_text);
    }

    // Not word-for-word: two different models. But if the Parakeet path were
    // wired up wrong — wrong tokenizer, pieces joined wrongly, timestamps
    // misread as text — the overlap would collapse.
    let whisper = words(&texts[0]);
    let parakeet = words(&texts[1]);
    let shared = parakeet.iter().filter(|w| whisper.contains(w)).count();
    let ratio = shared as f64 / parakeet.len().max(1) as f64;
    println!("\nshared words: {shared}/{} ({:.0}%)", parakeet.len(), ratio * 100.0);

    assert!(
        ratio >= 0.6,
        "only {:.0}% of Parakeet's words appear in Whisper's transcript, which means the \
         Parakeet path is decoding wrongly rather than merely differing",
        ratio * 100.0
    );
}

#[tokio::test]
#[ignore = "needs a downloaded model and a speech recording"]
async fn parakeet_refuses_a_language_it_cannot_write() {
    let (Some(dir), Some(wav)) = (app_data_dir(), speech_wav()) else {
        return;
    };

    let manager = ModelManager::new(dir.clone());
    manager.init().await.expect("models dir");
    ensure_model(&manager, ModelSize::ParakeetUltra).await;

    let transcriber = transcriber_for(&dir, ModelSize::ParakeetUltra);
    let error = transcriber
        .transcribe(&wav, Some("zh"))
        .expect_err("Parakeet must refuse Chinese rather than transcribe it");

    println!("\nrefused as expected: {error}");
    assert!(
        matches!(error, TranscriptionError::LanguageNotSupported { .. }),
        "wrong error: {error:?}"
    );

    // ...and still works for a language it does cover, so the refusal is about
    // the language and not a broken engine.
    assert!(
        !transcriber
            .transcribe(&wav, Some("de"))
            .expect("German is one of Parakeet's 25")
            .full_text
            .trim()
            .is_empty()
    );
}
