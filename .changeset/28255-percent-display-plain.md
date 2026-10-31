---
'@object-ui/fields': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-detail': patch
'@object-ui/plugin-list': patch
'@objectstack/spec': patch
---

feat(console): a percent field with `percentDisplay: 'plain'` shows the percentage with no progress bar

Clause-②: no
Metadata-protocol: none

`FieldSchema.percentDisplay` (`bar` or `plain`) was declared ahead of its renderer, so every percent field still drew a progress bar, including rates and probabilities such as an opportunity's win probability. The Console now reads it:

- **The percent cell.** `PercentCellRenderer` in `@object-ui/fields` prints the formatted percentage alone when the field says `percentDisplay: 'plain'`. An absent key or `bar` keeps the bar beside the number, as before. The number itself is unchanged: same storage reading (`max`), same decimal places (`scale`), same locale.
- **Every read-only host.** The list grid, the record page's fields and header chips, the quick-look panel, related lists and gallery cards all draw that one cell. Each builds the cell's field metadata key by key, so each now copies `percentDisplay` beside `useGrouping`: the grid's three configured-column paths, the detail enrichment key list (record page fields and header chips), the quick-look panel, the related list and the gallery card.
- **The field form.** The field designer offers a `percentDisplay` select (Bar / Plain) on `percent` fields. Left untouched it writes nothing, and the field keeps the bar.
- **The contract.** `percentDisplay`'s describe no longer says the Studio UI does not read it, and its liveness row is `live`, naming those relay sites.

Nothing to migrate: a field that already says `plain` now shows it.
