/// Maximum content length before chunking is applied (in characters)
/// Roughly ~10k chars to leave room for prompt template and response
pub const MAX_CONTENT_LENGTH: usize = 10000;

/// Prompt templates for note summaries
pub struct SummaryPrompts;

impl SummaryPrompts {
    /// Format the notes section if present
    fn format_notes_section(notes: Option<&str>) -> String {
        match notes {
            Some(n) if !n.trim().is_empty() => format!(
                r#"
USER NOTES:
{}

"#,
                n
            ),
            _ => String::new(),
        }
    }

    /// Generate a note overview summary (notes only, no transcript)
    pub fn overview_notes_only(notes: &str) -> String {
        format!(
            r#"You are a professional note summarizer. Analyze the following user notes and provide a clear, concise summary in markdown format.

USER NOTES:
{notes}

Provide a professional summary that includes:
- Main topics covered
- Key points and conclusions
- Overall outcome or insights

Rules:
- Use markdown formatting (headings, bullet points, bold for emphasis)
- Be concise and professional
- Do NOT use emojis
- Focus on factual information
- Use clear, formal language

SUMMARY:"#
        )
    }

    /// Extract action items from notes only
    pub fn action_items_notes_only(notes: &str) -> String {
        format!(
            r#"You are a professional note analyst. Extract all action items from the following user notes.

USER NOTES:
{notes}

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

ACTION ITEMS:"#
        )
    }

    /// Extract key decisions from notes only
    pub fn key_decisions_notes_only(notes: &str) -> String {
        format!(
            r#"You are a professional note analyst. Extract all key decisions from the following user notes.

USER NOTES:
{notes}

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

KEY DECISIONS:"#
        )
    }

    /// Generate a custom summary from notes only
    pub fn custom_notes_only(notes: &str, user_prompt: &str) -> String {
        format!(
            r#"You are a professional note analyst. Analyze the following user notes based on the user's request.

USER NOTES:
{notes}

USER REQUEST:
{user_prompt}

Rules:
- Use markdown formatting where appropriate
- Be professional and concise
- Do NOT use emojis
- Directly address the user's request
- Use clear, formal language

RESPONSE:"#
        )
    }

    /// Generate a note overview summary
    pub fn overview(transcript: &str, notes: Option<&str>) -> String {
        let notes_section = Self::format_notes_section(notes);
        format!(
            r#"Summarize this transcript in markdown. Only include what was actually said. If brief, keep summary brief.
{}{}

Summary:"#,
            notes_section,
            transcript
        )
    }

    /// Extract action items from the transcript
    pub fn action_items(transcript: &str, notes: Option<&str>) -> String {
        let notes_section = Self::format_notes_section(notes);
        format!(
            r#"You are a professional note analyst. Extract all action items from the following transcript{}.
{}TRANSCRIPT:
{}

For each action item, identify:
- The specific task to be completed
- Responsible person (if mentioned)
- Deadline or timeline (if mentioned)

Rules:
- ONLY extract action items explicitly mentioned in the transcript
- Do NOT infer or fabricate action items that are not clearly stated
- Use markdown formatting with numbered lists
- Be specific and actionable
- Do NOT use emojis
- If no action items are found or the transcript is too brief, state "No action items identified."
- Use professional, clear language
- If user notes mention action items or tasks, include them

ACTION ITEMS:"#,
            if notes.is_some_and(|n| !n.trim().is_empty()) {
                " and user notes"
            } else {
                ""
            },
            notes_section,
            transcript
        )
    }

    /// Extract key decisions from the transcript
    pub fn key_decisions(transcript: &str, notes: Option<&str>) -> String {
        let notes_section = Self::format_notes_section(notes);
        format!(
            r#"You are a professional note analyst. Extract all key decisions from the following transcript{}.
{}TRANSCRIPT:
{}

For each decision, include:
- What was decided
- Context or reasoning (if provided)
- Who made or approved the decision (if mentioned)

Rules:
- ONLY extract decisions explicitly mentioned in the transcript
- Do NOT infer or fabricate decisions that are not clearly stated
- Use markdown formatting with numbered lists
- Be specific and clear
- Do NOT use emojis
- If no decisions were made or the transcript is too brief, state "No key decisions identified."
- Use professional, formal language
- If user notes mention decisions, include them

KEY DECISIONS:"#,
            if notes.is_some_and(|n| !n.trim().is_empty()) {
                " and user notes"
            } else {
                ""
            },
            notes_section,
            transcript
        )
    }

