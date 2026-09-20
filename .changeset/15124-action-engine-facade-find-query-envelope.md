---
'@objectstack/spec': minor
'@objectstack/runtime': minor
---

**BREAKING for action handlers** — `ActionEngineFacade.find` takes the engine's query ENVELOPE; the bare-filter parameter shape is withdrawn (#15124)

Clause-②: yes (narrowing)

`ctx.engine.find(object, query)` now takes `EngineQueryOptions` — the same
options bag `IDataEngine.find` and ObjectQL's own `engine.find` take, named by
identity rather than restated. **One platform, one query shape.**

### Migration — FROM → TO

| You wrote | Write instead |
| --- | --- |
| `ctx.engine.find('task', { status: 'open' })` | `ctx.engine.find('task', { where: { status: 'open' } })` |
| `ctx.engine.find('task', { amount: { $gt: 100 } })` | `ctx.engine.find('task', { where: { amount: { $gt: 100 } } })` |
| `ctx.engine.find('task', {})` | unchanged — an empty envelope is still the unfiltered read |

The rewrite is lossless and mechanical: the filter moves under `where`, verbatim.
`tsc --noEmit` over your handlers finds every unmigrated call — see below.

### Why the shape was withdrawn rather than the bar closed

Until now this parameter was the `where` HALF of a query while every other
`find` on the platform took the whole envelope, and the runtime wrapped what it
was given. That made the most natural spelling the wrong one, silently: an
author who passed the engine's own envelope reached the engine as
`{ where: { where: … } }` — a filter on a field named `where` — which matches no
row and resolves to `[]` with **no error at all**. A handler that made the
mistake ran to completion over zero rows for as long as it shipped, and its own
hand-written test double, written to the same belief, passed every assertion.
Because an empty `{}` skipped the wrap, one unfiltered read kept working under
either belief, so a dead handler looked partially alive.

Refusing `where` at the top level instead — intersecting the old parameter with
`{ where?: never }` — was rejected: it asserts a vocabulary fact the spec
declares nowhere, reserving the field name `where` across every customer's data
model to buy one parameter's compile-time check. Aligning the parameter removes
the ambiguity at its root and reserves nothing.

### What the new declaration refuses, measured

If your handler is typed with the published `ActionHandlerContext`, a bare filter
no longer type-checks on **either** path you can reach it by:

- an object literal (`{ status: 'completed' }`) fails the excess-property check —
  a field name is not an envelope key;
- a filter held in a `FilterCondition` variable fails **TS2559** — every envelope
  key is optional, so a bag of field names has no property in common with it.

The envelope's own keys are typed too: `where: 'a = b'`, `fields: 'id,subject'`
and `limit: '50'` are each refused.

**If your handler is NOT typed with it** — a handler in an `objectstack.config.js`
/ `.mjs`, one annotated with your own copy of the context type, or a `(ctx: any)`
handler — nothing above reaches you, so the facade refuses the withdrawn shape at
**runtime** instead, before the engine, with the same prescription:

```
find('task') was given a key 'status' the query envelope does not carry.
ctx.engine.find(object, query) takes the engine QUERY ENVELOPE, not a bare
filter — move the filter under `where`: find(object, { where: { … } }) (#15124).
```

⚠️ **That refusal matters most for a filter whose value is `null`.** The engine's
own unknown-option check exempts a `null` value, because on an option bag a
`null` is a withdrawal. On a filter it is the "rows with no X" idiom, so
`{ deleted_at: null }` would have been dropped unexecuted and the read would have
widened to **every row** — including the ones you were excluding — with no error
at all. It is refused instead.

### What this opens

`fields`, `orderBy`, `limit`, `offset` and `expand` are reachable from an action
handler for the first time — under the old parameter there was nowhere to carry
them. A caller-supplied `context` is **ignored**: this facade is trusted and
context-less by design, and the runtime stamps its own elevated
`ExecutionContext` last. Do not write one — it reads as authorization and is
none.

### Checking a migrated handler

Do not settle for "it still resolves". A handler that had been passing the
envelope was returning `[]` on **every** call, so a suite written against the
mistake passes and the row count is the only witness. Re-run each migrated
handler against seeded data and assert it returns the rows its filter selects.

<!-- adr-0087: registered action-engine-facade-find-query-envelope -->
