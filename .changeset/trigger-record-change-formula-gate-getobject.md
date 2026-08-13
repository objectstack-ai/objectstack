---
"@objectstack/trigger-record-change": patch
---

fix(trigger-record-change): the hydration schema gate now actually engages on the real engine (#8482)

`RecordChangeTrigger`'s computed-field hydration re-read (a `findOne` on every
`afterInsert`/`afterUpdate` dispatch, added to surface `formula` virtual fields
in the seeded flow record) was meant to be skipped for objects that declare no
`formula` field — the only thing the re-read adds. The skip was gated on an
optional `getObjectConfig` accessor that the concrete ObjectQL engine never
implemented, so on every real deployment the gate always fell through to its
`true` fallback and the re-read ran **unconditionally** on every dispatch, even
for the common case of an object with no formula field at all.

`objectHasFormulaField` now reads the object's field map through `getObject` —
the accessor the trigger already uses elsewhere (the unknown-object probe in
`start()`, and `buildContext`'s declared-field materialization since #4953) and
the one the real engine actually implements. The now-unreachable
`getObjectConfig` interface member is retired.

This is a perf-only change — no output changes. Measured on a real ObjectQL
engine (ObjectQL + `@objectstack/driver-sql` on better-sqlite3 `:memory:`,
`record-change-integration.test.ts`): an `afterUpdate` dispatch on an object
with no `formula` field now issues **0** hydration `findOne` calls, down from
**1** before this fix; an object that does declare a `formula` field is
unaffected (still exactly 1).
