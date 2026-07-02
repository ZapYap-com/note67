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

test.describe("first-run / needs setup (#7 onboarding)", () => {
  test("shows the onboarding wizard on the first unmet step", async ({ page }) => {
    // No Whisper model, Ollama down, permissions not granted.
    await installTauriMock(page, needsSetupCommands);
    await page.goto("/");

    // The skippable wizard overlays the app, landing on the first unmet step.
    await expect(page.getByRole("heading", { name: /welcome to note67/i })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /download a transcription model/i })
    ).toBeVisible();

    await page.screenshot({ path: "e2e/__screenshots__/onboarding.png", fullPage: true });
  });

  test("'Skip for now' dismisses the wizard", async ({ page }) => {
    await installTauriMock(page, needsSetupCommands);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /welcome to note67/i })).toBeVisible();
    await page.getByRole("button", { name: /skip for now/i }).click();

    // Wizard gone; the app's own setup affordance remains behind it.
    await expect(page.getByRole("heading", { name: /welcome to note67/i })).toBeHidden();
    await expect(
      page.getByRole("button", { name: /set up whisper & ollama/i })
    ).toBeVisible();
  });
});

test.describe("ready state", () => {
  test("shows a meeting note with its tabs", async ({ page }) => {
    const note = makeNote({ title: "Weekly Sync" });
    await installTauriMock(page, { list_notes: [note], get_note: note });
    await page.goto("/");

    // Note appears in the sidebar and opens.
    await page.getByRole("button", { name: /weekly sync/i }).first().click();

    // #4: the note view collapses to two surfaces — Note (the document) and
    // Transcript (source reference). Scope to the tab bar to disambiguate the
    // "note" tab from the sidebar "Notes" toggle.
    const tabBar = page.locator("div.flex.gap-6", {
      has: page.getByRole("button", { name: "transcript", exact: true }),
    });
    for (const tab of ["note", "transcript"]) {
      await expect(tabBar.getByRole("button", { name: tab, exact: true })).toBeVisible();
    }
    // There is no longer a separate "summary" tab.
    await expect(tabBar.getByRole("button", { name: "summary", exact: true })).toHaveCount(0);

    await page.screenshot({ path: "e2e/__screenshots__/note-view.png", fullPage: true });
  });

  test("shows the enhanced note with a My notes / Enhanced toggle (#4)", async ({ page }) => {
    const note = makeNote({ title: "Q3 Planning", description: "- pricing\n- hiring" });
    await installTauriMock(page, {
      list_notes: [note],
      get_note: note,
      get_note_summaries: [
        {
          id: 1,
          note_id: note.id,
          summary_type: "overview",
          content: "## Summary\nTeam aligned on tiered pricing; Sofia owns the deck.",
          created_at: "2026-07-02T09:31:00.000Z",
        },
      ],
    });
    await page.goto("/");
    await page.getByRole("button", { name: /q3 planning/i }).first().click();

    // The enhanced doc renders by default, with a toggle back to the raw notes.
    await expect(page.getByRole("button", { name: /my notes/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /enhanced/i })).toBeVisible();
    await expect(page.getByText(/Sofia owns the deck/i)).toBeVisible();

    // Switching to "My notes" shows the user's own editable notes.
    await page.getByRole("button", { name: /my notes/i }).click();
    await expect(page.getByText(/Sofia owns the deck/i)).toBeHidden();
  });

  test("Start listening is enabled when setup is complete", async ({ page }) => {
    await installTauriMock(page); // all-ready defaults
    await page.goto("/");
    await expect(page.getByRole("button", { name: /start listening/i })).toBeEnabled();
  });

  test("global Tasks view lists open action items (#3)", async ({ page }) => {
    const note = makeNote({ title: "Weekly Sync" });
    await installTauriMock(page, {
      list_notes: [note],
      get_note: note,
      list_all_open_action_items: [
        {
          id: 1,
          note_id: note.id,
          note_title: "Weekly Sync",
          text: "Send the pricing deck",
          assignee: "sofia",
          due_date: null,
          done: false,
          created_at: "2026-07-02T09:31:00.000Z",
        },
      ],
    });
    await page.goto("/");

    // Open the Tasks view from the sidebar.
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
    await expect(page.getByText("Send the pricing deck")).toBeVisible();
    await expect(page.getByText("@sofia")).toBeVisible();

    // Clicking a task opens its source note.
    await page.getByText("Send the pricing deck").click();
    const tabBar = page.locator("div.flex.gap-6", {
      has: page.getByRole("button", { name: "transcript", exact: true }),
    });
    await expect(tabBar.getByRole("button", { name: "note", exact: true })).toBeVisible();
  });
});
