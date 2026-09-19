import { test, expect, type Page } from "@playwright/test";
import { installTauriMock, makeNote } from "./support/tauri-mock";

// Links meant for the browser go to the opener plugin. The app's window never
// follows a link (src-tauri/src/navigation.rs refuses it), so without this
// they did nothing.

async function openApp(page: Page, commands: Record<string, unknown> = {}) {
  await installTauriMock(page, { "plugin:opener|open_url": null, ...commands });
  await page.addInitScript(() => {
    const w = window as unknown as {
      __opened: string[];
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;
      };
    };
    w.__opened = [];
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args, options) => {
      if (cmd === "plugin:opener|open_url") w.__opened.push(String(args?.url));
      return invoke(cmd, args, options);
    };
  });
  await page.goto("/");
}

const opened = (page: Page) =>
  page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);

test("the About page's links open in the browser", async ({ page }) => {
  await openApp(page);
  const popups: string[] = [];
  page.on("popup", (popup) => popups.push(popup.url()));

  await expect(page.getByRole("button", { name: /start listening/i })).toBeVisible();
  await page.keyboard.press("Control+,");
  await page.getByRole("button", { name: "About", exact: true }).click();
  await page.getByRole("link", { name: "Visit Website" }).click();

  await expect.poll(() => opened(page)).toEqual(["https://note67.com/"]);
  expect(popups).toEqual([]);
});

test("a link in a summary opens in the browser, and the app stays put", async ({ page }) => {
  const note = makeNote({ title: "Pricing review" });
  await openApp(page, {
    list_notes: [note],
    get_note: note,
    get_note_summaries: [
      {
        id: 1,
        note_id: note.id,
        summary_type: "overview",
        content: "## Summary\n\nDetails are on [the pricing page](https://example.com/pricing).",
        created_at: "2026-07-02T09:31:00.000Z",
      },
    ],
  });
  const appUrl = page.url();
  await page.getByRole("button", { name: /pricing review/i }).first().click();

  const link = page.getByRole("link", { name: "the pricing page" });
  await expect(link).toHaveAttribute("title", "https://example.com/pricing");
  await link.click();

  await expect.poll(() => opened(page)).toEqual(["https://example.com/pricing"]);
  expect(page.url()).toBe(appUrl);
});
