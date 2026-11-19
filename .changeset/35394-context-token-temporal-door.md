---
'@objectstack/core': patch
---

fix(core)!: a context placeholder (`{current_user_id}`, `{current_org_id}`) compared against a date, datetime or time field is refused, as the id it resolves to already was

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: what moved is the answer of the published isUninterpretableTemporalComparand predicate for a context placeholder, which the engine's temporal-comparand door now refuses as it refuses the id the placeholder resolves to. Such a filter never matched a temporal column correctly, so no consumer had a working form of it to migrate. -->

**BREAKING** for a filter that compares a `date`, `datetime` or `time` field against a context placeholder. Such a filter is now refused with `INVALID_FILTER` (400), naming the field, before any read, on `find`, `findOne`, `count`, `aggregate` (its `where` and its `having`), `update` and `delete`. It never answered correctly: the placeholder resolves to the caller's user or organization id, an id is not a day, an instant or a time of day, and the comparison ran as text against the stored values.

- FROM: `{ due_on: { $lt: '{current_user_id}' } }` answered every row, and `$eq` / `$gte` answered no row, all with a 200, on SqlDriver and InMemoryDriver alike, while the same filter written with the literal id was refused.
- TO: the placeholder takes the literal id's refusal, `INVALID_FILTER` / 400, on all three kinds, in both spellings (`{current_user_id}` and `${current_user_id}`).

`isUninterpretableTemporalComparand` (`@objectstack/core`) now answers `true` for a context placeholder on every temporal kind, as it does for a period key (`{current_iso_week}`). It still answers `false` for a date macro (`{current_week_start}`, `{30_days_ago}`), which the engine judges by its year once resolved, and for an unknown or record-context placeholder (`{TODAY}`, `{record_id}`), which the resolver keeps refusing by name with `FILTER_TOKEN_UNKNOWN` / `FILTER_TOKEN_UNRESOLVED`. A context placeholder on an id or text field resolves exactly as before.

The fix for an author: compare the date field against a date (a `YYYY-MM-DD` day, an ISO-8601 instant, or a date macro such as `{30_days_ago}`), and compare the user or organization id against the field that holds it, such as `owner_id`.
