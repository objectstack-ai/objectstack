---
"@objectstack/studio": patch
---

Studio: redesign the object page Airtable-style.

The object detail page (`/objects/:name`) previously stacked four
overlapping navigation strips on top of each other: sidebar, outer
route tabs (Designer/Views/Forms/...), the PluginHost mode strip
(Preview/Code/Data/History), and ObjectExplorer's own internal
tabs (Schema/Data/API) — plus a duplicated object header card.

This change collapses the redundancy:

- `ObjectExplorer` becomes a controlled component driven by the
  `mode` prop from PluginHost. Its internal tab strip is removed
  so the page only ever shows a single row of mode buttons.
- The duplicate "object meta" card inside `ObjectSchemaInspector`
  is removed; the route-level header is now the single source of
  identity (label + machine name + description).
- The route header itself is slimmed: the "Object" eyebrow and
  the redundant stat-badge row (fields / views / forms / hooks)
  are gone since the related-metadata tabs already convey the
  same counts.
- `object-plugin` declares modes as `['data', 'design', 'code']`
  and `PluginHost` lands on `data` by default for objects so the
  records grid is the first thing the user sees — matching
  Airtable's "data first" philosophy.
- Mode buttons get per-type labels via `MODE_LABEL_OVERRIDES`:
  for `object`, `data` reads "Records", `design` reads "Fields",
  `code` reads "API".
- A per-type `MODE_ALLOWLIST_BY_TYPE` filters out the generic
  `preview` fallback for objects so the strip is the curated
  `Records / Fields / API / History` and nothing more.
