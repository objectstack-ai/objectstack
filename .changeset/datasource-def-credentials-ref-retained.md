---
"@objectstack/objectql": minor
---

feat(objectql): retain and expose `external.credentialsRef` on datasource definitions (#12758)

`ObjectQL.registerDatasourceDef`'s parameter type carried only `name`,
`schemaMode` and `external.allowWrites`, so a caller passing a fresh object
literal with `external.credentialsRef` was refused by excess-property checking
(`TS2353`) — while the docs (`/docs/data-modeling/external-datasources`)
prescribe exactly that key on a code-declared datasource, and
`@objectstack/spec` has declared it all along on
`ExternalDatasourceSettingsSchema`, valid in every `schemaMode` (#8153). The
engine also exposed **no reader at all** onto its datasource index; its sole
consumer was the private write gate.

Measured before anything was changed: nothing stripped the reference at
runtime. The writer stores the caller's `external` object whole, by reference,
and the package-manifest install path spreads the def straight through — so the
value was already in the index, unreachable to every typed producer and every
consumer. The defect was type-level, and the fix is a widening plus the
accessor that was missing.

- `registerDatasourceDef` now takes the named, exported `DatasourceDef`, whose
  `external` block carries `credentialsRef?: string` beside `allowWrites`.
  Retention, not invention: the key is the spec's, and every shape that
  compiled before still compiles.
- New `ObjectQL.listDatasourceDefs()` answers every definition the engine
  holds, from both entry routes. Deliberately unfiltered — `credentialsRef` is
  valid on a managed datasource too, so filtering by schema mode would hide
  live handles from a `sys_secret` reference sweep, and under-reporting is the
  direction that deletes live credentials. Each entry carries a copied
  `external` block so a reader cannot reach through it and mutate the write
  gate's own input.

Why this matters beyond tidiness: a datasource declared **in code** never
reaches `sys_metadata`, so the cross-producer `sys_secret` reference union
(#12663) cannot see the handle it holds and must be handed the list by its
host. That makes the completeness of the union — the precondition an orphan
sweep's deletion predicate rests on — depend on every caller remembering to
pass a list. This moves the guarantee from process to mechanism. The union is
not rewired here; that is consumer-side work on a shipped contract and is
tracked separately.

The write gate is untouched: it reads `schemaMode` + `allowWrites`, the new key
is inert to it, and both directions of the gate stay pinned.

**Why `minor` and not `patch`.** Zero runtime behaviour changes, which is the
honest case for `patch` — but the bump describes the **contract**, not the
bytes executed, and this release adds public API three ways: a new public
method (`listDatasourceDefs`), a newly exported type (`DatasourceDef`), and a
widened accepted set on an existing public method (calls that were rejected at
compile time now compile). A consumer pinning `~` would receive new API under a
`patch`, which misdescribes the release. Nothing is removed, narrowed or
renamed, so no breaking-change declaration and no ADR-0087 entry arise; `minor`
is the additive-surface bump, not the launch-window breaking convention.
