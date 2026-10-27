---
'@object-ui/plugin-grid': patch
---

refactor(plugin-grid): `ObjectGrid`'s column generator, column post-processing and Actions column move into three sibling modules

Clause-②: no
Metadata-protocol: none

The last three blocks of the move-only split leave `ObjectGrid.tsx` verbatim. `generateColumns`, which turns the authored columns or the object's fields into column drafts, goes to the hook `useObjectGridGenerateColumns` (`objectGridGenerateColumns.tsx`). The column post-processing (field-type enrichment, the fold onto the declared column type, and the user's persisted widths and order) goes to `resolveObjectGridPersistedColumns` (`objectGridPersistedColumns.ts`). The Actions column and the pinned column sets go to `resolveObjectGridActionsColumn` (`objectGridActionsColumn.tsx`). `ObjectGrid` calls each where its block stood, so its hook order, its columns and its rendered output do not change. No name is renamed, and the package entry is unchanged.

What to do: nothing.
