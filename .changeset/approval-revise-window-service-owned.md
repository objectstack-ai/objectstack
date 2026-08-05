---
"@objectstack/spec": minor
"@objectstack/plugin-approvals": minor
"@objectstack/lint": minor
---

fix(approvals): the ADR-0044 revise window is a service-owned node type, not a bare `wait` (#3823)

#3801 gated `POST /api/v1/automation/:name/runs/:runId/resume` on the **node type**
that produced the suspension: an `approval` pause declares
`resumeAuthority: 'service'`, so it continues only through `ApprovalService`.
ADR-0044's **revise window** was the same trust boundary in a shape that key
could not see. Send-back parked the run on an ordinary `wait` node the flow
author placed — correctly `resumeAuthority: 'any'`, because a signal wait is
*meant* to be resumable by an external producer — and `ApprovalService.resubmit`
was the only thing that checked anything about continuing it.

Demonstrated (not reasoned) against the real engine: a raw `resume(runId)` with
an **empty body**, from any caller, walked the `resubmit` back-edge into the
approval node and opened round N+1 with **no submitter check and no `resubmit`
audit row** (`['submit','revise']` — no third row, ever). Worse, when another
request was already pending on the record — the exact case `resubmit` refuses
with `DUPLICATE_REQUEST` *specifically to keep the run alive* — the raw resume
went around that guard: the approval node's re-entry failed **after** the engine
consumed the suspension, and the run was **permanently destroyed** with its
round-N request stuck `returned` and no resubmit able to reach it.

The revise pause is therefore its own node type:

- **`approval_revise`** (`APPROVAL_REVISE_NODE_TYPE`), registered by
  `@objectstack/plugin-approvals` alongside the `approval` node, declaring
  `resumeAuthority: 'service'`. It stays a first-class box on the canvas, in the
  run log and in the suspended-run store — only the *reuse* of `wait` was wrong.
  It takes **no config**: the window ends on the submitter's explicit resubmit,
  never on a signal or timer. The `resumeAuthority` gate itself is unchanged.
- `sendBack` refuses a `revise` edge whose target is not an `approval_revise`
  node, **before any mutation** (like the existing missing-`revise`-edge check),
  so no run can be parked in a window something else can advance.
- New gating lint `flow-approval-revise-target-not-service-owned`
  (severity `error`, on `os build` / `os validate` / `os lint` and the runtime
  metadata publish gate) rejects the old shape at authoring time.

**Upgrading a flow authored against the original ADR-0044 D3.** One token:

- **FROM:** `{ id: 'wait_revision', type: 'wait', waitEventConfig: { eventType: 'signal', … } }`
- **TO:** `{ id: 'wait_revision', type: 'approval_revise' }` — drop
  `waitEventConfig` / any `config`; the window has no event to wait on.

Until you do, such a flow keeps registering and running and its approvals stay
decidable (`approve` / `reject` / `recall` / `reassign` are untouched), but
**send-back is refused** with a message naming the node and this fix, and
re-publishing it reports the lint error. A run *already parked* in a legacy
revise window keeps its recorded node type (a republish never re-types a live
pause) and is drained by `resubmit` or `recall` as usual.

ADR-0044's 2026-07-28 amendment records the reversal of its D3 and of its
`Alternatives` rejection of a service-owned revise pause, with the evidence
above; the implementation section there records what shipped, why the approval
node does not re-suspend itself instead, and why no ADR-0087 conversion was
added for the old shape.
