export function NoteGuideTab() {
  return (
    <div className="space-y-6">
      {/* Introduction */}
      <div>
        <p
          className="text-sm"
          style={{ color: "var(--color-text-secondary)" }}
        >
          note67 uses familiar syntax patterns from apps like Notion and
          Obsidian. Here's how to format your notes.
        </p>
      </div>

      {/* Slash Commands */}
      <Section title="Slash Commands" shortcut="/">
        <p className="text-sm mb-3" style={{ color: "var(--color-text-secondary)" }}>
          Type <Kbd>/</Kbd> at the start of a line to open the command menu for quick formatting.
        </p>
        <div className="space-y-2">
          <CommandRow command="/heading1" description="Large heading" />
          <CommandRow command="/heading2" description="Medium heading" />
          <CommandRow command="/heading3" description="Small heading" />
          <CommandRow command="/bullet" description="Bullet list" />
          <CommandRow command="/numbered" description="Numbered list" />
          <CommandRow command="/todo" description="Checkbox item" />
          <CommandRow command="/quote" description="Block quote" />
          <CommandRow command="/code" description="Code block" />
          <CommandRow command="/divider" description="Horizontal line" />
        </div>
      </Section>

      {/* Tags */}
      <Section title="Tags" shortcut="#">
        <p className="text-sm mb-3" style={{ color: "var(--color-text-secondary)" }}>
          Type <Kbd>#</Kbd> followed by text to create a tag. Tags help organize and filter your notes.
        </p>
        <div className="space-y-2">
          <Example input="#meeting" result="Creates a 'meeting' tag" />
          <Example input="#project-alpha" result="Tags with hyphens work" />
          <Example input="Discussed #budget today" result="Tags can be inline" />
        </div>
        <p className="text-xs mt-3" style={{ color: "var(--color-text-tertiary)" }}>
          Tip: An autocomplete menu appears as you type, showing existing tags.
          Colors are auto-generated based on the tag name.
        </p>
      </Section>

      {/* Wiki Links */}
      <Section title="Wiki Links" shortcut="[[">
        <p className="text-sm mb-3" style={{ color: "var(--color-text-secondary)" }}>
          Type <Kbd>[[</Kbd> to link to another note. This creates bidirectional links between notes.
        </p>
        <div className="space-y-2">
          <Example input="[[Meeting Notes]]" result="Links to 'Meeting Notes'" />
          <Example input="See [[Project Plan]]" result="Inline link to another note" />
        </div>
        <p className="text-xs mt-3" style={{ color: "var(--color-text-tertiary)" }}>
          Tip: An autocomplete menu shows matching notes as you type.
          When you rename a note, all links to it update automatically.
        </p>
      </Section>

      {/* Backlinks */}
      <Section title="Backlinks">
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          The "Linked References" panel at the bottom of each note shows all notes
          that link to the current note. Click any backlink to navigate to that note.
        </p>
      </Section>

      {/* Markdown */}
      <Section title="Markdown Formatting">
        <p className="text-sm mb-3" style={{ color: "var(--color-text-secondary)" }}>
          Standard markdown syntax is supported for inline formatting.
        </p>
        <div className="space-y-2">
          <Example input="**bold**" result="Bold text" />
          <Example input="*italic*" result="Italic text" />
          <Example input="`code`" result="Inline code" />
          <Example input="~~strikethrough~~" result="Strikethrough text" />
          <Example input="[link](url)" result="External link" />
        </div>
      </Section>

      {/* Headings Note */}
      <Section title="Headings vs Tags">
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          <Kbd>#</Kbd> at the start of a line followed by a space creates a heading.
          <br />
          <Kbd>#</Kbd> followed immediately by text (no space) creates a tag.
        </p>
        <div className="mt-3 space-y-2">
          <Example input="# Heading" result="Creates a heading" />
          <Example input="#tag" result="Creates a tag" />
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  shortcut,
  children,
}: {
  title: string;
  shortcut?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="p-4 rounded-xl"
      style={{ backgroundColor: "var(--color-bg-subtle)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <h3
          className="text-sm font-semibold"
          style={{ color: "var(--color-text)" }}
        >
          {title}
        </h3>
        {shortcut && (
          <Kbd>{shortcut}</Kbd>
        )}
      </div>
      {children}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="px-1.5 py-0.5 text-xs font-mono rounded"
      style={{
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        color: "var(--color-text)",
      }}
    >
      {children}
    </kbd>
  );
}

function CommandRow({
  command,
  description,
}: {
  command: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <code
        className="text-xs px-2 py-1 rounded font-mono min-w-[100px]"
        style={{
          backgroundColor: "var(--color-bg-elevated)",
          color: "var(--color-accent)",
        }}
      >
        {command}
      </code>
      <span
        className="text-sm"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {description}
      </span>
    </div>
  );
}

function Example({ input, result }: { input: string; result: string }) {
  return (
    <div className="flex items-center gap-3">
      <code
        className="text-xs px-2 py-1 rounded font-mono"
        style={{
          backgroundColor: "var(--color-bg-elevated)",
          color: "var(--color-text)",
        }}
      >
        {input}
      </code>
      <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
        →
      </span>
      <span
        className="text-sm"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {result}
      </span>
    </div>
  );
}
