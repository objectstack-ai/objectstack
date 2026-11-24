---
'@object-ui/fields': patch
---

fix(fields): a markdown value that starts with a heading no longer draws at heading size in a list cell

Clause-②: no
Metadata-protocol: none

In a grid column (list views and related lists pass `inGridColumn`), the `markdown` cell now draws its value in a cell face: a heading is a bold line at the cell's own text size instead of a heading element, and the body takes the cell's font size and line height. A value such as `# Heading` showed a truncated H1 and grew its row; the row now keeps the height of every other row. The record page and readonly form fields keep the full document face and its heading sizes. Nothing changes in what an author writes, and no export changes.
