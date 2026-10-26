---
'@objectstack/plugin-security': patch
'@objectstack/objectql': patch
'@objectstack/runtime': patch
'@objectstack/core': patch
---

fix(security): a hook that runs as system and an action body are refused writes to position holdings, permission-set grants, invitations and memberships, as a system flow already is

Clause-②: no (narrowing: app-authored hook and action-script writes to the four identity objects are refused at run time, as #25251 did for flows; the seat runs the contract review before the queue)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What changes is the run-time answer to a hook or action body's elevated write to four platform objects; the save-time refusal and its semantic entry are the spec half of the same card. -->

**BREAKING** (a served-set narrowing) for app-authored automation that writes `sys_user_position`, `sys_user_permission_set`, `sys_invitation` or `sys_member` under system elevation. A census of the hooks and action bodies in this repository and in HotCRM found none that does.

A `runAs: 'system'` flow has been refused these writes since 18.1. Two other kinds of app-authored automation run with the same elevation and were not: a hook that declares `runAs: 'system'`, and an action body (`type: 'script'`), which always runs elevated. Their writes skipped the delegated-administration gate (so a grant carried no `granted_by`) and the invitation door's placement and role-cap checks. Both are now refused the same way:

- An insert, update, delete, transfer, restore or purge of one of the four objects, from a `runAs: 'system'` hook (a sandboxed body or an in-process handler) or from an action body (through `ctx.api` or `ctx.engine`), answers `403 PERMISSION_DENIED`. Nothing is written. A hook's refusal aborts the triggering write under the default `onError: 'abort'`.
- The message names the source and the fix. For position holdings and permission-set grants: set the hook's `runAs` to `'user'`, so the delegated-administration gate judges the user the hook acts for and records them as `granted_by`. An action body has no `runAs`, so its grant moves to a `runAs: 'user'` flow, which an action of type `flow` runs as the invoking user. For invitations and memberships: use the organization endpoints.

Unchanged: reads of the four objects, and writes to every other object, from the same hook or body. A hook under `runAs: 'user'`, which the ordinary gates judge as its user. The platform's own writers (better-auth and its reconciliation, invitation placement, the seeders, any `sudo()`), which carry no app-automation mark. A system flow's refusal, word for word.

**What changes for you.** A hook or action body that grants a position or a permission set under elevation now fails. Declare `runAs: 'user'` on the hook, or move an action body's grant into a `runAs: 'user'` flow. Invitations and memberships change through `POST /api/v1/auth/organization/invite-member`, `cancel-invitation`, `update-member-role` and `remove-member`.

`@objectstack/core` exports the mark: `APP_AUTOMATION_ELEVATION`, `markAppAutomationElevation`, `appAutomationElevationOf` and `carryAppAutomationElevation`.
