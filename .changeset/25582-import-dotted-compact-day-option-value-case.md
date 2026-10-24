---
'@objectstack/core': patch
---

fix(core): `POST /api/v1/data/:object/import` reads a dotted (`2011.07.01`) or compact (`20090615`) year-first day in a `date` or `datetime` cell, and matches a select / multiselect cell against the option values case-insensitively

Clause-②: yes (widening: two date-cell spellings and an option value in another case, each refused before with `invalid_date` / `invalid_option`, are now read; nothing read before is refused or stored differently)
Metadata-protocol: none

Two cell shapes a person reads without hesitation used to fail the whole row. Both are now read by the import's cell reader (`parseDateCell`, `matchOption`), on the commit and on the dry run, for CSV, JSON and xlsx payloads alike:

- **A year-first day, dotted or compact.** `YYYY.MM.DD` (`2011.07.01`, the dotted date of Chinese ledgers) and `YYYYMMDD` (`20090615`, the compact date of ERP exports) are stored as `2011-07-01` / `2009-06-15` in a `date` cell, and as midnight UTC in a `datetime` cell, as `2026/7/15` already is. The day must exist: `20090230` and `2009.02.30` stay `invalid_date`, never rolled over. No other form is widened: a one-digit month or day (`2011.7.1`), a clock after either spelling, a two-digit year, a day-first dotted date (`01.07.2011`), six or seven digits, a `time` cell and a JSON number `20090615` stay refused. An eight-digit cell on a `number` or `text` column is read exactly as before.
- **An option value in another case.** A select / multiselect cell `CN` matches the declared option value `cn` and stores `cn` — the declared value, never the cell's spelling — as labels already matched in any case. A cell that matched an exact value or a label before stores what it stored: the value pass runs after both. A cell naming, by case alone, two declared values that differ only by case (`cn` and `CN`, which the spec's lowercase option value refuses but a programmatically registered object can carry) is not resolved by guessing; it gets `invalid_option` as before.

Every cell error of a row is still reported as the first one only; that half of the same request is not in this change.
