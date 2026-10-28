---
'@object-ui/plugin-grid': patch
---

refactor(plugin-grid): `ObjectGrid`'s row load moves into a sibling hook

Clause-②: no
Metadata-protocol: none

The row load of the `ObjectGrid` component moves verbatim out of `ObjectGrid.tsx` into `useObjectGridRowLoad` (`objectGridRowLoad.ts`): the data-invalidation nonce, the one async load effect, the host `findParams` reset of "select all matching" and the page-1 reset on a query change. `toOrderByClause`, whose only caller is the load effect, moves with it. `ObjectGrid` calls the hook where the block stood, so its hook order, its queries and its rendered output do not change. No name is renamed, and the package entry is unchanged.

What to do: nothing.
