import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { Options } from "react-markdown";

/**
 * Turns model output into HTML. Raw HTML in it is parsed (models put <br> in
 * table cells) and then cleaned with GitHub's allowlist, so iframes,
 * <meta http-equiv="refresh">, <style>, <form> and event handlers never reach
 * the page. The output is steerable by anything said in the meeting: a
 * <meta refresh> could send the window, notes in its URL, to another site.
 */
export const aiRehypePlugins: Options["rehypePlugins"] = [
  rehypeRaw,
  rehypeSanitize,
];
