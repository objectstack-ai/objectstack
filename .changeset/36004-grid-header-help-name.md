---
'@object-ui/fields': patch
'@object-ui/i18n': patch
---

fix(fields): the line grid's column-header help no longer becomes part of every cell's announced column name

Clause-②: yes (widening)
Metadata-protocol: none

The widening is additive: the new key `fields.grid.columnHelp` in every locale pack `@object-ui/i18n` publishes through `./locales`, in all eleven locales.

The info button beside a line grid's column header used the column's help text as its accessible name. The button sits inside the header cell, so the help joined the column header's name, and a screen reader that announces a cell's column read the whole help sentence with every cell of that column. The button is now named by a short "Help" word in the reader's language (`fields.grid.columnHelp`), and the help is its description (`aria-describedby`), read when the button is reached. The column header is named by the field label and that one word. The tooltip on hover and keyboard focus is unchanged, on the editable grid and on the read-only table.

No metadata key is added or changed.
