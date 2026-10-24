---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): an out-of-office delegation applies only in its own organization, and an organization-less delegation reroutes no approval

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What changes is how the approval service reads a stored `sys_approval_delegation` row: the reading ADR-0131 D1 retired for every tenant column, and that `grantAppliesInTenant` already applies to grant rows. -->

**BREAKING** for a stored `sys_approval_delegation` row that carries no `organization_id` (`NULL`, absent or blank). No write produces such a row any more under a walled posture, so only a database upgraded from before 18.0 can hold one.

- **Which delegation reroutes an approver.** FROM: an organization-less delegation applied in every organization ("null = applies across tenants for this delegator"), and a request with no organization took every active delegation of its approver, whatever organization it belonged to. TO: a delegation reroutes an approver only when its organization is the request's organization, the rule a stored position or permission-set grant follows. An organization-less delegation reroutes nothing anywhere, and a request with no organization takes no delegation.
- **Why.** Under `group` or `isolated`, an organization-less delegation rerouted every organization's approvals for its delegator, onto a delegate who may hold no membership in that organization. ADR-0131 D1: nothing reads a NULL tenant value as an owner.
- **Under `single`** a delegation written on 18.x applies as before: the engine stamps the Default Organization on a delegation its author writes and on the record a request is about, and the request takes its record's organization. Only an organization-less row left from before the ownership ceremony stops applying.
- **Where such a row comes from.** Under a wall a member's insert is stamped with the active organization, an elevated insert with none is refused, and an update that empties the column is refused. A row stored before that, on a database upgraded from 17.x or an 18.0 pre-release, can still be organization-less: `os migrate organization-ownership` attributes it to the Default Organization under `single`, and under a wall, where the row names nothing to attribute it by, reports it and leaves it NULL.
- **It is not silent.** Each time a lookup skips an active organization-less delegation, the approval service logs a `warn` naming the delegation, its delegator and delegate, the request's organization, and the remedy.
- **Setup.** The delegation form's Organization help says what the code does, in every shipped locale.

**What an operator does.** On a `single` deployment, run `os migrate organization-ownership --apply` if it has not run yet; it attributes these rows to the Default Organization. On a walled deployment, ask the delegator to create the delegation again while signed in to the organization whose approvals it should cover, then delete the organization-less row the warning names.