    /// Generate a short, descriptive title for the note
    pub fn title(transcript: &str) -> String {
        format!(
            r#"Write a 2-6 word title for this transcript. Use specific nouns, not generic words. Output only the title.

{}

Title:"#,
            transcript
        )
    }

    /// Generate a short, descriptive title based on the note summary
    pub fn title_from_summary(summary: &str) -> String {
        format!(
            r#"Write a 2-6 word title for this summary. Use specific nouns, not generic words. Output only the title.

{}

Title:"#,
            summary
        )
    }

    /// Generate a custom summary based on user prompt
    pub fn custom(transcript: &str, user_prompt: &str, notes: Option<&str>) -> String {
        let notes_section = Self::format_notes_section(notes);
        format!(
            r#"You are a professional note analyst. Analyze the following transcript{} based on the user's request.
{}TRANSCRIPT:
{}

USER REQUEST:
{}

Rules:
- Use markdown formatting where appropriate
- Be professional and concise
- Do NOT use emojis
- Directly address the user's request
- Use clear, formal language
- If user notes are provided, consider them as additional context

RESPONSE:"#,
            if notes.is_some_and(|n| !n.trim().is_empty()) {
                " and user notes"
            } else {
                ""
            },
            notes_section,
            transcript,
            user_prompt
        )
    }

    /// Summarize a chunk of transcript (used for long transcripts)
    pub fn chunk_overview(chunk: &str, chunk_num: usize, total_chunks: usize) -> String {
        format!(
            r#"You are summarizing part {chunk_num} of {total_chunks} from a longer transcript.

TRANSCRIPT CHUNK:
{chunk}

Provide a concise summary of this section including:
- Main topics discussed in this part
- Key points and any conclusions
- Important details mentioned

Rules:
- Be concise but capture all important information
- Use bullet points for clarity
- Do NOT use emojis
- This will be combined with other chunk summaries later

CHUNK SUMMARY:"#
        )
    }

    /// Summarize a chunk for action items
    pub fn chunk_action_items(chunk: &str, chunk_num: usize, total_chunks: usize) -> String {
        format!(
            r#"You are extracting action items from part {chunk_num} of {total_chunks} of a longer transcript.

TRANSCRIPT CHUNK:
{chunk}

Extract any action items from this section:
- The specific task to be completed
- Responsible person (if mentioned)
- Deadline or timeline (if mentioned)

Rules:
- Use numbered lists
- Be specific and actionable
- Do NOT use emojis
- If no action items in this chunk, respond with "No action items in this section."

ACTION ITEMS:"#
        )
    }

    /// Summarize a chunk for key decisions
    pub fn chunk_key_decisions(chunk: &str, chunk_num: usize, total_chunks: usize) -> String {
        format!(
            r#"You are extracting key decisions from part {chunk_num} of {total_chunks} of a longer transcript.

TRANSCRIPT CHUNK:
{chunk}

Extract any decisions from this section:
- What was decided
- Context or reasoning (if provided)
- Who made or approved the decision (if mentioned)

Rules:
- Use numbered lists
- Be specific and clear
- Do NOT use emojis
- If no decisions in this chunk, respond with "No decisions in this section."

KEY DECISIONS:"#
        )
    }

