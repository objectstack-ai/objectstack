---
"@objectstack/formula": minor
"@objectstack/plugin-security": minor
"@objectstack/spec": patch
---

A row-level write check that orders a field against a bound (`>`, `>=`, `<`, `<=`) is refused with `INVALID_FILTER` / 400 when that field holds a list or an object on the record being written, instead of comparing the list's string form and admitting the write (#19886).

**BREAKING** — an accept-set narrowing, shipped by `@objectstack/formula` and `@objectstack/plugin-security` as `minor` under the repo's launch-window convention for accept-set narrowings. The hand-migration prescription is registered under protocol major 18 as `rls-predicate-stored-list-ordering-refused`.

Clause-②: no (narrowing)

**Security fix for RLS write checks.** Measured through the real plugin-security on driver-sql and driver-memory: `record.tags > 'a'`, with `tags` a `json` field holding `['m']`, compared `'m' > 'a'` and admitted and stored the write. `record.meta < 'a'` with `meta` holding `{ a: 1 }` compared `'[object Object]' < 'a'` and did the same, and so did a `multiple` lookup. `using` stands in as the check for a policy that declares no `check`, so the same predicate in `using` was enforced the same way on writes. No shipped row-level or sharing-rule predicate orders a field at all.

What changes:

- `@objectstack/formula`: `matchesFilterCondition` refuses `$gt` / `$gte` / `$lt` / `$lte` and `$between` on a field whose value on the record is a list or a plain object, whatever the comparand, with the same `INVALID_FILTER` / 400 and the same message as the stage 2d refusals. The refusal is per record: a record whose `json` field holds one scalar is compared as before. `null` and `Date` values are unchanged, and so is every equality against a stored list (`$eq`, `$ne`, implicit equality, `$in`, `$nin`). `$between` is not produced by the CEL lowering, so it reaches this only through a filter passed to `matchesFilterCondition` directly.
- `@objectstack/plugin-security`: a check insert or by-id update whose post-image holds a list or an object in an ordered field is refused 400 and stores nothing. That includes a by-id update that edits another field of a row whose stored `json` column holds a list, because the post-image merges the stored row.
- `@objectstack/spec`: the migration registry carries the entry. The stage 2a entry `rls-predicate-array-comparand-refused` now ends "Scalar != and ==, null, Date comparands, and { $field } references between single-valued columns evaluate exactly as before", which is true since stage 2d.

Three moves, named:

1. **The write check now matches driver-sql's read.** driver-sql refuses every ordering comparison, and `$between`, on a column it stores as JSON text, by declared type (400, #7398). The in-process check now refuses the same predicate on the same row (400).
2. **driver-memory's read parts from the write check.** driver-memory, a test driver, compares a stored list element by element on a read and keeps returning those rows (`record.tags > 'a'` reads a row holding `['m']`), while the check now refuses writing it. This is declared on #15104, as for stage 2d's `{ $field }` half.
3. **A list written into a scalar field under an ordering check now answers 400.** `status: ['m']` into a `text` field under `record.status > 'a'`, or `amount: [500]` into a `number` field under `record.amount > 10`, was admitted, and driver-sql stored it as the text `'["m"]'` / `'[500]'`. It is now refused before anything is stored.

**The explain answer.** `security/explain` evaluates the business RLS predicate in-process on the fetched record, so it now answers `INVALID_FILTER` / 400 where the record holds a list or an object under an ordering predicate (this stage). It already answered 400 for a `{ $field }` comparison against a list-holding column (stage 2d). For both, per operation:

| explain operation | driver | the enforced operation answers | same as explain's 400? |
|---|---|---|---|
| `read` | driver-sql | 400 `INVALID_FILTER` (the driver's refusal) | yes |
| `update` | driver-memory | 400 `INVALID_FILTER` (the post-image check) | yes |
| `update` | driver-sql | 403 `PERMISSION_DENIED`: the pre-image gate fails closed on the driver's 400 | no — both deny |
| `read` | driver-memory | the rows its element-wise read admits | no — the test driver's read |

Explain itself is unchanged.

**What to change.** Order a single-valued column (`record.priority > 2`), or test membership in the list with `in` (`record.status in ['open', 'pending']`). A `json` or `multiple` field has no ordering.

<!-- adr-0087: registered rls-predicate-stored-list-ordering-refused -->
