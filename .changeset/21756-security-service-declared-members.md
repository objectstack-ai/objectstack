---
'@objectstack/spec': minor
---

`ISecurityService` declares the two members the registered `security` service already served without a declaration: `discardPermissionSetOverlay` and `contributeOwnershipFloorAlternates`. Both are optional, and callers feature-detect them.

Clause-②: yes (widening)

- **`discardPermissionSetOverlay(callerContext, id)`** (`@objectstack/spec/contracts`). The audited operator action behind a permission set's "Discard Overlay" Setup action: it deletes the stale environment overlay that shadows a package-declared permission set, then re-projects the row from the declared artifact before it resolves. Its docblock names the refusals it throws and the codes they carry: `PERMISSION_DENIED` (403) when the caller is not a tenant-level administrator or no installed package declares the set, `NOT_FOUND` (404) for an unknown row, and `INVALID_STATE` (409) when there is no active overlay to discard. It resolves with the new `PermissionSetOverlayDiscardResult` type. The REST route answers `501 NOT_IMPLEMENTED` when the method is absent.
- **`contributeOwnershipFloorAlternates(plugin, alternates)`**. The seam through which a plugin that installs a tighter row gate stops the platform's `created_by` write floor pre-empting that gate on one object and one limb. Its docblock names what it refuses (a wildcard object, an operation other than exactly `update` or `delete`, a missing or malformed policy), and says a second call replaces the same plugin's first and an empty list withdraws it. The new `OwnershipFloorAlternate` type is the minimal contract shape of one alternate.
- **Optional, and absence is typed.** A security service without either member still satisfies the contract, and an unguarded call does not compile.

Nothing an author writes changes. An implementation typed as `ISecurityService` that serves either name must now serve it under the declared signature; `@objectstack/plugin-security` already does, and needs no change.
