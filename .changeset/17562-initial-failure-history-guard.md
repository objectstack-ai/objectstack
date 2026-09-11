---
"@objectstack/service-automation": patch
---

A run that genuinely failed is still answered in the declared shape when its own terminal run-history write throws (#17562)

`AutomationEngine.execute()` and `executeWithoutRetry()` each ended their node-failure `catch` with an unguarded `recordLog({ status: 'failed' })`. That `catch` **is** the handler for node failures and there is no outer one, so a throw out of the history write escaped the method entirely and left `execute()` a **rejected promise**, where its declared return type is an `AutomationResult`. This is the failure-arm half of the completion-path guard shipped just before it, and the same shape already landed on the resume path's failure arm in 17.4.0.

**What is lost is the shape, not the verdict.** The run really did fail, so nothing misleads an operator: there is no false `failed` and no double run. But a caller that branches on `{ success: false, status: 'failed' }` gets an exception instead, so the transport's `status` arm is bypassed and `errorMessage` (the author's failure text) and `summary` (how far the run got before dying) never arrive — a REST route or SDK caller sees a 500-class throw for a run that had a perfectly good failure envelope waiting, and the node's own error text is replaced by the history driver's.

Reproduced with a control, the identical flow and the identical node failure differing only in the store:

```
store = SYNC-THROW        -> {"kind":"threw","error":"run-history driver refused the terminal row"}
store = HEALTHY (control) -> {"kind":"returned","status":"failed","error":"work blew up"}
```

**What can throw there is a host surface, not in-repo code** — the same two statements the completion-path fix names: the default-on run-summary line `logger.info(line, meta)`, which calls a host-injected `Logger` and needs no store at all; and `store.recordTerminal(record)` throwing **synchronously**, before it returns a promise, which the `void write.catch(...)` beneath that call cannot see. Both stores shipped in this package are `async` and cannot do it, but `SuspendedRunStore` is an exported interface whose `recordTerminal` is optional, so a host store is unconstrained.

What changes:

- **Each failure-path history write is guarded at its own call site**, restoring the invariant that call's own documentation states: a history write must never block or break the run that produced it. The caller now receives the envelope it was always promised — `success: false`, `status: 'failed'`, the **node's** own text in `error`, the flow's `errorMessage`, and a `summary` recomputed by the same pure function `recordLog` runs first.
- **The retry budget survives the loss.** On the retry path the throw used to reject out through the retry loop and `execute()` both, ending the run early; the remaining attempts now run as the author's policy says.
- **The swallowed failure is reported once per abandoned write at `error`**, with the consequence and the fix in the first line: the run failed, its terminal row never landed, nothing retries it, and the caller *was* told the run failed so nothing needs re-driving. The thrown text rides the structured slot.

⛔ No `catch` arm's meaning is widened: the suspend arm, the input-schema refusal and the retry strategy branch are untouched, and a genuine node failure against healthy sinks is answered exactly as before.
