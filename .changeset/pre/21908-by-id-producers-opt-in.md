---
"@objectstack/service-storage": patch
"@objectstack/service-messaging": patch
---

The storage store's by-id methods and the HTTP outbox's `redeliver` now pass the explicit system opt-in (`{ isSystem: true }`) on their data-engine calls. Until now they reached the engine with no principal and no opt-in, and the security middleware let that through only because of its principal-less hand-off.

Clause-②: no

- **service-storage.** `StorageMetadataStore.getFile`, `updateFile`, `deleteFile`, `getSession`, `updateSession` and `deleteSession` take the opt-in inside the store. Access stays by id, and the reads stay unscoped by organization, as before. On update and delete the acting organization still reaches the driver beside the opt-in, so a row stamped for another organization is still out of reach of these doors. The doors keep the authorization they already ran.
- **service-storage, the update payload.** `updateFile` and `updateSession` now send the caller's patch alone, where they used to send the whole row read back merged with it. The engine's read-only strip, which does not run for a system write, used to take `organization_id` and the four audit columns out of that row; now the store never sends them. The stored row is the same as before, and a column another writer changed between the read and the write is no longer reverted by it.
- **service-messaging.** `SqlHttpOutbox.redeliver` takes the opt-in on both of its reads and on its reset write. The caller's `tenantId` stays on every call as the driver-level scope, so a delivery in another organization is still not found. The reset write states `bypassTenantAudit: false`, so a redelivery from a caller with no organization is still reported by the driver's tenant audit.
- None of the gates the security middleware runs before its hand-off applies to these calls. ⛔ No new export on either package entry, and no new elevation API.
