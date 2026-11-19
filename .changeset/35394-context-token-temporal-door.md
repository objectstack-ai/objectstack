---
'@objectstack/core': patch
---

fix(core)!: a context placeholder (`{current_user_id}`, `{current_org_id}`) compared against a date, datetime or time field is refused, as the id it resolves to already was

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: what moved is the answer of the published isUninterpretableTemporalComparand predicate for a context placeholder, which the engine's temporal-comparand door now refuses as it refuses the id the placeholder resolves to. Such a filter never matched a temporal column correctly, so no consumer had a working form of it to migrate. -->

**BREAKING** for a filter that compares a `date`, `datetime` or `time` field against a context placeholder. Such a filter is now refused with `INVALID_FILTER` (400), naming the field, before any read, on `find`, `findOne`, `count`, `aggregate` (its `where`, each aggregation's `filter` and its `having`), `update` and `delete`. It never answered correctly: the placeholder resolves to the caller's user or organization id, an id is not a day, an instant or a time of day, and the comparison ran as text against the stored values.

- FROM: `{ due_on: { $lt: '{current_user_id}' } }` answered every row, and `$eq` / `$gte` answered no row, all with a 200, on SqlDriver and InMemoryDriver alike, while the same filter written with the literal id was refused.
- TO: the placeholder takes the literal id's refusal, `INVALID_FILTER` / 400, on all three kinds, in both spellings (`{current_user_id}` and `${current_user_id}`).

`isUninterpretableTemporalComparand` (`@objectstack/core`) now answers `true` for a context placeholder on every temporal kind, as it does for a period key (`{current_iso_week}`). It still answers `false` for a date macro (`{current_week_start}`, `{30_days_ago}`), which the engine judges by its year once resolved, and for an unknown or record-context placeholder (`{TODAY}`, `{record_id}`), which the resolver keeps refusing by name with `FILTER_TOKEN_UNKNOWN` / `FILTER_TOKEN_UNRESOLVED`. A context placeholder on an id or text field resolves exactly as before.

The refusal comes from the temporal-comparand door, which runs one stage ahead of the placeholder resolver. So a caller with no session, which got `FILTER_TOKEN_UNRESOLVED` (400) for this spelling on a temporal field, now gets `INVALID_FILTER` (400). On an id or text field it still gets `FILTER_TOKEN_UNRESOLVED`.

The engine's judge-only admission runs the same door, and so do two of its readers:

- `IObjectQLEngine.judgeFilter` answers `{ ok: false, code: 'INVALID_FILTER', status: 400 }` for this spelling on a temporal field. With a session it answered `{ ok: true }`; without one it answered `FILTER_TOKEN_UNRESOLVED`.
- Lint's row-scope predicate rule (`rls-predicate-unenforceable`) still refuses a predicate such as `due_on < '{current_user_id}'`. The finding now quotes `INVALID_FILTER / 400` with the hint to rewrite the comparison, where it quoted `FILTER_TOKEN_UNRESOLVED / 400` with the hint to write the caller's value as a `current_user` key.
- Analytics read-scope admission: when the analytics service asks the engine to admit an object's read scope, a scope that compares a `date` or `datetime` field with a context placeholder is now refused at compile, `READ_SCOPE_COMPILE_FAILED` (500, fail-closed). After the upgrade, a dashboard or analytics query over such an object answers 500 until that clause is rewritten as below.

The fix for an author: compare the date field against a date (a `YYYY-MM-DD` day, an ISO-8601 instant, or a date macro such as `{30_days_ago}`), and compare the user or organization id against the field that holds it, such as `owner_id`. In a row-level-security predicate, write `owner == current_user.id`.
