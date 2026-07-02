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

    // Three surfaces: Note (your notes), Transcript (source), Summary (AI).
    // Scope to the tab bar to disambiguate the "note" tab from the sidebar
    // "Notes" toggle.
    const tabBar = page.locator("div.flex.gap-6", {
      has: page.getByRole("button", { name: "transcript", exact: true }),
    });
    for (const tab of ["note", "transcript", "summary", "tasks"]) {
      await expect(tabBar.getByRole("button", { name: tab, exact: true })).toBeVisible();
    }

    await page.screenshot({ path: "e2e/__screenshots__/note-view.png", fullPage: true });
  });

  test("Tasks tab shows a note's action items (#3)", async ({ page }) => {
    const note = makeNote({ title: "Weekly Sync" });
    await installTauriMock(page, {
      list_notes: [note],
      get_note: note,
      get_action_items: [
        {
          id: 1,
          note_id: note.id,
          stable_id: "a1",
          text: "Send the pricing deck",
          assignee: "sofia",
          due_date: "2026-07-11",
          done: false,
          sort_order: 0,
          created_at: "2026-07-02T09:31:00.000Z",
          updated_at: "2026-07-02T09:31:00.000Z",
        },
      ],
    });
    await page.goto("/");
    await page.getByRole("button", { name: /weekly sync/i }).first().click();

    const tabBar = page.locator("div.flex.gap-6", {
      has: page.getByRole("button", { name: "transcript", exact: true }),
    });
    await tabBar.getByRole("button", { name: "tasks", exact: true }).click();

    // Split view: the task shows in the left list; the first task is auto-selected
    // so the detail pane (with a subtask adder) is shown.
    await expect(page.getByText("Send the pricing deck")).toBeVisible();
    await expect(page.getByPlaceholder("Add a task…")).toBeVisible();
    await expect(page.getByPlaceholder("Add a subtask…")).toBeVisible();
  });

  test("shows the AI summary in its own tab (#4)", async ({ page }) => {
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

    // Opening a note lands on the Summary tab, which renders the AI summary.
    await expect(page.getByText(/Sofia owns the deck/i)).toBeVisible();

    // The Note tab holds the user's own editable notes (no summary content).
    const tabBar = page.locator("div.flex.gap-6", {
      has: page.getByRole("button", { name: "transcript", exact: true }),
    });
    await tabBar.getByRole("button", { name: "note", exact: true }).click();
    await expect(page.getByText(/Sofia owns the deck/i)).toBeHidden();
  });

  test("Start listening is enabled when setup is complete", async ({ page }) => {
    await installTauriMock(page); // all-ready defaults
    await page.goto("/");
    await expect(page.getByRole("button", { name: /start listening/i })).toBeEnabled();
  });

  test("global Tasks view lists open action items (#3)", async ({ page }) => {
    const note = makeNote({ title: "Weekly Sync" });
    const task = {
      id: 1,
      note_id: note.id,
      stable_id: "a1",
      text: "Send the pricing deck",
      description: null,
      parent_id: null,
      assignee: null,
      due_date: null,
      done: false,
      sort_order: 0,
      created_at: "2026-07-02T09:31:00.000Z",
      updated_at: "2026-07-02T09:31:00.000Z",
    };
    await installTauriMock(page, {
      list_notes: [note],
      get_note: note,
      get_action_items: [task],
      get_open_action_items: [task],
    });
    await page.goto("/");

    // Open the central Tasks page from the sidebar (split view: list + detail).
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
    await expect(page.getByText("Send the pricing deck")).toBeVisible();
    // First task auto-selected → its detail (subtask adder) is shown.
    await expect(page.getByPlaceholder("Add a subtask…")).toBeVisible();

    // The link button opens the task in its note's Tasks tab.
    await page.getByTitle("Open in note").first().click();
    const tabBar = page.locator("div.flex.gap-6", {
      has: page.getByRole("button", { name: "transcript", exact: true }),
    });
    await expect(tabBar.getByRole("button", { name: "note", exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("Add a subtask…")).toBeVisible();
  });
});
