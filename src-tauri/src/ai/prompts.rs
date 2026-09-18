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

    /// Generate a note overview summary.
    ///
    /// When the user took their own notes, treat those as the authoritative
    /// outline and expand them with accurate detail from the transcript (the
    /// "enhanced notes" experience). With no notes, fall back to a plain
    /// transcript summary.
    pub fn overview(transcript: &str, notes: Option<&str>) -> String {
        let has_notes = notes.map(|n| !n.trim().is_empty()).unwrap_or(false);
        let notes_section = Self::format_notes_section(notes);
        if has_notes {
            format!(
                r#"You are turning a meeting into clean, enhanced notes. The user's own notes below are the authoritative outline: keep their points and structure, and expand each one with accurate detail from the transcript. Do not contradict or drop the user's points, and do not invent anything the transcript does not support. Write in clear markdown. If the transcript is brief, keep it brief.
{}TRANSCRIPT:
{}

Enhanced notes:"#,
                notes_section,
                transcript
            )
        } else {
            format!(
                r#"Summarize this transcript in markdown. Only include what was actually said. If brief, keep summary brief.
{}{}

Summary:"#,
                notes_section,
                transcript
            )
        }
    }

    /// Extract action items as a GitHub-style markdown checklist, which
    /// extract_action_items parses into task rows.
    pub fn action_items_checkboxes(
        transcript: &str,
        notes: Option<&str>,
        meeting_date: Option<&str>,
    ) -> String {
        let notes_section = Self::format_notes_section(notes);
        let date_section = meeting_date
            .map(|date| format!("{date}\n\n"))
            .unwrap_or_default();
        format!(
            r#"Extract the action items from this meeting as a GitHub-style markdown checklist.
{}{}TRANSCRIPT:
{}

Output ONLY checkbox lines, one per action item, in exactly this format:
- [ ] <clear, specific task> 📅<YYYY-MM-DD if a date is mentioned>

Rules:
- Only include tasks explicitly stated. Do not invent or infer tasks.
- Omit "📅date" if no date is mentioned.
- No headings, no numbering, no extra prose, no emojis other than 📅.
- If there are no action items, output nothing at all.

Checklist:"#,
            date_section, notes_section, transcript
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

