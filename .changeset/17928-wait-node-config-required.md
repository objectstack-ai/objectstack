---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
---

fix(automation): a `wait` node must say what resumes it — the config block is required at the contract, and the executor stops defaulting to a duration-less timer (#17928)

**BREAKING** — a `type: 'wait'` flow node with no `waitEventConfig` block, and a
`type: 'boundary_event'` node with no `boundaryConfig` block, no longer parse.
Under `eventType: 'timer'`, `timerDuration` is now required and may not be blank
— and that half sits on the `waitEventConfig` BLOCK, not on the node type, so it
bites on ANY node carrying the block: a `start` node spelled
`waitEventConfig: { eventType: 'timer' }` parsed before and is refused now. It is
still a narrowing in every direction (no shape starts parsing that did not), and
the block is inert on a node type no executor reads it from, so the practical
reach is `wait`.

`eventType` has been required *inside* each block since protocol 17, so
`waitEventConfig: {}` was already a loud parse error. The block itself was
optional — so "omit the key" and "omit the block" were two documents with two
verdicts, and the accepted one was the silent one. It is also the state a
freshly created node is in, which is what made it reachable from a designer's
default screen rather than only by hand-authoring.

What that document did, measured through a real `engine.execute()` run rather
than read off the source:

```
FROM  { id: 'pause', type: 'wait', label: 'Wait' }          // parses clean
      -> { success: true, suspend: true }                    // run status: paused
         scheduled jobs: []      <- with a job service ANSWERING
         variables:      no `pause.waitUntil`                <- cold boot cannot re-arm
         log lines:      0 at any level                      <- warn, error, info, debug

TO    FlowNodeSchema.safeParse(...)
      -> { success: false,
           issues: [{ code: 'custom', path: ['waitEventConfig'],
                      message: 'a `wait` node requires a `waitEventConfig` block saying
                                what resumes it … `waitEventConfig: { eventType: 'timer',
                                timerDuration: 'PT1H' }` … or `{ eventType: 'signal',
                                signalName: 'order_paid' }` …' }] }
```

The control — the same node with `{ eventType: 'timer', timerDuration: 'PT1H' }`
— armed the one-shot job and persisted the deadline, so the zeros above are a
reading of this path and not of a dead harness.

**The executor follows the contract.** `wait-node.ts` carried
`(node.waitEventConfig ?? {})` and `String(wec.eventType ?? 'timer')` under a
comment declaring the second one deliberate — "a wait node without one is a
VALID TIMER WAIT". Both fallbacks are retired. A node that still reaches
`execute` without the block (a stored pre-migration document on a path that
skipped the parse) is now a **guard refusal** — `errorClass: 'guard'`, so a
`fault` edge cannot route a metadata defect into a handler that reports success
— and it **logs**, naming the node and the remedy, because the defect being
closed was silence. It never suspends with `success: true` again. Two smaller
corrections ride along in the same return: the timer branch stops answering
`output` as a present key holding `undefined` (it is absent when no deadline was
computed), and the reversed comment is deleted rather than left describing a
behaviour that is gone.

**`screen.mode` now declares the default the executor applies; `http.method`
still declares none.** Both were read by running the executors with the key
absent, not by reading the Zod:

| key | absent ⇒ the runtime applies | declared |
| --- | --- | --- |
| `ScreenConfig.mode` | `'create'` (object-form branch; the flat `fields` branch never reads it) | `.default('create')` |
| `HttpConfig.method` | `GET` inline, **`POST`** when `durable: true` | ⛔ none — two values, no single default |

Declaring `.default('GET')` on `method` would materialise `GET` at parse time,
the durable arm's own `?? 'POST'` would never fire again, and every stored
durable callout that omits the method would silently change verb. That is the
defect this card exists to end, pointed the other way.

**Migration.** A stored `wait` node with no block has no lossless conversion —
the missing value is an intent no artifact records, and the old runtime's pick
(`'timer'` with no duration) was not a wait at all — so this is an ADR-0087 D3
semantic entry rather than a D2 conversion: `os migrate meta --from 17` names
each node to edit. Declare the resume condition and re-publish the flow. ⚠️
Behaviour the fix deliberately changes: a run that used to park forever now
waits the duration you declare or the signal you name.

**`boundary_event` gets the contract half only.** The runtime registers no
executor for that node type at all — a flow reaching one fails with
`NO_EXECUTOR` before any config is read, identically whether the block is
present or absent — so there is no silent executor branch behind it. The
refusal fixes the authoring surface; `try_catch` (ADR-0031) remains the native
construct for error handling.

<!-- adr-0087: registered wait-node-event-config-required -->
