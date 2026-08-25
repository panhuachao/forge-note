interface Props {
  kbId: string;
  notePath: string;
  inlinks: string[];
  outlinks: string[];
  broken: string[];
  onOpen: (path: string) => void;
}

export function LinkPanel({ inlinks, outlinks, broken, onOpen }: Props) {
  return (
    <div className="px-4 py-3 border-b border-border">
      <h3 className="text-xs font-semibold text-fg-muted uppercase mb-2">双向链接</h3>
      <div className="text-sm space-y-3">
        <div>
          <div className="text-fg-muted text-xs mb-1">入链 ({inlinks.length})</div>
          {inlinks.length === 0 ? (
            <div className="text-fg-faint text-xs">无</div>
          ) : (
            <ul className="space-y-0.5">
              {inlinks.map((p) => (
                <li
                  key={p}
                  className="text-brand hover:underline cursor-pointer truncate text-xs"
                  onClick={() => onOpen(p)}
                  title={p}
                >
                  ← {p.split('/').pop()?.replace(/\.md$/i, '')}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="text-fg-muted text-xs mb-1">出链 ({outlinks.length})</div>
          {outlinks.length === 0 ? (
            <div className="text-fg-faint text-xs">无</div>
          ) : (
            <ul className="space-y-0.5">
              {outlinks.map((p) => (
                <li key={p} className="text-brand truncate text-xs" title={p}>
                  → {p.replace(/\.md$/i, '')}
                </li>
              ))}
            </ul>
          )}
        </div>
        {broken.length > 0 && (
          <div>
            <div className="text-red-500 text-xs mb-1">失效链接 ({broken.length})</div>
            <ul className="space-y-0.5">
              {broken.map((p) => (
                <li key={p} className="text-red-500 line-through truncate text-xs" title={p}>
                  ✗ {p}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
