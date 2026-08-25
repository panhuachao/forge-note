import { useEffect, useRef } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';

export function GraphPage() {
  const { activeKb, applied } = useKBStore();
  const { openTab } = useLayoutStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<{ nodes: { x: number; y: number; vx: number; vy: number; path: string; name: string; color: string }[]; edges: { a: number; b: number }[]; drag?: number }>({ nodes: [], edges: [] });

  useEffect(() => {
    if (!activeKb) return;
    (async () => {
      const tree = await window.forge.fs.listTree(activeKb.id);
      const colorMap = new Map<string, string>();
      if (applied) {
        for (const d of applied.meta.dirs) {
          colorMap.set(`${d.id} ${d.name}`, d.color);
          colorMap.set(d.name, d.color);
        }
      }
      // 收集所有笔记
      const allFiles: { path: string; name: string; color: string }[] = [];
      function walk(n: any) {
        if (n.kind === 'file') {
          let color = '#a8a29e';
          const parts = n.path.split('/');
          if (parts.length > 1) {
            const dir = parts[parts.length - 2];
            color = colorMap.get(dir) || color;
          }
          allFiles.push({ path: n.path, name: n.name.replace(/\.md$/i, ''), color });
        } else if (n.children) {
          n.children.forEach(walk);
        }
      }
      walk(tree);
      // 收集所有出链
      const outMap = new Map<string, string[]>();
      for (const f of allFiles) {
        const c = await window.forge.fs.readNote(activeKb.id, f.path);
        outMap.set(f.path, c.outlinks);
      }
      // 建图
      const nodes = allFiles.map((f, i) => ({
        x: 400 + Math.cos((i / allFiles.length) * Math.PI * 2) * 250,
        y: 300 + Math.sin((i / allFiles.length) * Math.PI * 2) * 200,
        vx: 0,
        vy: 0,
        path: f.path,
        name: f.name,
        color: f.color
      }));
      const nameToIdx = new Map<string, number>();
      allFiles.forEach((f, i) => nameToIdx.set(f.name, i));
      const edges: { a: number; b: number }[] = [];
      for (let i = 0; i < allFiles.length; i++) {
        const outs = outMap.get(allFiles[i].path) || [];
        for (const o of outs) {
          const j = nameToIdx.get(o);
          if (j !== undefined) edges.push({ a: i, b: j });
        }
      }
      stateRef.current = { nodes, edges };
      draw();
    })();
  }, [activeKb?.id, applied?.appliedAt]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const { nodes, edges } = stateRef.current;
    // edges
    ctx.strokeStyle = '#d6d3d1';
    ctx.lineWidth = 0.6;
    for (const e of edges) {
      const a = nodes[e.a];
      const b = nodes[e.b];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // nodes
    for (const n of nodes) {
      ctx.fillStyle = n.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // 简单力导向模拟
  useEffect(() => {
    let raf = 0;
    function step() {
      const { nodes, edges, drag } = stateRef.current;
      // 排斥
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const f = 400 / d2;
          const fx = (dx / Math.sqrt(d2)) * f;
          const fy = (dy / Math.sqrt(d2)) * f;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }
      // 吸引
      for (const e of edges) {
        const a = nodes[e.a];
        const b = nodes[e.b];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const f = (d - 80) * 0.005;
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
      // 中心引力
      for (const n of nodes) {
        n.vx += (400 - n.x) * 0.001;
        n.vy += (300 - n.y) * 0.001;
      }
      for (let i = 0; i < nodes.length; i++) {
        if (i === drag) continue;
        const n = nodes[i];
        n.vx *= 0.85; n.vy *= 0.85;
        n.x += n.vx; n.y += n.vy;
      }
      draw();
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  function handleClick(e: React.MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { nodes } = stateRef.current;
    for (const n of nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < 8) {
        openTab(n.path);
        return;
      }
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-white">
      <div className="h-10 flex items-center px-4 border-b border-ink-200 text-sm">
        <span className="font-medium">🌐 知识图谱</span>
        <span className="ml-3 text-ink-500 text-xs">
          {stateRef.current.nodes.length} 个节点 · {stateRef.current.edges.length} 条链接
        </span>
        {applied && (
          <div className="ml-auto flex items-center gap-2 text-xs">
            {applied.meta.dirs.map((d) => (
              <span key={d.id} className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: d.color }}></span>
                {d.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 relative">
        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-pointer"
          onClick={handleClick}
        />
      </div>
    </div>
  );
}
