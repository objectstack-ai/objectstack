---
'@object-ui/core': patch
---

fix(core): an `api` action's target is interpolated before a registered `api` handler sends it

Clause-②: no
Metadata-protocol: none

An `api` action whose `target` carries `${ctx.recordId}` (or any other `${ctx.X}` / `${param.X}` token) went out on the wire with the literal placeholder (`/api/v1/data/gapdata_item/$%7Bctx.recordId%7D`) when a host had registered its own `api` handler, as the Console does, so a record-level PATCH or POST hit a record that does not exist. A `url` action with the same token already resolved it. `ActionRunner` now runs its one target substitution on an `api` target before handing the action to a registered `api` handler, with the same scopes and the same per-value `encodeURIComponent` a `url` target gets. The built-in executor already did this and is unchanged; a registered handler for any other type still receives its target as authored.
