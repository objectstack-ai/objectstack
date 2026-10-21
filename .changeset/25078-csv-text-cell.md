---
'@objectstack/rest': patch
---

fix(rest)!: the CSV export writes a text cell its consumer would interpret in a form that consumer reads as text, and the CSV import reverses exactly that

Clause-②: no (narrowing) — the CSV export serves different bytes for some text cells, and the CSV import parse reads a cell of the same shape differently; nothing is widened.
Metadata-protocol: none (a REST export's bytes and a REST import's parse; nothing a metadata author writes changes)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the bytes one REST export format serves for some text cells and how the CSV import parse reads a cell of that same shape; stored rows are not touched. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the CSV export's bytes change for some text cells, and the CSV import reads a user-authored cell of the same shape differently), shipped as `patch` because the metadata protocol does not move.

The CSV export (`GET /api/v1/data/:object/export?format=csv`) wrote every text cell exactly as stored, so a cell whose leading character the program the file is opened in interprets was read there as something other than text. The rule below is defined once, in `csvTextCellNeedsMark` (`packages/rest/src/export-format.ts`), and both directions read it.

- **The export.** A CSV text cell whose first character is one of a small fixed set that its consumer interprets is written with one apostrophe (U+0027) in front of its content, before the usual RFC-4180 quoting. A text cell is a string in a column whose field is not declared numeric, boolean, date or datetime, a header label, or a reference field's display title; with no field metadata (the raw path) every string cell is one. A cell made only of digits, spaces and the characters a signed number or a phone number is written with is never marked, so phone numbers and signed amounts are byte-identical.
- **The import.** `parseCsvToRows` removes exactly one leading apostrophe from a cell, header row included, when the rest of the cell is one the export would mark. It serves the sync import (`POST /api/v1/data/:object/import`), the async import job (`POST /api/v1/data/:object/import/jobs`) and plugin-auth's admin user import (`POST /api/v1/auth/admin/import-users`), with an inline mapping or a named one. So a CSV exported and imported back returns the stored value, with the one exception in the next point.
- **A cell that begins with an apostrophe** followed by a cell the export would mark now imports without that apostrophe; the file cannot tell it from an exported one. That holds for a user-authored cell, and for a stored text value of that shape, which the export writes unchanged, so it comes back without its leading apostrophe. A cell beginning with an apostrophe followed by anything else imports unchanged.
- **Measured.** A value beginning with TAB or CR is marked; the import removes the mark, and the default `trimWhitespace: true` then trims the leading TAB or CR exactly as it did before. With `trimWhitespace: false` it returns exactly.
- **Unchanged.** Every other cell; numeric, boolean, date and datetime cells; the xlsx and json export formats; json and xlsx import payloads.
- **What to do.** Nothing for a file that goes back through these import doors. A program that reads the CSV export some other way and needs the stored text applies the same reversal: remove one leading apostrophe from a cell whose rest satisfies `csvTextCellNeedsMark`.
