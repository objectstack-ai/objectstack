---
'@objectstack/spec': minor
---

`ISecurityService` declares an optional, feature-detected member that answers the existing ADR-0055 master-detail write check: `checkControlledByParentWrite(object, recordId, context)`.

Clause-②: yes (widening)

- **What it answers.** It answers what the master-detail write check decides for an update of one record by the caller. A by-id write to a `controlled_by_parent` record requires edit access to its master, and the write path checks each master up the chain: the object-level `update` grant, the master's write row-level security, and record sharing. The answer equals what a by-id update of the same record gets from that check, the ADR-0090 D10 delegator leg included. It adds no verdict: it exposes the one the write path already reaches, so a gate on a record's attachments or comments can judge the record as its own update is judged.
- **What it resolves with.** `ControlledByParentWriteOutcome` is a discriminated union. `allow` means the check does not refuse. `deny` names the leg that refused (`ControlledByParentWriteDenialLeg`: `object_permission`, `row_level_security`, `record_sharing` or `master_chain`). `not_applicable` means the object is not `controlled_by_parent`. `unresolvable` names why the check reached no verdict (`ControlledByParentWriteUnresolvedReason`: a missing `master_detail` relation, a record that does not exist, or an empty master reference). A store fault is not an outcome: the member rejects with the engine's own error, so the fault keeps its declared status (a datasource outage is `503`).
- **Optional, and absence is typed.** A security service without the member still satisfies the contract, and an unguarded call does not compile. Absence means no master check is composed for a consumer to ask, which is not a policy that admits.

Nothing an author writes changes, and no runtime behaviour changes. `@objectstack/plugin-security` does not serve the member yet. An implementation typed as `ISecurityService` that serves this name must serve it under the declared signature.
