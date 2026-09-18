import { test, expect } from "@playwright/test";
import { installTauriMock, makeNote } from "./support/tauri-mock";

// Opening notes from outside the note list. These paths used to leave the
// user where they were: a new note or a search result opened "behind" the
// Tasks page, or on the Summary tab of a note that had just been created.

const noteTabBar = (page: import("@playwright/test").Page) =>
  page.locator("div.flex.gap-6", {
    has: page.getByRole("button", { name: "transcript", exact: true }),
  });

test.describe("opening notes", () => {
  test("a new note opens on the Note tab, even from the Tasks page", async ({ page }) => {
    await installTauriMock(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();

    await page.keyboard.press("Control+n");

    await expect(noteTabBar(page)).toBeVisible();
    // The Note tab is the one with the editor. It is briefly built twice (the
    // editor rebuilds on an outside value change), so wait for it to settle.
    await expect(page.locator("main .ProseMirror")).toHaveCount(1);
    await expect(page.locator("main .ProseMirror")).toBeVisible();
  });

  test("a Cmd+K result opens its note, even from the Tasks page", async ({ page }) => {
    const note = makeNote({ title: "Pricing review" });
    await installTauriMock(page, {
      list_notes: [note],
      get_note: note,
      search_notes: [note],
    });
    await page.goto("/");

    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();

    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search notes...").fill("q3-pricing");
    await expect(page.getByRole("button", { name: /pricing review.*2026/i })).toBeVisible();
    await page.keyboard.press("Enter");

    await expect(noteTabBar(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeHidden();
  });
});

test.describe("transcripts", () => {
  test("a transcript that failed to load loads when the note is opened again", async ({
    page,
  }) => {
    const call = makeNote({ id: "note-1", title: "Pricing call" });
    const other = makeNote({ id: "note-2", title: "Standup" });
    const line = {
      id: 1,
      note_id: call.id,
      start_time: 0,
      end_time: 3,
      text: "Let's ship the new pricing on Friday.",
      speaker: "You",
      source_type: "segment",
      source_id: 1,
      created_at: "2026-07-02T09:00:00.000Z",
    };
    await installTauriMock(page, {
      list_notes: [call, other],
      get_note: call,
      get_transcript: { __rejectOnce: "database is locked", __after: [line] },
    });
    await page.goto("/");

    await page.getByRole("button", { name: /pricing call/i }).first().click();
    await page.waitForFunction(() =>
      ((window as unknown as { __tauriCalls?: string[] }).__tauriCalls ?? []).includes(
        "get_transcript"
      )
    );
    await page.getByRole("button", { name: "transcript", exact: true }).click();
    await expect(page.getByText(line.text)).toBeHidden();

    await page.getByRole("button", { name: /standup/i }).first().click();
    await page.getByRole("button", { name: /pricing call/i }).first().click();
    // Named with its line count once it has lines: "transcript (1)".
    await page.getByRole("button", { name: /^transcript/i }).click();
    await expect(page.getByText(line.text)).toBeVisible();
  });
});

test.describe("starting a recording", () => {
  test("a start that fails leaves no empty note behind", async ({ page }) => {
    // What the backend now answers when a session is already open.
    await installTauriMock(page, {
      start_dual_recording_with_segments: {
        __reject: "A recording is already in progress. Stop it before starting another.",
      },
    });
    await page.goto("/");

    await page.getByRole("button", { name: /start listening/i }).click();

    // The note is created first, then deleted once the start fails.
    await page.waitForFunction(() =>
      ((window as unknown as { __tauriCalls?: string[] }).__tauriCalls ?? []).includes(
        "delete_note"
      )
    );
    await expect(page.getByRole("button", { name: /^untitled/i })).toHaveCount(0);
    await expect(noteTabBar(page)).toBeHidden();
  });
});

test.describe("tasks", () => {
  test("a task ticked on the Tasks page shows as done in its note", async ({ page }) => {
    const note = makeNote({ title: "Weekly Sync" });
    const task = {
      id: 1,
      note_id: note.id,
      stable_id: "a1",
      text: "Send the pricing deck",
      description: null,
      parent_id: null,
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

    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await page.getByRole("checkbox", { name: "Mark as done" }).click();
    // Done tasks leave the page's default (open) list.
    await expect(page.getByText("No open tasks. Nice.")).toBeVisible();

    await page.getByRole("button", { name: /weekly sync/i }).first().click();
    await noteTabBar(page).getByRole("button", { name: "tasks", exact: true }).click();
    await expect(page.getByText("Send the pricing deck")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Mark as not done" })).toBeVisible();
  });
});
