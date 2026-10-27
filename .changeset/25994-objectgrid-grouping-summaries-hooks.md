---
'@object-ui/plugin-grid': patch
---

refactor(plugin-grid): `ObjectGrid`'s grouping and column summaries move into two sibling hooks

Clause-②: no
Metadata-protocol: none

Two adjacent blocks of the `ObjectGrid` component move verbatim out of `ObjectGrid.tsx`. The grouping (the group value formatter, the date-family group faces, the server group headers and row pages, and the grouped data) goes to `useObjectGridGrouping` (`objectGridGrouping.ts`), together with `temporalGroupHeading`, which draws a date group's heading. The cross-page fan-out query, the resolved match total and the column summaries go to `useObjectGridSummaries` (`objectGridSummaries.ts`). `ObjectGrid` calls each hook where its block stood, so its hook order, its queries and its rendered output do not change. No name is renamed, and the package entry is unchanged.

What to do: nothing.
