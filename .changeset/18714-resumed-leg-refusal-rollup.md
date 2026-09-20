---
"@objectstack/service-automation": patch
---

fix(service-automation): a child that PAUSES and then refuses now rolls its refusal up on both resumed legs — the delegated resume and the up-bubble (#18714)

**Clause-②: no** — nothing published moves. The two arms are added inside `AutomationEngine`'s private `resumeInternal` / `bubbleToParent`, and the one new type (`ChildRunRefusal`) is module-private, not barrel-exported. No schema key, no closed-set member, no export and no registry entry changes; `refused` has been a published terminal status since #15788 and no new status, code or `ERROR_CODE_LEDGER` entry is minted here.

#18110 / #18555 gave the `subflow` and `map` executors an arm for `child.status === 'refused'`, and that arm reads the value `engine.execute` **returned** to them — so it covers exactly one shape: a child that runs straight through without pausing. A child that durably PAUSES first (a nested `approval` / `screen` / `wait`) never returns through that call at all. Its outcome reaches its parent on one of two **resumed** legs instead, and neither had an arm. Both pre-date #18110/#18555 and neither is a regression of it; that delivery named the two executors and matched its ruling exactly, and its own changeset filed this card for the remaining half.

The two legs failed **differently**, so each gets its own arm and its own pin:

- **Delegated resume** — `engine.resume(parentRunId)`, the path a screen-flow runner takes when it holds one stable run id and posts every wizard step to it. The delegation block tested only `paused` and `!success`; a refused child is neither, so it fell through the ordinary success exit. Measured: the parent answered `{ success: true, successMessage: … }`, its run row recorded **`completed`**, and the node downstream of the `subflow` **ran**. The refusal was lost **fail-open** — the identical shape #18110 closed on the synchronous leg.
- **Up-bubble** — `engine.resume(childRunId)`. `bubbleToParent` was called on the completion path only, so a child resumed to a refusal resolved exactly one of the two runs it is responsible for. Measured: the child row recorded `refused` correctly and the parent stayed **`paused`**, in `listSuspendedRuns()`, indefinitely. Nothing looks wrong; a run is **leaked**.

What changed:

- **One terminal shape, both legs.** Each leg records the child's refusal and hands it to a single throw site inside the resume's traversal `try`, which raises the engine's existing internal refusal signal — so the refusal leaves through the same `finishRefusedRun` chokepoint every other producer already uses. ⛔ Deliberately not a second terminal exit per leg: this file's history is a list of outcomes that became a function of which route a run took.
- **The throw site sits past the consumption and before the traversal.** The parent's own suspension is consumed exactly as it is on every other way a resume can end, so the terminal row and the pause can never disagree; and nothing downstream of the awaiting node runs.
- **The parent's terminal row reads `refused`**, carrying the child's already-rendered `refusalMessage` verbatim, and the parent's own `successMessage` stays silent. ⛔ Not `failed`: a refusal is not a failure — it must not consume retry budget, must not be routable by a `fault` edge and must not be counted in `nodes[].failures`.
- **The child's #4354 rollup (`selected` / `acted` / `unmeasuredEffect`) survives on both legs**, for the same reason it survives on the synchronous one: the refusal is raised after the awaiting step has been credited. A child that refused really can have written rows before it said no.
- **Chains of any depth resolve**, because the up-bubble arm resumes the parent for real — the parent consumes its pause, records its own terminal row and bubbles to *its* parent in turn, by the same induction completions already rely on. ⛔ Not a direct ancestor walk like the failure cascade's: that verb records ancestors `failed`, which is the wrong word here.
- **The child's own resumer is told exactly what it was told before** — the bubble is still best-effort at the engine layer and never rewrites the child's envelope.

Unchanged: the synchronous leg (#18110/#18555), the region-containment refusal (#18881 — a different error type on a different path, which neither resume leg raises or consumes), the retryable delegated resume-bag codes (#14379), the terminal child-failure cascade, and the `RESUME_IN_PROGRESS` / `STORE_UNAVAILABLE` / stranded gradings on the bubble.

⚠️ **Behavioural direction**: a run that previously finished green over a refusing paused child now terminates `refused`, and a parent that previously sat in `listSuspendedRuns()` forever is now resolved. Both are the authored outcome arriving where it never did; a composition that depended on the fail-open was depending on the defect.
