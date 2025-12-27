//! Acoustic Echo Cancellation (AEC) module
//!
//! Currently disabled - using post-processing deduplication instead.
//! The complex NLMS filter was too slow and not effective enough.

use std::sync::atomic::{AtomicBool, Ordering};

/// Global flag to enable/disable AEC
static AEC_ENABLED: AtomicBool = AtomicBool::new(false); // Disabled by default now

/// Check if AEC is enabled
pub fn is_aec_enabled() -> bool {
    AEC_ENABLED.load(Ordering::SeqCst)
}

/// Set AEC enabled state
pub fn set_aec_enabled(enabled: bool) {
    AEC_ENABLED.store(enabled, Ordering::SeqCst);
}

/// Initialize the global AEC processor (no-op now)
#[allow(dead_code)]
pub fn init_aec(_sample_rate: u32) {
    // No-op - AEC disabled
}

/// Apply AEC to mic samples - now just returns original samples
/// Echo removal is handled by post-processing deduplication in live.rs
#[allow(dead_code)]
pub fn apply_aec(mic_samples: &[f32], _reference_samples: &[f32]) -> Vec<f32> {
    // Just return original samples - deduplication handles echo removal
    mic_samples.to_vec()
}

/// Reset the AEC processor (no-op now)
#[allow(dead_code)]
pub fn reset_aec() {
    // No-op
}
