---
"@objectstack/spec": minor
---

fix(spec): `$gt`/`$gte`/`$lt`/`$lte` accept the ISO string the platform itself produces (#5685)

The four ordering-comparison slots declared `number | Date | FieldReference` —
and the platform's own producers put a **string** in them and nothing else. The
declaration did not merely under-describe reality, it contradicted it:

- `resolveFilterTokens` (`@objectstack/core`) is the evaluator for the `{token}`
  grammar and **every** branch returns a string — `asYmd(…)` for a calendar day,
  `.toISOString()` for the sub-day tokens. Its own module example is exactly
  this shape: `{ close_date: { $gte: '{current_year_start}' } }` becomes
  `{ close_date: { $gte: '2026-01-01' } }`.
- `date-macros.zod.ts` states the same rule from the other end: "the DRIVER only
  ever sees ISO date / timestamp strings, never `{tokens}`".
- Three first-party callers send strings today — `lifecycle-service`'s retention
  cutoffs, `plugin-email`'s outbox sweep, and `plugin-auth`'s better-auth
  adapter.

An author — an AI author in particular — reading `number | Date` concluded that
a date window must be a `Date` object or an epoch number, which is the one form
the date-macro path can never hand them.

**This is additive and declaration-side only.** No producer, caller or driver
changed. Every evaluation surface already compared strings: `driver-sql` binds
`>`/`>=`/`<`/`<=`, and `formula`'s `matchesFilter` and `driver-memory`'s matcher
fall through to the JS operators. Filters that validated before still validate.

Widened in all three places this contract is spelled: `ComparisonOperatorSchema`
(documentation), `FieldOperatorsSchema` (the copy `NormalizedFilterSchema`
validates against and `FieldOperators` is inferred from), and the `Filter<T>`
TypeScript helper — where `T` is known, so it stays type-precise: a `Date` field
now also takes the resolver's ISO string, a `string` field (a `Field.time`
`'09:00'`, an autonumber code) is orderable instead of collapsing to `never`,
and a `number` field stays numbers-only.

**The comparand form the contract guarantees** is the ISO/clock one — an ISO
calendar day (`YYYY-MM-DD`), a UTC ISO-8601 instant, or a wall-clock time of day
(`HH:MM[:SS[.fff]]`). Those are ASCII and fixed-width, so lexicographic order IS
chronological order and every backend agrees. The union is a bare `string`
rather than an ISO refinement because this schema is field-agnostic (it never
sees which column the operator applies to) and because an ISO refinement would
reject `Field.time`'s declared `HH:MM` form, which `SqlDriver.temporalFilterValue`
canonicalises in the comparand position. Ordering **non-temporal** text is
therefore permitted but not promised: the order is the backend collation's
(byte-wise on SQLite, the database locale on Postgres, UTF-16 code units in the
JS matchers), and those coincide only for ASCII. The `.describe()` on each slot
says so.
