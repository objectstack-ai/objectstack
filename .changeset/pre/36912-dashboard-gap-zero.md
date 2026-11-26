---
'@object-ui/plugin-dashboard': patch
---

fix(plugin-dashboard): a dashboard that declares `gap: 0` is drawn with no gap

Clause-②: no
Metadata-protocol: none

The dashboard renderer read the declared `gap` as `schema.gap || 4`, so a declared `gap: 0`, which the spec admits (`min(0)`), fell through to the default and widgets an author wanted flush were drawn 1rem apart. It now reads `schema.gap ?? 4`: only an absent `gap` takes the default of 4 (1rem), and a declared zero draws the grid with no gap. The design-mode resize handle, which measures a span from the same gap, uses the declared zero too.
