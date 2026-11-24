---
'@objectstack/plugin-approvals': patch
'@objectstack/rest': patch
'@object-ui/console': patch
'@object-ui/app-shell': patch
---

fix(plugin-approvals): the decide refusal of a submitter's own approval, and a submitter notice that names several slots, read in the reader's language

Clause-②: yes (widening)
Metadata-protocol: none

**Widened door response.** The approvals decide door (`packages/rest/src/approvals-routes.ts`) gains one optional member, `userMessage`, at the top level of its flat `{ code, error }` refusal body. Two rows answer it today: the two `403 FORBIDDEN` decide refusals of a submitter's own approval, the `excludeSubmitter` refusal and the administrator-override self-approve refusal. It is absent whenever no producer marked one, so every other refusal body is unchanged.

- **The decide refusal.** When the decision door refuses a submitter's own approval (the step sets `excludeSubmitter`, or the administrator override would approve the actor's own request), the thrown error now carries a `userMessage`: the same refusal, with its remedy, in the decider's language (`approvalDecideRefused*` in every approvals message pack). A position is named by the decider's pack label, then its declared label, then its name. The error's `message` is unchanged: it stays English for the developer and the log. With no reader language, `userMessage` is English and names no user id.
- **The REST door.** The approvals routes answer a refusal the service marked with `userMessage` at the top level of their flat `{ code, error }` body, beside `error`, on every mapped row. A refusal with no marking answers exactly as before.
- **The console.** The record page's `type: 'api'` actions (the request's Approve button) read a flat body's top-level `userMessage` as well as the `error.userMessage` of the ADR-0112 envelope, and show it in place of the English `error`. The Approval Center's inline decision toast shows a marked refusal as written, before its generic line.
- **The submitter notice.** A notice for a slate of 2 to 8 slots names each slot inline, one keyed type word and value per slot (`approvalNoApproverHoldingSlots2` to `…Slots8`, derived from each pack's own `approvalNoApproverHolding`, `approvalNoApproverSlot` and `approvalNoApproverSlotSeparator`), so the messaging service renders every slot in the recipient's language at delivery. A slate of more than 8 slots still names its slots in English inside the recipient's sentence. The literal English body is unchanged.
