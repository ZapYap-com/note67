import { $node, $inputRule, $remark } from '@milkdown/kit/utils';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import type { Node, NodeType } from '@milkdown/kit/prose/model';
import type {
  MarkdownNode,
  ParserState,
  Root,
  SerializerState,
} from '@milkdown/kit/transformer';

// Minimal mdast node shape for the remark tree transform below.
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
  target?: string;
  alias?: string | null;
  [key: string]: unknown;
}

// Remark plugin to parse [[wiki links]] in markdown AST
function remarkWikiLink() {
  const wikiLinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

  return (tree: Root) => {
    const visit = (node: MdastNode, parent?: MdastNode, index?: number) => {
      if (node.type === 'text' && parent) {
        const value = node.value as string;
        const matches: Array<{ match: RegExpExecArray; start: number; end: number }> = [];

        let match;
        while ((match = wikiLinkRegex.exec(value)) !== null) {
          matches.push({
            match,
            start: match.index,
            end: match.index + match[0].length,
          });
        }

        if (matches.length === 0) return;

        // Build new children array with wiki link nodes
        const newChildren: MdastNode[] = [];
        let lastEnd = 0;

        for (const { match, start, end } of matches) {
          // Text before the wiki link
          if (start > lastEnd) {
            newChildren.push({
              type: 'text',
              value: value.slice(lastEnd, start),
            });
          }

          // Wiki link node
          const target = match[1].trim();
          const alias = match[2]?.trim();
          newChildren.push({
            type: 'wikiLink',
            data: {
              hName: 'span',
              hProperties: {
                'data-wiki-link': 'true',
                'data-target': target,
                'data-alias': alias || '',
              },
            },
            children: [{ type: 'text', value: alias || target }],
            target,
            alias: alias || null,
          });

          lastEnd = end;
        }

        // Text after the last wiki link
        if (lastEnd < value.length) {
          newChildren.push({
            type: 'text',
            value: value.slice(lastEnd),
          });
        }

        // Replace the text node with our new children
        if (typeof index === 'number' && parent.children) {
          parent.children.splice(index, 1, ...newChildren);
        }
      }

      // Recursively visit children
      if (node.children) {
        // Iterate backwards to handle splice correctly
        for (let i = node.children.length - 1; i >= 0; i--) {
          visit(node.children[i], node, i);
        }
      }
    };

    visit(tree as unknown as MdastNode);
  };
}

// Remark plugin wrapped for Milkdown
export const remarkWikiLinkPlugin = $remark('remarkWikiLink', () => remarkWikiLink);

// Wiki link node schema
export const wikiLinkNode = $node('wikiLink', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  attrs: {
    target: { default: '' },
    alias: { default: null },
    isBroken: { default: false },
  },
  parseDOM: [
    {
      tag: 'span[data-wiki-link]',
      getAttrs: (dom: HTMLElement) => ({
        target: dom.getAttribute('data-target') || '',
        alias: dom.getAttribute('data-alias') || null,
        isBroken: dom.getAttribute('data-broken') === 'true',
      }),
    },
  ],
  toDOM: (node: Node) => {
    const { target, alias, isBroken } = node.attrs;
    const displayText = alias || target;
    const className = isBroken ? 'wiki-link wiki-link-broken' : 'wiki-link';

    return [
      'span',
      {
        'class': className,
        'data-wiki-link': 'true',
        'data-target': target,
        'data-alias': alias || '',
        'data-broken': isBroken ? 'true' : 'false',
        'title': `Link to: ${target}`,
        'contenteditable': 'false',
      },
      displayText,
    ];
  },
  parseMarkdown: {
    match: (node: MarkdownNode) => node.type === 'wikiLink',
    runner: (state: ParserState, node: MarkdownNode, type: NodeType) => {
      const target = typeof node.target === 'string' ? node.target : '';
      const alias = typeof node.alias === 'string' ? node.alias : null;
      state.addNode(type, { target, alias, isBroken: false });
    },
  },
  toMarkdown: {
    match: (node: Node) => node.type.name === 'wikiLink',
    runner: (state: SerializerState, node: Node) => {
      const { target, alias } = node.attrs;
      if (alias) {
        state.addNode('text', undefined, `[[${target}|${alias}]]`);
      } else {
        state.addNode('text', undefined, `[[${target}]]`);
      }
    },
  },
}));

// Input rule: typing [[text]] creates a wiki link
export const wikiLinkInputRule = $inputRule(() => {
  // Match [[title]] or [[title|alias]] when user types the closing ]]
  return new InputRule(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/,
    (state, match, start, end) => {
      const target = match[1].trim();
      const alias = match[2]?.trim() || null;

      const nodeType = state.schema.nodes.wikiLink;
      if (!nodeType) return null;

      const node = nodeType.create({ target, alias, isBroken: false });
      return state.tr.replaceWith(start, end, node);
    }
  );
});

// Export all plugins as an array for easy integration
export const wikiLinkPlugins = [
  remarkWikiLinkPlugin,
  wikiLinkNode,
  wikiLinkInputRule,
].flat();
