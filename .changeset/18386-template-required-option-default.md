---
'@objectstack/rest': patch
---

fix(rest): the import template (`GET /api/v1/data/:object/export?template=true`) puts ` *` on a column only when the import refuses a row that leaves it blank

Clause-②: no

- A required field whose option list marks an option `default: true` no longer gets ` *` in the header, and the instructions sheet lists it as not required. A blank cell in that column is imported as the marked option.
- A required field that declares `defaultValue: null` now gets ` *`, unless one of its options is marked `default: true`: the import treats `null` as no default and refuses the blank. A required field whose default is `''`, or `[]` on a multi-valued field, now gets ` *` too: the required check refuses that default.
- A required `system`, `readonly` or `autonumber` field named in `?fields=` no longer gets ` *`: the import does not refuse a blank in it.
- Each dropdown's error title, which is the column header, is cut to 32 characters, the longest title Excel's data-validation dialog takes.
