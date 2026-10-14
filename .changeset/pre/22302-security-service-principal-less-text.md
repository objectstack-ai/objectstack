---
'@objectstack/spec': patch
---

docs(spec): `ISecurityService` no longer says a context with no principal is admitted or keeps its scope

Clause-②: no

The contract text on `ISecurityService.getReadFilter`, `ISecurityService.canExport` and `ISecurityService.canReadObject` (its verdict's arm list and its fails-closed paragraph) said that a context carrying no principal at all keeps the scope the other layers compose for it, or is admitted, as the security middleware hands it through. Since ADR-0096 D5 strict mode `plugin-security` does neither. A non-system context with no position, no named permission set and no user id now gets `false` from `canReadObject` and `canExport`, the deny filter from `getReadFilter`, and `403 PERMISSION_DENIED` (`PermissionDeniedError`) from the engine middleware's principal-less refusal. The text now says so, at each of the three methods, and cites ADR-0096 D5.

The TSDoc on `ExecutionContext.flowRunId` and on the `ExecutionContext` input type (`kernel/execution-context.zod.ts`), and on `BaseEngineOptionsSchema.context` (`data/data-engine.zod.ts`), no longer teaches `{ flowRunId }` alone as an admitted, unscoped context: it carries no principal and is refused like any other.

Only comments change. No behaviour, export or type moves, and the system bypass and the ADR-0056 D2 deny baseline for a caller that carries a principal and resolves no permission set read as before. The corrected text ships in the published `.d.ts`.

What changes for you: nothing at runtime. If your code read the old text and passes the engine a context that carries neither the caller's principal nor `isSystem: true`, it is refused; pass the caller's own context or, for platform code whose own door already authorized the caller, the explicit system opt-in `{ isSystem: true }`.
