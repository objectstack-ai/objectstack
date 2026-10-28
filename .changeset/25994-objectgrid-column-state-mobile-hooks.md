---
'@object-ui/plugin-grid': patch
---

refactor(plugin-grid): `ObjectGrid`'s row-height sync, column state and mobile affordances move into three sibling hooks

Clause-②: no
Metadata-protocol: none

Three adjacent blocks at the top of the `ObjectGrid` component move verbatim out of `ObjectGrid.tsx`. The effect that follows a changed `schema.rowHeight` goes to `useObjectGridRowHeightSync` (`objectGridRowHeight.ts`). The column-state persistence (the storage key, the `columnState` seed, the sync of a host-supplied `columnState` and `saveColumnState`) goes to `useObjectGridColumnState` (`objectGridColumnState.ts`). Pull to refresh and the card-view breakpoint go to `useObjectGridMobile` (`objectGridMobile.ts`). `ObjectGrid` calls each hook where its block stood, so its hook order, its stored column state and its rendered output do not change. No name is renamed, and the package entry is unchanged.

What to do: nothing.
