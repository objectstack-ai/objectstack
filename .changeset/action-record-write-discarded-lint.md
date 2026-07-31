---
"@objectstack/lint": minor
"@objectstack/spec": patch
"@objectstack/runtime": patch
---

feat(lint): an action body's discarded `ctx.record` write warns at author time (#4345)

`#4344` deliberately left `ctx.record` alone, and said why: an action's
`ctx.record` is a plain snapshot (`unwrapProxyToPlain(actionCtx?.record)`) that
`boundActionHandler` never writes back — the hook path's
`applyMutationsToInput` has no action-side counterpart — so `ctx.record.x = …`
is discarded for **declared and undeclared fields alike**. Reporting that
through the unknown-field rule would have been actively wrong: flagging only
the undeclared half implies the declared half persists, which is the false
completion this rule family exists to stop manufacturing. It needed its own
finding, and now has one.

**New rule — `action-record-write-discarded` (advisory).**

**It is not "flag every `ctx.record.<field>` assignment"** — that would be a
false-positive machine, because mutating the snapshot to build a payload is a
legitimate idiom:

```js
ctx.record.stage = 'won';
await ctx.api.object('crm_deal').update(ctx.record);   // the write is LIVE
```

So the finding requires the write to be **provably dead**: reported only when
`ctx.record` never escapes the body as a value. Property reads
(`ctx.record.id`) do not rescue a write and do not suppress the finding;
handing the object to anything — an argument, an assignment RHS, a spread, a
return — does. Aliasing (`const r = ctx.record`) reads as an escape, which is
the safe direction: it costs a missed finding, never a false one.

Truthiness and type tests are **not** escapes, and that distinction is what
makes the rule fire on real code rather than almost never. Running it against
the showcase app is what surfaced it: `mark_done` opens with
`ctx.recordId || (ctx.record && ctx.record.id)`, the defensive idiom action
bodies are actually written with, and counting that guard as an escape silenced
the finding on the one body in the repo that had a record write. A test reads
the reference and yields a boolean — or, for `&&`/`||`/`??`, yields the left
operand only when it is falsy, which is null or undefined and persists nothing.
Only the LEFT operand is a test: `x || ctx.record` really does evaluate to the
object, and still escapes.

**One suite member, two rule ids.** Both findings fall out of one parse of one
source on one surface, so `validateActionBodyWrites` reports both rather than
`REFERENCE_INTEGRITY_RULES` growing a second member that would parse every
action body again to say two things about the same walk. The alternative —
hand-wiring it into the three CLI commands — is the drift that suite exists to
end, and `validateReadonlyFlowWrites` is the standing proof: wired into
`validate` and `compile`, never into `lint`. The trade-off is written down at
both ends rather than left to be rediscovered.

**The ledger ratchet fired, as designed.** `record-property-assign` joins the
shared `HOOK_BODY_WRITE_PATTERNS` — the extractor's shape inventory, not any
one rule's — and both existing consumers had to classify it before it could
land. That was not cosmetic on the hook side: a `record-property-assign` write
carries no `object`, and `validateHookBodyWrites` branched on exactly that to
mean "a `ctx.input` write", so the new shape would have been reported as *"the
hook writes 'stage' to its input"*. The hook rule now declares its own
consumed subset (`HOOK_BODY_WRITE_PATTERN_IDS`) and its exclusion with a
reason — a hook sandbox context has no `ctx.record` at all
(`buildSandboxContext` never sets it), so the expression throws at run time
rather than silently no-op'ing, and a loud failure is not an advisory rule's
business.

`extractHookBodyWriteSet` is the new one-parse entry point, returning the
writes plus the `ctxRecordEscapes` signal; `extractHookBodyWrites` stays as a
thin projection of it.

**Boot path.** The action gate's prefilter widens from `api` to `api`-or-
`record`, so a body reaching neither still never loads the ~9 MB TypeScript
compiler. `lazy-deps.test.ts` pins it — and its header and two case names,
which still claimed every lazy dep waited on "a react page", now say which
trigger each one pins (typescript has also been loaded by the hook-body gate
since #4271).

`@objectstack/spec` / `@objectstack/runtime`: `ScriptBodySchema`,
`ActionSchema.body` and `ScriptContext.record` now state that
`ctx.api.object(...)` is the only path that persists anything, and that
`ctx.record` is read-only in effect. Doc comments only — no schema or
generated-artifact change. Whether the runtime should instead refuse or honour
a record write stays open on #4345.
