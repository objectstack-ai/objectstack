---
"@objectstack/objectql": patch
"@objectstack/runtime": patch
---

fix(objectql): the ADR-0048 install-time namespace gate's refusal carries an ADR-0112 envelope, so `POST /packages` answers 422 instead of 500 (#14474)

`NamespaceConflictError` — raised by `SchemaRegistry.installPackage` when a package's `manifest.namespace` is already owned by an installed package that is not a co-owner of it (ADR-0130 D1) — carried `namespace` / `existingPackageId` / `incomingPackageId` but no `code` and no `status`. It now carries `code: 'NAMESPACE_CONFLICT'` and `status: 422`, the same three-field envelope shape as its sibling `ArtifactObjectNameConflictError` in the same file. The message text is byte-for-byte unchanged: the prose was already correct and specific, and this change adds fields rather than rewriting a sentence.

Why it matters, measured rather than read: unlike its three install-time siblings, this refusal is reachable from a wire. `POST /api/v1/packages` calls `installPackage` with no artifact scope — which this gate, unlike the ADR-0130 D3 object-name one, does not need — and the domain's terminal catch answers `errorFromThrown(e, 500)`. `resolveThrownHttpError` reads `.status` / `.code` off the throw and falls to the caller's fallback when it finds neither. Observed on a booted stack, two installs declaring one namespace:

- before: `500` with `error.code: INTERNAL_ERROR`, carrying the refusal's prose
- after: `422` with `error.code: VALIDATION_ERROR` and `error.declaredCode: NAMESPACE_CONFLICT`

A refusal the platform decided is a client-side conflict was telling operators the server had broken, which invites a retry instead of a rename.

Not narrowed, not widened: no accept-set changes, no export changes, and no ledger registration. `NAMESPACE_CONFLICT` is not an `ErrorCode` member, so the door's narrowing demotes it off `error.code` onto the wire's open `declaredCode` sibling and `error.code` stays the closed member 422 derives.

`@objectstack/runtime` carries the classification row for the new code in the dispatcher error-code vocabulary (verdict `pending-registration`, door `dispatcher` — the measured verdict, not the expected one). That row is the input to a ledger-registration batch in the `packages/spec` lane; registering the code is what ratchets the row back out and what would let `error.code` carry the semantic spelling.
