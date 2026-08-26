import { useEffect, useRef, useState, useMemo } from 'react';
import { useKBStore } from '../stores/kb-store';
import { useLayoutStore } from '../stores/layout-store';
import { PageHeader } from '../components/PageHeader';
import { Icon } from '../components/Icon';
import type { NoteContent } from '@shared/types';

interface GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  path: string;
  name: string;
  dir: string;        // 所在直接父目录（保留用于内部用途）
  topDir: string;     // 顶级（一级）目录名：仅 path 首段，用于右侧目录筛选/隐藏
  color: string;
  outlinkCount: number;
  inlinkCount: number;
}

interface GraphEdge {
  a: number;
  b: number;
}

interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export function GraphPage() {
  const { activeKb, applied } = useKBStore();
  const { openTab, setMainView } = useLayoutStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 图谱数据
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const noteCacheRef = useRef<Map<string, NoteContent>>(new Map());
  const dragNodeRef = useRef<number | null>(null);
  const panRef = useRef<{ active: boolean; startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const mouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hoverNodeRef = useRef<number | null>(null);
  const clickStartRef = useRef<{ t: number; x: number; y: number; nodeIdx: number | null } | null>(null);

  // 视图变换（缩放/平移）
  const viewRef = useRef<ViewState>({ zoom: 1, panX: 0, panY: 0 });

  // UI 状态
  const [panelTab, setPanelTab] = useState<'info' | 'dirs'>('dirs');
  const [selectedNodeIdx, setSelectedNodeIdx] = useState<number | null>(null);
  const [selectedNote, setSelectedNote] = useState<NoteContent | null>(null);
  const [hiddenDirs, setHiddenDirs] = useState<Set<string>>(new Set());
  // hiddenDirs 同时存一份 ref：RAF draw() 在闭包外持续运行，依赖闭包内的 hiddenDirs 会拿到旧值
  // 这里用 ref 让 draw() 始终读到最新的隐藏集合（避免"勾选后画布不更新"的问题）
  const hiddenDirsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    hiddenDirsRef.current = hiddenDirs;
  }, [hiddenDirs]);
  // 图谱数据存在 ref 中（RAF 绘制直接读 ref），但 ref 赋值不会触发 React 重渲染，
  // 因此用 graphVersion 在数据加载完成后 +1 来驱动依赖它的 UI（目录列表等）刷新。
  const [graphVersion, setGraphVersion] = useState(0);

  // 加载图谱数据
  useEffect(() => {
    if (!activeKb) return;
    (async () => {
      const tree = await window.forge.fs.listTree(activeKb.id);
      const colorMap = new Map<string, string>();
      if (applied) {
        for (const d of applied.meta.dirs) {
          colorMap.set(d.name, d.color);
        }
      }

      const allFiles: { path: string; name: string; dir: string; color: string }[] = [];
      function walk(n: any, dirName = '', inheritedColor = '') {
        if (n.kind === 'file') {
          // 跳过隐藏笔记（以点开头，如 .AI_CONFIG.md / .README.md，仅供模板设置与 AI 内部使用）
          if (n.name.startsWith('.')) return;
          // 颜色优先级：文件自身 > 当前目录 templateColor > colorMap > 兜底灰
          let color = inheritedColor || colorMap.get(dirName) || '#a8a29e';
          const parts = n.path.split('/');
          if (parts.length > 1) {
            const fallbackDir = parts[parts.length - 2];
            color = color || colorMap.get(fallbackDir) || '#a8a29e';
          }
          allFiles.push({
            path: n.path,
            name: n.name.replace(/\.md$/i, ''),
            dir: dirName || (parts.length > 1 ? parts[parts.length - 2] : ''),
            color
          });
        } else if (n.children) {
          // 目录节点的 templateColor 由 kb-service 在 buildTree 时填入
          const nodeColor = n.templateColor || colorMap.get(n.name) || inheritedColor;
          n.children.forEach((c: any) => walk(c, n.name, nodeColor));
        }
      }
      walk(tree);

      // 读取所有笔记内容（含 outlinks/inlinks）
      const outMap = new Map<string, string[]>();
      const inMap = new Map<string, string[]>();
      const cache = new Map<string, NoteContent>();
      for (const f of allFiles) {
        const c = await window.forge.fs.readNote(activeKb.id, f.path);
        cache.set(f.path, c);
        outMap.set(f.path, c.outlinks);
        // 统计入链
        for (const o of c.outlinks) {
          // 通过 name 反查 path
        }
      }
      // 反向索引：name -> path
      const nameToPath = new Map<string, string>();
      for (const f of allFiles) nameToPath.set(f.name, f.path);
      // 统计每个节点的出/入链数
      for (const f of allFiles) {
        const inlinks = (outMap.get(f.path) || []).map(() => 0);
        inMap.set(f.path, []);
      }
      for (const f of allFiles) {
        const outs = outMap.get(f.path) || [];
        for (const o of outs) {
          const target = nameToPath.get(o);
          if (target) {
            const arr = inMap.get(target) || [];
            arr.push(f.path as any);
            inMap.set(target, arr);
          }
        }
      }

      const nodes: GraphNode[] = allFiles.map((f, i) => ({
        x: 0, y: 0,
        vx: 0, vy: 0,
        path: f.path,
        name: f.name,
        dir: f.dir,
        // 顶级目录：仅保留路径的第一段（一级目录）。用于右侧目录筛选与隐藏判断。
        topDir: f.path.includes('/') ? f.path.split('/')[0] : '',
        color: f.color,
        outlinkCount: (outMap.get(f.path) || []).length,
        inlinkCount: (inMap.get(f.path) || []).length
      }));
      // 初始位置：随机分布
      nodes.forEach((n, i) => {
        const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
        n.x = Math.cos(angle) * 200 + (Math.random() - 0.5) * 50;
        n.y = Math.sin(angle) * 200 + (Math.random() - 0.5) * 50;
      });

      const nameToIdx = new Map<string, number>();
      allFiles.forEach((f, i) => nameToIdx.set(f.name, i));
      const edges: GraphEdge[] = [];
      for (let i = 0; i < allFiles.length; i++) {
        const outs = outMap.get(allFiles[i].path) || [];
        for (const o of outs) {
          const j = nameToIdx.get(o);
          if (j !== undefined) edges.push({ a: i, b: j });
        }
      }
      nodesRef.current = nodes;
      edgesRef.current = edges;
      noteCacheRef.current = cache;
      setSelectedNodeIdx(null);
      setSelectedNote(null);
      viewRef.current = { zoom: 1, panX: 0, panY: 0 };
      setGraphVersion((v) => v + 1); // 触发目录列表等 UI 刷新
    })();
  }, [activeKb?.id, applied?.appliedAt]);

  // 力导向模拟 + 绘制
  useEffect(() => {
    let raf = 0;
    function step() {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const drag = dragNodeRef.current;
      // 排斥
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const f = 600 / d2;
          const fx = (dx / Math.sqrt(d2)) * f;
          const fy = (dy / Math.sqrt(d2)) * f;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }
      // 吸引
      for (const e of edges) {
        const a = nodes[e.a], b = nodes[e.b];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const f = (d - 100) * 0.005;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      // 中心引力
      for (const n of nodes) {
        n.vx += (0 - n.x) * 0.001;
        n.vy += (0 - n.y) * 0.001;
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

  function draw() {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { zoom, panX, panY } = viewRef.current;
    const cx = w / 2 + panX;
    const cy = h / 2 + panY;
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);

    // 边
    ctx.strokeStyle = '#d6d3d1';
    ctx.lineWidth = 0.6 / zoom;
    for (const e of edgesRef.current) {
      const a = nodesRef.current[e.a];
      const b = nodesRef.current[e.b];
      if (!a || !b) continue;
      // 隐藏端点的边跳过：按一级目录隐藏（一级隐藏则其下所有节点也隐藏）
      if (hiddenDirsRef.current.has(a.topDir) || hiddenDirsRef.current.has(b.topDir)) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // 节点
    const hoverIdx = hoverNodeRef.current;
    const selectIdx = selectedNodeIdx;
    for (let i = 0; i < nodesRef.current.length; i++) {
      const n = nodesRef.current[i];
      if (hiddenDirsRef.current.has(n.topDir)) continue;
      ctx.fillStyle = n.color;
      ctx.strokeStyle = i === hoverIdx || i === selectIdx ? '#0f172a' : '#ffffff';
      ctx.lineWidth = (i === hoverIdx || i === selectIdx ? 2 : 1.5) / zoom;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // 显示节点名称（小字）
      const isHighlight = i === hoverIdx || i === selectIdx;
      ctx.fillStyle = isHighlight ? '#0f172a' : '#475569';
      ctx.font = `${isHighlight ? 12 : 11}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(n.name, n.x, n.y + 8);
    }
  }

  // 坐标变换：屏幕 -> 世界
  function screenToWorld(sx: number, sy: number) {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const w = container.clientWidth;
    const h = container.clientHeight;
    const { zoom, panX, panY } = viewRef.current;
    return { x: (sx - w / 2 - panX) / zoom, y: (sy - h / 2 - panY) / zoom };
  }

  function findNodeAt(wx: number, wy: number, threshold = 10): number | null {
    const nodes = nodesRef.current;
    let best = -1;
    let bestDist = threshold;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (hiddenDirsRef.current.has(n.topDir)) continue;
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best >= 0 ? best : null;
  }

  // 鼠标交互
  function handleMouseDown(e: React.MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    const idx = findNodeAt(wx, wy);
    if (idx !== null) {
      dragNodeRef.current = idx;
      clickStartRef.current = { t: Date.now(), x: sx, y: sy, nodeIdx: idx };
    } else {
      // 空白区域：开始平移
      panRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        startPanX: viewRef.current.panX,
        startPanY: viewRef.current.panY
      };
      clickStartRef.current = null;
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    mouseRef.current = { x: sx, y: sy };
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    hoverNodeRef.current = findNodeAt(wx, wy);
    if (dragNodeRef.current !== null) {
      nodesRef.current[dragNodeRef.current].x = wx;
      nodesRef.current[dragNodeRef.current].y = wy;
      nodesRef.current[dragNodeRef.current].vx = 0;
      nodesRef.current[dragNodeRef.current].vy = 0;
    } else if (panRef.current?.active) {
      viewRef.current.panX = panRef.current.startPanX + (e.clientX - panRef.current.startX);
      viewRef.current.panY = panRef.current.startPanY + (e.clientY - panRef.current.startY);
    }
  }

  function handleMouseUp(e: React.MouseEvent) {
    const drag = dragNodeRef.current;
    const pan = panRef.current;
    dragNodeRef.current = null;
    panRef.current = null;
    if (clickStartRef.current && drag !== null) {
      const dt = Date.now() - clickStartRef.current.t;
      const dx = e.clientX - (rectX(clickStartRef.current.x));
      const dy = e.clientY - (rectY(clickStartRef.current.y));
      const dist = Math.hypot(dx, dy);
      // 区分单击/双击
      if (dist < 5) {
        // 单击选中
        setSelectedNodeIdx(drag);
        const node = nodesRef.current[drag];
        const note = noteCacheRef.current.get(node.path);
        setSelectedNote(note || null);
        setPanelTab('info');
      }
    }
  }

  // 辅助：把相对 rect 的坐标转回 client
  function rectX(sx: number) {
    return canvasRef.current!.getBoundingClientRect().left + sx;
  }
  function rectY(sy: number) {
    return canvasRef.current!.getBoundingClientRect().top + sy;
  }

  function handleDoubleClick(e: React.MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    const idx = findNodeAt(wx, wy);
    if (idx !== null) {
      const node = nodesRef.current[idx];
      setMainView('note');
      openTab(node.path);
    }
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const container = containerRef.current!;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const { zoom, panX, panY } = viewRef.current;
    // 计算缩放前的世界坐标
    const wxBefore = (sx - w / 2 - panX) / zoom;
    const wyBefore = (sy - h / 2 - panY) / zoom;
    // 新缩放
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newZoom = Math.min(4, Math.max(0.2, zoom * factor));
    viewRef.current.zoom = newZoom;
    // 调整 pan 使鼠标处的世界坐标保持不变
    viewRef.current.panX = sx - w / 2 - wxBefore * newZoom;
    viewRef.current.panY = sy - h / 2 - wyBefore * newZoom;
  }

  // 目录列表（去重，按一级目录聚合）。依赖 graphVersion（而非 nodesRef.current.length），
  // 因为 nodesRef 是 ref，赋值不会触发重渲染，必须用 graphVersion 驱动刷新。
  const dirs = useMemo(() => {
    const map = new Map<string, { name: string; color: string; count: number }>();
    for (const n of nodesRef.current) {
      // 仅按顶级目录聚合（一级目录 = path 首段），隐藏一级目录会同时隐藏其下所有嵌套节点
      if (!n.topDir) continue;
      const e = map.get(n.topDir) || { name: n.topDir, color: n.color, count: 0 };
      e.count++;
      map.set(n.topDir, e);
    }
    return Array.from(map.entries()).map(([k, v]) => ({ key: k, ...v }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphVersion]);

  const visibleNodeCount = nodesRef.current.filter(n => !hiddenDirs.has(n.topDir)).length;
  const visibleEdgeCount = edgesRef.current.filter(e => {
    const a = nodesRef.current[e.a];
    const b = nodesRef.current[e.b];
    return a && b && !hiddenDirs.has(a.topDir) && !hiddenDirs.has(b.topDir);
  }).length;

  function toggleDir(dir: string) {
    setHiddenDirs(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  }

  return (
    <div className="flex-1 flex flex-col bg-content overflow-hidden">
      <PageHeader icon="share" title="知识图谱">
        <span className="text-fg-muted text-xs">
          {visibleNodeCount} 个节点 · {visibleEdgeCount} 条链接 · 共 {nodesRef.current.length} 节点
        </span>
      </PageHeader>
      <div className="flex-1 flex pt-14 overflow-hidden">
        {/* 图谱画布 */}
        <div ref={containerRef} className="flex-1 relative bg-canvas">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ cursor: dragNodeRef.current !== null ? 'grabbing' : hoverNodeRef.current !== null ? 'pointer' : 'grab' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { dragNodeRef.current = null; panRef.current = null; }}
            onDoubleClick={handleDoubleClick}
            onWheel={handleWheel}
          />
          {/* 缩放控制 */}
          <div className="absolute right-4 bottom-4 flex flex-col gap-1 bg-content border border-border rounded-md shadow p-1 z-10">
            <button
              className="w-7 h-7 flex items-center justify-center text-fg-secondary hover:bg-hover-bg rounded"
              onClick={() => {
                viewRef.current.zoom = Math.min(4, viewRef.current.zoom * 1.2);
              }}
              title="放大"
            >+</button>
            <button
              className="w-7 h-7 flex items-center justify-center text-fg-secondary hover:bg-hover-bg rounded text-xs"
              onClick={() => { viewRef.current.zoom = 1; viewRef.current.panX = 0; viewRef.current.panY = 0; }}
              title="重置视图"
            >⊙</button>
            <button
              className="w-7 h-7 flex items-center justify-center text-fg-secondary hover:bg-hover-bg rounded"
              onClick={() => {
                viewRef.current.zoom = Math.max(0.2, viewRef.current.zoom / 1.2);
              }}
              title="缩小"
            >−</button>
          </div>
          {/* 操作提示 */}
          <div className="absolute left-4 bottom-4 text-xs text-fg-faint bg-content/80 px-2 py-1 rounded z-10">
            滚轮缩放 · 拖动空白平移 · 单击查看 · 双击打开
          </div>
        </div>

        {/* 右侧侧栏 */}
        <aside className="w-72 shrink-0 border-l border-border bg-panel flex flex-col">
          {/* 顶部 tab */}
          <div
            className="h-14 flex items-center gap-2 px-3 border-b border-border bg-toolbar shrink-0"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            onDoubleClick={() => window.forge?.win?.maximizeToggle().catch(() => {})}
          >
            <div
              className="flex-1 flex items-center justify-center h-8 bg-panel rounded-md p-0.5 border border-border-soft"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <button
                onClick={() => setPanelTab('dirs')}
                className={`h-7 px-3 rounded text-[12px] transition-colors ${panelTab === 'dirs' ? 'bg-content text-fg shadow-sm' : 'text-fg-muted hover:text-fg-secondary'}`}
              >
                目录
              </button>
              <button
                onClick={() => setPanelTab('info')}
                className={`h-7 px-3 rounded text-[12px] transition-colors ${panelTab === 'info' ? 'bg-content text-fg shadow-sm' : 'text-fg-muted hover:text-fg-secondary'}`}
              >
                基本信息
              </button>
            </div>
          </div>
          {/* 内容 */}
          <div className="flex-1 overflow-y-auto">
            {panelTab === 'dirs' && (
              <div className="p-3 space-y-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-fg-secondary">知识库目录</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setHiddenDirs(new Set())}
                      className="text-[11px] text-fg-faint hover:text-fg-secondary"
                      title="全部显示"
                    >
                      全部
                    </button>
                    <span className="text-fg-faint text-[11px]">·</span>
                    <button
                      onClick={() => setHiddenDirs(new Set(dirs.map(d => d.key)))}
                      className="text-[11px] text-fg-faint hover:text-fg-secondary"
                      title="全部隐藏"
                    >
                      隐藏
                    </button>
                  </div>
                </div>
                {dirs.map(d => {
                  const hidden = hiddenDirs.has(d.key);
                  return (
                    <button
                      key={d.key}
                      onClick={() => toggleDir(d.key)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-hover-bg ${hidden ? 'opacity-40' : ''}`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0"
                        style={{ background: hidden ? 'transparent' : d.color, borderColor: hidden ? d.color : 'transparent' }}
                      >
                        {!hidden && <span className="text-white text-[10px] leading-none">✓</span>}
                      </span>
                      <span className="flex-1 text-sm text-fg">{d.name}</span>
                      <span className="text-[11px] text-fg-faint">{d.count}</span>
                    </button>
                  );
                })}
                {dirs.length === 0 && (
                  <div className="text-xs text-fg-faint text-center py-4">暂无目录</div>
                )}
              </div>
            )}
            {panelTab === 'info' && (
              <div className="p-3 text-fg-secondary text-sm">
                {!selectedNote && (
                  <div className="text-center py-8 text-fg-faint text-xs">
                    <Icon name="cursor-arrow-click" className="w-6 h-6 mx-auto mb-2 opacity-40" />
                    单击图谱节点查看基本信息
                  </div>
                )}
                {selectedNote && (
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-fg-faint mb-1">笔记名称</div>
                      <div className="text-fg font-medium">{selectedNote.path.replace(/^.*\//, '').replace(/\.md$/i, '')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-fg-faint mb-1">路径</div>
                      <div className="text-fg text-xs break-all font-mono">{selectedNote.path}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-xs text-fg-faint mb-1">创建时间</div>
                        <div className="text-fg text-xs">{formatTime(selectedNote.ctime)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-fg-faint mb-1">更新时间</div>
                        <div className="text-fg text-xs">{formatTime(selectedNote.mtime)}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-xs text-fg-faint mb-1">出链</div>
                        <div className="text-fg text-xs">{selectedNote.outlinks.length}</div>
                      </div>
                      <div>
                        <div className="text-xs text-fg-faint mb-1">入链</div>
                        <div className="text-fg text-xs">{selectedNote.inlinks.length}</div>
                      </div>
                    </div>
                    {selectedNote.outlinks.length > 0 && (
                      <div>
                        <div className="text-xs text-fg-faint mb-1">出链列表</div>
                        <div className="flex flex-wrap gap-1">
                          {selectedNote.outlinks.map((l, i) => (
                            <span key={i} className="text-xs bg-hover-bg px-1.5 py-0.5 rounded">{l}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedNote.inlinks.length > 0 && (
                      <div>
                        <div className="text-xs text-fg-faint mb-1">入链列表</div>
                        <div className="flex flex-wrap gap-1">
                          {selectedNote.inlinks.map((l, i) => (
                            <span key={i} className="text-xs bg-hover-bg px-1.5 py-0.5 rounded">{l}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setMainView('note');
                        openTab(selectedNote.path);
                      }}
                      className="w-full h-8 rounded bg-brand text-brand-fg text-sm font-medium hover:bg-brand-hover mt-2"
                    >
                      打开笔记
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}