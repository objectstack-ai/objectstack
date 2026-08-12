---
'@objectstack/spec': minor
---

Close the memory driver's `persistence` sub-shapes against unknown keys (#4001 batch B)

zod's default is `.strip`: a key a schema does not declare is silently
discarded and the parse still succeeds. `datasource.config` for a `memory`
driver has been parsed since #4410, but `.strict()` does not recurse — the
top-level `MemoryConfigSchema` was closed then, while the five variant shapes
nested under its `persistence` union stayed open, so a typo written *inside*
`persistence` (e.g. `{ type: 'file', filepath: '/data.json' }`) parsed clean
and the driver came up on its persistence defaults with no signal at all.

`PersistenceAdapterSchema`, `FilePersistenceConfigSchema`,
`LocalStoragePersistenceConfigSchema`, `CustomPersistenceConfigSchema` and
`AutoPersistenceConfigSchema` now raise a named, fixable error — the surface,
the offending key, and (where the schema declares one) an edit-distance "did
you mean" suggestion — instead of dropping the key.

No field was added or removed; every existing valid payload still parses the
same. Only a config that was already writing an unrecognised key under
`persistence` sees a new, loud rejection in place of the old silent no-op.
