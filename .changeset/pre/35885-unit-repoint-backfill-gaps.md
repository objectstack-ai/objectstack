---
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
---

fix(units): a `unitField` re-pointed at a new field raises its blank-unit debt; the unit-code backfill names unused mapping entries and says what a capped walk did not judge

Clause-②: no
Metadata-protocol: none

- A metadata save that re-points a stored `record`-mode quantity's `unitConfig.unitField` at a field that held no stored unit before the save (new in it, or unstored before it) is now answered 409 `DESTRUCTIVE_CHANGE` with `unit_mode_to_record` on the quantity: every stored row then holds its quantity beside a blank unit, and is refused at its next quantity edit until it holds a unit code. The finding names the `""` mapping entry of `os migrate unit-codes` that writes those blanks, reads no row, and is lifted by `force: true`. A re-point onto a stored text field still raises `unit_code_field_declared` alone, and a re-point onto a field that already was a unit code field still raises nothing.
- `os migrate unit-codes` and `POST /api/v1/meta/_migrate-unit-codes`: a mapping entry whose key the rows store as a unit code, which is never rewritten, and that no row used is now named, as `unusedEntry` on that value in the report and as a line of the printed report.
- When the walk stops at `maxRecords`, the printed report now says that the rows past the cap were not judged, so any of them may hold a value with no mapping entry, and that an apply run wrote the rows examined only, as the record-currency backfill's report does; an unscoped run also says its organization check saw only the rows examined. An apply run over such a walk still writes the rows it examined, as before.
