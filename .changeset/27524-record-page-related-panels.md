---
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

feat(plugin-detail)!: the record page's related panels lose collapse — the header opens the whole list, ⠿ ＋ ⋯ on hover, ⋯ holds Hide alone, empty panels fold into one line, and the stored arrangement drops `collapsed`

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (type-surface-only @object-ui/plugin-detail#RelatedArrangement.collapsed, @object-ui/plugin-detail#ResolvedRelatedArrangement.collapsed, @object-ui/plugin-detail#RelatedArrangementEdit) the narrowed members are a reader's per-browser layout preference and its edit vocabulary in a published ui package; no packages/spec schema, no metadata key, no registered node type and no sys_metadata shape names them, so there is nothing for `objectstack migrate meta` to rewrite. The stored preference moves to version 2 and a version-1 record reads as no choice. -->

The record page's related column is a stack of same-shaped panels (record page v4).

- **The panel header** is the title, then the count chip. The header row (or the chip) opens the panel's whole list; on hover the title's end shows › and its tooltip reads "View all N". On hover or focus the right end shows ⠿ (drag to reorder; focused, ⌥↑ / ⌥↓ move the panel), ＋ and ⋯, which now holds Hide and nothing else. There is no collapse and no ⤢, and nothing is reserved on the left.
- **Empty panels** (0 rows) fold into one line after the others: "N more empty lists · name · … · Expand". Expand draws them again in their places. The Related tab of an authored page keeps its own line.
- **The compact row's first column** skips the foreign key that points back at the record on the page: a product's line items, whose name field is the product, are named by their next column.
- **The stored arrangement** (`record.related.arrangement`, per reader × object) is `{ v, order, hidden, basedOn, seen }`. `collapsed` is removed with no compatibility read: a reader's earlier record reads as no choice, and the panels show in the default order.

**BREAKING** for a TypeScript consumer of `@object-ui/plugin-detail`'s arrangement API; nothing an author declares changes.

- FROM `RelatedArrangement.collapsed` / `ResolvedRelatedArrangement.collapsed` TO nothing: a panel has no collapsed state. Drop the member from any value you build.
- FROM the `{ kind: 'collapse', id, collapsed }` edit TO `{ kind: 'hide', id }`, or no edit at all.
- FROM `resolveRelatedArrangement(order, stored, now, defaultCollapsed)` / `editRelatedArrangement(order, stored, edit, now, defaultCollapsed)` TO the same calls without the last argument.
- The i18n keys `detail.relatedCardMoveUp`, `detail.relatedCardMoveDown`, `detail.relatedCardCollapse` and `detail.relatedCardCount` leave every pack; `detail.relatedPanelViewAll`, `detail.relatedPanelReorder`, `detail.relatedPanelReorderHint` and `detail.relatedEmptyFold` arrive in all ten.
