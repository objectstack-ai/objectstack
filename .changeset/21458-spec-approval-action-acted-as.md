---
"@objectstack/spec": minor
---

feat(spec): `ApprovalActionRow` declares `acted_as`, the pending-approver slot an approval action was taken as, beside the person in `actor_id`

Clause-②: yes

**What it declares.** One optional string member on `ApprovalActionRow` in `@objectstack/spec/contracts`, the row type of an approval request's action log (`IApprovalService.listActions`, served at `GET /api/v1/approvals/requests/:id/actions` and typed by the client SDK):

- `acted_as?: string` is the slot the action was admitted under, in the slot's stored spelling as it stood in the request's `pending_approvers`: a `position:<name>` address (or `role:<name>`, the deprecated pre-rename spelling), an email, or a user id.
- It is never a person. The person who acted is `actor_id`, which under ADR-0118 D1 holds a `sys_user` id or nothing. A slot addressed by a user id carries that id in `acted_as` as the slot's address, which makes no claim about who acted.
- Absent means the action was not admitted through a slot (a submitter's own action, a system action, or an admin override, which `via_override` marks), or the row was written before the slot was recorded. So absent alone never proves that no slot was involved.

**What moves for consumers.** Nothing in this package writes the member, and every existing export and member is unchanged: a row without `acted_as` conforms exactly as before. The approvals service is its producer, and that package's own changeset states when `listActions` starts returning it. Until then every row omits it, which is the member's declared absent case. A client that renders the action log can show `acted_as` beside the actor's name as the capacity the actor acted in.
