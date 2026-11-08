---
'@objectstack/objectql': patch
'@objectstack/runtime': patch
---

feat(objectql, runtime): the action engine keeps each package's handler under one object and action name (ADR-0150 D4)

Clause-②: no (narrowing)
Metadata-protocol: none

Two packages can now each register a handler for the same object and action name, and both are kept. `ObjectQL#executeAction(objectName, actionName, ctx, { packageId })` runs that package's own handler. With no `packageId` it runs exactly what it ran before: the last registration under `OBJECT:NAME`, with the replacement still warned and naming both packages.

The router (`resolveRouteActionDeclaration`) takes an optional `callerPackageId`. Given one, it resolves the bare action name through the package-scoped resolver (ADR-0150 D3) over the `action` items that belong to the routed object: the caller's own declaration first, then the one holder in its declared closure. Two holders in the closure, or a holder outside it (another package, or an environment-authored action), is refused with every candidate named, and the `/actions` door answers 409 `RESOURCE_CONFLICT`. No door passes a caller's package yet, so every request today resolves and runs exactly as before.

New exports from `@objectstack/objectql`: `resolveActionByPackage`, `actionOwnerScopedRegistry`, `actionHolderCoordinate`, `actionHandlerCoordinate`, `ENVIRONMENT_ACTION_COORDINATE`, and the types `ActionPackageQuery` and `ExecuteActionOptions`.
