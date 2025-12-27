//! Acoustic Echo Cancellation (AEC) module
//!
//! Uses NLMS (Normalized Least Mean Squares) adaptive filter with:
//! - Cross-correlation based delay estimation
//! - Double-talk detection
//! - Adaptive step size

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Global flag to enable/disable AEC (disable when using headphones)
static AEC_ENABLED: AtomicBool = AtomicBool::new(true);

/// Check if AEC is enabled
pub fn is_aec_enabled() -> bool {
    AEC_ENABLED.load(Ordering::SeqCst)
}

/// Set AEC enabled state (disable when using headphones for better performance)
pub fn set_aec_enabled(enabled: bool) {
    AEC_ENABLED.store(enabled, Ordering::SeqCst);
}

/// Estimate delay between mic and reference signals using cross-correlation
/// Returns the delay in samples that maximizes correlation
fn estimate_delay(mic: &[f32], reference: &[f32], max_delay_samples: usize) -> usize {
    if mic.is_empty() || reference.is_empty() {
        return 0;
    }

    let mut best_delay = 0;
    let mut best_correlation = f32::MIN;

    // Search for delay that maximizes correlation
    let search_range = max_delay_samples.min(reference.len().saturating_sub(mic.len()));

    for delay in 0..=search_range {
        let mut correlation: f32 = 0.0;
        let samples_to_check = mic.len().min(reference.len().saturating_sub(delay));

        for i in 0..samples_to_check {
            if delay + i < reference.len() {
                correlation += mic[i] * reference[delay + i];
            }
        }

        if correlation > best_correlation {
            best_correlation = correlation;
            best_delay = delay;
        }
    }

    best_delay
}

/// Detect if local speaker is talking (double-talk condition)
/// Returns true if mic energy is significantly higher than reference
fn is_double_talk(mic: &[f32], reference: &[f32]) -> bool {
    if mic.is_empty() || reference.is_empty() {
        return false;
    }

    let mic_energy: f32 = mic.iter().map(|x| x * x).sum::<f32>() / mic.len() as f32;
    let ref_energy: f32 = reference.iter().map(|x| x * x).sum::<f32>() / reference.len() as f32;

    // If mic energy is much higher than reference, user is likely speaking
    // Use threshold of 3x to account for echo attenuation
    mic_energy > ref_energy * 3.0 && mic_energy > 1e-6
}

/// AEC processor state
pub struct AecProcessor {
    /// Adaptive filter coefficients
    filter: Vec<f32>,
    /// Reference signal buffer (system audio)
    reference_buffer: Vec<f32>,
    /// Filter length in samples (determines max echo delay handled)
    filter_length: usize,
    /// Base NLMS step size (learning rate)
    base_step_size: f32,
    /// Small constant to prevent division by zero
    epsilon: f32,
    /// Estimated delay in samples
    estimated_delay: usize,
    /// Number of frames processed (for delay estimation frequency)
    frame_count: usize,
}

impl AecProcessor {
    /// Create a new AEC processor
    ///
    /// - `sample_rate`: Audio sample rate (e.g., 16000)
    /// - `max_delay_ms`: Maximum echo delay to handle in milliseconds (e.g., 150ms)
    pub fn new(sample_rate: u32, max_delay_ms: u32) -> Self {
        let filter_length = (sample_rate * max_delay_ms / 1000) as usize;

        Self {
            filter: vec![0.0; filter_length],
            reference_buffer: vec![0.0; filter_length * 2], // Extra buffer for delay search
            filter_length,
            base_step_size: 0.15, // Slightly higher for faster convergence
            epsilon: 1e-8,
            estimated_delay: 0,
            frame_count: 0,
        }
    }

    /// Add reference samples to the buffer
    pub fn add_reference(&mut self, samples: &[f32]) {
        // Shift buffer left and append new samples
        let shift = samples.len().min(self.reference_buffer.len());
        self.reference_buffer.rotate_left(shift);
        let start = self.reference_buffer.len() - shift;
        let copy_len = shift.min(samples.len());
        self.reference_buffer[start..start + copy_len]
            .copy_from_slice(&samples[samples.len() - copy_len..]);
    }

