---
'@object-ui/fields': patch
---

fix(fields): a text field that declares `options` reads the matching option's label in its read-only cell

Clause-②: no
Metadata-protocol: none

The spec allows `options` on every field type, and analytics dimensions and grid group headers already show a declared option's label on any type. The read-only text cell ignored the list, so one declaration read `backlog` in a list or detail cell and `Backlog` in a chart or group header.

`TextCellRenderer` (and every field type it draws, such as `textarea`, `code` and `time`) now applies the same test analytics applies, a non-empty `options` array: a stored value that names an option reads that option's label, already translated by the host as a select cell's is. The stored value is untouched, a value that names no option reads as itself, and a field with no list renders exactly as before. Edit inputs and forms are unchanged: a text field with options stays a free text input. The value-to-option match (exact, then case-insensitive) is the one `SelectCellRenderer` used, now shared by both cells.
