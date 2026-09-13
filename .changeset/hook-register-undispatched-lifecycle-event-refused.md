---
'@objectstack/objectql': minor
'@objectstack/spec': minor
---

**BREAKING** `engine.registerHook` refuses an engine lifecycle event the engine never dispatches (#17713)

`registerHook(event, handler)` took `event: string`. For a name outside the dispatched set it logged a warning and then **registered the handler anyway**, so the declaration succeeded and the handler never ran — ADR-0078's prohibited fourth state (parsed, unmarked, silently inert) on an authorable seam.

The measured cost is a data-visibility one. A consumer registered **read filters** on `beforeFindOne` and `beforeCount`, expecting them to scope single-record reads and list totals. They sat inert through every boot behind ~40 warning lines: `findOne` was still filtered (`beforeFind` covers it, so the mistake gave no signal), `count` was not — a `limit`ed list answered a `total` counting rows the caller could not see — and `aggregate` was not either, so a `groupBy` was not narrowed at all.

Six event names now throw at registration instead of registering inert. They are the engine's own lifecycle namespace — `before`/`after` × `OperationContext['operation']` — minus the eight the engine dispatches, derived in code rather than typed out.

FROM → TO:

| was | now | fix |
| --- | --- | --- |
| `registerHook('beforeFindOne', h)` | throws | register on `'beforeFind'` — it already fires for `findOne` |
| `registerHook('afterFindOne', h)` | throws | register on `'afterFind'` — same reason |
| `registerHook('beforeCount', h)` | throws | `count()` dispatches no hook; use `engine.registerMiddleware(fn)` and read `ctx.operation === 'count'` |
| `registerHook('afterCount', h)` | throws | same as `beforeCount` |
| `registerHook('beforeAggregate', h)` | throws | `aggregate()` dispatches no hook; use `engine.registerMiddleware(fn)` and read `ctx.operation === 'aggregate'` |
| `registerHook('afterAggregate', h)` | throws | same as `beforeAggregate` |

One-line fix for a read filter that was on `beforeCount` or `beforeAggregate`: move it into `engine.registerMiddleware(async (ctx, next) => { if (ctx.operation === 'count' || ctx.operation === 'aggregate') ctx.ast.where = ctx.ast.where ? { $and: [ctx.ast.where, scope] } : scope; await next(); })` — the same seam RLS and sharing already use, so the predicate reaches the driver call.

What is **not** affected: an event name outside the engine's lifecycle namespace (`'myPlugin:flush'`) still warns and still registers, so a plugin that dispatches its own events through `triggerHooks` keeps working. Metadata-authored hooks were never exposed — `HookSchema.events` is `z.array(HookEvent)` and `HookEvent` enumerates exactly the eight dispatched names, so the gap only ever existed on the code door.

<!-- adr-0087: registered hook-register-undispatched-lifecycle-event-refused -->
