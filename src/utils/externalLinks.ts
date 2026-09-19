import { openUrl } from "@tauri-apps/plugin-opener";

const OPENABLE = new Set(["http:", "https:", "mailto:"]);

/**
 * Opens links meant for a new window (target="_blank") in the default
 * browser: the About and Ollama pages, onboarding, and links in AI output.
 * The window itself never leaves the app (src-tauri/src/navigation.rs), and
 * without this those links did nothing. Links in the note editor have no
 * target and stay editor links.
 *
 * Returns a function that stops it.
 */
export function openExternalLinksInBrowser(): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const link = event
      .composedPath()
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    if (!link || link.target !== "_blank" || !link.href) return;

    let url: URL;
    try {
      url = new URL(link.href);
    } catch {
      return;
    }
    if (!OPENABLE.has(url.protocol)) return;
    event.preventDefault();
    openUrl(url.href).catch((e) => console.error("Couldn't open the link:", e));
  };
  window.addEventListener("click", onClick);
  return () => window.removeEventListener("click", onClick);
}
