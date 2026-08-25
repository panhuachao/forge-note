# 锦囊笔记客户端 UI 设计规范

> 适用范围：客户端（`src/renderer`）所有页面、面板、弹层、组件的新增与扩展。
> 目标：统一的卡片化、留白、柔和品牌色、一致圆角与选区语义，跨浅色/深色主题自动适配。
> 设计基调：浅底白卡 + 中性灰文本 + 单一品牌强调色（默认红，可在设置中切换）。不泛粉、不重黑、强调轻。

---

## 1. 设计 Token（基于 `index.css` 与 Tailwind 语义色）

所有颜色一律使用语义变量 / Tailwind 语义类，禁止硬编码 hex（主题切换依赖 `rgb` 形式变量）。

| 语义 | CSS 变量 | Tailwind 类 | 说明 |
| --- | --- | --- | --- |
| 画布底（最外层背景） | `--bg-canvas` | `bg-canvas` | 内容区之外的大底色 |
| 侧栏底 | `--bg-panel` | `bg-panel` | 左右侧栏，比画布略亮 |
| 内容卡片底 | `--bg-content` | `bg-content` | 中间正文、卡片、弹层 |
| 操作栏底 | `--bg-toolbar` | `bg-toolbar` | 顶部标题栏、工具条，近白 |
| 悬浮底 | `--bg-hover` | `bg-hover-bg` | hover / 选中浅底（中性 4%~8% 黑/白） |
| 选中底（强） | `--bg-active` | `bg-active-bg` | 强选中背景（谨慎使用） |
| 弱分割线 | `--border-soft` | `border-border-soft` | 卡片描边、轻分隔 |
| 强分割线 | `--border-strong` | `border-border-strong` | 输入框描边、较重分隔 |
| 主文本 | `--text-primary` | `text-fg` | 标题、正文 |
| 次文本 | `--text-secondary` | `text-fg-secondary` | 副标题、说明 |
| 弱化文本 | `--text-muted` | `text-fg-muted` | 图标、辅助信息 |
| 极弱文本 | `--text-faint` | `text-fg-faint` | 时间、计数、占位符 |
| 品牌色 | `--brand` | `bg-brand text-brand` | 强调、主按钮、选中强调 |
| 品牌悬浮 | `--brand-hover` | `bg-brand-hover` | 主按钮 hover |
| 品牌浅底 | `--brand-soft` | `bg-brand-soft` | 选中浅底、轻高亮 |
| 品牌前景 | `--brand-fg` | `text-brand-fg` | 品牌底上的文字（白） |

- 灰度全部为纯中性 `R=G=B`，避免 macOS 上泛粉。
- 品牌色可在「设置 → 主题色」切换（红/蓝/绿/紫/琥珀/青），切换后上述 `--brand*` 变量整体替换，组件无需改动。

---

## 2. 圆角（全局统一）

| 元素 | 圆角 |
| --- | --- |
| 大卡片、面板、弹层、气泡、标签项 | `rounded-xl` |
| 小按钮 / 图标按钮 / 徽章 / 菜单项 | `rounded-xl`（小尺寸也用 x，保持统一；特殊场景可用 `rounded-lg` 折中） |
| 旧代码 `rounded` / `rounded-md` | 统一改 `rounded-xl`（存量逐步清理） |
| 分段控制 / 胶囊 | `rounded-full` |

**原则**：一个产品内圆角只有「xl（默认）」与「full（胶囊）」两档，不要出现零碎的 `rounded-md / rounded-lg / rounded` 混用。

---

## 3. 间距与留白

- 卡片内边距：`p-3.5`（标准卡），小卡 `p-3`，弹层 `p-3`。
- 卡片间：`space-y-3`~`space-y-6`（分组区块用 `space-y-5/6`）。
- 内容区：`px-4 py-3`~`py-4`，沉浸式区域背景用 `bg-canvas`。
- 列表项竖距：`py-2`~`py-2.5`，横向 `gap-2`~`gap-3`。
- 顶部标题栏下方有 `border-b border-border-soft`，与内容区用 1px 弱线分隔。

---

## 4. 卡片（Card）规范

卡片是核心容器（首页知识库卡、属性面板卡片 `PanelCard`、标签视图笔记卡、对话历史项等）。

```css
/* 标准卡片 */
rounded-xl border border-border-soft bg-content
shadow-[0_1px_2px_rgba(17,24,39,0.04),0_4px_12px_rgba(17,24,39,0.05)]
hover:shadow-[0_4px_12px_rgba(17,24,39,0.08)]  /* 可选 */
overflow-hidden
```

