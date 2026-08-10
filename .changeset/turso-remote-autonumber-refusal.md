---
"@objectstack/driver-turso": minor
---

fix(driver-turso): the remote face refuses an `auto_number` create instead of silently writing NULL (#6944)

`TursoDriver` picks its transport from `url`. Local and embedded-replica inherit
`SqlDriver`'s write path and issue record numbers from the persistent
`_objectstack_sequences` table. Remote overrides the write path to
`RemoteTransport`, which builds its own `INSERT` and never enters
`fillAutoNumberFields` — so on that face `auto_number` was only a column mapped
to `TEXT`, and the slot the engine deliberately leaves empty stayed empty.
Measured on `main` @ `2f3e79351`:

```
REMOTE create      -> RESOLVED case_number=null
REMOTE bulkCreate  -> RESOLVED [null, null]
REMOTE upsert      -> RESOLVED case_number=null
LOCAL  create      -> RESOLVED case_number="CASE-00001"
```

Nothing upstream caught it. `supports.autonumber` is `true` on this face
(inherited via `...super.supports`), so the engine defers generation to the
driver entirely and never runs its own fallback — `engine.ts` already records
`driver-turso` in its driver table as "inherited, no fallback path". A driver
face that boots and quietly fails to deliver a declared capability is the shape
#3724 ruled on; triage applied that ruling here on 2026-08-09 as **disposition
B — explicit refusal**. Implementing autonumber on the remote transport (A)
stays deferred for want of measured demand.

## What changed

`TursoDriver.create` / `bulkCreate` / `upsert` now refuse, in remote mode, a
write that would need a record number this face cannot issue:

```
NOT_IMPLEMENTED / 501
Object "crm_case" declares auto_number field(s) [case_number] left empty for
this create, and the Turso REMOTE transport does not generate record numbers. …
```

`NOT_IMPLEMENTED` / 501 is the same class this package already gives an
aggregate function it cannot compile (#5907) or a date bucket it cannot emit
(#6212), for the same reason and per ADR-0112: `autonumber` is a field type
`@objectstack/spec` declares and this very driver's other faces generate, so the
caller's object definition is correct and the gap is the backend's.

The refusal is raised on `TursoDriver`, not inside `RemoteTransport`, because
the transport cannot see what it would need in order to decide:
`RemoteTransport.create(object, data)` takes no schema and caches none. The
driver can — `registerRemoteFieldMetadata` → `registerExternalObject` classifies
every field at remote schema-sync time and populates `autoNumberFields`,
measured live in remote mode.

## What is deliberately NOT refused

- **A record that already carries a value in the slot.** That is the `isSystem`
  seed replay and the `preserveAudit` historical import, which the engine
  exempts from its strip on purpose (#5503); on this face they were, and remain,
  written through unchanged and correctly. The generate predicate
  (`undefined` / `null` / `''`) is `fillAutoNumberFields`' own, reused rather
  than re-derived.
- **A merging upsert.** `RemoteTransport.upsert` emits
  `INSERT … ON CONFLICT DO UPDATE`, so a row that matches keeps the number
  already in its column — measured. Only the provably-inserting shape (no `id`,
  no explicit conflict keys, so the transport mints a fresh id for the sole
  merge key) is refused. An id- or conflict-key-bearing upsert that turns out to
  insert is a known residue: classifying it needs the round trip the refusal
  exists to avoid, and it is pinned as such in the suite.
- **Local and embedded-replica.** Both still generate; pinned across all three
  faces so the refusal cannot leak onto the wrong one (#6203).

`packages/drivers/driver-turso` only. `driver-memory` / `driver-mongodb` sit
inside the #5499 freeze and declare no `supports.autonumber`; they take the
engine's own fallback path and are unrelated.
