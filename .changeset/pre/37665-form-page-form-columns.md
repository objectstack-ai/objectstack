---
'@object-ui/plugin-form': patch
'@object-ui/console': patch
---

fix(console): a named or public form lays its sections out by the form view's own `columns`, as its Setup preview does

Clause-②: no
Metadata-protocol: none

- A form view's `columns` (the form body's column count) was drawn by the Setup preview and ignored by the published form: `/forms/:name` and `/f/:slug` read only each section's `columns`, defaulting to two. A form saved with `columns: 3` and undeclared sections previewed three across and published two across; a form with `columns: 1` and a `columns: 2` section previewed one column and published two.
- The form page now resolves each section's fields per row through `@object-ui/plugin-form`'s `sectionedGridLayout`, the rule the Setup canvas, the record dialog and the record form already share: the form view's `columns` is the grid width and caps a section's count, and a section that declares none takes the form's count. A form view without `columns` draws exactly as before.
- `@object-ui/plugin-form`: `sectionedGridLayout` and its `SectionedGridLayout` type are exported from the package root and from `/core`, and the layout gains `sectionColumns(declared)`, the count one section draws, for a host that draws each section on a grid of its own.
