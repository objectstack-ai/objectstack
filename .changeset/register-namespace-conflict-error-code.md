---
"@objectstack/spec": minor
"@objectstack/runtime": minor
---

`POST /api/v1/packages` now answers an install-time namespace collision with `error.code: "NAMESPACE_CONFLICT"`. `NAMESPACE_CONFLICT` is registered in `ERROR_CODE_LEDGER` under `@objectstack/objectql`, so the closed ADR-0112 vocabulary (`StandardErrorCode ∪ ERROR_CODE_LEDGER`) gains one member and a caller can branch on the refusal directly.

**The wire, before and after** — measured through the shipped door (`HttpDispatcher.handlePackages` over a real `SchemaRegistry`), not derived from the call graph:

- before: `422` with `error.code: "VALIDATION_ERROR"` and `error.declaredCode: "NAMESPACE_CONFLICT"`
- after: `422` with `error.code: "NAMESPACE_CONFLICT"` and **no** `declaredCode` — with the spelling registered there is nothing left to demote

The status, the message and the throw are unchanged. `NamespaceConflictError` (`@objectstack/objectql`'s `SchemaRegistry.installPackage`, ADR-0048 Phase 1 / ADR-0130 D1) has carried `code` and `status: 422` since the envelope landed; what changed is that the door's #9106 narrowing no longer demotes the spelling. Until now a caller wanting to tell "your namespace is taken, rename it" from every other `422` had to read `declaredCode` — the channel ADR-0112 declares as the open, not-guaranteed one — because `error.code` carried the generic member `422` derives.

Scope of the widening: one new accept value on `ApiErrorSchema.code`; no export changes, no schema-shape changes, and nothing narrowed. A consumer that treats `error.code` as a closed set it enumerates locally will see a value it does not know, which is what a vocabulary widening means and why this is a `minor`.

The now-discharged `pending-registration` row ratchets out of `packages/runtime`'s dispatcher-error-vocabulary table in the same change — registration is what makes that row stale, and `pnpm check:dispatcher-error-vocabulary` fails on a registered code still carrying one. The door's answer is pinned in `packages/runtime/src/package-door-namespace-conflict-code.test.ts`, which drives the real route and asserts the body, so the reachability the removed row asserted is now held by a test rather than by a claim.
