---
"@objectstack/service-datasource": minor
"@objectstack/metadata-protocol": minor
"@objectstack/runtime": minor
---

fix(service-datasource,runtime,metadata-protocol)!: a stored datasource row no longer displaces a code-defined datasource at boot, and the metadata door refuses edits to the host's `default` (#21922, #21944)

Clause-②: no (narrowing)

A code-defined datasource (one the installed artifact declares in `*.datasource.ts`, or the host's own `default`) is read-only: `DatasourceSchema.origin` publishes it as "GitOps-owned, read-only in the UI", and the datasource-admin service states "code wins on collision". The boot restore broke both. It registered every stored `datasource` row in `sys_metadata` over whatever the runtime had registered from code, so after a restart a row left under a code-defined name was served by the admin door, editable there when it carried `origin: 'runtime'`, and handed to pool rehydration. A stored `default` row opened a second live pool named `default` on the row's own connection. The metadata door also still saved edits to `default`, the one code-defined datasource no package declares.

The runtime now keeps one in-memory set of the datasource names it registers from code, on the kernel service `code-datasource-names`: `AppPlugin` adds the datasources the artifact declares and `DefaultDatasourcePlugin` adds `default`, both in `init()`, so the set is complete before any `start()` runs. The boot restore skips a stored row under a name in that set, and the metadata door's code-datasource check reads the same set.

**BREAKING — what moves for consumers.**

- After a restart over a stored row under a code-defined datasource's name, `GET /api/v1/datasources` serves the code definition (`origin: code`) instead of the row, and `PATCH /api/v1/datasources/:name` answers `400 DATASOURCE_ADMIN_ERROR` ("… is code-defined and cannot be edited at runtime.") where it answered 200 for a row that carried `origin: 'runtime'`.
- No live pool is opened from such a row at boot.
- `PUT /api/v1/meta/datasource/default` answered 200 and now answers `403 NOT_OVERRIDABLE`. `DELETE /api/v1/meta/datasource/default` with no stored row answered 200 and now answers the same `403`. The refusal's remedy names the host's database configuration (the database URL the server starts with), which is what defines `default`; every other code-defined datasource's refusal still names its `*.datasource.ts` source.
- The skipped row is kept, and the boot logs one warning naming it.

**Remedy.**

- To change a code-defined datasource, change its code definition and redeploy: its `*.datasource.ts` source, or the host's database configuration for `default`.
- A row the boot warning names is removable, and removing it is the repair: `DELETE /api/v1/meta/datasource/:name` answers 200 and deletes it.

**Unchanged.** A runtime datasource with no code twin restores, saves and deletes through both doors as before. A host that composes neither `AppPlugin` nor `DefaultDatasourcePlugin` registers no set, and its stored rows restore as before. While a stored row exists under a code-defined name, `GET /api/v1/meta/datasource/:name` still serves that row (the metadata door reads its stored overlay first); after the `DELETE` above it serves the code definition, in the same boot.

<!-- adr-0087: not-required (no-migration-prescription) a boot-restore verdict and a metadata-door verdict on datasources the host registers from code, which the published contract already calls read-only: no authorable key, spelling, export or stored shape moves, and no stored row is rewritten, converted or dropped. A row an earlier runtime write left under a code-defined name stays in sys_metadata and is removed by the operator with the metadata door's own DELETE; which stored edit an operator meant to keep is not something a ledger entry can rewrite. The other categories are closed on facts: every bumped package publishes (not unpublished); no ADR-0087 id covers this restore or this door (not already-registered); and the change is a verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
