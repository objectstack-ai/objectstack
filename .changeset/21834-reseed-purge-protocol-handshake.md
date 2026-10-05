---
"@objectstack/cloud-connection": patch
---

`reseed-sample-data` and `purge-sample-data` on an installed package that this runtime refused to load now answer `422 OS_PROTOCOL_INCOMPATIBLE` before they change anything. Before, both acted on such a package anyway.

Clause-②: no

- **What was wrong.** On a restart, a ledger entry whose `engines.protocol` range excludes this runtime is not loaded: nothing is registered, synced, bound or seeded for it. `POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data` on that entry loaded the package's translations into the i18n service and merged its seed datasets into the kernel's shared `seed-datasets` list, and then failed with `400 RESEED_SKIPPED` because the package's objects were never registered. `POST …/:manifestId/purge-sample-data` answered `200` with every record counted in `errors`, and set the ledger's `withSampleData` to `false` with no row deleted.
- **What it does now.** Both doors run the protocol check on the ledger entry right after reading it. An entry whose declared range excludes this runtime gets the answer the install route gives the same manifest: `422`, `error.code` `OS_PROTOCOL_INCOMPATIBLE`, the check's own message, and `error.details` with `requiredRange`, `rangeSource`, `protocolVersion`, `targetMajor` and `migrateCommand`. No translation is loaded, no dataset is merged, no seed row is read or deleted, and the ledger is not written. The refusal comes before the organization check too, so a session with no active organization on a walled deployment also gets the `422` for such an entry.
- **Unchanged.** An entry this runtime loads is answered exactly as before. An entry that declares no range, or a range the check cannot read, is admitted as before, with no new warning. `DELETE /api/v1/marketplace/install-local/:manifestId` still removes a refused entry, and installing a compatible version over it makes both doors act on it again.
