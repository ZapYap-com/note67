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
    // The Note tab is the one with the editor.
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
