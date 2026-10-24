---
'@objectstack/runtime': patch
'@objectstack/service-datasource': patch
---

fix(rest): an unknown resource answers `404 RESOURCE_NOT_FOUND` at the package draft and commit-trail doors, the flow runs list and delete, and the datasource by-name write doors, as their read siblings already did

Clause-②: no
Metadata-protocol: none

Eight doors answered a request about a resource that does not exist as if it were an empty or a bad request, while their sibling doors answered `404` for the same name. An SDK or AI caller could not tell "no such thing" from "nothing yet". Each now answers `404 RESOURCE_NOT_FOUND`, naming the missing resource, in the same words as its sibling:

- `POST /api/v1/packages/:id/publish-drafts` for a package the registry does not hold: was `200 { success: false, outcome: 'nothing_to_publish' }`, now `404 "Package '<id>' not found"`, the answer of `GET /api/v1/packages/:id`. `nothing_to_publish` is kept for a package that exists and has nothing pending. Drafts the protocol does hold for such an id are still published as before.
- `POST /api/v1/packages/:id/discard-drafts`, the same door's twin: was `200 { discardedCount: 0 }`, now the same `404`.
- `GET /api/v1/packages/:id/commits` for an unknown package: was `200 { commits: [] }`, now the same `404`. A trail that outlived its package's registry entry is still listed.
- `DELETE /api/v1/automation/:name` for a flow neither the engine nor the metadata store holds: was `200 { name, deleted: true }`, now `404 "Flow '<name>' not found"`. A stored flow the engine does not hold is still deleted and answered `200`.
- `GET /api/v1/automation/:name/runs` for an unknown flow: was `200 { runs: [], hasMore: false }`, now `404 "Flow '<name>' not found"`, the answer of `POST /api/v1/automation/:name/trigger`. An empty page is kept for a flow that exists and has not run.
- `PATCH`, `DELETE /api/v1/datasources/:name` and `POST /api/v1/datasources/:name/migrate-credential` for an unknown datasource: were `400 DATASOURCE_ADMIN_ERROR`, now `404`, the answer of `GET /api/v1/datasources/:name`. A code-defined datasource is still refused `400 DATASOURCE_ADMIN_ERROR`. The datasource-admin service now throws its not-found refusal with the `404` / `RESOURCE_NOT_FOUND` envelope, so an embedder calling `updateDatasource`, `removeDatasource` or `migrateCredential` directly can read `err.code` and `err.status`; the message is unchanged.

`ObjectStackClient` already throws on any non-2xx answer, so `packages.publishDrafts`, `packages.discardDrafts`, `packages.listCommits`, `automation.listRuns` and `automation.delete` now reject with the not-found message for an unknown id instead of resolving an empty result.
