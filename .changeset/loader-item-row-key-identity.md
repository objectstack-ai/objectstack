---
"@objectstack/metadata": patch
---

fix(metadata): key loader-held items by the row key they were stored under, so a body with no top-level `name` is no longer dropped from `list()` (#14205)

`MetadataManager.readListUncached()` — and its no-catch sibling
`listForIndex()`, which builds the endpoint index — merged each loader's answer
into the result set keyed by `body.name`, and admitted an item ONLY when the
stored body carried a string `name`.

A metadata body is not required to name itself. `register(type, name, data)`
takes the key as its ARGUMENT, and `assertMetadataRegisterContract` says so in
as many words: "A document with NO `name` of its own is fine — the argument is
the key". An aggregated `defineView` container is exactly that shape — no own
`name` by design, its identity being the target object, carried in the row's
`name` COLUMN — and `DatabaseLoader.rowToData()` returns the stored body
without folding the column into it.

So a container written by `register('view', OBJECT, container)` lived in the
registry for the life of the process and was written to `sys_metadata`, and
then **disappeared at the next restart**: cold registry, only the loader
answering, and `list('view')` refused the row. `listDiagnosed()` reported that
short answer as complete (`degraded: false`) because no loader had thrown. Not
scoped to views — any loader-held body with no top-level `name` was invisible.

**The repair.** A loader-held item's identity is the key its store holds it
under, so the manager now asks the loader for that key rather than guessing it
from the body: `MetadataLoader` gains an OPTIONAL `loadManyKeyed()` returning
`(name, body)` pairs, implemented by `DatabaseLoader` (from the row's `name`
column) and `MemoryLoader` (from its storage map key). The key travels BESIDE
the body and is never folded into it, so nothing synthesises a `name` into a
body that deliberately has none and the register contract's refusal of a
disagreeing `data.name` keeps meaning what it says.

**Nothing consumers see today changes shape.** For any item that went through
`register()`, a `data.name` that exists is required to equal the key, so the
keyed merge produces the identical entry; what is new is only the items the old
gate refused. `loadManyKeyed()` is optional, and a loader without it (a
`RemoteLoader`, whose wire format carries bodies only) falls back to the
previous `body.name` keying unchanged — so no implementor of the published
`MetadataLoader` interface needs to change.

`MetadataManager.loadMany()` is deliberately untouched: its `body.name` test is
a de-duplication guard, not an admission gate — a nameless item already fell
past it and was returned — so it never carried this defect.
