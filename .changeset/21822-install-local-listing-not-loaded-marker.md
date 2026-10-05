---
"@objectstack/cloud-connection": patch
---

`GET /api/v1/marketplace/install-local` now marks an installed package that this runtime refused to load. Before, after a restart whose rehydrate refused a package built for another protocol major, the listing served it like any loaded package, and the console's Installed Apps showed it as installed.

Clause-②: no

- **What was wrong.** On a restart, a ledger entry whose `engines.protocol` range excludes this runtime is not loaded, and the boot logs `OS_PROTOCOL_INCOMPATIBLE` at `error`. The entry stays in the ledger, so `DELETE` and a compatible re-install still act on it. The listing served it with the same fields as a loaded package. Each request also tried to read its seed rows from objects that were never registered, and logged a `warn` saying it could not.
- **What it does now.** That entry is listed with `"notLoaded": { "code": "OS_PROTOCOL_INCOMPATIBLE", "requiredRange": "^16" }` (the range the package declares) in place of `withSampleData`. No seed row is read for it, so the per-request `warn` is gone. `notLoaded` has exactly these two members, and every authenticated caller sees it.
- **Unchanged.** A loaded package's entry is exactly as before, with no `notLoaded` key. `DELETE /api/v1/marketplace/install-local/:manifestId` removes a marked entry as before, and once a compatible version is installed over it, the entry is listed as loaded.
- **Where the marker comes from.** The rehydrate records each entry it refuses, and the listing reads that record. The listing does not run the protocol check again.
