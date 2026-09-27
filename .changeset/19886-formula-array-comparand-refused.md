---
"@objectstack/formula": minor
"@objectstack/plugin-security": minor
"@objectstack/spec": patch
---

`matchesFilterCondition` refuses an array comparand under `$ne` and in the equality position (`{ field: [...] }`, `$eq: [...]`) with `INVALID_FILTER` / 400, before any record is judged (#19886).

**BREAKING** — an accept-set narrowing, shipped by `@objectstack/formula` and `@objectstack/plugin-security` as `minor` under the repo's launch-window convention for accept-set narrowings. The hand-migration prescription is registered under protocol major 18 as `rls-predicate-array-comparand-refused`.

Clause-②: no (narrowing)

**Security fix for row-level write checks.** This evaluator is what `@objectstack/plugin-security` runs against the post-image of an insert or update to enforce a row-level `check`. It compared strictly, and no stored value ever equals an array, so:

- a `check` written `record.status != ['closed', 'archived']`, or `!=` against a `current_user` membership array, lowered to `{ status: { $ne: [...] } }` and matched **every** post-image;
- a `check` written `!(record.status == ['closed', 'archived'])` lowered to `{ $not: { status: [...] } }` and did the same.

Every write such a policy was written to refuse was admitted and stored. The positive `record.status == ['open', 'pending']` already refused every write (403).

The message withholds the field, the operator and the value, because the filter is usually an access policy the caller did not write, and the comparand may be a resolved membership set.

**What to change.** A `check` or `using` predicate that means "one of these values" or "none of these values" is spelled with `in`: `record.status in ['open', 'pending']`, or `!(record.status in ['closed', 'archived'])`. Those, scalar `!=` / `==`, `null`, `Date` comparands and `{ $field }` references evaluate exactly as before.

<!-- adr-0087: registered rls-predicate-array-comparand-refused -->
