---
'@objectstack/runtime': patch
'@objectstack/service-datasource': patch
---

fix(rest): an unknown resource answers `404 RESOURCE_NOT_FOUND` at the package draft and commit-trail doors, the flow runs list and delete, and the datasource by-name write doors, as their read siblings already did

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What changes is the HTTP answer eight REST doors give for a resource name that does not exist. -->

**BREAKING** (a served-set narrowing) for a caller that sends one of these doors a package id, flow name or datasource name that does not exist. Five of them used to answer such a request `200` with an empty result. All eight now refuse it.

Eight doors answered a request about a resource that does not exist as if it were an empty or a bad request, while their sibling doors answered `404` for the same name. An SDK or AI caller could not tell "no such thing" from "nothing yet". Each now answers `404 RESOURCE_NOT_FOUND`, with the status, code and message its sibling gives for the same name. FROM → TO, per door:

- `POST /api/v1/packages/:id/publish-drafts`, for a package the registry does not hold: `200 { success: false, outcome: 'nothing_to_publish' }` → `404 RESOURCE_NOT_FOUND "Package '<id>' not found"`. That is the answer of `GET /api/v1/packages/:id`.
- `POST /api/v1/packages/:id/discard-drafts`: `200 { success: true, discardedCount: 0 }` → the same `404`.
- `GET /api/v1/packages/:id/commits`: `200 { commits: [] }` → the same `404`.
- `GET /api/v1/automation/:name/runs`, for a flow the engine does not hold: `200 { runs: [], hasMore: false }` → `404 RESOURCE_NOT_FOUND "Flow '<name>' not found"`. That is the answer of `POST /api/v1/automation/:name/trigger`.
- `DELETE /api/v1/automation/:name`, for a flow that neither the engine nor the metadata store holds: `200 { name, deleted: true }` → the same `404`.
- `PATCH /api/v1/datasources/:name`, for a datasource that does not exist: `400 DATASOURCE_ADMIN_ERROR "Datasource '<name>' not found."` → `404 RESOURCE_NOT_FOUND 'Datasource "<name>" does not exist.'`. That is the answer of `GET /api/v1/datasources/:name`, word for word.
- `DELETE /api/v1/datasources/:name`: the same `400` → the same `404`.
- `POST /api/v1/datasources/:name/migrate-credential`: the same `400` → the same `404`.

Unchanged: a resource that exists keeps its answer. An empty page for a flow that has not run, `nothing_to_publish` for a package with nothing pending, and `400 DATASOURCE_ADMIN_ERROR` for a code-defined datasource all stay as they were. Drafts or commits the store holds for an id the registry no longer lists are still published, discarded or listed. A stored flow the engine does not hold is still deleted. A failed ADR-0045 visibility flip still answers `200` with its `unhideError`.

**What changes for you.** `ObjectStackClient` already throws on any non-2xx answer. `packages.publishDrafts`, `packages.discardDrafts`, `packages.listCommits`, `automation.listRuns` and `automation.delete` now reject with the not-found message for an unknown id, instead of resolving an empty result. Treat that rejection as "no such resource". An embedder calling `DatasourceAdminService.updateDatasource`, `removeDatasource` or `migrateCredential` directly now gets an error carrying `code: 'RESOURCE_NOT_FOUND'` and `status: 404`. Its message is now `Datasource "<name>" does not exist.`.
