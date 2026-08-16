---
"@objectstack/spec": minor
---

feat(spec): refuse undeclared keys on object `indexes[]` entries (#4001 批 20 site 14, the held `IndexSchema`)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

`IndexSchema` — 批 20's one deliberately-held site — is now `strictObject` like
its thirteen siblings. The hold was a measured #5114-class risk, not an
unfinished to-do: objectui's embedded index editor shipped a drifted
hand-copied schema (`FALLBACK_SCHEMAS.index`) offering `where` for a
partial-index predicate and `brin` in an algorithm enum, spliced its form
output into `object.indexes[]` and PUT the whole object — so closing the shape
would have 422'd a control the console itself rendered. objectui#4772
converged that editor to the declared surface (`name` / `fields` / `unique`),
spending the hold's evidence.

Before this change an undeclared key on an index parsed clean and was silently
dropped: an admin filling the old "Partial-index predicate" control got a
green save while no driver ever read the predicate
(`SqlDriver.syncDeclaredIndexes` consumes `name`/`fields`/`unique` only).

**What is refused:** any key the shape does not declare, with a prescriptive
message naming the surface and the offending key. `where` carries a curated
guidance entry — the predicate belongs at the database layer
(`CREATE [UNIQUE] INDEX … WHERE` from a runtime migration, the
`ensureOverlayIndex` pattern), deliberately NOT a rename onto the retired
`partial` tombstone (a suggestion pointing into a second rejection).

**What stays accepted:** every declared key byte-identically, including every
ADR-0120 `unique` scope spelling — and the protocol-17 `type`/`partial`
tombstones keep answering their own migration prescription rather than
degrading to a generic `unrecognized_keys`.

## FROM → TO

```ts
// before — parsed green; the predicate was silently dropped, the index built FULL
indexes: [{ fields: ['status'], where: "status = 'open'" }]

// after — rejected with the database-layer prescription; declare only what is materialized
indexes: [{ fields: ['status'] }]
// …and issue `CREATE INDEX … WHERE <predicate>` from a runtime migration when
// a partial index is actually needed.
```

There is deliberately no automatic rewrite: an undeclared key here either
names a capability the declaration surface does not deliver (blessing it would
be declared-but-unenforced surface, ADR-0078) or is a spelling of a declared
one, which the rejection names. `os migrate meta` surfaces the change as a
structured TODO (semantic entry `object-index-unknown-keys-refused`, protocol
major 18 — this refusal is not part of the v17.0.0 cut).

<!-- adr-0087: registered object-index-unknown-keys-refused -->
