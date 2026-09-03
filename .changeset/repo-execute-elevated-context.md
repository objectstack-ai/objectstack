---
'@objectstack/objectql': patch
---

`ObjectRepository.execute()` (the `repo.execute(actionName, params)` face a hook or action body reaches as `ctx.api.object(name).execute(...)`) now dispatches the action handler under the same elevated `ScopedContext` REST `/actions` and MCP `run_action` already give an action body — closing the third of three `executeAction` callers that #3914 argues must never run identity-less.

Before this change, the handler's `ctx` carried `params`, `userId`, `tenantId` and `roles` but neither `api` nor `executionContext`: a handler composing a sibling write via `ctx.api.object(x).update(y)` got `ctx.api === undefined`, and the sandbox's own last-resort fallback ran that write as a non-system caller — so the engine's static `readonly` strip (`!opCtx.context?.isSystem`) applied to a write made through this path and not to the identical write made through REST `/actions` or MCP `run_action`.

`ctx.api` is now a real `ScopedContext` bound to `{ ...callerContext, isSystem: true }` — the caller's own envelope, elevated — the same `sudo()`-shaped formula `buildActionExecutionContext` and `recomputeSummaries`'s `systemCtx` already use, so `userId`/`tenantId` still stamp the write and an open transaction still joins rather than escapes. `ctx.executionContext` carries the same elevated envelope, matching the REST/MCP shape exactly.

**What widens**: a `readonly: true` field a handler writes through `ctx.api.object(x).update(y)` when reached via `repo.execute()` now lands instead of being silently stripped, matching REST `/actions` and MCP `run_action`. A repo-wide census (production + test, `examples/` and `apps/` included) found no existing caller of `ObjectRepository.execute()` — every hit in the tree was prose describing the shape, never an invocation — so no shipped write changes behaviour.
