# Markdown 笔记重构方案（实现版）

> 本文档同步更新至当前实现状态。核心原则：**笔记文件（Front Matter）是唯一真源，SQLite 仅作为检索加速副本，在笔记变动后自动从 Front Matter 重新派生。**

---

## 1. 设计目标

1. 摘要、标签等关键信息写入每篇笔记文件开头的 **Front Matter**，换电脑重新索引即可恢复，不依赖数据库。
2. 属性面板的「生成摘要 / 生成标签」**实时写入笔记文件 Front Matter**；SQLite 在笔记发生变动时自动从 Front Matter 重新提取并更新，不单独写库。
3. Front Matter 字段采用标准英文名 `title/summary/tags`，兼容中文回退名 `标题/概述/标签`，并保留未知扩展字段（如未来的 `source`）。
4. 标签统一以 YAML 数组存储，避免逗号/空格歧义。

---

## 2. Front Matter 标准

每篇笔记位于文件最前，用 `---` 包裹的 YAML：

```markdown
---
title: 笔记标题
summary: 一句话摘要，用于列表与检索预览
tags: [灵感, AI, 产品]
---

正文……
```

### 字段约定

| 标准字段 | 中文回退 | 类型 | 说明 |
| --- | --- | --- | --- |
| `title` | `标题` | string | 笔记标题；创建时由文件名填入 |
| `summary` | `概述` | string | 摘要；AI 生成或从正文提取，空则不写键 |
| `tags` | `标签` | string[] | 标签数组；AI 生成或手动维护，空则不写键 |
| （未来）`source` | — | string | 来源（如微信/网页/书籍）；当前未启用，写入时自动保留 |

### 约束

- `readFrontmatter` / `writeFrontmatter` 位于 `src/main/utils/markdown.ts`：
  - 读取时优先标准字段，回退到中文名；标签兼容数组与「逗号/空格分隔字符串」。
  - 写入时清理所有 `title/summary/tags` 相关旧键（中英），再按传入落地，避免中英并存。
  - **未传入的字段保持原值**：仅更新 `tags` 不会冲掉 `summary`/`title`，反之亦然。
  - 空字符串 `summary`、空数组 `tags` 不写键，保持 Front Matter 简洁。
  - 非上述键（如未来的 `source`）一律保留，支持平滑扩展。

### 创建笔记

`fs-service.createNote` 在落盘时用 `writeFrontmatter(content, { title })` 写入标准头；`summary`/`tags` 初始为空故不写键，得到：

```markdown
---
title: 笔记标题
---

# 笔记标题

正文……
```

---

## 3. 数据流（核心）

**原则：属性面板只更新到笔记文件，SQLite 在笔记变动后自动更新。**

```mermaid
flowchart TD
  A[属性面板: AI 生成摘要/标签] --> B[renderer: window.forge.fs.updateSummary / updateTags]
  B --> C[fs-service: 用 writeFrontmatter 改写文件 Front Matter]
  C --> D[fs-service: syncIndex(kbId, notePath)]
  D --> E[search-service.upsertNote(raw)]
  E --> F[从 Front Matter 重提 summary / tags]
  F --> G[upsertNoteMeta 写入 SQLite note_meta]
  H[编辑器保存正文 writeNote] --> C
```

### 3.1 写入路径（面板 → 文件）

- 「AI 生成摘要」：`runAction('summary')` → `window.forge.fs.updateSummary(kbId, path, summary)` → `fs-service.updateSummary` 用 `writeFrontmatter` 仅写 `summary` 键 → `atomicWrite` 落盘 → `syncIndex`。
- 「AI 生成标签」：`handleAiTags` → `actions.updateTags` → `fs-service.updateTags` 用 `writeFrontmatter` 仅写 `tags` 键 → 落盘 → `syncIndex`。
- 编辑器正文保存：`writeNote` 在用正文覆盖前，先用 `readFrontmatter` 取磁盘现有 Front Matter，再用 `writeFrontmatter` 把正文与旧 Front Matter 重新拼回，**编辑正文永不丢失摘要/标签**。

> 落盘后 `readNote` 返回的 `frontmatter` 即从文件头解析，属性面板通过 `forgenote:note-data` 事件刷新展示，所见即文件真实内容。

### 3.2 同步路径（文件变动 → SQLite）

`fs-service` 任何写入（含 `updateTags`/`updateSummary`/`writeNote`/`createNote`）都会调用 `syncIndex` → `search-service.upsertNote(kbId, path, raw, ...)`，其中 `raw` 是含 Front Matter 的完整文件。

`upsertNote` 内部：

```ts
const fm = readFrontmatter(content);          // content 含文件头
const summary = fm.summary ?? '';
const tags = fm.tags;
upsertNoteMeta(kbId, notePath, mtime, size, templateDirId, hash, summary, tags);
```

- `note_meta` 表新增 `summary TEXT` 与 `tags TEXT`（JSON 数组字符串）两列，作为**检索副本**。
- 即便正文内容 hash 未变（仅 Front Matter 的 summary/tags 变化），短路分支仍刷新这两列，保证 SQLite 与文件一致。
- 旧库启动时通过 `ALTER TABLE` 补列，向后兼容。

**结论**：SQLite 永远以文件 Front Matter 派生，不在生成摘要/标签时直接写库；换电脑迁移只需拷贝 `.md` 文件，重新索引即可重建全部摘要/标签检索。

---

## 4. 读路径（检索 / 展示）

| 场景 | 来源 | 实现 |
| --- | --- | --- |
| 属性面板显示摘要/标签 | 文件 Front Matter | `readNote` → `frontmatter`，renderer 仅展示此值 |
| 标签云 / 全部标签 | 文件 Front Matter（真源） | `fs-service.getAllTags` 遍历 `.md` 解析 `tags` 数组计数 |
| 按标签筛选笔记 | 文件 Front Matter | `fs-service.notesByTag` |
| 全文 / 语义检索 | SQLite `note_chunks` + `note_meta` | `search-service` 基于分块与 `summary/tags` 副本 |

---

## 5. 方案比对（原设计 vs 实现）

| 维度 | 原方案设想 | 当前实现 |
| --- | --- | --- |
| 摘要/标签存储 | Front Matter | ✅ 同 |
| 标签格式 | 文档曾写「逗号字符串」 | ⚠️ 已统一为 **YAML 数组** `[a, b]` |
| `source` 字段 | 模板写入 `source: note` 等 | ⚠️ 暂未实现；Front Matter 已保留扩展能力，后续启用即可 |
| SQLite 与文件关系 | 双向同步 | ✅ 文件为真源，SQLite 变动后自动派生 |
| AI 生成入口 | 单一 `analyzeNote` | 拆分为「生成摘要」「生成标签」两个独立动作，分别写文件 Front Matter |

---

## 6. 后续可扩展

1. **`source` 来源字段**：在 `writeFrontmatter` 已兼容保留，启用时只需在创建/编辑时填入 `source`，`upsertNote` 的 `readFrontmatter` 可一并提取同步到 `note_meta.source`。
2. **手动编辑摘要/标签**：属性面板目前支持 AI 生成后实时落盘；后续可开放手动输入，同样经 `updateSummary`/`updateTags` 写文件。
3. **批量回填**：对存量无 Front Matter 的旧笔记，提供一次性脚本用 `writeFrontmatter` 补标准头。
