---
'@objectstack/plugin-security': minor
---

feat(plugin-security)!: a flow that runs as system writes no identity assignment — position holdings, permission-set grants, invitations and memberships are refused from a flow run's system context

Clause-②: no (narrowing)
Metadata-protocol: semantic

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is added, removed, renamed or re-shaped: `runAs` keeps its two values and every flow still saves, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What changes is what `runAs: 'system'` lets a flow's data nodes write, which is the semantic entry the spec lane records under ADR-0087 D3 beside the `runAs` describe sentence. The author's migration is an authoring choice no rewrite can make for them: set the flow's `runAs` to `'user'` so the delegated-administration gate judges the user it acts for, or move invitation and membership changes to the organization endpoints, as the refusal itself says. -->

**BREAKING** for a `runAs: 'system'` flow that writes `sys_user_position`, `sys_user_permission_set`, `sys_invitation` or `sys_member`, shipped as `minor` under the launch-window convention for breaking changes. No flow shipped in this repository or in hotcrm does: a census of every create, update and delete record node found none aimed at the four objects.

- **FROM:** the data middleware returned `next()` for every `isSystem` context ahead of its gates, so a `runAs: 'system'` run, whose data context is `isSystem` plus the run's `flowRunId`, wrote these four objects past the ADR-0090 D12 delegated-administration gate and the identity write guard. Its grants carried no `granted_by`, and its invitations and memberships never passed the organization endpoints' checks.
- **TO:** an insert, update, delete, transfer, restore or purge of a row of the four objects from a context with `isSystem` and a `flowRunId` is refused with `PERMISSION_DENIED` (`403`) before the bypass, and nothing is written. The write node fails, and the run's result carries the refusal to its caller. The message names the remedy: `runAs: 'user'` for position holdings and permission-set grants, the organization endpoints for invitations and memberships. This holds at any depth of the flow's own write: a cascade leg or a hook's `ctx.api` write under the same context is refused the same way.
- **Unchanged:** every system writer that carries no `flowRunId` (the seeders, the publish materializer, better-auth and its reconciliation, invitation placement, the organization-administrator grant). A `runAs: 'system'` flow's reads of the four objects, and its writes to every other object. A `runAs: 'user'` flow, which carries a `flowRunId` without `isSystem`: it reaches the D12 gate as the user it acts for, which admits a tenant-level or delegated administrator's grant and records that user as `granted_by`, and refuses anyone else's.
- **Fix:** set the flow's `runAs` to `'user'`, so the grant is judged and attributed as the triggering user's own. Change invitations and memberships through `POST /api/v1/auth/organization/invite-member`, `cancel-invitation`, `update-member-role` and `remove-member`.

The package's exports are unchanged.
