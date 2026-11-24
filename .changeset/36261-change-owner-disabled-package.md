---
'@objectstack/core': patch
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

fix(core)!: Change Owner refuses an object of a disabled package with the data door's `404 OBJECT_PACKAGE_DISABLED`

Clause-②: yes (narrowing) — `@objectstack/core` gains the root export `objectPackageDisabledError`, and all three Change Owner doors newly answer `404 OBJECT_PACKAGE_DISABLED` for an object of a disabled package, which they answered `200` before
Metadata-protocol: none
Skills-docs: none — no page under `skills/` teaches Change Owner; the refusal carries the data door's own sentence, which names the fix

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row, registry key or authored value changes. What moves is the answer the three Change Owner doors give for an object whose owning package is disabled, an answer that returns to what it was the moment the package is re-enabled; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller that changes owners on a disabled package's object.

- FROM: `POST /api/v1/data/:object/:id/change-owner` and `POST /api/v1/data/:object/change-owner` answered `200` for an object of a disabled package: the owner changed (and, when a cascade was named, its child rows), and when asked the notification was sent; `GET /api/v1/data/:object/change-owner/cascades` answered `200` with the object's cascade candidates.
- TO: all three doors answer `404 OBJECT_PACKAGE_DISABLED`, naming the object, in the data door's words; nothing is read, written or sent. The fix for a caller: re-enable the package.

`POST /api/v1/data/:object/:id/change-owner` and `POST /api/v1/data/:object/change-owner` changed owners (and cascaded child rows), and sent owner-change notifications, on records of an object whose owning package was disabled, although every `/data` write refuses such an object. `changeRecordOwner` and `changeRecordsOwner` now ask the engine registry's `isObjectPackageDisabled` before the object's Change Owner switch is read, and refuse the whole call with the data door's own envelope (`code: 'OBJECT_PACKAGE_DISABLED'`, `status: 404`, the object name on `object`) before any user lookup, write or notification. Re-enabling the package restores the action; nothing is cached. `GET /api/v1/data/:object/change-owner/cascades` asks the same predicate in the same order (after the object resolves, before the switch), so the dialog lists nothing for such an object.

The refusal's constructor, `objectPackageDisabledError`, now lives in `@objectstack/core` and is exported from it; `@objectstack/metadata-protocol` re-exports the same function under the same name, so its importers are unchanged and the code, status and sentence stay one. The error-code ledger (`@objectstack/spec`) records `OBJECT_PACKAGE_DISABLED` under `@objectstack/core` as a provenance row; the code itself, its status and its wire shape are unchanged.
