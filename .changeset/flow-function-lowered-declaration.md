---
"@objectstack/spec": minor
---

fix(spec): `functions: { fn: { handler, effect: 'writes' } }` survives `objectstack build` (#4976)

`FlowFunctionEntrySchema` gains a fourth union member — the **lowered
declaration**, a `functions` entry whose `handler` has been replaced by the
string ref `objectstack build` emits:

```
functions: {
  sweepProjectHealth: { handler: 'sweepProjectHealth', effect: 'writes' },
}
```

Nothing an author writes changes. This shape is produced by the CLI, not typed
by a person: `lowerCallables` replaces every inline callable with a serialisable
ref before the stack is parsed (it must — `z.function()` wraps callables and
would break the ref mapping), and since #4396 it keeps the declaration beside
the ref so what a function said about itself survives into the artifact. The
union was not extended in that change, so the artifact it started emitting was
rejected by the very schema it had to pass:

```
  ✗ Validation failed

  functions:
    ✗ functions
      invalid_union: Invalid input
```

Loading from source was unaffected — `objectstack dev`, `objectstack validate`
and the test suite all passed — so the failure appeared only at build, on the
one spelling the platform asks writers to use. That is the same asymmetry #4343
fixed for the bare handler ref, one shape over.

**Why this was worse than a failed build.** `effect: 'writes'` exists so a
function that writes is not counted as having written nothing (#4396, #4354): a
`script` step reports no record metrics *because* flow functions are
contractually pure, and a declared writer instead reports `unmeasuredEffect` so
the run's broken-sweep query (`selected > 0 AND acted = 0 AND unmeasured = 0`)
stays off it. The error above names no key, no entry and no reason, so the
practical repair an author reaches for is deleting the declaration — shipping an
undeclared writer, which is exactly the state it exists to prevent, recorded
permanently in `sys_automation_run`.

**One behaviour change worth stating.** `{ handler: 'someName' }` written by
hand now parses where it used to be rejected as "handler is not callable". The
rejection could not survive this member and should not have: a bare string entry
(`functions: { foo: 'foo' }`) has been accepted since #4343 with the caveat that
it registers nothing, so refusing the record spelling of the same mistake while
accepting the string spelling was two dialects for one contract. Both fail the
same way, loudly, at execute: `no function named '…' is registered` (#1870).
Everything else stays strict — the lowered member is *derived* from the authored
declaration rather than re-typed beside it, so `{ handler: 'fn', efect: 'writes' }`
still raises the named surface and the `` `efect` → `effect` `` prescription, an
unknown `effect` value is still refused, and an empty ref is still not a name.

**Runtime is unchanged and was already correct.** `normalizeFlowFunctionEntry`
returns `undefined` for a lowered entry in both its shapes, because neither
carries a callable; `mergeRuntimeModule` re-attaches the sidecar module's
function to the declaration the JSON carried *before* any collector runs, so
`effect` reaches `collectBundleFunctionEntries` intact on the built path.

The two halves are now pinned against each other by a round-trip test that
drives the real pipeline (`defineStack` → `normalizeStackInput` →
`lowerCallables` → parse) instead of a hand-written sample of what the lowering
is believed to emit — the crossing neither side previously made, which is why
both stayed green while the build failed on the join.
