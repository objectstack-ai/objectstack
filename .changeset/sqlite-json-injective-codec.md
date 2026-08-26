---
"@objectstack/driver-sql": minor
---

fix(driver-sql): make the SQLite `Field.json` codec injective — one encoding across all three dialects (#12380)

**BREAKING** storage-format change for `Field.json` columns on SQLite (and the
SQLite-backed `driver-turso` / `driver-sqlite-wasm`, which inherit this codec),
shipped as `minor` under the repo's launch-window convention for breaking
changes. Postgres and MySQL are **untouched** — this makes SQLite match what
they have always done.

`formatInput` now `JSON.stringify`s every `Field.json` value on every dialect,
and `formatOutput` parses it back. That **deletes a dialect branch rather than
adding one**.

## What was wrong

Measured 2026-08-26 through the driver boundary on live SQLite, live Postgres
16.13 and live MySQL 8.0.46, with each stored cell read back through a separate
raw catalog query: **Postgres and MySQL were 17/17 faithful; SQLite was 13/17
type-changed.** Three independent mechanisms, only two of them reversible:

1. **Read-side.** `formatOutput` `JSON.parse`s every string in a json column, so
   a stored string whose *content* is valid JSON came back type-changed —
   `'true'` → boolean, `'null'` → null, `'[]'` → array, `'{"a":1}'` → object.
2. **Write-side.** The column is declared type `json`, which contains none of
   `INT`/`CHAR`/`CLOB`/`TEXT`/`BLOB`/`REAL`/`FLOA`/`DOUB`, so SQLite's affinity
   rules fall through to **NUMERIC** and a bound number-like string was converted
   to INTEGER/REAL *before storage*: `'123'`, `'  123  '`, `'0123'`, `'1e5'`,
   `'1.0'`, `'-0'` were destroyed on disk. ⛔ Not reversible.
3. **Native booleans.** `true` was stored as INTEGER 1 and read back as the
   number `1` — `formatOutput`'s `booleanFields` pass is keyed to declared
   `Field.boolean` *columns*, not to booleans inside a json payload.

The contract decides which dialect is right, not strictness: `json`'s stored
contract is `z.unknown()` because *"openness is now an explicit decision, not an
accident of nobody checking"* (`packages/spec/src/data/field-value.zod.ts`). An
explicitly-open contract admits both `123` and `'123'` as legal values of one
field, so no driver may collapse them onto one representation.

The live consumer is `sys_setting.value`, which is `Field.json`, and the settings
service persists verbatim and reads back with no re-coercion by declared type —
so the driver's answer is what the caller gets, on the dialect tenant
environments actually run.

## What changes on disk, and what does not

The DDL is unchanged — the column is still declared `json`, so NUMERIC affinity
is still in force. The encoded form defeats it because a string's encoding
carries its quotes (`'123'` → `"123"`, which is not a numeric literal). Pinned
live rather than reasoned.

For **new** writes the on-disk delta is exactly two classes:

- **strings** are now quoted JSON text;
- **booleans** are now TEXT `true`/`false` instead of INTEGER `1`/`0`.

Objects, arrays, `null` and **numbers** are byte-identical to before (`123` bound
as a number and `"123"` bound as text both land as INTEGER `123`).

⚠️ An out-of-band reader of a SQLite file — anything reading the table with its
own SQL rather than through this driver — now sees quoted JSON text where it saw
a bare value.

## The migration, and the limits of what it can recover

`backfillCanonicalJsonEncoding` runs on `syncSchema`/`initObjects` for existing
tables, the same posture and shape as the `backfillCanonicalDatetimes` and
`backfillCanonicalTimes` storage-format migrations beside it: one `UPDATE` per
column, failures logged and swallowed, correctness never contingent on it having
run. It converts the **one on-disk class the pre-fix encoding left unambiguous** —
a TEXT cell that is not valid JSON, which nothing but a stored plain string could
have produced — into its quoted form. Idempotent by construction: the `WHERE` is
the exact complement of the `SET`'s output, so a converted row cannot match again
and re-running costs one scan and zero writes.

⛔ **It does not guess, because the rest cannot be guessed**, and two classes are
therefore left exactly as they are:

- **INTEGER/REAL cells.** A number, a boolean, and a number-like string eaten by
  NUMERIC affinity are the *same bytes* on disk — `123` the number and `'123'`
  the string are one INTEGER `123`. No migration can know which was written.
- **TEXT cells that already parse.** A stored object `{"a":1}` and a stored
  *string* `'{"a":1}'` were byte-identical before this change. Re-quoting them
  would turn every legacy object and array into a string — corrupting the common
  case to guess at the rare one.

⇒ Those rows read after this change exactly as they read before it. **The class
stops growing; it is not retroactively repaired.** Maintainer ruling 2026-08-26,
with that cost accepted explicitly.

The migration changes **no read**: a legacy plain string reads back as that
string before it runs (via `formatOutput`'s parse fallback, kept for exactly this
reason and now documented as the pre-#12380 read-side repair) and after it runs.
It is a canonicalisation that makes the on-disk format uniform and injective
going forward, not a repair of something that reads wrong today.

## What upgraders may notice

Values that were being **corrupted** now read back correctly. Code that adapted
to the corruption is what changes underneath: a boolean `Field.json` value that
read back as `1` now reads back as `true`, and a string whose content is valid
JSON now reads back as that string instead of the structure it looked like.
Filters are unaffected — every scalar comparison operator on a json column is
already refused by the driver (`JSON_COLUMN_INCOMPATIBLE_OPERATORS`), so no
predicate could have been keyed to the old stored text.

<!-- adr-0087: not-required (no-migration-prescription) A storage-codec change inside one driver: no authorable metadata key is removed, renamed or re-shaped, no `packages/spec` declaration changes, and the `json` field type's stored contract (`z.unknown()`) is exactly what it was — so there is no tombstone and nothing whatsoever for `objectstack migrate meta` to rewrite. The migration this change needs is over DATA ROWS, not metadata, and it is performed automatically by the driver at schema sync (`backfillCanonicalJsonEncoding`); there is no step an upgrader is prescribed to take, which is why no ledger entry could carry one. -->
