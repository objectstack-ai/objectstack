---
'@object-ui/plugin-dashboard': patch
---

fix(plugin-dashboard): drill-down and auto-derived table columns head each column with the field's own label and leave out hidden fields

Clause-②: no
Metadata-protocol: none

A dashboard drill-down drawer that names no columns derives them from the object. Its headers used to fall back to the humanized field key, so a field whose label was written only on the field (no translation bundle entry) showed an English, key-made header, and fields the object declares `hidden: true` were listed as columns. Headers now resolve as list views resolve them: a translation bundle entry first, then the field's declared `label` (an inline locale map is picked in the UI language), then the humanized key. Auto-derived columns skip `hidden: true` fields. An explicit `columns` list is never filtered, and a header written on a column still wins; a column listed only by its key, as a string or as a drill column, falls back to the field's label the same way an auto-derived one does.