要点：
- 默认极淡双层阴影，不要重阴影。
- 描边用 `border-border-soft`（浅），hover 可加深描边到 `border-brand/40` 或 `border-brand/50`。
- 不要纯靠背景色区分卡片（浅底产品上易糊），描边 + 阴影双保险。
- 选中卡：描边转品牌色 + 浅品牌底（`bg-brand-soft/30 ~ /50`）。

---

## 5. 组件类（直接用，禁止重新造）

`src/renderer/styles/index.css` 已定义，新增功能优先复用：

| 类 | 用途 | 关键样式 |
| --- | --- | --- |
| `.btn` | 按钮基础 | `px-3.5 py-1.5 rounded-xl text-sm font-medium` |
| `.btn-primary` | 主按钮 | `bg-brand text-brand-fg hover:bg-brand-hover shadow-sm` |
| `.btn-secondary` | 次按钮 | `bg-content text-fg-secondary border border-border-soft hover:bg-hover-bg` |
| `.btn-ghost` | 幽灵按钮 | `text-fg-secondary hover:bg-hover-bg`（无边框） |
| `.icon-btn` | 图标按钮 | `p-1.5 rounded-xl hover:bg-hover-bg text-fg-muted hover:text-fg`（**标题栏/工具条首选**） |
| `.input` | 输入框 | `rounded-xl border border-border bg-content focus:border-brand focus:ring-2 focus:ring-active-bg` |
| `.badge` / `.badge-brand` / `.badge-gray` | 徽章 | `rounded text-xs`，计数用浅灰底 `bg-hover-bg text-fg-faint` |

按钮文字大小统一 `text-xs`（工具条）/ `text-sm`（主操作）。

---

## 6. 选区 / 选中态语义（最关键的一致性规则）

**严禁使用深灰实底 + 白字作为选中态**（视觉过重、与轻量基调冲突）。统一改为「品牌浅底 + 品牌字 + 细品牌边 / 左侧品牌竖条」。

| 场景 | 选中样式 |
| --- | --- |
| 列表项 / 树节点 / 标签项 | `relative` + 左侧 `w-0.5 rounded-full bg-brand` 竖条 + `bg-brand-soft/40 text-fg`；hover（未选）`bg-hover-bg` |
| 分段控制 / 胶囊（问答/检索模式） | 选中：`bg-brand-soft text-brand border border-brand/20`；未选：`bg-content text-fg-secondary border border-border-soft hover:bg-hover-bg` |
| 标签页切换（属性面板 基本信息/大纲/对话） | 选中：`bg-brand-soft text-brand`；未选：`text-fg-muted hover:bg-hover-bg` |
| 笔记卡片 hover/active | `hover:border-brand/50 hover:bg-brand-soft/30 active:bg-brand-soft/50` |
| 下拉菜单项 | 选中：`text-brand bg-brand-soft/40`；hover：`bg-hover-bg` |
| 分页当前页 | `bg-brand-soft text-brand font-medium`（不要实色填充） |

图标选中时随文字变品牌色（Heroicons 默认 `currentColor`）。

---

## 7. 层级布局高度规范

| 区域 | 高度 |
| --- | --- |
| 顶部标题栏 / 视图切换栏（ViewTabs）/ 侧栏内快捷操作栏 | `h-12`（48px，三者必须对齐） |
| 状态栏 | `h-11`（44px） |
| 属性面板「对话上下文」信息条 | `h-9`（36px） |
| 菜单栏主轨（MainMenuRail） | `w-14`（56px） |

侧栏快捷操作栏（如 `FileTree` 顶部新建/排序栏）高度为 `h-12`，按钮 `h-10 w-10`，与中间 `TopBar` 高度严格一致。

---

## 8. 可拖拽分割线（侧栏宽度）

- 左栏 `LeftPanel`、右栏 `RightPanel` 宽度由 `useLayoutStore.rightPanelWidth / leftPanelWidth` 控制（持久化 localStorage）。
- 拖拽手柄：`absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-brand/30 z-10`，`onMouseDown` 触发 `setResizing(true)`。
- 拖拽中：全局监听 `mousemove`（按 `window.innerWidth - e.clientX` 计算右栏宽）、`mouseup` 结束；`document.body` 设 `cursor:col-resize` + `userSelect:none`。
- 宽度约束：左栏 `[200,400]`，右栏 `[220,480]`。

---

## 9. 对话 / 聊天类界面规范

适用于 `ChatPage`（全局问答）、`NoteAIChat`（围绕本篇笔记）、右侧属性面板 AI 聊天。

