---
'@object-ui/fields': patch
---

fix(fields): an html or richtext cell holding a heading keeps the list row one line high

Clause-②: no
Metadata-protocol: none

An `html` or `richtext` value that holds a heading drew it as a heading element in a grid cell, at the typography scale's heading size, so the row grew taller than the other rows (45 px against 36 px in Chromium for a stored `<h1>`). In a grid column the cell now draws the value in the same cell face a `markdown` cell uses: every heading level is a bold line at the cell's own text size, and the body takes the cell's font size and line height. What the sanitiser keeps and drops is unchanged. The record page and readonly form fields keep their full-size headings.
