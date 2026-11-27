---
'@object-ui/plugin-detail': patch
'@object-ui/fields': patch
---

fix(ui): long-text fields on the record page read label-on-top across the whole column, and a rich-text body's headings draw one step smaller

Clause-②: no
Metadata-protocol: none

On the record page's field list every field drew its label in a 112 px column to the left of its value, so a long body (a `textarea`, `markdown`, `html` or `richtext` field, or a `file` / `image` field declared `multiple: true`) was set in what that column left over. Those fields, the same set the detail layout already spans across a full row, now draw the label above the value and give the value the whole column. Every other field keeps its label-left row, and a click on the value still edits it.

A `markdown`, `html` or `richtext` value drawn in full (the record page, a readonly form field) draws `h1` at 18 px, `h2` at 16 px and `h3` at 14 px instead of 30, 20 and 18 px. The headings are still heading elements, so a link to a cited section still finds them; a value drawn in a grid cell is unchanged. No metadata changes.
