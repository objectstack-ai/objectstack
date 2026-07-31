---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/runtime": minor
"@objectstack/service-automation": minor
"@objectstack/cli": minor
---

feat(automation): a `script` node's purity contract is declared, and a function that writes can say so (#4396)

The `script` executor's contract — *the named function returns a value; data I/O
stays on the flow graph* — existed only as a comment inside the executor, while
#4354's run summary depended on it. That summary reports no record metrics for a
`script` step precisely because a pure function's writes are downstream
`create_record` / `update_record` nodes counting themselves. A function that
wrote anyway made its run report `selected: 30, acted: 0` — indistinguishable
from the broken sweep the counters exist to detect, recorded permanently on
`sys_automation_run`.

**The rule is now visible.** `ActionDescriptor` carries
`handlerContract: 'none' | 'pure'`, and the `script` descriptor publishes
`'pure'`, so the action catalog, the designer palette and the reference docs
state the rule an author has to follow instead of an executor holding it
privately.

**And a legitimate writer can opt out honestly.** A `defineStack({ functions })`
entry may declare what it does, in either shape:

```ts
defineStack({
  functions: {
    scoreLead: (ctx) => ({ score: 42 }),                     // pure — the default
    syncBilling: { handler: syncBilling, effect: 'writes' }, // declared writer
  },
});
```

A step calling a declared writer reports `unmeasuredEffect`, so the run's
`unmeasured` tally keeps the broken-sweep query
(`selected > 0 AND acted = 0 AND unmeasured = 0`) off that flow — and only that
flow. Marking *every* `script` step unmeasured was rejected: it would blind the
detector on every flow that calls any function in order to cover the few that
break the rule.

Nothing here is retired or renamed: a bare `functions: { fn }` entry is
unchanged and means `effect: 'pure'`. The declaration is carried end to end —
`ObjectQL.registerFunction` accepts `{ packageId, effect }` alongside the
existing `packageId` string and exposes `resolveFunctionEntry(name)`,
`objectstack build` lowers a declared entry without dropping it, and the
artifact loader re-attaches the module's callable to the declaration the JSON
carried.

**Also fixed:** `bindHooksToEngine` returned before registering a bundle's
functions when the stack declared no hooks, so a flow-only app's
`defineStack({ functions })` reached the engine as nothing and every `script`
node calling one failed with "no function named 'x' is registered".
