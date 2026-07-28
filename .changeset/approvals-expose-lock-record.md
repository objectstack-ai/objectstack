---
"@objectstack/spec": minor
"@objectstack/plugin-approvals": minor
---

feat(approvals): expose the pending node's `lockRecord` policy on the request row (#3814, objectui#2902)

An approval node declares `lockRecord` (default `true`), and the record-lock
`beforeUpdate` hook enforces exactly that: `lockRecord: false` and the record
stays writable for the whole time the node waits. The behavior was correct and
has been since Phase B — but it was **invisible to every client**.

`rowFromRequest` parses `node_config_json` and projects a whitelist out of it
(`__flowLabel`, `__nodeLabel`, `__round`, `escalation.timeoutHours`,
`decisionOutputs`). `lockRecord` was never in that list, and no other field on
`ApprovalRequestRow` carried the lock either. So the strongest thing a console
could learn from `GET /approvals/requests` was *"a pending request exists"* —
from which it can only assume the record is locked.

That assumption is wrong on every opted-out node, and a flow that chains nodes
with different policies makes it visibly wrong: the same UI state renders for
"you may edit this" and "the server will reject your save with `RECORD_LOCKED`".
The console has no third option — guessing the other way would offer an edit
that dies on save.

`ApprovalRequestRow` now carries **`lock_record: boolean`**, read from the same
snapshot the hook reads, with the same `!== false` default. Present on every
service read (`openNodeRequest` / `getRequest` / `listRequests`), so the flag a
client renders and the rule the server applies cannot drift.

Additive and backward compatible — nothing to migrate. A client that wants
node-accurate lock state reads `request.lock_record`; treat `undefined` (an
older backend) as locked, which is the pre-existing behavior.

The showcase's `showcase_budget_approval` now declares `lockRecord: false` on
its single-approver Manager Review and keeps `true` on the multi-approver
Executive Review, so both policies are exercised in one flow.
