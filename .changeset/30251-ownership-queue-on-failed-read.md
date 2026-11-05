---
'@objectstack/spec': patch
---

feat(spec): `IOwnershipQueueService` lets a caller ask for a refusal on a failed member read (`onFailedRead`), the call-time signal ADR-0142 D2 asks each consumer to send

Clause-②: yes (widening: an optional `onFailedRead` on `expandMembers`' options and an optional options argument on `isMember`; precedent PR #30015)
Metadata-protocol: none

- **New type `OwnershipQueueFailedReadAnswer`** (`'nobody' | 'refuse'`, `@objectstack/spec/contracts`): what a membership read answers when a read behind the queue fails (`sys_queue`, `sys_queue_member`, `sys_team_member`, `sys_user_position`, `sys_member` through the position transition limb, the business-unit membership and tree).
- **`expandMembers(name, organizationId, { purpose?, onFailedRead? })`** and **`isMember(userId, name, organizationId, { onFailedRead? })`**. `'nobody'` is the default and the answer every caller had before: a failed read is logged at `warn` and contributes nobody. Under `'refuse'` a failed read rejects with a failure that names the read, never `[]`, a partial set or `false`; an empty queue is still `[]`. The docblock names who takes which: the access path (D3), the claim admission (D4) and the assignment pool (D5) take `'nobody'`; the approver slate (D6) and the sharing-recipient grant recompute (D7) take `'refuse'`. The key is independent of `purpose`.
- **Contract only.** Every existing call and implementation compiles unchanged and behaves as today; the producer in `@objectstack/plugin-sharing` and the D6/D7 callers that pass `'refuse'` land with #29604.
