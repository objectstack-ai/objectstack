---
"@objectstack/runtime": minor
---

fix(actions): dispatch on the declared action `type` over REST — flow actions are no longer MCP-only (#3915)

`POST /api/v1/actions/:object/:action` had **no action-type branching at all**.
Whatever an action declared, the route went straight to `ql.executeAction` — the
script-handler registry — while the MCP `run_action` bridge had implemented the
`flow` branch since #2849. The spec is unambiguous that every non-`script` type
dispatches on `target` (`packages/spec/src/ui/action.zod.ts`), so a REST/SDK
caller who followed it and invoked a `type: 'flow'` action got

```
Action '' on object '*' not found
```

and had to know, out of band, to call `POST /api/v1/automation/:target/trigger`
itself. Worse for the Studio-authored case: `resyncAuthoredActions` deliberately
registers **no** handler for a flow-typed action ("no body (target/flow/url
action)"), so there was never anything for the registry to find.

The two headless surfaces now share one dispatch:

- **`flow`** → `automation.execute(action.target, …)` via the new
  `dispatchFlowAction`, which the MCP path now calls too. The caller's identity
  (`userId` / `positions` / `permissions` / `tenantId`) is forwarded, so a
  `runAs: 'user'` flow enforces RLS as the invoker instead of falling into the
  user-less UNSCOPED path (ADR-0049). A flow action on a kernel with no
  automation service reports **503**, not a `{ success: false }` body.
- **`script`** → the handler registry, unchanged. An action with no resolvable
  declaration is handler-only by definition and keeps that path.
- **`url` / `modal` / `form` / `api`** → **400** naming the type and the
  prescription (for `api`, the `target` endpoint to call directly) instead of a
  registry miss that reads like the action does not exist.

The route also resolves **standalone declarations** now — `defineAction`
artifacts in the ObjectQL registry and Studio-authored `action` metadata rows,
neither of which appears inside any object's `actions[]`. They were invisible
to this route before, which is why a flow-typed one could not be dispatched —
and, separately, why its `requiredPermissions` were declared-but-unenforced on
REST while MCP honoured them. The ADR-0066 D4 gate still runs **before** the
type check, so an unauthorized caller learns nothing about how an action
dispatches.

**Migration:** a caller invoking a `url`/`modal`/`form`/`api` action through
this endpoint used to receive `{ success: false, error: "Action '' on object
'*' not found" }` (HTTP 200) and now receives a 400 that says what to call
instead. No spec-faithful action changes behavior.
