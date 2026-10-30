---
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

feat(plugin-detail)!: the record page's related panels lose collapse — the header opens the whole list, ⠿ ＋ ⋯ on hover, ⋯ holds Hide alone, empty panels fold into one line, and the stored arrangement drops `collapsed`

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-interface-only ui/packages/plugin-detail/src/synth/relatedArrangement.ts#RelatedArrangement, ui/packages/plugin-detail/src/synth/relatedArrangement.ts#ResolvedRelatedArrangement, ui/packages/plugin-detail/src/synth/relatedArrangement.ts#RelatedArrangementEdit) a reader's per-browser layout preference and its edit vocabulary: no Zod schema, no spec declaration and no stored metadata reads them, so the compiler is the channel that reaches every caller; the stored preference moves to version 2 and a version-1 record reads as no choice -->

The record page's related column is a stack of same-shaped panels (record page v4).

- **The panel header** is the title, then the count chip. The header row (or the chip) opens the panel's whole list; on hover the title's end shows › and its tooltip reads "View all N". On hover or focus the right end shows ⠿ (drag to reorder; focused, ⌥↑ / ⌥↓ move the panel), ＋ and ⋯, which now holds Hide and nothing else. There is no collapse and no ⤢, and nothing is reserved on the left.
- **Empty panels** (0 rows) fold into one line after the others: "N more empty lists · name · … · Expand". Expand draws them again in their places. The Related tab of an authored page keeps its own line.
- **The compact row's first column** skips the foreign key that points back at the record on the page: a product's line items, whose name field is the product, are named by their next column.
- **The stored arrangement** (`record.related.arrangement`, per reader × object) is `{ v, order, hidden, basedOn, seen }`. `collapsed` is removed with no compatibility read: a reader's earlier record reads as no choice, and the panels show in the default order.

**BREAKING** (`@object-ui/plugin-detail`, TypeScript only): `RelatedArrangement` and `ResolvedRelatedArrangement` no longer carry `collapsed`, `RelatedArrangementEdit` no longer has the `collapse` kind, and `resolveRelatedArrangement` / `editRelatedArrangement` no longer take a last `defaultCollapsed` argument. The only caller is the console's own arranged column. A caller still passing one gets a compile error naming it; the fix is to drop it, since a panel has no collapsed state to set. `RELATED_ARRANGEMENT_RECORD_VERSION` (2) is new.

- The i18n keys `detail.relatedCardMoveUp`, `detail.relatedCardMoveDown`, `detail.relatedCardCollapse` and `detail.relatedCardCount` leave every pack; `detail.relatedPanelViewAll`, `detail.relatedPanelReorder`, `detail.relatedPanelReorderHint` and `detail.relatedEmptyFold` arrive in all ten.
