---
'@objectstack/spec': minor
---

spec(ui): `ActionEngineFacade.find` no longer accepts a `context` on its query envelope

Clause-②: no (narrowing)

`ctx.engine.find(object, query)` takes `Omit<EngineQueryOptions, 'context'>` — the
engine's query envelope with exactly one key subtracted. Every other key is
unchanged and still read off the engine's own type by reference.

**Why.** The action facade is trusted and context-less by design: the runtime
stamps its own elevated `ExecutionContext` last, so a caller-supplied `context`
was overridden, never honoured. The key was nonetheless *declared* on the
parameter, which made this a declared-but-unenforced key on the one thing
`context` carries — identity and tenant. A handler could write
`context: { tenantId: 'org_acme' }`, type-check clean, and get the facade's
context instead: a read its author believes is tenant-scoped, silently broader
than intended. ADR-0049 admits enforce or remove; removal is the exit that
changes no runtime behaviour.

**Migration.** Delete the key. There is nothing to replace it with, because it
never did anything: a `find` that carried one returned exactly the rows it
returns without one. To scope a read, put the scope in `where`.

| You wrote | Write instead |
| --- | --- |
| `ctx.engine.find('task', { where: { … }, context: { tenantId } })` | `ctx.engine.find('task', { where: { … } })` |
| `ctx.engine.find('task', { where: { … } })` | unchanged |

`tsc --noEmit` over a consumer's handlers finds every occurrence, because the
key is now an excess property on a fresh literal. ⚠️ Only where the handler is
annotated with the published `ActionHandlerContext`: an untyped handler (a JS
config body, a local copy of the context type, `(ctx: any)`) still passes the
key and still has it overridden, silently, exactly as before. The runtime arm is
deliberately unchanged — refusing an identity key there is a runtime behaviour
change, not a declaration narrowing.

<!-- adr-0087: not-required (already-registered action-engine-facade-find-query-envelope) that entry announces this parameter's shape and already states the rule this diff makes the compiler enforce — "A caller-supplied `context` is ignored: the facade is trusted and stamps its own elevated one." A consumer that followed it has no `context` left to remove, so this narrowing adds no migration step to the ledger. -->
