import { test, expect } from "@playwright/test";
import { installTauriMock, makeNote } from "./support/tauri-mock";

const note = makeNote({ title: "Imported call" });
const imported = {
  id: 7,
  note_id: note.id,
  file_path: "/recordings/note-1_upload_ab12.wav",
  original_filename: "call.m4a",
  duration_ms: 60_000,
  speaker_label: "Uploaded",
  transcription_status: "pending",
  display_order: 0,
  created_at: "2026-07-02T09:00:00.000Z",
};

async function openNote(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /imported call/i }).first().click();
}

test.describe("imported audio", () => {
  test("a note whose only audio is imported gets a player and its file", async ({ page }) => {
    await installTauriMock(page, {
      list_notes: [note],
      get_note: note,
      get_uploaded_audio: [imported],
    });
    await page.goto("/");
    await openNote(page);

    await page.getByTitle(/show audio files/i).click();
    await expect(page.getByText("call.m4a")).toBeVisible();
    await expect(page.getByRole("button", { name: "Transcribe", exact: true })).toBeVisible();
  });

  test("a failed import says why", async ({ page }) => {
    const reason = "Opus audio isn't supported yet. Convert it to m4a or mp3 and upload it again.";
    await installTauriMock(page, {
      list_notes: [note],
      get_note: note,
      "plugin:dialog|open": "/Users/me/voice.webm",
      upload_audio: { __reject: reason },
    });
    await page.goto("/");
    await openNote(page);

    await page.getByTitle("More actions").click();
    await page.getByRole("button", { name: /upload audio/i }).click();

    await expect(page.getByRole("alert")).toContainText(reason);
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("alert")).toBeHidden();
  });
});

test.describe("uploading audio", () => {
  const upload = (overrides: Record<string, unknown>) => ({
    list_notes: [note],
    get_note: note,
    "plugin:dialog|open": "/Users/me/call.m4a",
    upload_audio: imported,
    transcribe_uploaded_audio: 12,
    ...overrides,
  });

  async function uploadFile(page: import("@playwright/test").Page) {
    await openNote(page);
    await page.getByTitle("More actions").click();
    await page.getByRole("button", { name: /upload audio/i }).click();
    await page.waitForFunction(() =>
      ((window as unknown as { __tauriCalls?: string[] }).__tauriCalls ?? []).includes(
        "upload_audio"
      )
    );
  }

  const calls = (page: import("@playwright/test").Page) =>
    page.evaluate(() => (window as unknown as { __tauriCalls?: string[] }).__tauriCalls ?? []);

  test("is transcribed straight away when a model is loaded", async ({ page }) => {
    await installTauriMock(page, upload({}));
    await page.goto("/");
    await uploadFile(page);

    await page.waitForFunction(() =>
      ((window as unknown as { __tauriCalls?: string[] }).__tauriCalls ?? []).includes(
        "transcribe_uploaded_audio"
      )
    );
  });

  test("offers Transcribe when no model is loaded", async ({ page }) => {
    await installTauriMock(page, upload({ get_loaded_model: null }));
    await page.goto("/");
    await page.getByRole("button", { name: /skip for now/i }).click();
    await uploadFile(page);

    await expect(page.getByRole("button", { name: "Transcribe", exact: true })).toBeVisible();
    expect(await calls(page)).not.toContain("transcribe_uploaded_audio");
  });
});
