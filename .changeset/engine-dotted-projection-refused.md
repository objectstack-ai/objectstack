---
"@objectstack/objectql": minor
---

<!-- adr-0087: registered engine-dotted-projection-refused -->

fix(objectql)!: `engine.find` / `engine.findOne` refuse a dotted projection instead of widening the response to every field (#7589)

`engine.find()` and `engine.findOne()` are a **public API**, and a `fields`
entry carrying a dotted path (`['name', 'account.name']`) — which used to
answer 200 with **every** column, byte-identical to no projection at all —
now **throws `400 INVALID_FIELD`**.

#7532 (PR #7588) closed this at the REST ingress
(`assertProjectionFieldsExist`), covering everything that reaches `findData`.
A caller reaching the engine directly passed through none of it, and that
caller set was measured, not assumed (#7589): a flow `get_record` node's
authored `fields: ['name', 'account.name']` parses (`GetRecordConfigSchema`
restricts nothing), travels verbatim into `data.find(...)` /
`data.findOne(...)`, cleared the engine's head-only projection filter on its
head segment (`account` IS a field), and reached the driver as a projection
column — where SQL renders `"account"."name"` against a table that was never
joined, the DB answers `no such column`, and the driver's #3821 recovery
ladder retries `select('*')`. The caller asked to narrow and silently
received everything, pointing away from both FLS and data minimisation. A
saved report's `query.fields` (`plugin-reports` forwards it verbatim) reached
it the same way.

The head-only check was justified by its own comment: "the engine will
resolve those via populate". **No populate step exists** — #7601 measured it,
and this comment was the last place in the repo asserting dotted-path
resolution does. The comment and the check it explained are gone together;
what is removed is not a working feature but a path to widening, kept alive
by a false premise.

**FROM → TO**: a direct-engine caller (flow `get_record` `fields`, saved
report `query.fields`, hook code) projecting `account.name` reads the related
record with `expand` (`{ expand: { account: { object: '<target>', fields:
['name'] } } }`) while keeping the reference column itself in `fields`, or
denormalises the value onto the queried object (a stored field, written when
the source changes) and names that. A plain reference column (`fields:
['account']`) still projects.

**Deliberately KEPT** (same ruling, 2026-08-12): the unknown-PLAIN-column
tolerance — an unknown plain name is still dropped silently and an
all-unknown projection still falls back to `*`, because the "no records
exist" failure that tolerance prevents is real. A registry-less host (no
field map) gets **no** verdict, exactly as the ingress gate returns early
there; for that host the driver-side #3821 ladder remains the documented
backstop, and a driver-side carve-out stays measured-need only. One path is
observable rather than refused: a dotted `fields` inside a nested `expand`
raises this refusal inside `expandRelatedRecords`' pre-existing
graceful-degradation `catch`, so it logs a warning naming the field and the
fix and retains the raw foreign keys — the same posture the sort axis (#7095)
records for the same catch.
