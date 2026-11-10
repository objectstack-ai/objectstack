---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals)!: under a walled tenancy posture, an approval request that carries no organization is acted on only by a platform administrator or the system

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: the approval request, its actions and the IApprovalService contract keep their shapes. What moves is who the approval doors admit on a stored request with no organization under the group or isolated posture, and nothing at rest records that answer, so there is nothing for a migration to rewrite. -->

**BREAKING** for an organization administrator under the `group` or `isolated` posture, on an approval request whose stored row carries no organization (ADR-0131 D1: NULL is not a state and names no owner).

- **The rule.** Under a walled posture, only a platform administrator or a system context acts on an approval request that has no organization. An organization administrator is answered on approve, reject, recall, reassign, revise (send back), resubmit, remind, request info and comment exactly as for an id that names no request: `404 REQUEST_NOT_FOUND`, and the request is unchanged.
- **Unchanged.** Under the `single` posture nothing changes: a tenant administrator still acts on such a request. A request that carries an organization is acted on, as before, by an administrator of that organization or a platform administrator; an administrator of another organization is answered as for no request. A pending approver and the submitter are judged by each door's own rule, as before.

**Who moves, and the fix.** Only a deployment running `group` or `isolated` that still holds approval requests with no organization, stored before ADR-0131 D9: under a walled posture a new write is stamped with an organization or refused. For a stuck legacy request, a platform administrator can act on it as before. To give those rows their owner, run the existing, voluntary organization-ownership ceremony: `os migrate organization-ownership` first, which writes a read-only plan and changes no row, review the plan, then `os migrate organization-ownership --apply --plan-file PLAN_FILE --backup-taken`. Nothing runs on upgrade.
