---
"@objectstack/cli": minor
"@objectstack/verify": minor
---

feat(datasource): reject field.columnName on external objects + drop showcase onEnable bridge (ADR-0062 Phase 4, D7/D8)

**D7 — reconcile column mapping.** `os compile`/`build` (`validateStackExpressions`)
now rejects `field.columnName` on a federated (external) object with a corrective
message: the driver's query pipeline ignores `field.columnName` for external
objects, so `external.columnMap` is the single authoritative mechanism. Managed
objects are untouched.

**D8 — drop the canonical example's driver bridge.** `examples/app-showcase`
declares its external datasource with **no** `onEnable` driver registration — the
declared datasource auto-connects at boot (ADR-0062 D1). `onEnable` now only
provisions the "remote" fixture tables. To cover this end-to-end, the
`@objectstack/verify` harness wires the datasource-admin plugin (registering the
`'datasource-connection'` service) when an app declares datasources, so it mirrors
`objectstack dev`/serve; a new dogfood test reads the federated objects through the
real REST stack (incl. the `remoteName` remap). `onEnable` + `ctx.drivers.register`
remains supported as an escape hatch for drivers built dynamically at runtime.
