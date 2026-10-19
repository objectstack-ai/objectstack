---
'@objectstack/spec': minor
'@objectstack/objectql': patch
'@objectstack/runtime': patch
---

fix(objectql,runtime): a hook whose `handler` names a function gets `ctx.title(field?)` in-process, as an inline handler and a `body` do

Clause-②: yes (widening)

- **What was wrong.** A hook whose `handler` is a string naming a function ran in-process without `ctx.title`: `defineStack({ functions })` plus a hook naming an entry on a source boot (`@objectstack/verify`'s `bootStack(config)`, `os serve` over a config), and a string `handler` resolved from the artifact's `runtimeModule` (what `objectstack build` ships for a callable it could not lower to a `body`). The engine's binder resolved the name after the runtime had wrapped the inline handlers, so the function was called with the bare engine context and `await ctx.title()` threw `TypeError: ctx.title is not a function`.
- **What changed.** `bindHooksToEngine` (`@objectstack/objectql`) takes a `wrapHandler(handler, hook)` option, applied at bind to every handler a hook runs in-process, after a string `handler` resolves: an inline function, a name from the bind's `functions`, or a name the same package registered on the engine. A `body`'s handler (built by `bodyRunner`) never takes it. `ObjectQL.bindHooks` and the `IObjectQLEngine.bindHooks` contract (`@objectstack/spec`) carry the option. `bindAppArtifactHandlers` (`@objectstack/runtime`) passes the existing `withInProcessHookTitle` through it, in place of wrapping inline handlers before the bind, so the inline and the named handler take one wrap.
- **Unchanged.** A bind that passes no `wrapHandler` binds every handler exactly as resolved, so a host or harness that calls `bindHooks` itself, and a hook registered with `ql.registerHook(...)`, are not handed `ctx.title`. `HookContext` still declares no `title`.
