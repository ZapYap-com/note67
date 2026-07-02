import { test, expect } from "@playwright/test";
import {
  installTauriMock,
  needsSetupCommands,
  makeNote,
} from "./support/tauri-mock";

/**
 * Example specs proving the mockIPC harness works against the CURRENT UI.
 * As #4 (tab collapse) and #7 (onboarding wizard) land, tighten these
 * assertions to the new surfaces (see TODOs).
 */

test.describe("first-run / needs setup", () => {
  test("prompts the user to set up Whisper & Ollama", async ({ page }) => {
    // No Whisper model, Ollama down, permissions not granted.
    await installTauriMock(page, needsSetupCommands);
    await page.goto("/");

    // Today this shows in the EmptyState. TODO(#7): assert the onboarding
    // wizard overlay + its first unmet step instead.
    await expect(
      page.getByRole("button", { name: /set up whisper & ollama/i })
    ).toBeVisible();

    // The "Start listening" button should be disabled until setup completes.
    await expect(page.getByRole("button", { name: /start listening/i })).toBeDisabled();

    await page.screenshot({ path: "e2e/__screenshots__/needs-setup.png", fullPage: true });
  });
});

test.describe("ready state", () => {
  test("shows a meeting note with its tabs", async ({ page }) => {
    const note = makeNote({ title: "Weekly Sync" });
    await installTauriMock(page, { list_notes: [note], get_note: note });
    await page.goto("/");

    // Note appears in the sidebar and opens.
    await page.getByRole("button", { name: /weekly sync/i }).first().click();

    // The note view's tab bar. "transcript"/"summary" are unique; the note's
    // "notes" tab collides with the sidebar "Notes" toggle, so scope to the tab
    // bar for that one.
    // TODO(#4): once tabs collapse to "Note | Transcript", assert the
    // 2-surface layout + the "My notes | Enhanced" toggle instead.
    const tabBar = page.locator("div.flex.gap-6", {
      has: page.getByRole("button", { name: "transcript", exact: true }),
    });
    for (const tab of ["notes", "transcript", "summary"]) {
      await expect(tabBar.getByRole("button", { name: tab, exact: true })).toBeVisible();
    }

    await page.screenshot({ path: "e2e/__screenshots__/note-view.png", fullPage: true });
  });

  test("Start listening is enabled when setup is complete", async ({ page }) => {
    await installTauriMock(page); // all-ready defaults
    await page.goto("/");
    await expect(page.getByRole("button", { name: /start listening/i })).toBeEnabled();
  });
});
