---
"@objectstack/spec": minor
---

feat(spec): `ApprovalRequestRow` declares `current_step_label`, the `sys_approval_request` column's own name for the step's label

Clause-②: yes (widening)

- **The member.** `ApprovalRequestRow` (`@objectstack/spec/contracts`) gains an optional `current_step_label?: string` beside `step_label`. It names the declared `sys_approval_request.current_step_label` column: the Approval node's authored label as it stood when the request reached the step. A page bound to `sys_approval_request` names the object's declared fields, and `step_label` is not one, so a served row that carries this member lets such a page list the step by its label instead of by `current_step`, the node's machine id.
- **Nothing moves.** `step_label` stays, at the same shape and with the same value, so no reader changes. The member is optional, so every existing implementer and every row built without it still conforms. It is a member of a TypeScript interface: no Zod schema and no runtime accept set changes.
- **Its producer.** `@objectstack/plugin-approvals`' request read mapping is the producer; serving the member there is that package's own change.
