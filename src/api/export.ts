import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

pdfMake.vfs = pdfFonts.vfs;

export interface ExportData {
  markdown: string;
  filename: string;
}

function fixSpacedText(text: string): string {
  // Fix "s p a c e d" text - sequences of single letters separated by spaces
  const words = text.split(" ");
  const result: string[] = [];
  let singleLetters: string[] = [];

  const flushSingles = () => {
    if (singleLetters.length >= 4) {
      result.push(singleLetters.join(""));
    } else {
      result.push(...singleLetters);
    }
    singleLetters = [];
  };

  for (const word of words) {
    if (word.length === 1 && /[a-zA-Z]/.test(word)) {
      singleLetters.push(word);
    } else {
      flushSingles();
      result.push(word);
    }
  }
  flushSingles();

  return result.join(" ");
}

function normalizeText(text: string): string {
  let result = text
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  result = fixSpacedText(result);
  return result;
}

function parseInlineFormatting(text: string): Content {
  // Parse **bold** within text
  const parts: Content[] = [];
  const boldRegex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(normalizeText(text.slice(lastIndex, match.index)));
    }
    parts.push({ text: normalizeText(match[1]), bold: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(normalizeText(text.slice(lastIndex)));
  }

  if (parts.length === 0) {
    return normalizeText(text);
  }

  if (parts.length === 1 && typeof parts[0] === "string") {
    return parts[0];
  }

  return { text: parts };
}

function markdownToPdfContent(markdown: string): Content[] {
  const content: Content[] = [];
  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    // H1 Header
    if (trimmed.startsWith("# ")) {
      content.push({
        text: normalizeText(trimmed.slice(2)),
        style: "h1",
        margin: [0, i === 0 ? 0 : 10, 0, 4],
      });
      continue;
    }

    // H2 Header
    if (trimmed.startsWith("## ")) {
      content.push({
        text: normalizeText(trimmed.slice(3)),
        style: "h2",
        margin: [0, 8, 0, 3],
      });
      continue;
    }

    // H3 Header
    if (trimmed.startsWith("### ")) {
      content.push({
        text: normalizeText(trimmed.slice(4)),
        style: "h3",
        margin: [0, 6, 0, 2],
      });
      continue;
    }

    // Bold line (e.g., **Section Title**)
    const boldMatch = trimmed.match(/^\*\*(.+)\*\*$/);
    if (boldMatch) {
      content.push({
        text: normalizeText(boldMatch[1]),
        style: "boldLine",
        margin: [0, 6, 0, 2],
      });
      continue;
    }

    // Horizontal rule
    if (trimmed === "---") {
      content.push({
        canvas: [
          {
            type: "line",
            x1: 0,
            y1: 0,
            x2: 515,
            y2: 0,
            lineWidth: 0.5,
            lineColor: "#cccccc",
          },
        ],
        margin: [0, 10, 0, 10],
      });
      continue;
    }

    // List item
    if (trimmed.startsWith("- ")) {
      content.push({
        ul: [parseInlineFormatting(trimmed.slice(2))],
        margin: [0, 2, 0, 2],
      });
      continue;
    }

    // Regular paragraph
    content.push({
      text: parseInlineFormatting(trimmed),
      style: "paragraph",
      margin: [0, 0, 0, 6],
    } as Content);
  }

  return content;
}

function createPdfDocument(markdown: string): TDocumentDefinitions {
  return {
    content: markdownToPdfContent(markdown),
    defaultStyle: {
      font: "Roboto",
      fontSize: 11,
      lineHeight: 1.4,
    },
    styles: {
      h1: {
        fontSize: 22,
        bold: true,
        lineHeight: 1.2,
      },
      h2: {
        fontSize: 16,
        bold: true,
        lineHeight: 1.2,
      },
      h3: {
        fontSize: 13,
        bold: true,
        lineHeight: 1.2,
      },
      boldLine: {
        fontSize: 12,
        bold: true,
        lineHeight: 1.2,
      },
      paragraph: {
        fontSize: 11,
        lineHeight: 1.4,
      },
    },
    pageMargins: [56, 56, 56, 56],
  };
}

export const exportApi = {
  exportMarkdown: (noteId: string): Promise<ExportData> => {
    return invoke("export_note_markdown", { noteId });
  },

  saveToFileWithDialog: async (content: string, defaultFilename: string): Promise<string | null> => {
    const filePath = await save({
      defaultPath: defaultFilename,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });

    if (filePath) {
      await writeTextFile(filePath, content);
      return filePath;
    }
    return null;
  },

  copyToClipboard: async (text: string): Promise<void> => {
    await writeText(text);
  },

  savePdfWithDialog: async (
    markdown: string,
    defaultFilename: string
  ): Promise<string | null> => {
    const docDefinition = createPdfDocument(markdown);

    return new Promise((resolve) => {
      pdfMake.createPdf(docDefinition).getBuffer(async (buffer) => {
        const pdfFilename = defaultFilename.replace(/\.md$/, ".pdf");
        const filePath = await save({
          defaultPath: pdfFilename,
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });

        if (filePath) {
          await writeFile(filePath, new Uint8Array(buffer));
          resolve(filePath);
        } else {
          resolve(null);
        }
      });
    });
  },
};
