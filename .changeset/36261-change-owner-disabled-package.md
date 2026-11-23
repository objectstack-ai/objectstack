---
'@objectstack/core': patch
'@objectstack/metadata-protocol': patch
---

fix(core): Change Owner refuses an object of a disabled package `404 OBJECT_PACKAGE_DISABLED`

Clause-②: no
Metadata-protocol: none

`POST /api/v1/data/:object/:id/change-owner` and `POST /api/v1/data/:object/change-owner` changed owners, and sent owner-change notifications, on records of an object whose owning package was disabled, although every `/data` write refuses such an object. `changeRecordOwner` and `changeRecordsOwner` now ask the engine registry's `isObjectPackageDisabled` before the object's Change Owner switch is read, and refuse the whole call with the data door's own envelope (`code: 'OBJECT_PACKAGE_DISABLED'`, `status: 404`, the object name on `object`) before any user lookup, write or notification. Re-enabling the package restores the action; nothing is cached.

The refusal's constructor, `objectPackageDisabledError`, now lives in `@objectstack/core` and is exported from it; `@objectstack/metadata-protocol` re-exports the same function under the same name, so its importers are unchanged and the code, status and sentence stay one.
