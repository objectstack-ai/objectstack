---
"@objectstack/cloud-connection": patch
---

`POST /api/v1/marketplace/install-local/:manifestId/purge-sample-data` now deletes an installed package's sample rows. Before, it answered `500 DRIVER_UNAVAILABLE` on every runtime.

Clause-②: no

- **What was wrong.** The purge looked up a bare `driver` service, a name no kernel registers (drivers register as `driver.<name>`), so it refused everywhere. Behind that it matched seed records by `id`, which seed records rarely carry: the CRM example's 28 records key by `name`, `email` and `subject`. It also deleted through the driver, past every engine hook.
- **What it does now.** It deletes through the ObjectQL engine, so lifecycle hooks and the audit trail run, under the posture the seed was written with (record-change automation suppressed). Rows are matched by each dataset's `externalId`, the key the install and the reseed upsert by. A row whose key no seed record declares is never touched. Children are deleted before parents, in the reverse of the seed loader's own dependency order.
- **Scope.** Under an organization wall the purge removes only the seed rows of the caller's active organization, the scope the install and the reseed seed into. A session with no active organization is answered `400 RESEED_SKIPPED` (`multi-tenant-no-active-org`), the way reseed answers it. Without a wall the deployment is one tenant, and the match is table-wide, as the install's own match is.
- **The response keeps its shape**, `{ manifestId, deleted, skipped, errors, withSampleData }`. `skipped` counts seed records no row carries (already deleted). `errors` counts records that could not be purged, each with its reason in the server log: a delete the engine refused (for example, a user's row still requires the seed row as its parent), a key that more than one row carries, or a seed record with no key value.
- A runtime with no data engine or no metadata service still answers `500 DRIVER_UNAVAILABLE`, now naming what is missing.
