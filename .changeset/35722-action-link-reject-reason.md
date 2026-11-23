---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals)!: a reject from the email action link records the reason the approver types on the confirm page, and a reject with no reason is refused on the page

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — nothing under `skills/**` teaches the approval action link or its confirm page (`git grep -i` for "action link", "approvals/act" and `issueActionTokens` over `skills/` finds nothing)

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the answer the ADR-0043 action page gives a POST that redeems a reject link: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller that POSTs a reject link's token to `/api/v1/approvals/act` (the plugin's self-hosted mount, or the HTTP dispatcher's `/approvals/act` domain through `IApprovalService.handleActionPage`) without a reason.

- FROM: the confirm page for a reject link had no reason field. A POST carrying only the `token` field rejected the request and recorded the fixed comment "Via action link", while every other reject door (the record-page action, MCP `run_action`, the `/reject` route, the SDK) refused a reject with no reason.
- TO: the reject confirm page carries a required "Reason for rejecting · 驳回理由" field, posted as `comment`, and the decision records that text as its comment. A POST whose `comment` is missing, blank or not a string (judged by the same rule `ApprovalService.decide()` applies) is answered the same confirm page again with the refusal "Enter a reason to reject this request. · 驳回需填写驳回理由。" and status `400`. Nothing is decided and the token is not consumed, so the approver can type a reason and send the same link again.

**Not moved.** An approve link: its page has no reason field, a POST reads only `token`, and the decision still records "Via action link". A dead link (unknown, expired, used, already decided, handed to someone else) is still told on the result page with `200`, checked before the reason, and a GET still never decides. Both doors still answer the same status and bytes for the same body.

The fix for a caller: send the reason in the form's `comment` field with the `token` when redeeming a reject link.