    /// Process microphone samples to remove echo from reference signal
    ///
    /// - `mic_samples`: Microphone input (contains voice + echo)
    /// - `reference_samples`: Current system audio chunk
    ///
    /// Returns: Cleaned mic samples with echo removed
    pub fn process(&mut self, mic_samples: &[f32], reference_samples: &[f32]) -> Vec<f32> {
        if mic_samples.is_empty() {
            return Vec::new();
        }

        // Add new reference samples to buffer
        self.add_reference(reference_samples);

        // Re-estimate delay periodically (every 10 frames)
        self.frame_count += 1;
        if self.frame_count % 10 == 1 {
            let max_delay = self.filter_length;
            self.estimated_delay = estimate_delay(mic_samples, &self.reference_buffer, max_delay);
        }

        // Check for double-talk condition
        let double_talk = is_double_talk(mic_samples, reference_samples);

        // Reduce step size during double-talk to prevent divergence
        let step_size = if double_talk {
            self.base_step_size * 0.1 // Very slow adaptation during double-talk
        } else {
            self.base_step_size
        };

        let mut output = Vec::with_capacity(mic_samples.len());

        for (i, &mic_sample) in mic_samples.iter().enumerate() {
            // Get aligned reference sample
            let ref_start = self.reference_buffer.len()
                .saturating_sub(self.filter_length)
                .saturating_sub(self.estimated_delay);

            // Compute filter output (estimated echo)
            let echo_estimate: f32 = self
                .filter
                .iter()
                .enumerate()
                .map(|(j, &coef)| {
                    let ref_idx = ref_start + j;
                    if ref_idx < self.reference_buffer.len() {
                        coef * self.reference_buffer[ref_idx]
                    } else {
                        0.0
                    }
                })
                .sum();

            // Compute error (cleaned signal = mic - echo)
            let error = mic_sample - echo_estimate;

            // Compute power of reference signal for NLMS normalization
            let power: f32 = (0..self.filter_length)
                .map(|j| {
                    let ref_idx = ref_start + j;
                    if ref_idx < self.reference_buffer.len() {
                        let val = self.reference_buffer[ref_idx];
                        val * val
                    } else {
                        0.0
                    }
                })
                .sum();

            // NLMS update: w = w + (step_size * error * x) / (power + epsilon)
            if power > self.epsilon && !double_talk {
                let norm_factor = step_size / (power + self.epsilon);

                for (j, coeff) in self.filter.iter_mut().enumerate() {
                    let ref_idx = ref_start + j;
                    if ref_idx < self.reference_buffer.len() {
                        *coeff += norm_factor * error * self.reference_buffer[ref_idx];
                    }
                }
            }

            // Shift reference buffer for next sample (only if we have more mic samples)
            if i < mic_samples.len() - 1 && i < reference_samples.len() {
                self.reference_buffer.rotate_left(1);
                let last_idx = self.reference_buffer.len() - 1;
                self.reference_buffer[last_idx] =
                    reference_samples.get(i).copied().unwrap_or(0.0);
            }

            output.push(error);
        }

        output
    }

    /// Reset the processor state
    pub fn reset(&mut self) {
        self.filter.fill(0.0);
        self.reference_buffer.fill(0.0);
        self.estimated_delay = 0;
        self.frame_count = 0;
    }
}

/// Global AEC processor for live transcription
static AEC_PROCESSOR: Mutex<Option<AecProcessor>> = Mutex::new(None);

/// Initialize the global AEC processor
pub fn init_aec(sample_rate: u32) {
    let mut processor = AEC_PROCESSOR.lock().unwrap();
    *processor = Some(AecProcessor::new(sample_rate, 150)); // 150ms max delay
}

/// Apply AEC to mic samples using the stored reference
pub fn apply_aec(mic_samples: &[f32], reference_samples: &[f32]) -> Vec<f32> {
    let mut processor = AEC_PROCESSOR.lock().unwrap();

    if let Some(ref mut proc) = *processor {
        proc.process(mic_samples, reference_samples)
    } else {
        // AEC not initialized, return original samples
        mic_samples.to_vec()
    }
}

/// Reset the AEC processor
pub fn reset_aec() {
    let mut processor = AEC_PROCESSOR.lock().unwrap();
    if let Some(ref mut proc) = *processor {
        proc.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_delay_estimation() {
        // Create reference signal
        let reference: Vec<f32> = (0..1000).map(|i| (i as f32 * 0.1).sin()).collect();

        // Create mic signal as delayed reference
        let delay = 50;
        let mic: Vec<f32> = reference[delay..delay + 100].to_vec();

        let estimated = estimate_delay(&mic, &reference, 200);
        assert!(
            (estimated as i32 - delay as i32).abs() < 10,
            "Estimated delay {} should be close to actual delay {}",
            estimated,
            delay
        );
    }

    #[test]
    fn test_double_talk_detection() {
        // High mic energy, low reference
        let mic: Vec<f32> = (0..100).map(|i| (i as f32 * 0.1).sin() * 0.8).collect();
        let reference: Vec<f32> = (0..100).map(|i| (i as f32 * 0.1).sin() * 0.1).collect();

        assert!(is_double_talk(&mic, &reference));

        // Low mic energy, high reference (echo only)
        let mic2: Vec<f32> = (0..100).map(|i| (i as f32 * 0.1).sin() * 0.1).collect();
        let reference2: Vec<f32> = (0..100).map(|i| (i as f32 * 0.1).sin() * 0.5).collect();

        assert!(!is_double_talk(&mic2, &reference2));
    }

    #[test]
    fn test_aec_basic() {
        let mut aec = AecProcessor::new(16000, 150);

        // Create a simple reference signal (sine wave)
        let reference: Vec<f32> = (0..1600)
            .map(|i| (i as f32 * 0.1).sin() * 0.5)
            .collect();

        // Mic signal = voice + echo (reference delayed and attenuated)
        let voice: Vec<f32> = (0..1600)
            .map(|i| (i as f32 * 0.05).sin() * 0.3)
            .collect();

        let delay = 160; // 10ms delay at 16kHz
        let echo_gain = 0.3;

        let mic: Vec<f32> = voice
            .iter()
            .enumerate()
            .map(|(i, &v)| {
                let echo = if i >= delay {
                    reference[i - delay] * echo_gain
                } else {
                    0.0
                };
                v + echo
            })
            .collect();

        // Process through AEC
        let cleaned = aec.process(&mic, &reference);

        // The cleaned signal should be closer to the original voice
        let mic_error: f32 = mic
            .iter()
            .zip(voice.iter())
            .map(|(m, v)| (m - v).powi(2))
            .sum();
        let cleaned_error: f32 = cleaned
            .iter()
            .zip(voice.iter())
            .map(|(c, v)| (c - v).powi(2))
            .sum();

        println!(
            "Mic error: {}, Cleaned error: {}, Improvement: {:.1}%",
            mic_error,
            cleaned_error,
            (1.0 - cleaned_error / mic_error) * 100.0
        );
    }
}
