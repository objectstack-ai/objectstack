---
'@objectstack/spec': patch
---

feat(spec): register `PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE`, the code the package disable door answers when an enabled package's validation rule reads a field the package adds

Clause-②: yes (widening)
Metadata-protocol: none

The error-code ledger (`ERROR_CODE_LEDGER`, and so `ErrorCode`) gains one `@objectstack/runtime` code. `PATCH /api/v1/packages/:id/disable` will answer it with `409` when a validation rule of a package that stays enabled (any severity, an app's `.custom` pair included) reads a field the package being disabled adds through `objectExtensions`. Disabling the package would withhold that field, and every write to the object would then fail that rule. The refusal names each package, object and rule it found, and there can be several. To go ahead, disable or change the reading rule first, or keep the package enabled.

Registration only: the disable door does not answer this code yet. It starts to when the door's dependent scan lands. No existing code changes, and no standard-catalog member is shadowed, so no synonym waiver is needed.
