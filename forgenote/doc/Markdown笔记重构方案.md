# Markdown 笔记重构方案（Front Matter 标准）

> 目标：把笔记的**来源、标签、摘要**统一收敛到文件头部的标准 Front Matter 块中，作为笔记属性的**唯一事实源**，并重做「标签 / 摘要」的读写、聚合、检索实现方式，使其与用户在编辑器/AI 工作流中实际书写的格式保持一致。

---

## 1. 现状与问题

当前实现已具备 Front Matter 基础能力：

- 解析：`parseFrontMatter(raw)` 基于 `gray-matter`，`readNote` 返回 `frontmatter: Record<string, unknown>`。
- 摘要：`updateSummary` 可写 `summary` 字段；`RightPanel` 从 `frontmatter.summary` 恢复展示。
- 标签：`updateTags` 可写 `tags`；`extractTags`（`utils/markdown.ts`）已能兼容「数组」与「逗号分隔字符串」两种写法。

但存在 **3 个关键不一致 / 缺口**：

| # | 问题 | 影响 |
|---|------|------|
| P1 | **标签格式需统一为 YAML 数组**：标准写法定为 `tags: [灵感, AI]`（YAML 数组）。当前 `updateTags` 写入已是数组格式，但存量笔记若按旧习惯写成逗号字符串 `tags: 灵感, AI`，`gray-matter` 会解析为整段字符串 `"灵感, AI"`（当 1 个标签），而 `getAllTags` / `listTags` / `notesByTag` 只认**数组**，导致这类笔记标签读不出来。 | 标签面板、按标签筛选、AI 标签建议对「逗号字符串写法」的存量笔记失效或产生「灵感, AI」假标签。 |
| P2 | **`source` 字段无统一读写入口**：仅在灵感页快捷模板里硬写 `source: inspiration`，没有 `updateSource` / 读取 / 聚合逻辑；`createNote` 新建笔记时不写任何 Front Matter。 | 来源维度（如「灵感 / 对话 / 网页 / 读书」）无法统计、无法筛选。 |
| P3 | **标签聚合逻辑绕开 `extractTags`**：`getAllTags` / `listTags` / `notesByTag` 直接 `Array.isArray(fm.tags)`，不兼容逗号字符串，也不复用正文 `#标签` 提取。 | 与 `extractTags` 行为漂移，读出的标签集合不一致。 |

---

## 2. 统一 Front Matter Schema（标准）

规定笔记头部标准块，**三个属性同级、顺序固定**：

```markdown
---
source: inspiration
tags: 灵感, AI
summary: 笔记摘要
---

正文……
```

### 字段语义

| 字段 | 类型（落盘） | 取值约定 | 必填 |
|------|------|---------|------|
| `source` | 单行字符串 | 来源类别枚举：`inspiration`(灵感) / `chat`(对话) / `web`(网页) / `book`(读书) / `meeting`(会议) / `note`(默认笔记) | 否（缺省 `note`） |
| `tags` | **YAML 数组**（兼容容错逗号字符串） | 中文/英文短标签，如 `[灵感, AI, 知识管理]` | 否 |
| `summary` | 单行字符串 | ≤ 250 字纯文本摘要 | 否 |

### 格式决策：tags 用「YAML 数组」作为标准格式

- **标准写法**：`tags: [灵感, AI]`（YAML 数组），机器可读、无歧义，也是当前 `updateTags` 的写入格式。
- **容错**：解析层（`parseTags` / `extractTags`）同时兼容「数组」与用户手写的「逗号分隔字符串」两种写法，保证存量笔记不丢标签；但**写入层统一序列化为 YAML 数组**，避免同一库里出现两种格式漂移。
- `summary` / `source` 始终为单行字符串，无歧义。

---

## 3. 标签 / 摘要实现方式重做

### 3.1 统一解析函数（单一真源）

新增 `utils/markdown.ts` 的 `parseTags(fm: Record<string, unknown>): string[]`，作为**所有标签读取的唯一入口**，替代各处的 `Array.isArray(fm.tags)` 内联判断：

```ts
export function parseTags(fm: Record<string, unknown> | undefined): string[] {
  if (!fm) return [];
  const raw = fm['tags'] ?? fm['标签'] ?? fm['Tag'] ?? fm['TAG'];
  const set = new Set<string>();
  if (Array.isArray(raw)) {
    raw.forEach((t) => typeof t === 'string' && t.trim() && set.add(t.trim()));
  } else if (typeof raw === 'string' && raw.trim()) {
    raw.split(/[\s,，、]+/).map((s) => s.trim()).filter(Boolean).forEach((t) => set.add(t));
  }
  return [...set].filter((t) => t.length <= 30);
}
```

> 注：`extractTags` 已含相同逻辑（含正文 `#标签`），可内部复用 `parseTags(fm)` 避免漂移。

### 3.2 标签写入：`updateTags` 统一逗号格式

```ts
async updateTags(kbId, notePath, tags: string[]): Promise<void> {
  const { content, data } = parseFrontMatter(raw);
  const norm = [...new Set(tags.map(String).trim().filter(Boolean))].slice(0, 12);
  const nextData = { ...data, tags: norm };   // 统一序列化为 YAML 数组 [灵感, AI]
  await atomicWrite(abs, matter.stringify(content, nextData));
  await syncIndex(kbId, notePath);
  eventBus.emit('fsChange', { type: 'change', path: notePath });
}
```