    /// Merge multiple chunk summaries into a final summary
    pub fn merge_overview(chunk_summaries: &[String], notes: Option<&str>) -> String {
        let notes_section = Self::format_notes_section(notes);
        let summaries = chunk_summaries
            .iter()
            .enumerate()
            .map(|(i, s)| format!("--- Part {} ---\n{}", i + 1, s))
            .collect::<Vec<_>>()
            .join("\n\n");

        format!(
            r#"You are creating a final summary from multiple section summaries of a long transcript{}.
{}SECTION SUMMARIES:
{summaries}

Combine these into a single, coherent summary that includes:
- Main topics discussed
- Key points and conclusions
- Overall outcome

Rules:
- Use markdown formatting (headings, bullet points, bold for emphasis)
- Be concise and professional
- Do NOT use emojis
- Eliminate redundancy between sections
- Present information in a logical flow
- If user notes are provided, incorporate relevant context

FINAL SUMMARY:"#,
            if notes.is_some_and(|n| !n.trim().is_empty()) {
                " and user notes"
            } else {
                ""
            },
            notes_section
        )
    }

    /// Merge multiple chunk action items into a final list
    pub fn merge_action_items(chunk_summaries: &[String], notes: Option<&str>) -> String {
        let notes_section = Self::format_notes_section(notes);
        let summaries = chunk_summaries
            .iter()
            .enumerate()
            .map(|(i, s)| format!("--- Part {} ---\n{}", i + 1, s))
            .collect::<Vec<_>>()
            .join("\n\n");

        format!(
            r#"You are consolidating action items from multiple sections of a long transcript{}.
{}SECTION ACTION ITEMS:
{summaries}

Combine these into a single, deduplicated list of action items:
- The specific task to be completed
- Responsible person (if mentioned)
- Deadline or timeline (if mentioned)

Rules:
- Use markdown formatting with numbered lists
- Remove duplicate or redundant items
- Be specific and actionable
- Do NOT use emojis
- If no action items found, state "No action items identified."
- If user notes mention action items, include them

ACTION ITEMS:"#,
            if notes.is_some_and(|n| !n.trim().is_empty()) {
                " and user notes"
            } else {
                ""
            },
            notes_section
        )
    }

    /// Merge multiple chunk key decisions into a final list
    pub fn merge_key_decisions(chunk_summaries: &[String], notes: Option<&str>) -> String {
        let notes_section = Self::format_notes_section(notes);
        let summaries = chunk_summaries
            .iter()
            .enumerate()
            .map(|(i, s)| format!("--- Part {} ---\n{}", i + 1, s))
            .collect::<Vec<_>>()
            .join("\n\n");

        format!(
            r#"You are consolidating key decisions from multiple sections of a long transcript{}.
{}SECTION DECISIONS:
{summaries}

Combine these into a single, deduplicated list of decisions:
- What was decided
- Context or reasoning (if provided)
- Who made or approved the decision (if mentioned)

Rules:
- Use markdown formatting with numbered lists
- Remove duplicate or redundant decisions
- Be specific and clear
- Do NOT use emojis
- If no decisions found, state "No key decisions identified."
- If user notes mention decisions, include them

KEY DECISIONS:"#,
            if notes.is_some_and(|n| !n.trim().is_empty()) {
                " and user notes"
            } else {
                ""
            },
            notes_section
        )
    }

    /// Merge custom prompt chunk results
    pub fn merge_custom(chunk_summaries: &[String], user_prompt: &str, notes: Option<&str>) -> String {
        let notes_section = Self::format_notes_section(notes);
        let summaries = chunk_summaries
            .iter()
            .enumerate()
            .map(|(i, s)| format!("--- Part {} ---\n{}", i + 1, s))
            .collect::<Vec<_>>()
            .join("\n\n");

        format!(
            r#"You are consolidating results from multiple sections of a long transcript{} for the user's request.
{}USER REQUEST:
{user_prompt}

SECTION RESULTS:
{summaries}

Combine these into a single, coherent response that addresses the user's request.

Rules:
- Use markdown formatting where appropriate
- Be professional and concise
- Do NOT use emojis
- Eliminate redundancy
- If user notes are provided, consider them as additional context

FINAL RESPONSE:"#,
            if notes.is_some_and(|n| !n.trim().is_empty()) {
                " and user notes"
            } else {
                ""
            },
            notes_section
        )
    }

