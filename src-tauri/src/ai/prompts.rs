/// Prompt templates for meeting summaries
pub struct SummaryPrompts;

impl SummaryPrompts {
    /// Generate a meeting overview summary
    pub fn overview(transcript: &str) -> String {
        format!(
            r#"You are a professional meeting summarizer. Analyze the following meeting transcript and provide a clear, concise summary in markdown format.

TRANSCRIPT:
{}

Provide a professional summary that includes:
- Main topics discussed
- Key points and conclusions
- Overall meeting outcome

Rules:
- Use markdown formatting (headings, bullet points, bold for emphasis)
- Be concise and professional
- Do NOT use emojis
- Focus on factual information
- Use clear, formal language

SUMMARY:"#,
            transcript
        )
    }

    /// Extract action items from the transcript
    pub fn action_items(transcript: &str) -> String {
        format!(
            r#"You are a professional meeting analyst. Extract all action items from the following meeting transcript.

TRANSCRIPT:
{}

For each action item, identify:
- The specific task to be completed
- Responsible person (if mentioned)
- Deadline or timeline (if mentioned)

Rules:
- Use markdown formatting with numbered lists
- Be specific and actionable
- Do NOT use emojis
- If no action items are found, state "No action items identified."
- Use professional, clear language

ACTION ITEMS:"#,
            transcript
        )
    }

    /// Extract key decisions from the transcript
    pub fn key_decisions(transcript: &str) -> String {
        format!(
            r#"You are a professional meeting analyst. Extract all key decisions from the following meeting transcript.

TRANSCRIPT:
{}

For each decision, include:
- What was decided
- Context or reasoning (if provided)
- Who made or approved the decision (if mentioned)

Rules:
- Use markdown formatting with numbered lists
- Be specific and clear
- Do NOT use emojis
- If no decisions were made, state "No key decisions identified."
- Use professional, formal language

KEY DECISIONS:"#,
            transcript
        )
    }

    /// Generate a short, descriptive title for the meeting
    pub fn title(transcript: &str) -> String {
        format!(
            r#"Generate a concise meeting title based on this transcript.

TRANSCRIPT:
{}

Rules:
- 2-6 words only
- Capture the main topic or purpose
- Be specific and informative
- No quotes around the title
- No prefixes like "Meeting:" or "Title:"
- No emojis

Respond with ONLY the title, nothing else.

TITLE:"#,
            transcript
        )
    }

    /// Generate a custom summary based on user prompt
    pub fn custom(transcript: &str, user_prompt: &str) -> String {
        format!(
            r#"You are a professional meeting analyst. Analyze the following meeting transcript based on the user's request.

TRANSCRIPT:
{}

USER REQUEST:
{}

Rules:
- Use markdown formatting where appropriate
- Be professional and concise
- Do NOT use emojis
- Directly address the user's request
- Use clear, formal language

RESPONSE:"#,
            transcript, user_prompt
        )
    }
}

/// A template for generating prompts
pub struct PromptTemplate {
    pub name: String,
    pub description: String,
    pub template: String,
}

impl PromptTemplate {
    pub fn render(&self, transcript: &str) -> String {
        self.template.replace("{transcript}", transcript)
    }
}
