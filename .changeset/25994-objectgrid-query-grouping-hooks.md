---
'@object-ui/plugin-grid': patch
---

refactor(plugin-grid): `ObjectGrid`'s query inputs and grouping decisions move into two sibling hooks

Clause-②: no
Metadata-protocol: none

Two adjacent blocks of the `ObjectGrid` component move verbatim out of `ObjectGrid.tsx`. The projection keys and the view's filter, sort, search and server-paging state go to `useObjectGridQueryInputs` (`objectGridQueryInputs.ts`). The masked grouping-key refusal, the server-grouping decision, the two grouping refusals, the fetch window and the held group row query go to `useObjectGridGroupingDecisions` (`objectGridGroupingDecisions.ts`). `ObjectGrid` calls each hook where its block stood, so its hook order, its queries, its warnings and its rendered output do not change. No name is renamed, and the package entry is unchanged.

What to do: nothing.
