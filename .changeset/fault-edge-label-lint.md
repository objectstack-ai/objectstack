---
"@objectstack/cli": minor
"@objectstack/service-automation": patch
---

feat(cli,automation): catch `label: 'error'` written where `type: 'fault'` was meant (#3863)

Two of the three items left open on #3863. Both are about making the fault-edge
contract legible; neither changes routing behaviour.

**New lint — `flow-error-label-not-fault`.** `type: 'fault'` is what routes a
failure; `label` is cosmetic on an ordinary edge. So this, which reads exactly
like error handling:

```ts
{ source: 'charge_card', target: 'flag_for_review', label: 'error' }
```

is an ordinary out-edge — and `traverseNext` runs every unconditional out-edge
in parallel. The handler fires on every **successful** run of `charge_card`,
concurrently with the real success path, and never on a failure. The run still
aborts when the node fails.

Silent in both directions: the author believes failures are handled, and never
notices the handler running when nothing went wrong. The reading is especially
natural for an AI author, since the label is precisely what the intent sounds
like — which is why this is worth a build-time diagnostic rather than leaving it
to a puzzled look at a run trace.

Deliberately narrow, because a label IS load-bearing on a branching node: a
`decision` / `approval` executor returns a `branchLabel` and traversal then
prefers the edge carrying it. Edges out of those node types are excluded, as are
conditional edges (a guarded path is not the unconditional footgun) and edges
already typed `fault`. Matches the obvious synonyms (`error`, `failure`,
`catch`, `on_error`, …) case-insensitively. Verified against the shipped
showcase: no findings.

An alias — accepting `label: 'error'` as if it were `type: 'fault'` — was
considered and rejected: two spellings for one concept is harder to read than
one spelling plus a diagnostic that names the fix.

**Pinned: a handled failure does not consume a flow-level retry.** The two
recovery mechanisms have different scopes and must not compound — a `fault` edge
handles one node, while `errorHandling.retry` replays the flow **from the
start**, re-running every node that already succeeded (a second notification, a
second created record). A failure a fault edge handled is not a flow failure, so
it does not consume a retry. That already held by construction (a routed failure
never propagates out of `executeNode`); it is now a test, so a refactor of the
catch path cannot quietly change it.

Docs and the automation skill gain both points, plus a note on the edge-property
table that `label` does not select a path except on a branching node.
