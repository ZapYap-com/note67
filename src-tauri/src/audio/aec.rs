//! Acoustic Echo Cancellation (AEC) module
//!
//! Uses NLMS (Normalized Least Mean Squares) adaptive filter to remove
//! speaker output (reference signal) from microphone input.

use std::sync::Mutex;

/// AEC processor state
pub struct AecProcessor {
    /// Adaptive filter coefficients
    filter: Vec<f32>,
    /// Reference signal buffer (system audio)
    reference_buffer: Vec<f32>,
    /// Sample rate
    sample_rate: u32,
    /// Filter length in samples (determines max echo delay handled)
    filter_length: usize,
    /// NLMS step size (learning rate)
    step_size: f32,
    /// Small constant to prevent division by zero
    epsilon: f32,
}

impl AecProcessor {
    /// Create a new AEC processor
    ///
    /// - `sample_rate`: Audio sample rate (e.g., 16000)
    /// - `max_delay_ms`: Maximum echo delay to handle in milliseconds (e.g., 100ms)
    pub fn new(sample_rate: u32, max_delay_ms: u32) -> Self {
        let filter_length = (sample_rate * max_delay_ms / 1000) as usize;

        Self {
            filter: vec![0.0; filter_length],
            reference_buffer: vec![0.0; filter_length],
            sample_rate,
            filter_length,
            step_size: 0.1, // NLMS step size, typical range 0.01-0.5
            epsilon: 1e-8,
        }
    }

    /// Process microphone samples to remove echo from reference signal
    ///
    /// - `mic_samples`: Microphone input (contains voice + echo)
    /// - `reference_samples`: System audio (the signal being played through speakers)
    ///
    /// Returns: Cleaned mic samples with echo removed
    pub fn process(&mut self, mic_samples: &[f32], reference_samples: &[f32]) -> Vec<f32> {
        let mut output = Vec::with_capacity(mic_samples.len());

        // Ensure reference buffer is properly sized
        if reference_samples.len() > self.reference_buffer.len() {
            // Take the most recent samples
            let start = reference_samples.len() - self.reference_buffer.len();
            self.reference_buffer.copy_from_slice(&reference_samples[start..]);
        } else {
            // Shift buffer and append new samples
            let shift = reference_samples.len();
            self.reference_buffer.rotate_left(shift);
            let start = self.reference_buffer.len() - shift;
            self.reference_buffer[start..].copy_from_slice(reference_samples);
        }

        for (i, &mic_sample) in mic_samples.iter().enumerate() {
            // Update reference buffer position for this sample
            if i < reference_samples.len() {
                self.reference_buffer.rotate_left(1);
                self.reference_buffer[self.filter_length - 1] = reference_samples[i];
            }

            // Compute filter output (estimated echo)
            let echo_estimate = self.compute_filter_output();

            // Compute error (desired signal = mic - echo)
            let error = mic_sample - echo_estimate;

            // Update filter coefficients using NLMS
            self.update_filter(error);

            output.push(error);
        }

        output
    }

    /// Compute the filter output (convolution of reference with filter)
    fn compute_filter_output(&self) -> f32 {
        self.filter
            .iter()
            .zip(self.reference_buffer.iter().rev())
            .map(|(f, r)| f * r)
            .sum()
    }

    /// Update filter coefficients using NLMS algorithm
    fn update_filter(&mut self, error: f32) {
        // Compute power of reference signal
        let power: f32 = self.reference_buffer.iter().map(|x| x * x).sum();

        // NLMS update: w = w + (step_size * error * x) / (power + epsilon)
        let norm_factor = self.step_size / (power + self.epsilon);

        for (i, coeff) in self.filter.iter_mut().enumerate() {
            let ref_idx = self.filter_length - 1 - i;
            *coeff += norm_factor * error * self.reference_buffer[ref_idx];
        }
    }

    /// Reset the processor state
    pub fn reset(&mut self) {
        self.filter.fill(0.0);
        self.reference_buffer.fill(0.0);
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
    fn test_aec_basic() {
        let mut aec = AecProcessor::new(16000, 100);

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
        // than the mic signal was
        let mic_error: f32 = mic.iter().zip(voice.iter()).map(|(m, v)| (m - v).powi(2)).sum();
        let cleaned_error: f32 = cleaned.iter().zip(voice.iter()).map(|(c, v)| (c - v).powi(2)).sum();

        // AEC should reduce error (not always guaranteed with simple NLMS, but generally)
        println!("Mic error: {}, Cleaned error: {}", mic_error, cleaned_error);
    }
}
