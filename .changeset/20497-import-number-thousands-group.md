---
'@objectstack/rest': minor
---

fix(rest): `POST /api/v1/data/:object/import` reads a comma in a number cell only as a thousands group, and refuses every other comma instead of storing a different number (#20497)

Clause-②: no (narrowing)

**BREAKING for callers of the import door.** A cell for a numeric field
(`number`, `currency`, `percent` and the other numeric value types) that
carries a comma is now admitted only when the comma groups thousands: 1 to 3
leading digits, then groups of exactly three digits, and only before any `.`
(`1,000`, `12,345.67`, `-1,234,567.89`). Any other
comma makes the cell that row's `invalid_number` error, the same code the
plain write doors (create, update, batch) already answer for the cell. The
reader used to strip every comma before parsing, so each of these was stored
as a DIFFERENT number while the import reported `ok 1, errors 0`. For each
shape, change the cell FROM the refused spelling TO the one that says what you
mean:

- **A decimal comma.** FROM `3,14`, `1,5`, `0,5`, `1.000,5` (stored as `314`,
  `15`, `5`, `1.0005`) TO a `.` decimal point with no grouping, or with comma
  grouping: `3.14`, `1.5`, `0.5`, `1000.5` or `1,000.5`. A file exported with a
  decimal-comma locale has to be converted before import. No locale is
  guessed: `1,500` is always one thousand five hundred.
- **A comma that does not group thousands.** FROM `1,2,3`, `1,23`, `1,0000`,
  `1234,567`, `,123`, `1,000,` or a comma after the `.` (`12,345.6,7`), each
  stored with its commas removed, TO the number with no separators, or with
  well-formed thousands grouping.
- **Grouping by twos (`12,34,567`, `1,00,000`).** FROM that grouping TO
  `1234567` / `100000`, or `1,234,567` / `100,000`. These used to import as
  the number they denote. They are refused now because the reader cannot tell
  a two-digit group from a decimal comma, and it no longer guesses.

**What is not affected.** Every cell without a comma reads exactly as before.
That is measured over the platform numeric grammar's 41 case rows: the only
row whose import reading changed is `1.000,5`. A well-formed thousands grouping
reads as before, with or without a leading currency symbol, a trailing `%`, a
sign or accounting parentheses (`$1,000`, `1,234%`, `(1,234)`). A JSON number,
and an xlsx cell Excel stores as a number, never pass through this reading.
The dry run answers the same verdicts as the real write. A refused cell fails
only its own row, and the rest of the batch imports as before.

**If you are refused.** The row's result carries `code: 'invalid_number'` and
quotes the cell, so the file can be corrected and re-imported.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or reshaped: no spec key, no export, no stored row. The import door's cell reader accepts fewer spellings of a number inside an imported file, which is data, not metadata, so `objectstack migrate meta` has nothing to reach. The row's invalid_number error quotes the refused cell, and the repair is to write the number with a `.` decimal point. -->
