import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";

/** Shared markdown component overrides for AI-generated content (summaries,
 * enhanced notes). Kept in one place so every rendered surface looks the same. */
const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-lg font-semibold mb-2 mt-3" style={{ color: "var(--color-text)" }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold mb-2 mt-3" style={{ color: "var(--color-text)" }}>{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold mb-1.5 mt-2" style={{ color: "var(--color-text)" }}>{children}</h3>
  ),
  p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold" style={{ color: "var(--color-text)" }}>{children}</strong>
  ),
  code: ({ children }) => (
    <code className="px-1 py-0.5 rounded text-sm" style={{ backgroundColor: "var(--color-bg-subtle)" }}>{children}</code>
  ),
  table: ({ children }) => (
    <table className="w-full border-collapse my-3 text-sm" style={{ borderColor: "var(--color-border)" }}>{children}</table>
  ),
  thead: ({ children }) => <thead style={{ backgroundColor: "var(--color-bg-subtle)" }}>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--color-text)", borderBottom: "2px solid var(--color-border)" }}>{children}</th>
  ),
  td: ({ children }) => <td className="px-3 py-2" style={{ color: "var(--color-text-secondary)" }}>{children}</td>,
  pre: ({ children }) => (
    <pre className="p-3 rounded-lg my-2 overflow-x-auto text-sm" style={{ backgroundColor: "var(--color-bg-subtle)" }}>{children}</pre>
  ),
};

/** Renders AI markdown content with the shared component overrides. */
export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none" style={{ color: "var(--color-text-ai)" }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
