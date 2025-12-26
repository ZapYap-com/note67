import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export interface ExportData {
  markdown: string;
  filename: string;
}

function markdownToHtml(markdown: string): string {
  return markdown
    .replace(/^# (.+)$/gm, '<h1 style="font-size:24px;font-weight:bold;margin-bottom:16px;">$1</h1>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:18px;font-weight:bold;margin-top:24px;margin-bottom:12px;">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:16px;font-weight:bold;margin-top:16px;margin-bottom:8px;">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^---$/gm, '<hr style="margin:16px 0;border:none;border-top:1px solid #ccc;">')
    .replace(/^- (.+)$/gm, '<li style="margin-left:20px;">$1</li>')
    .replace(/\n\n/g, '</p><p style="margin-bottom:8px;">')
    .replace(/\n/g, '<br>')
    .replace(/^(.+)$/gm, (match) => {
      if (match.startsWith('<')) return match;
      return `<p style="margin-bottom:8px;">${match}</p>`;
    });
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
    // Create hidden container with styled HTML
    const container = document.createElement("div");
    container.style.cssText =
      "position:absolute;left:-9999px;width:800px;padding:40px;background:#fff;font-family:system-ui;color:#000;line-height:1.5;";
    container.innerHTML = markdownToHtml(markdown);
    document.body.appendChild(container);

    try {
      // Capture as canvas
      const canvas = await html2canvas(container, { scale: 2 });

      // Create PDF
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * pageWidth) / canvas.width;

      // Handle multi-page
      let y = 0;
      while (y < imgHeight) {
        if (y > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, -y, imgWidth, imgHeight);
        y += pageHeight;
      }

      // Save dialog
      const pdfFilename = defaultFilename.replace(/\.md$/, ".pdf");
      const filePath = await save({
        defaultPath: pdfFilename,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (filePath) {
        const pdfBytes = pdf.output("arraybuffer");
        await writeFile(filePath, new Uint8Array(pdfBytes));
        return filePath;
      }
      return null;
    } finally {
      document.body.removeChild(container);
    }
  },
};
