---
"@objectstack/objectql": minor
---

feat(objectql): opt-in `sys_metadata` hydration for isolated project kernels

Boot Phase-2 hydration (`restoreMetadataFromDb` → `loadMetaFromDb`, which
registers objects WITH their fields into the `SchemaRegistry`) was gated on
`environmentId === undefined`, assuming every project kernel sources its
metadata from a remote artifact / control-plane proxy. That is untrue for an
isolated, proxy-free project kernel that persists its OWN `sys_metadata`
locally (the cloud single-env tenant runtime): objects created at runtime there
never re-entered the registry after a restart, so `registry.getObject(name)`
returned nothing and every registry consumer silently degraded (notably the
`engine.find` unknown-`$select` guard, which then let an unknown projected
column zero the result set).

Adds an explicit `hydrateMetadataFromDb` plugin option (default `false`, so the
control-plane/proxy path is untouched). When set, hydration runs even with
`environmentId` defined — safe because each engine now owns its registry
instance and `loadMetaFromDb` already tolerates a missing table.
