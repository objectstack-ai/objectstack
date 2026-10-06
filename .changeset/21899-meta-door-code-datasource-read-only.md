---
"@objectstack/metadata-protocol": minor
---

fix(metadata-protocol)!: the metadata door refuses an edit of a code-defined datasource, and removes only a stored row left under one (#21899)

Clause-②: no (narrowing)

A datasource an installed package declares in `*.datasource.ts` is code-defined: `DatasourceSchema.origin` publishes it as "GitOps-owned, read-only in the UI", and the datasource-admin door already refused to edit or remove one. The metadata door did not. The runtime registers a code-defined datasource in memory only, never as a registry item, so the door's artifact check missed it and the write took the runtime-create tier: `PUT /api/v1/meta/datasource/:name` answered 200, persisted a row, and the metadata read then served that row in place of the code definition.

The door's artifact check now reads the datasources the installed packages declare, so the package door that refuses every other code-shipped item of a type with no overlay channel refuses this one too.

**BREAKING — what moves for consumers.**

- `PUT /api/v1/meta/datasource/:name` on a code-defined datasource answered 200 and now answers `403 NOT_OVERRIDABLE`: "Datasource ':name' is code-defined and cannot be edited at runtime: it is read-only. Edit the *.datasource.ts source that declares it and redeploy."
- `DELETE /api/v1/meta/datasource/:name` on a code-defined datasource with no stored row answered 200 ("nothing to delete") and now answers the same `403 NOT_OVERRIDABLE`, saying "cannot be removed at runtime".
- The admin door keeps its own `400 DATASOURCE_ADMIN_ERROR`. The two doors' codes differ; the verdict and the remedy are the same.
- The metadata read envelope reports the same answers: `editable: false`, and `deletable` true only while a stored row exists under the name.

**Remedy.**

- To change a code-defined datasource, edit the `*.datasource.ts` source that declares it and redeploy.
- A row an earlier `PUT` stored under a code-defined datasource's name is still removable, and removing it is the repair: `DELETE /api/v1/meta/datasource/:name` answers 200 and deletes it, once per name. After the next restart both doors serve the code definition again. Until that restart the datasource-admin service keeps the stored copy it restored at boot (tracked in #21922).

**Unchanged.** A runtime datasource, one no package declares, saves and deletes through the metadata door as before. `OS_METADATA_WRITABLE=datasource` opens the lock exactly as it did. The host's `default` datasource is declared by no package, so the metadata door still accepts edits to it as before; the admin door refuses them.

<!-- adr-0087: not-required (no-migration-prescription) a refusal of metadata-door writes the published contract already forbids, on datasources an installed package declares: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A row an earlier save left under a code-defined name stays readable and is removed by the operator with the door's own DELETE; which stored edit an operator meant to keep is not something a ledger entry can rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this door (not already-registered); and the change is a door verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
