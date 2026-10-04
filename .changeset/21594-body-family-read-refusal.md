---
'@objectstack/runtime': minor
---

fix(runtime)!: an app-authored body may not read the stored-metadata tables either; it reaches them through the metadata API only (#21594)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no metadata body, authorable key, spelling, export or stored shape moves; what changes is which reads a sandboxed hook, action or job body may make of the two stored-metadata tables, so `objectstack migrate meta` has nothing to rewrite. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a refused read (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what an app-authored body may do with the two stored-metadata tables, `sys_metadata` and `sys_metadata_history`. With the binding and write refusals already in this release, an app-authored body now reaches them through the metadata API only.

- **Reading.** A sandboxed hook, action or job body's read of either table through `ctx.api` answers `PERMISSION_DENIED` / 403 before the read runs. That covers `find`, `findOne`, `count` and `aggregate`, inside a transaction or not, with or without elevation, and whatever filter, sort, grouping, search or projection the read carries. A body is served nothing of these tables, neither the stored row nor a projection of it, and the answer does not depend on what the read asks. A hook body that reads them fails the write that fired it.
- **Subject record.** An action body is not handed a row of either table as its subject record either. The `/actions` door loads an action's subject row before it dispatches. When that row is from either table, the call answers the same `PERMISSION_DENIED` / 403 before the body runs, instead of handing the body the row as `ctx.record`. That covers an action declared on either table (through a bundle, an installed package or the metadata door) and an object-less action addressed under one. A call that carries no record hands the body nothing and runs as before.
- **The route.** A body that read either table through `ctx.api.object(...)` was served the body projected and the content hash keyed; read metadata through the metadata API instead: `GET /api/v1/meta/:type/:name` for a definition, and `GET /api/v1/meta/:type/:name/history` for its versions. The refusal names that route. No shipped example reads either table from a body.
- **This supersedes, for bodies, two earlier entries of this release:** the served read of these tables, and the evaluate-shape refusals (`INVALID_FIELD` / 400) and default-search narrowing of that read. For a body, all of these now give way to this refusal. It also supersedes the binding-and-write entry's note that a body's reads are unchanged.
- **Unchanged:** host code that registers its own action handlers (its `ctx.api`, `ctx.engine.find` and subject record are still served as the generic data door serves these tables, with the door's evaluate refusals); the binding and write refusals; the platform's own readers; the generic data door and the metadata API; and every other object.

It ships as `minor` under the launch-window convention for accept-set narrowings.
