---
"@objectstack/objectql": patch
---

fix(objectql): the hook layer logs through the `Logger` contract instead of a local dialect (#5637)

`packages/spec/src/contracts/logger.ts` declares `error(message, error?: Error,
meta?)` — the `Error` slot is **second**, the meta bag **third**. Both hook
modules declared their own four-method logger shape instead, and that shape
spelled `error` as `(msg, meta?)`, so every call site put its diagnostic in the
`Error` slot.

Nothing caught it. The contract's type satisfies the local shape structurally
(a function of fewer parameters is assignable, and `any` is compatible both
ways), so `tsc` never spoke; and the implementation the platform injects today,
`ObjectLogger`, dispatches its second argument **by shape**
(`errorOrMeta instanceof Error`), so the meta landed anyway. That tolerance is
not something the contract declares. Its two sibling implementations —
`ConsoleLogger` / `JsonLogger` in `@objectstack/observability` — follow the
contract literally: the meta object lands in the `error` slot, `error.message`
and `error.stack` read `undefined`, `meta` **is** `undefined`, and the whole
diagnostic evaporates, leaving a bare sentence. The first host to plug a
faithful structured logger into `ctx.logger` would have lost the fields of every
hook diagnostic, with a symptom ("the log has fewer fields than it used to")
that is close to unattributable.

So the dialect is gone rather than being met halfway (Prime Directive #12 — one
contract, no consumer-side dialects):

- `WrapDeclarativeOptions.logger` and `BindHooksOptions.logger` are now
  `HookDiagnosticsLogger` = `Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>`,
  taken from `@objectstack/spec/contracts` — the four levels this layer calls,
  and nothing more.
- All four `error(...)` call sites pass the meta in the contract's third
  parameter (`error(msg, undefined, { … })`). The values in hand at each site
  are a `CelFault` (`{ kind, message }`) or a `catch` binding of type `unknown`,
  none of them statically an `Error`, so the `Error` slot stays empty and each
  message is carried in meta exactly as before.

`debug`/`info`/`warn` already matched the contract and are unchanged.

No behaviour change for hosts on `ObjectLogger` (the default, and what
`ctx.logger` / `engine.logger` supply): it accepts all three shapes since #5575,
so an empty `Error` slot renders the same record it rendered before. Callers
passing a full `Logger` are unaffected — a `Logger` satisfies the narrowed type
unchanged. A caller that hand-rolled a four-method object still satisfies it too,
as long as its `error` does not *require* a meta object in the second position;
if yours does, move that parameter to third — the contract's order is now the
one the hook layer calls with.
