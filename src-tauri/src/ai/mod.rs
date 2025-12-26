pub mod ollama;
pub mod prompts;

pub use ollama::{OllamaClient, OllamaModel};
pub use prompts::SummaryPrompts;
