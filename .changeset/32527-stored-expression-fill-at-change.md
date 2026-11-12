---
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
---

fix(objectql, metadata-protocol): the save or publish that makes a stored computed field compute something new fills the object's existing rows, and says so per field

Clause-②: no
Metadata-protocol: none

A stored computed field (a non-`formula` field declaring `expression`) is computed on every insert and update and on nothing else. Adding one to an object that already held rows, turning a `formula` into one (`type: 'number'` with the same `expression`, the remedy the platform now prescribes for a total over a formula), or changing its expression left every existing row NULL or holding the old value, so a dataset `sum` over it read 0 or too little with no error. `os migrate stored-expressions --apply` filled them, but it needs a direct database URL, which a hosted tenant does not have, and the save said nothing.

- **The doors fill at the change.** A save in publish mode (`PUT /api/v1/meta/:type/:name`), a publish (`POST /api/v1/meta/:type/:name/publish`) and a package publish (`POST /api/v1/packages/:id/publish-drafts`) of an `object` or `object_extension` capture the object's stored computed fields before the change goes live, and once it is served and its storage synced fill every stored row of each field that now computes something new: added, turned from a formula or from a plain field, or with a changed expression, stored type or scale. The fill is the walk `os migrate stored-expressions --changed --apply` runs: the write's own computation over each row, written through the engine under `preserveAudit`, so `updated_at` does not move and hooks, roll-ups and audit see an ordinary write; every organization's rows; a row that fails is listed and the walk goes on. Not opt-in. A draft save fills nothing, a change that computes nothing new reads no row, and a boot still fills nothing (the boot advisory and the command are unchanged).
- **The answer says what the rows hold, per field, on `advisories`** (the key a refused storage sync already rides; the element shape is unchanged): `stored-expression-filled` (`info`) with the rows written and the rows the object holds, or `stored-expression-fill-incomplete` (`warning`) when a row could not be written, the object could not be read, or the storage sync was refused (then nothing is filled), naming what is left and `os migrate stored-expressions --object <o> --field <f> --changed --apply`. A batch publish puts them on the object's `published[]` element. An object holding no row adds nothing, so a clean save's answer is unchanged. The save or publish itself is never failed by its fill.
- **Cost.** The fill reads and writes every row before the door answers: measured on SQLite with a bare engine, about 0.7 ms a row (5,000 rows 4.7 s, 20,000 rows 14 s, 100,000 rows 68 s).
- **`@objectstack/objectql`:** `ObjectQL.captureStoredExpressions(object)`, which a metadata door calls before its change and whose `fillChanged()` runs the fill after it, and `backfillStoredExpressions`'s `fields` option, several stored computed fields of one object walked in one pass.
