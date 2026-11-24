---
'@objectstack/plugin-approvals': patch
---

fix(approvals): a reject through the approvals route or `IApprovalService.decide` requires a reason

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is one runtime check in this plugin's decide(): a reject without a non-blank string comment is refused. No stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller of `POST /api/v1/approvals/requests/:id/reject`, or of `IApprovalService.decide()` with `decision: 'reject'`, that sends no `comment`, an empty or whitespace-only one, or one that is not a string: the call used to reject the request and is now refused before anything is read or written. It ships `patch` because it is a non-protocol breaking change (AGENTS.md Post-Task Checklist step 3): nothing a metadata author writes changes, so `Metadata-protocol` is `none`.

The refusal is the one the `approval_reject` action door gives, judged by the same rules over the same `textarea` param: `400 VALIDATION_ERROR` with `Invalid action params: Action param "comment" is required` for an absent, `null`, empty or whitespace-only value, and `Invalid action params: Action param "comment" (textarea): …` for a value that is not a string (a number, a boolean, an array or an object). The request stays pending. A reject with a reason runs as before, and an approve keeps its comment optional. The platform's own rejects keep working: the SLA escalation's `auto_reject` and the revision-limit auto-reject do not pass through `decide()`, and the email action link records its fixed text. The email action link still records no reason the approver typed; that is a separate follow-up.

Fix for a caller: send the reason as `comment` in the reject body (`{ "comment": "Over budget." }`).
