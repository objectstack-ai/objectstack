---
'@objectstack/rest': minor
---

fix(rest): `POST /api/v1/data/:object/import` reads a `date`, `datetime` or `time` cell only in ISO 8601, the export's own `YYYY-MM-DD HH:mm:ss` or a year-first date (`2026/7/15`), on a calendar day that exists, and keeps a `date`'s year at four digits (#20534)

Clause-②: no (narrowing)

**BREAKING for callers of the import door.** A text cell for a `date`,
`datetime` or `time` field is now read only in one of these spellings, after
trimming:

- `YYYY-MM-DD`;
- `YYYY-MM-DDTHH:MM[:SS[.fraction]]`, then `Z`, a `+HH:MM` / `-HH:MM` /
  `+HHMM` offset, or nothing (a wall clock, read in the importing user's
  business timezone, as before);
- `YYYY-MM-DD HH:MM[:SS[.fraction]]` with no offset, which is what the export
  writes for a `datetime` cell;
- a year-first date, `YYYY/M/D` or `YYYY-M-D` (a four-digit year, a one- or
  two-digit month and day, the same separator twice), optionally followed by
  one space and `H:MM` or `H:MM:SS` with no offset, read exactly as the
  export shape is;
- for a `time` field, also a bare `HH:MM` / `HH:MM:SS`.

The day must exist. Every other cell is that row's `invalid_date` error, with
the importer's existing sentence ("is not a valid date" / "datetime" /
"time"). The reader used to hand such a cell to the JavaScript date parser,
which read it in the SERVER PROCESS's timezone and month-first, and rolled an
impossible day into the next month, so the import reported success and stored
a different value. For each shape, change the cell FROM the refused spelling
TO an admitted one:

- **An impossible day.** FROM `2026-02-30`, `2026-02-29`, `2026-04-31` in any
  spelling (a `datetime` `2026-02-30` was stored as 2 March, and so was a
  `date` written `2026-02-30T10:00:00Z`) TO the day you mean. Nothing is
  rolled over.
- **A locale or prose date.** FROM `07/15/2026`, `07/15/2026 10:00`,
  `07/08/2026`, `15 July 2026`, `Jul 15 2026 10:00` (stored hours apart on a
  New York and a Shanghai server, a `date` a day apart, and `07/08/2026` read
  as 8 July) TO `2026-07-15`, `2026-07-15 10:00`, `2026-07-08` or
  `2026-08-07`. No timezone and no field order is guessed. Converting a
  spreadsheet column to ISO (in Excel, the cell format `yyyy-mm-dd` or
  `yyyy-mm-dd hh:mm:ss`) before export is the fix.
- **A year-first date outside its one form.** FROM a mixed separator
  (`2026/7-15`) TO `2026/7/15` or `2026-07-15`. FROM a `T` or a zone on the
  year-first form (`2026/7/15T9:00`, `2026/7/15 9:00Z`) TO `2026/7/15 9:00`
  (a wall clock in the business timezone) or the ISO `2026-07-15T09:00:00Z`.
  FROM a fraction of a second (`2026/07/15 10:00:00.123`) TO
  `2026-07-15 10:00:00.123`. A two-digit year (`26/7/15`) is refused, as it
  was.
- **A zone after a space, or lower-case `t` / `z`.** FROM
  `2026-07-15 10:00Z`, `2026-07-15 10:00:00+08:00`, `2026-07-15t10:00:00z` TO
  `2026-07-15T10:00Z`, `2026-07-15T10:00:00+08:00`, `2026-07-15T10:00:00Z`,
  the spellings the create and update doors take.
- **A zone-naive `24:00`.** FROM `2026-07-15 24:00` or `2026/7/15 24:00` (read
  in the server's zone) TO `2026-07-16 00:00` or `2026/7/16 0:00`.
  `2026-07-15T24:00:00Z`, which names its instant, reads as before.
- **A number, reduced or expanded forms.** FROM a JSON number such as `2026`
  or an Excel serial, `2026`, `2026-07`, `+002026-07-15` TO `2026-01-01`,
  `2026-07-01`, `2026-07-15`.

**Kept: year-first dates.** `2026/7/15`, `2026/07/15`, `2026-7-15`,
`2026/7/15 9:00` and `2026/08/01 06:00:00`, Excel's default short date in
zh-CN and ja-JP, stay admitted. They are now held to the same rules as every
other cell: the day must exist (`2026/2/30` is refused, never rolled into
March), the hour runs 0 to 23, and the day is stored in its padded ISO form
(`2026/7/15` is stored as `2026-07-15`). A year-first date with no clock
given to a `time` field reads as `00:00:00`, as an ISO day does; it used to
read the server's zone (`04:00:00` on a New York server).

**The year keeps four digits.** A `date` cell for a year from 0001 to 0999
(`0500-01-01`) used to leave the reader as `500-01-01`, which the write door
refuses, so the import refused a day the create door takes. It is stored as
written now. A bare day read into a `datetime` field in years 0001 to 0099
(`0050-01-01`) used to be stored in the 1900s (`1950-01-01T00:00:00.000Z`); it
is stored in its own year now.

**What is not affected.** Every ISO 8601 cell and every export-shape cell on
a real day reads exactly as before, including a zone-naive cell read in the
business timezone and an offset-bearing cell honoured as written. An xlsx
cell that Excel stores as a date is unaffected: it reaches the reader as the
export shape. The dry run answers the same verdicts as the real write. A
refused cell fails only its own row, and the rest of the batch imports as
before. The same narrowing applies to the exported `coerceRow` helper.

**If you are refused.** The row's result carries `code: 'invalid_date'` and
quotes the cell, so the file can be corrected and re-imported.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or reshaped: no spec key, no export, no stored row. The import door's cell reader accepts fewer spellings of a date inside an imported file, which is data, not metadata, so `objectstack migrate meta` has nothing to reach. The row's invalid_date error quotes the refused cell, and the repair is to write the date in ISO 8601 or as a year-first date. -->
