import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const { openExternalLinksInBrowser } = await import("./externalLinks");

function link(href: string, target?: string) {
  const a = document.createElement("a");
  a.href = href;
  if (target) a.target = target;
  a.textContent = "link";
  document.body.append(a);
  return a;
}

function click(el: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  el.dispatchEvent(event);
  return event;
}

describe("openExternalLinksInBrowser", () => {
  let stop: () => void;
  beforeEach(() => {
    openUrl.mockClear();
    stop = openExternalLinksInBrowser();
  });
  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  it("opens new-window links in the browser instead of the app's window", () => {
    const event = click(link("https://ollama.com/download", "_blank"));
    expect(openUrl).toHaveBeenCalledWith("https://ollama.com/download");
    expect(event.defaultPrevented).toBe(true);

    click(link("mailto:hello@note67.com", "_blank"));
    expect(openUrl).toHaveBeenLastCalledWith("mailto:hello@note67.com");
  });

  it("opens from anywhere inside the link", () => {
    const a = link("https://note67.com", "_blank");
    const logo = document.createElement("img");
    a.append(logo);
    click(logo);
    expect(openUrl).toHaveBeenCalledWith("https://note67.com/");
  });

  it("leaves other links and clicks alone", () => {
    // An editor link: no target.
    click(link("https://example.com/in-a-note"));
    // Not a web or mail link.
    click(link("file:///etc/hosts", "_blank"));
    click(link("javascript:alert(1)", "_blank"));
    // Not a plain left click, or already handled.
    click(link("https://example.com/", "_blank"), { button: 1 });
    const handled = link("https://example.com/handled", "_blank");
    handled.addEventListener("click", (e) => e.preventDefault());
    click(handled);

    expect(openUrl).not.toHaveBeenCalled();
  });

  it("stops when asked", () => {
    stop();
    click(link("https://note67.com", "_blank"));
    expect(openUrl).not.toHaveBeenCalled();
    stop = () => {};
  });
});
