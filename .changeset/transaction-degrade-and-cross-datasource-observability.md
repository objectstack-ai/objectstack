---
"@objectstack/objectql": patch
---

fix(objectql): say out loud when `transaction()` is not giving you a transaction (#4619)

`ObjectQL.transaction()` carries two caveats that are part of its **declared**
meaning (ADR-0119 D1, `packages/spec/src/contracts/objectql-engine.ts`), not
hidden behaviour:

1. when the default driver has no `beginTransaction`, the callback runs with no
   transaction and no rollback;
2. the transaction covers the **default** datasource only, so an object routed
   elsewhere by `setDatasourceMapping` is written outside it.

Declaring them is not the same as being able to observe them, and both were
completely mute. A caller asking for atomicity and not getting it had no way to
find out; a multi-datasource "atomic" unit of work that partially committed
reported nothing at all — one store reverted, the other kept its rows, and the
caller saw only that the whole thing failed. That is the same shape as
`batchData`'s `atomic` flag being a lie for as long as it was (ADR-0119 D4).

**Nothing about what the engine does has changed.** Both caveats still hold
exactly as declared; this release only makes them discoverable.

- **`warn`, once per driver per engine instance**, when `transaction()` (or
  `ctx.api.transaction()` in a sandboxed hook/action body) degrades because the
  driver has no `beginTransaction`. The line names the driver, the consequence
  — writes commit as they execute, so a later throw leaves the earlier ones
  persisted while the call rejects as if nothing had landed — and the fix.
  `warn` rather than `error` on purpose: at that moment nothing has been lost,
  a capability is simply absent, which is the functional-degradation branch
  AGENTS.md keeps at `warn`. Once per driver because the drivers that reach
  this path (test doubles, foreign engines) reach it on *every* call.

- **`error`, once per transaction per datasource**, when an `insert`/`update`/
  `delete` inside an open `transaction()` is routed to a driver that
  transaction does not cover. The line names the object, the datasource it went
  to, the datasource the transaction was opened on, and says the write commits
  on its own and will survive the rollback. `error` per AGENTS.md's judgment
  question: afterwards the system looks entirely normal from the outside while
  a write it claimed was part of an atomic unit has landed by itself — the
  durability class, not the functional one.

Both diagnostics are reported by the engine, so the direct
(`engine.transaction`) and sandboxed (`ScopedContext.transaction`) surfaces
share one budget and one wording rather than drifting apart.

Tightening either caveat — an `opts.require` that throws instead of degrading,
refusing a cross-driver write, or surfacing an owned-vs-joined signal to the
callback — would change the contract's declared semantics and is deliberately
**not** done here; that half of #4619 is tracked separately against
`packages/spec`.
