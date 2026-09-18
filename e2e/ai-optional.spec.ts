import { test, expect } from "@playwright/test";
import { installTauriMock, makeNote } from "./support/tauri-mock";

// Recording and transcription run on Whisper alone. Ollama only adds the
// summary, title and task extraction, so without it the app should still
// record and say what AI would add, instead of blocking.

const ollamaDown = {
  get_ollama_status: { running: false, models: [], selected_model: null },
};

test.describe("without Ollama", () => {
  test("recording can still be started", async ({ page }) => {
    await installTauriMock(page, ollamaDown);
    await page.goto("/");
    await expect(page.getByRole("button", { name: /start listening/i })).toBeEnabled();
  });

  test("the setup wizard does not appear just for Ollama", async ({ page }) => {
    await installTauriMock(page, ollamaDown);
    await page.goto("/");
    await expect(page.getByRole("button", { name: /start listening/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /welcome to note67/i })).toBeHidden();
  });

  test("the Summary and Tasks tabs say what AI would add", async ({ page }) => {
    const note = makeNote({ title: "Weekly Sync" });
    await installTauriMock(page, { ...ollamaDown, list_notes: [note], get_note: note });
    await page.goto("/");
    await page.getByRole("button", { name: /weekly sync/i }).first().click();

    const tabBar = page.locator("div.flex.gap-6", {
      has: page.getByRole("button", { name: "transcript", exact: true }),
    });
    await tabBar.getByRole("button", { name: "summary", exact: true }).click();
    await expect(page.getByText(/start ollama and pick a model/i)).toBeVisible();

    await tabBar.getByRole("button", { name: "tasks", exact: true }).click();
    const generate = page.getByRole("button", { name: /generate/i });
    await expect(generate).toBeDisabled();
    await expect(generate).toHaveAttribute("title", "Start Ollama to find tasks");
  });
});

test.describe("without a transcription model", () => {
  test("Cmd+R opens the settings that fix it", async ({ page }) => {
    await installTauriMock(page, { get_loaded_model: null });
    await page.goto("/");
    await page.getByRole("button", { name: /skip for now/i }).click();
    await page.keyboard.press("Control+r");
    await expect(page.getByRole("heading", { name: "Whisper" })).toBeVisible();
  });
});

test.describe("meeting detection setting", () => {
  async function openSystemSettings(page: import("@playwright/test").Page) {
    // Shortcuts are registered once the app has rendered.
    await expect(page.getByRole("button", { name: /start listening/i })).toBeVisible();
    await page.keyboard.press("Control+,");
    await page.getByRole("button", { name: "System", exact: true }).click();
  }

  test("can be switched off, and the choice is saved", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");
    await openSystemSettings(page);

    await page.getByRole("button", { name: /detect meetings/i }).click();
    await page.waitForFunction(() =>
      ((window as unknown as { __tauriCalls?: string[] }).__tauriCalls ?? []).includes(
        "set_meeting_detection_enabled"
      )
    );
  });

  test("says when Screen Recording permission is missing", async ({ page }) => {
    await installTauriMock(page, { has_system_audio_permission: false });
    await page.goto("/");
    await page.getByRole("button", { name: /skip for now/i }).click();
    await openSystemSettings(page);

    await expect(page.getByText(/needs screen recording permission to see meeting windows/i)).toBeVisible();
  });
});
