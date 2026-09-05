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
a thrown resume — stays at `warn` unchanged, because on those exits the parent
is still parked and resumable.

⚠️ This is the log half only. What the child's resumer is told is unchanged.
