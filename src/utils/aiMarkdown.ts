import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { Options } from "react-markdown";

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/**
 * Marks every link to open in the browser (src/utils/externalLinks.ts),
 * titled with where it goes: the text a model wrote can say anything.
 */
function linksOpenInBrowser() {
  const visit = (node: HastNode) => {
    if (node.type === "element" && node.tagName === "a" && node.properties?.href) {
      node.properties = {
        ...node.properties,
        target: "_blank",
        rel: ["noopener", "noreferrer"],
        title: String(node.properties.href),
      };
    }
    node.children?.forEach(visit);
  };
  return (tree: HastNode) => visit(tree);
}

/**
 * Turns model output into HTML. Raw HTML in it is parsed (models put <br> in
 * table cells) and then cleaned with GitHub's allowlist, so iframes,
 * <meta http-equiv="refresh">, <style>, <form> and event handlers never reach
 * the page. The output is steerable by anything said in the meeting: a
 * <meta refresh> could send the window, notes in its URL, to another site.
 * Links are marked afterwards, since the allowlist drops `target`.
 */
export const aiRehypePlugins: Options["rehypePlugins"] = [
  rehypeRaw,
  rehypeSanitize,
  linksOpenInBrowser,
];
