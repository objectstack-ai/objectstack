---
'@objectstack/service-automation': patch
---

automation: a subflow parent left STRANDED by a failed up-bubble is reported at `error`, not `warn`

When an approval (or any pause) sits inside a subflow child, resuming the child
bubbles up to the parent. If the parent's own continuation then fails on the
engine's stranded exit — its suspension consumed, a repair snapshot journalled,
the run recorded `failed` — nothing but a `warn` said so, while the child's
resumer (an approvals decision door, a wait timer) was told the resume
succeeded. Persisted state and runtime state disagree and nothing looks broken
from the outside, which is the durability class.

`bubbleToParent` now grades that record by the engine's own
`AutomationResult.status` discriminator: `'stranded'` is reported at `error`,
naming the parent run and the `restoreConsumedSuspension` verb that repairs it.
Every other parent-resume failure — a concurrent resume, an unreachable store,
a thrown resume — stays at `warn` unchanged, on a narrower ground: those exits
carry no `'stranded'` discriminator. `'stranded'` is the one exit that journals
a repair snapshot, so it is the one an operator can act on, and grading by the
engine's own verdict is what keeps `error` readable.

⚠️ That is a statement about what this seam can KNOW, not a guarantee that
every other exit left the parent healthy. Two exits are known not to be:

- a **thrown** parent resume carries no discriminator at all, and #15555
  documents a window in which a throw between the journal and the stamp hides a
  parent that IS stranded. Left at `warn` deliberately, for that card;
- the **claim-path** store failure reports, in its own envelope text, that
  whether the suspension was consumed is UNKNOWN — it relies on a retry to
  settle it, and an up-bubble has no retrier. ("Not consumed" is the guarantee
  of the strict-load store failure only, not of every store failure.)

⚠️ This is the log half only. What the child's resumer is told is unchanged.
