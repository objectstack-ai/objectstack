---
"@objectstack/objectql": patch
"@objectstack/runtime": patch
---

fix(objectql): `SchemaRegistry.registerObject`'s cross-package ownership refusal carries an ADR-0112 envelope (#14367)

The ADR-0029 D3 refusal — a package claiming `own` on an object name a DIFFERENT package already owns — was a bare `Error`: no `code`, no `status`. It is now `ObjectOwnershipConflictError` with `code: 'OBJECT_OWNERSHIP_CONFLICT'` and `status: 422`, plus `objectName` / `existingPackageId` / `incomingPackageId` as fields, the same shape as the sibling `ArtifactObjectNameConflictError`. The message text is byte-for-byte unchanged, so every message-substring assertion and every forwarder that interpolates it (`console.warn`, the per-record `errors` count) reads what it read before.

Why it matters: a rejection test on this path could only ever be a bare `toThrow()`, and a throw-shaped assertion stays green against an unrelated `Error` from anywhere on the path — measured when the install-time `DUPLICATE_ARTIFACT_OBJECT_NAME` check was ablated and its "refused" assertion stayed green because this refusal fired one step later. Rejection tests can now assert `code` + `status` on this path, and the existing sites that asserted only the message do.

Not narrowed, not widened: no accept-set changes. The ADR-0029 D9 §6.1 late-install branch (a tenant-authored sitting owner is re-classified as the code package's overlay layer) is not a refusal and is unchanged.

`@objectstack/runtime` carries the classification row for the new code in the dispatcher error-code vocabulary (verdict `boot-refusal`, door `none`: measured on this tree, every path to the refusal either aborts boot inside plugin init or catches below any HTTP door, and the two HTTP install sites never call `registerObject`).