    /// Custom prompt for a single chunk
    pub fn chunk_custom(chunk: &str, user_prompt: &str, chunk_num: usize, total_chunks: usize) -> String {
        format!(
            r#"You are analyzing part {chunk_num} of {total_chunks} from a longer transcript for the user's request.

USER REQUEST:
{user_prompt}

TRANSCRIPT CHUNK:
{chunk}

Provide relevant information from this section that addresses the user's request.

Rules:
- Be concise but capture all relevant information
- Do NOT use emojis
- This will be combined with results from other sections later

RESPONSE:"#
        )
    }
}

/// Prompt templates for AI writing assistant
pub struct WritingPrompts;

impl WritingPrompts {
    /// Improve writing quality and clarity
    pub fn improve(content: &str) -> String {
        format!(
            r#"Improve the following text for clarity and professionalism.

Rules:
- Output ONLY the improved text
- Do NOT repeat words or stutter
- Use proper markdown (# headings, - bullets, **bold**)
- No emojis, no preamble

TEXT:
{content}

IMPROVED:"#
        )
    }

    /// Summarize the content
    pub fn summarize(content: &str) -> String {
        format!(
            r#"Summarize the following text concisely.

Rules:
- Output ONLY the summary
- Use "- " (dash space) for bullets, NO leading spaces
- Do NOT repeat words
- No emojis, no preamble, no code blocks

TEXT:
{content}

SUMMARY:"#
        )
    }

    /// Expand on the content with more details
    pub fn expand(content: &str) -> String {
        format!(
            r#"Expand on the following text with more detail and examples.

Rules:
- Output ONLY the expanded text
- Do NOT repeat words
- Use proper markdown formatting
- No emojis, no preamble

TEXT:
{content}

EXPANDED:"#
        )
    }

    /// Fix grammar, spelling, and punctuation
    pub fn fix_grammar(content: &str) -> String {
        format!(
            r#"Fix spelling, grammar, and punctuation errors.

Rules:
- Output ONLY the corrected text
- Maintain original meaning
- No emojis, no preamble

TEXT:
{content}

CORRECTED:"#
        )
    }

    /// Convert to bullet points
    pub fn to_bullets(content: &str) -> String {
        format!(
            r#"Convert to a bullet point list.

Rules:
- Start each bullet with "- " (dash space)
- NO indentation at start of lines
- Output ONLY the bullets
- No emojis, no preamble, no code blocks

TEXT:
{content}

BULLETS:"#
        )
    }

    /// Extract action items
    pub fn extract_action_items(content: &str) -> String {
        format!(
            r#"Extract action items and tasks as a numbered list.

Rules:
- Format: 1. [Task] - [Person] - [Deadline]
- NO leading spaces or indentation
- Output ONLY the list
- If none found, say "No action items found"
- No emojis, no preamble, no code blocks

TEXT:
{content}

ACTIONS:"#
        )
    }

    /// Custom prompt with context
    pub fn custom(note_content: &str, selected_text: Option<&str>, user_message: &str) -> String {
        let context = if let Some(selected) = selected_text {
            format!(
                r#"You are an AI writing assistant helping with notes.

Current note content:
---
{note_content}
---

Selected text to work with:
"{selected}"

"#
            )
        } else {
            format!(
                r#"You are an AI writing assistant helping with notes.

Current note content:
---
{note_content}
---

"#
            )
        };

        format!(
            r#"{context}User request: {user_message}

IMPORTANT RULES:
- Output ONLY the requested content, no explanations
- Do NOT repeat words or phrases
- Use "- " (dash space) for bullets, NO leading spaces
- Use # for headings, **text** for bold
- NO code blocks, NO indentation
- No emojis, be concise"#
        )
    }
}

/// A template for generating prompts
#[allow(dead_code)]
pub struct PromptTemplate {
    pub name: String,
    pub description: String,
    pub template: String,
}

#[allow(dead_code)]
impl PromptTemplate {
    pub fn render(&self, transcript: &str) -> String {
        self.template.replace("{transcript}", transcript)
    }
}
