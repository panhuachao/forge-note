interface Props {
  content: string;
  onJump: (line: number) => void;
}

export function NoteOutline({ content, onJump }: Props) {
  const lines = content.split('\n');
  const headings: { level: number; text: string; line: number }[] = [];
  lines.forEach((l, i) => {
    const m = /^(#{1,6})\s+(.+)$/.exec(l);
    if (m) headings.push({ level: m[1].length, text: m[2], line: i + 1 });
  });

  if (headings.length === 0) return null;

  return (
    <div className="px-4 py-3 border-b border-ink-200">
      <h3 className="text-xs font-semibold text-ink-500 uppercase mb-2">大纲</h3>
      <ul className="space-y-1 text-sm">
        {headings.map((h, i) => (
          <li
            key={i}
            className="cursor-pointer text-ink-600 hover:text-brand-600 truncate"
            style={{ paddingLeft: (h.level - 1) * 12 }}
            onClick={() => onJump(h.line)}
            title={h.text}
          >
            {h.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
