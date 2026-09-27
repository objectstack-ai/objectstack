---
"@objectstack/driver-sql": patch
---

`backfillCanonicalDatetimes` / `backfillCanonicalTimes` no longer write SQLite's julian-day reading of a bare-numeric cell over the bytes on disk (#6009).

Both migrations use the read path's own repair expression as their `SET` value, and that expression's `else` arm is `coalesce(strftime(...), col)` — on the stated understanding that a value SQLite cannot parse falls through the `coalesce` unchanged. SQLite's time-value grammar has one limb that defeats it: a **bare number** is a julian day (`DDDD.DDDD`, the last of its documented formats), and `now` is the wall clock. For those two shapes `strftime` does not return NULL, so `coalesce` never fires and a confident wrong answer is what gets written. Measured on better-sqlite3 13.0.3 / SQLite 3.53.4 against a TEXT-affinity column:

```text
'12'        -> -4713-12-06T12:00:00.000Z     '2026'      -> -4707-06-11T12:00:00.000Z
'86400'     -> -4476-06-15T12:00:00.000Z     '2440587.5' ->  1970-01-01T00:00:00.000Z
'now'       -> whatever the clock said       '2026-08-06' -> 2026-08-06T00:00:00.000Z  (correct)
```

On a read that was a temporary misreading and the disk was untouched. On the `SET` side it is a write, and the original value is unrecoverable afterwards.

- **The guard is the structural complement of the parseable spellings, not a heuristic.** Every other format SQLite's date parser accepts goes through `parseYyyyMmDd` (which needs a `-`) or `parseHhMmSs` (which needs a `:`), so a cell the parser answers for while containing neither character reached it through the julian-day limb or the `now` limb — there is no third way in. `sqliteNonTemporalTextSql` is that predicate; it never inspects the magnitude of the number and never decides what the cell means, only that the migration must not rewrite it.
- **A withheld row also blocks the canonical mark, and that is what keeps every query answer identical.** Skipping the row costs nothing while the read-side repair still applies to it — it keeps reading as the same instant it always did. Marking the column clean is what would move an answer: `needsLegacyDatetimeRepair` would drop the repair and the raw `'2026'` would be compared as TEXT. Unlike the `coalesce` fixpoints, these rows are not invariant under the repair, so they cannot ride through the mark. The column stays un-marked, reads keep their (unindexed) repair, and one `warn` names the count, the reason and the remedy.
- **The read path is untouched, deliberately.** The maintainer's 2026-08-03 ruling on cloud#1005 refused teaching the shared read expression to recognise numeric-looking text: it is a public contract for every SQLite consumer, it runs on every read, and there it would misread a legitimate numeric-string column. Everything here runs once, as a migration, only on a column the metadata declares `Field.datetime` / `Field.time`, and it only ever declines to write.
- **`previewDatetimeConvergence` / `previewTimeConvergence` inherit the same exclusion**, so `os migrate plan` still promises exactly the rows `apply` rewrites.

Reaching the julian branch needs a temporal column with TEXT affinity. A column knex creates for `Field.datetime` is declared `datetime`, which is NUMERIC affinity, so `'2026'` is converted to INTEGER on the way in and takes the epoch branch instead — the local write path mostly dodges this. A table that already existed when `initObjects` first saw it keeps whatever affinity it was created with, and `initObjects` adds missing columns without ever retyping one.