- 去重、去空、限长（≤ 12 个，单标签 ≤ 30 字）。
- **序列化结果为 `tags: 灵感, AI`**，与用户标准一致。

### 3.3 标签聚合：复用 `parseTags`

`getAllTags` / `listTags` / `notesByTag` 改为调用 `parseTags(data)`，不再内联 `Array.isArray`：

```ts
const list = parseTags(data);   // 同时兼容数组 / 逗号字符串
for (const t of list) counter.set(t, (counter.get(t) || 0) + 1);
```

### 3.4 来源 `source`：补齐读写入口

- `updateSource(kbId, notePath, source)`：与 `updateTags` 同构，写 `source` 字段（校验枚举，未知值原样存但归一为小写）。
- `getAllSources(kbId)`：遍历 frontmatter 聚合 `{ source, count }`，供「来源筛选」面板。
- `notesBySource(kbId, source)`：按来源返回笔记列表。
- `createNote`：新建笔记默认写入最小 Front Matter：

```markdown
---
source: note
tags:
summary:
---
# 标题

```

（空 tags/summary 保持字段存在，便于用户/AI 后续填充；也可按模板决定是否预填。）

### 3.5 摘要 `summary`：保持单一写入 + 读取

- `updateSummary` 现状 OK，保留（写 `summary` 字段）。
- `RightPanel` / `MultiNoteEditor` 已正确从 `frontmatter.summary` 恢复，无需改。
- 新增约定：**AI 摘要一键应用**写入 frontmatter 后，`syncIndex` 用 `summary` 作为该笔记的「概述向量候选」（可选：把 summary 也纳入 RAG 召回的轻量描述，提升「总结本周」场景首屏命中质量）。

---

## 4. 检索与索引联动

- **RAG 分块**：`chunkNote` 已在分块前剥离 Front Matter（避免 `source/tags/summary` 污染正文向量），保持现状。
- **标签/来源作为过滤维度**：`retrieve` 的 `templateDirIds` 过滤范式可外推为 `tagFilters` / `sourceFilters` 可选参数（未来增强），从 `parseTags` / `source` 读取，不改检索主链路。
- **时间窗口总结**：`recentChunks` / `listRecentPaths` 不受影响（按 mtime），标签/来源仅作展示与可按需筛选。

---

## 5. 兼容性迁移

存量笔记可能已存在两种格式：

1. **`tags: [灵感, AI]`（YAML 数组）** → 解析层 `parseTags` 已兼容，读出正常；**写入时自动归一成逗号字符串**（下次 `updateTags` 触发）。
2. **`tags: 灵感, AI`（逗号字符串）** → 解析层兼容，读出正常。
3. **无 Front Matter** → `createNote` 新笔记补最小块；存量无头笔记在首次 `updateTags`/`updateSummary` 时由 `matter.stringify` 自动加头。

无需一次性批量迁移脚本；读写统一后自然收敛。若需主动归一，可加 `normalizeAllFrontmatter(kbId)` 工具（遍历重写），作为可选维护命令。

---

## 6. 渲染层配套

| 位置 | 改动 |
|------|------|
| `RightPanel.tsx` | 标签编辑调用 `updateTags`（已逗号兼容）；新增「来源」下拉调用 `updateSource`；摘要保持。 |
| `MultiNoteEditor.tsx` | 同 RightPanel；`__forgeNoteActions` 暴露 `updateSource`。 |
| 属性面板 | 展示 `source` 枚举徽标、`tags` 芯片、`summary` 预览。 |
| 列表/树 | 支持按 `source` / `tags` 筛选（调用 `getAllSources` / `notesByTag`）。 |

---

## 7. 落地步骤（建议顺序）

1. `utils/markdown.ts`：新增 `parseTags(fm)`，让 `extractTags` 复用它。
2. `fs-service.ts`：
   - `updateTags` 改为逗号字符串序列化；
   - `getAllTags` / `listTags` / `notesByTag` 改用 `parseTags`；
   - 新增 `updateSource` / `getAllSources` / `notesBySource`；
   - `createNote` 写最小 Front Matter（含 `source: note`）。
3. `preload/index.ts` + `ipc-channels.ts`：补充 `FS_UPDATE_SOURCE` / `FS_ALL_SOURCES` / `FS_NOTES_BY_SOURCE` 通道。
4. 渲染层：`RightPanel` / `MultiNoteEditor` 接入来源编辑与展示；属性面板/列表接筛选。
5. （可选）`normalizeAllFrontmatter` 主动归一存量。

---

## 8. 标准样例（最终形态）

```markdown
---
source: inspiration
tags: [灵感, AI, 知识管理]
summary: 从用户与 AI 对话中沉淀的灵感：用 Front Matter 统一来源/标签/摘要，作为笔记属性唯一事实源。
---

# 标题

正文……
```

> 该方案在不破坏现有 RAG / 链接索引的前提下，把「标签、摘要、来源」三类属性的实现统一到标准 Front Matter，并解决数组/逗号字符串格式不一致导致的标签丢失问题。
