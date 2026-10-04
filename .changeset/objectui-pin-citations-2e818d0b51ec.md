---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `2e818d0b51ec`.

Clause-②: no

Every anchor was mapped through the objectui diff `ab1879721595..2e818d0b51ec`. Every file a current anchor cites is byte-identical across the hop except four, and in those the cited text is byte-identical too:

- `plugin-dashboard/src/index.tsx`: objectui#11466 added lines above the `object-metric` registration, so the `object-metric` icon input record moves from `:269` to `:281`. It is still `{ name: 'icon', type: 'string' }`.
- `packages/types/src/objectql.ts`: objectui#11216 declared `grouping` on `ObjectKanbanSchema` below the cited `limit` member.
- `plugin-kanban.mdx`: objectui#11216 added a `grouping` row below the cited `limit` row.
- `SchemaRenderer.tsx`: objectui#11466 changed the type of `schema`. Its `properties.*` hoist and `createElement` spread are unchanged.

The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that reproduces the previous pin's numbers. objectui's 17.7.0 release removed 2726 consumed changesets, so the corpus is now 7579 tracked files. Every zero still reads zero.

No key, default, enum member or export moves.