- **整体结构**：`flex flex-col h-full`（或固定可用高度），顶部信息条（如「对话上下文：xxx」）+ 中间消息区（滚动）+ 底部输入区（固定）。
- **中间消息区**：`flex-1 min-h-0 overflow-y-auto`，自适应剩余高度并内部滚动；不要撑高父容器。
- **输入区固定在底部**：始终 `border-t` 固定在卡片底部，不被消息量推走。
- **消息气泡**：
  - 用户：`bg-brand text-brand-fg whitespace-pre-wrap`，右对齐 `justify-end`。
  - AI：`bg-content border border-border-soft text-fg`，用 `markdown-preview chat-md` 渲染（支持代码块/列表/链接/表格）。
  - 操作入口（复制、添加到笔记）：`text-[11px] rounded-xl text-fg-muted hover:text-brand hover:bg-hover-bg`。
- **输入框**：`textarea` + `.input` 风格 + `max-h-28 resize-none`，placeholder 简洁（如「基于本篇笔记提问」）。
- **快捷键提示**：输入框下方 `text-[10px] text-fg-faint` 显示 `*Enter 发送 / Shift+Enter 换行`。
- **loading**：三点 `animate-bounce` 圆点（`bg-fg-faint`），放在 `bg-hover-bg rounded-2xl` 气泡内。
- **空状态**：品牌色圆角图标块（`w-14 h-14 rounded-2xl bg-brand-soft`）+ 标题 + 副标题 + 快捷键徽章，居中。

---

## 10. 空状态规范

所有空列表/空视图统一：

```
flex flex-col items-center justify-center text-center px-6
  w-10~14 h-10~14 rounded-xl/2xl bg-hover-bg / bg-brand-soft  图标居中
  主文案 text-sm text-fg-secondary
  副文案 text-xs text-fg-faint
  （可选）主操作按钮 .btn-primary
```

---

## 11. 弹层 / 下拉菜单规范

- 容器：`bg-content border border-border-soft rounded-xl shadow-lg`（用 `overflow-hidden` 让圆角裁切子项）。
- 菜单项：`block w-full text-left px-3 py-1.5 text-xs hover:bg-hover-bg`，选中项 `text-brand bg-brand-soft/40`。
- 出现方式：hover 触发用 `group-hover:block`；点击触发用状态 + `absolute z-30`。
- 定位：`absolute` + 偏移（如 `top-full mt-1` / `bottom-full mb-1`）。

---

## 12. 主题与明暗适配

- 所有颜色经语义变量映射，深色主题仅替换变量值（侧栏/内容/工具条底反转，hover/active 转白透明），组件代码不变。
- 新增组件**不要**写死颜色，一律走语义类；确需自定义阴影时用中性黑 `rgba(17,24,39,x)`。
- 中性灰严格 `R=G=B`，避免暖/冷偏色。

---

## 13. 新增功能 Checklist

实现新界面时逐条核对：

- [ ] 颜色全部走语义类（无硬编码 hex）
- [ ] 圆角统一 `rounded-xl`（胶囊 `rounded-full`），无 `rounded-md/rounded` 残留
- [ ] 选中态用品牌浅底+品牌字/竖条，无深灰实底白字
- [ ] 复用 `.btn` / `.icon-btn` / `.input` / `.badge`，不重复造按钮
- [ ] 卡片用 `border-border-soft` + 淡阴影，hover 描边转品牌
- [ ] 对齐高度：`h-12` 标题栏、`h-11` 状态栏
- [ ] 聊天/列表区：滚动区 `flex-1 min-h-0 overflow-y-auto`，输入区固定底部
- [ ] 空状态用图标圆角块 + 主/副文案模板
- [ ] 弹层 `rounded-xl shadow-lg overflow-hidden`，菜单项选中高亮
- [ ] 暗色主题下目测无泛色/对比丢失

---

## 附：常用片段速查

```tsx
// 图标按钮（标题栏/工具条）
<button className="icon-btn" title="返回"><Icon name="chevron-left" className="w-4 h-4" /></button>

// 列表选中项
<li className={`relative rounded-xl px-3 py-2.5 cursor-pointer ${active ? 'bg-brand-soft/40' : 'hover:bg-hover-bg'}`}>
  {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-brand" />}
  ...
</li>

// 标准卡片
<div className="rounded-xl border border-border-soft bg-content shadow-[0_1px_2px_rgba(17,24,39,0.04),0_4px_12px_rgba(17,24,39,0.05)] overflow-hidden">...</div>

// 聊天容器
<div className="flex-1 min-h-0 overflow-y-auto ...">消息</div>
<div className="border-t border-border-soft ...">固定输入区</div>

// 计数徽章
<span className="text-[10px] px-1.5 py-0.5 rounded-md bg-hover-bg text-fg-faint">{count}</span>
```
