/// Prompt templates for meeting summaries
pub struct SummaryPrompts;

impl SummaryPrompts {
    /// Generate a meeting overview summary
    pub fn overview(transcript: &str) -> String {
        format!(
            r#"You are an expert meeting summarizer. Analyze the following meeting transcript and provide a clear, concise summary.

TRANSCRIPT:
{}

Please provide a summary that includes:
1. Main topics discussed
2. Key points and conclusions
3. Overall meeting outcome

Keep the summary professional and to the point. Use bullet points where appropriate.

SUMMARY:"#,
            transcript
        )
    }

    /// Extract action items from the transcript
    pub fn action_items(transcript: &str) -> String {
        format!(
            r#"You are an expert at identifying action items from meetings. Analyze the following meeting transcript and extract all action items.

TRANSCRIPT:
{}

Extract all action items mentioned in the meeting. For each action item, identify:
- The task to be done
- Who is responsible (if mentioned)
- Any deadline (if mentioned)

Format as a numbered list. If no action items are found, respond with "No action items identified."

ACTION ITEMS:"#,
            transcript
        )
    }

    /// Extract key decisions from the transcript
    pub fn key_decisions(transcript: &str) -> String {
        format!(
            r#"You are an expert at identifying key decisions from meetings. Analyze the following meeting transcript and extract all decisions that were made.

TRANSCRIPT:
{}

Identify all decisions made during the meeting. Include:
- What was decided
- Any context or reasoning mentioned
- Who made or approved the decision (if mentioned)

Format as a numbered list. If no decisions were made, respond with "No key decisions identified."

KEY DECISIONS:"#,
            transcript
        )
    }

    /// Generate a short, descriptive title for the meeting
    pub fn title(transcript: &str) -> String {
        format!(
            r#"You are an expert at creating concise meeting titles. Based on the following meeting transcript, generate a short, descriptive title.

TRANSCRIPT:
{}

Requirements:
- Title should be 2-6 words
- Capture the main topic or purpose of the meeting
- Be specific and informative
- Do not use quotes around the title
- Do not include prefixes like "Meeting:" or "Title:"

Respond with ONLY the title, nothing else.

TITLE:"#,
            transcript
        )
    }

    /// Generate a custom summary based on user prompt
    pub fn custom(transcript: &str, user_prompt: &str) -> String {
        format!(
            r#"You are an expert meeting analyst. Analyze the following meeting transcript based on the user's specific request.

TRANSCRIPT:
{}

USER REQUEST:
{}

Provide a response that directly addresses the user's request based on the transcript content.

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
