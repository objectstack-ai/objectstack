---
'@objectstack/plugin-approvals': patch
'@objectstack/spec': patch
---

fix(plugin-approvals)!: the administrator override never approves a request its actor submitted

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row, registry key or authored value changes. The approvals doors answer one more caller with a refusal, and the served viewer block gains one flag beside the three it had, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for an administrator (a platform admin, or a tenant admin in their own organization) who submitted a pending approval request and holds no slot on its step:

- `POST /api/v1/approvals/requests/:id/approve` answers `403 FORBIDDEN`, whatever the step's `excludeSubmitter` says. The override never approves its actor's own request.
- A `POST /api/v1/approvals/requests/:id/reassign` admitted through the override answers `400 VALIDATION_FAILED` when its target is the request's submitter (their user id, their email in any letter case, or a position only they hold in the request's organization), whoever makes it. When the submitter makes it themselves, every target they could act under is refused, a position they share with others included.

**Not moved.** Rejecting and recalling their own request stay open to them. An administrator's override of a request they did not submit is unchanged, and still audited `via_override: true`; such an administrator may still reassign it to a position the submitter shares with others. A submitter who holds a real slot on the step stays `excludeSubmitter`'s question, and that step's reassign check now reads an email target in any letter case as well.

The `viewer` block that `getRequest` / `listRequests` serve gains `can_override_approve`: `can_override`, except on a request the viewer submitted. `sys_approval_request`'s Approve action reads it in place of `can_override`, so the Approve control is not offered where the server refuses it. `can_override` keeps its meaning for Reject, Reassign and Recall, and `ApprovalRequestRow.viewer` in `@objectstack/spec/contracts` declares the new flag as optional.

The fix for a caller: have an approver on the step or another administrator decide the request, reassign it to someone else, or recall it and send the record for approval again.
