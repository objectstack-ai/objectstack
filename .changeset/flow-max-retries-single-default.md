---
"@objectstack/spec": major
"@objectstack/service-automation": major
---

fix(spec,service-automation)!: `errorHandling.maxRetries` has one default, and `strategy: 'retry'` states its count (#4247)

`flow.errorHandling.maxRetries` was declared twice, with different values:

- **spec** — `FlowSchema` (`automation/flow.zod.ts`): `.default(0)`
- **engine** — `retryExecution` (`service-automation/src/engine.ts`):
  `errorHandling.maxRetries ?? 3`

`??` fires only on `undefined`, so the winner was decided by the ROUTE a flow
took into the engine, not by what its author wrote:

| Path | `errorHandling.maxRetries` | Retries |
|:---|:---|---:|
| parsed by `FlowSchema` (`.default(0)` fills it) | `0` | **0** |
| object built by hand and fed to the engine | `undefined` | **3** |

One authored intent — "I didn't write a count" — two behaviors. The neighbouring
`retryDelayMs ?? 1000` / `backoffMultiplier ?? 1` agreed with their `.default()`s;
only `maxRetries` disagreed, which reads as a schema default changed from 3 to 0
without the engine following, not as a deliberate two-track design.

**The engine keeps no defaults of its own.** `retryExecution` now takes the
parsed `NonNullable<FlowParsed['errorHandling']>` and destructures all five
knobs — no `??`. This is safe because `AutomationEngine.flows` only ever holds
`FlowSchema.parse` output (`registerFlow` parses; the version-history rollback
re-seats an already-parsed snapshot), and it is what keeps a second set of
defaults from growing back: a knob the spec stops defaulting becomes a compile
error rather than a silent engine-side guess. Per Prime Directive #12 the spec
is the one contract; a consumer-side fallback is a second de-facto one.

**BREAKING — `strategy: 'retry'` now requires `maxRetries` >= 1.** With the
engine's copy gone, an unstated count is unambiguously `0`, and `'retry'` with 0
attempts runs the flow once and stops — i.e. `strategy: 'fail'` wearing another
label, a declared capability the runtime does not deliver (Prime Directive #10
corollary). Rather than pick 0 or 3 on the author's behalf, `FlowSchema` refuses
the combination in both spellings (omitted → defaulted 0, and an explicit 0),
with the prescription in the message. A retry re-runs the **whole flow from the
start** — records created again, callouts fired again — which is not a number to
guess for someone.

FROM → TO:

- `errorHandling: { strategy: 'retry' }` → `errorHandling: { strategy: 'retry', maxRetries: 3 }`
  (or `strategy: 'fail'` if no retry was intended — that is what it did).
- `errorHandling: { strategy: 'retry', maxRetries: 0 }` → same choice, spelled out.

Unaffected: `maxRetries: 0` under `strategy: 'fail'` / `'continue'` (neither
reads it, and a fully spelled-out block stays legal), flows with no
`errorHandling` at all, and every flow that already states a count — including
the `try_catch` node's own `config.retry`, which is a separate per-region policy
(`control-flow.zod.ts`) and is unchanged.
