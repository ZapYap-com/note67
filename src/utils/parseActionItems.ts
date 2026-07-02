import type { ActionItemInput } from "../types";

// Deterministic string hash (djb2) — used for a stable id so checking a box
// doesn't create a duplicate row on the next sync.
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

const TASK_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/;
const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const ASSIGNEE_RE = /@([A-Za-z0-9_.-]+)/;

/**
 * Parse GitHub-style task checkboxes out of a note's markdown into structured
 * action items. Inline checkboxes are the source of truth; this feeds the
 * derived table behind the global Tasks view.
 *
 * Recognizes: `- [ ] task @assignee 📅2026-07-11`
 */
export function parseActionItems(markdown: string, noteId: string): ActionItemInput[] {
  const items: ActionItemInput[] = [];
  const seen = new Set<string>();

  for (const line of markdown.split("\n")) {
    const m = line.match(TASK_RE);
    if (!m) continue;

    const done = m[1].toLowerCase() === "x";
    let rest = m[2].trim();
    if (!rest) continue;

    let due_date: string | null = null;
    const dm = rest.match(DUE_RE);
    if (dm) {
      due_date = dm[1];
      rest = rest.replace(dm[0], "").trim();
    }

    let assignee: string | null = null;
    const am = rest.match(ASSIGNEE_RE);
    if (am) {
      assignee = am[1];
      rest = rest.replace(am[0], "").trim();
    }

    const text = rest.replace(/\s+/g, " ").trim();
    if (!text) continue;

    const stable_id = hashString(`${noteId}::${text.toLowerCase()}`);
    if (seen.has(stable_id)) continue; // collapse exact-duplicate lines
    seen.add(stable_id);

    items.push({ stable_id, text, assignee, due_date, done });
  }

  return items;
}

/**
 * Insert-or-replace ONLY a delimited `## Action Items` section in the note
 * markdown, preserving everything else the user wrote. Never a wholesale
 * replace (see #3/#4). Returns the markdown unchanged if there's nothing to add.
 */
export function upsertActionItemsSection(markdown: string, checklist: string): string {
  const heading = "## Action Items";
  const trimmed = checklist.trim();
  const lines = markdown.split("\n");
  const startIdx = lines.findIndex(
    (l) => l.trim().toLowerCase() === heading.toLowerCase()
  );

  // Nothing to add and no existing section → leave the note untouched.
  if (!trimmed && startIdx === -1) return markdown;

  const section = trimmed ? `${heading}\n\n${trimmed}` : "";

  if (startIdx === -1) {
    const base = markdown.trimEnd();
    return base ? `${base}\n\n${section}\n` : `${section}\n`;
  }

  // Replace from the heading to the next `## ` heading (or end of note).
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  const before = lines.slice(0, startIdx).join("\n").trimEnd();
  const after = lines.slice(endIdx).join("\n").trimStart();
  const parts = [before, section, after].filter((s) => s.length > 0);
  return parts.join("\n\n") + "\n";
}
