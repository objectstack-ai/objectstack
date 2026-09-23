---
'@objectstack/spec': minor
---

`ERROR_CODE_LEDGER['@objectstack/plugin-security']` now lists the three codes the package stamps as class fields and ships in `dist`: `INVALID_STATE` (`PermissionSetOverlayStateError`, 409), `NOT_FOUND` (`PermissionSetNotFoundError`, 404) and `NOT_OVERRIDABLE` (`PackagedPermissionSetLockedError` and `PackagedPermissionSetProvenanceUnknownError`, 403) (#19441).

Clause-②: yes

Provenance, not identity: each code was already registered under another package (`@objectstack/rest`, `@objectstack/metadata-protocol`), so the `ErrorCode` union, the wire, and every other package's rows are unchanged. What widens is the per-package face a consumer reads from `ERROR_CODE_LEDGER['@objectstack/plugin-security']`. The `NOT_FOUND` synonym waiver's `reason` text now names plugin-security among its emitters; its `code` and `shadows` are unchanged. Nothing to migrate.
