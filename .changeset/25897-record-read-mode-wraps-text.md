---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the record page's read mode wraps a text value instead of cutting it to one line, and a highlighted date keeps its day

Clause-②: no
Metadata-protocol: none

- **Details body.** A `text` field in a `record:details` section, read mode, was drawn with the grid's one-line cell (one line, an ellipsis), so a case subject read "Data export timing out for large…" in a two-column section with room to spare. It now reads through the text field's own read display and wraps, as a `textarea` already did. The same holds for every type that used the grid's text cell (`code`, `time`, `auto_number`, …). A host that registered its own cell renderer for one of those types keeps it. Grid cells are unchanged and still truncate, with the whole value on hover.
- **Highlights strip.** A `date` or `datetime` chip now takes the wide column (16rem floor) that email, phone and URL chips take. On the 9rem column the compact datetime face, and a date in Chinese or Japanese, overran the value box, so the ellipsis landed inside the day ("2026/10/2…"). A chip whose line runs out still truncates, with the whole value as its hover title.

What to do: nothing.
