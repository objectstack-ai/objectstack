// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #25653, ruling record 6384657105 letter A — the D3 entry for the save-time
// half of the identity-assignment refusal, beside
// `18.flow-run-as-system-identity-assignment-write-refused`: `HookSchema`
// refuses a `runAs: 'system'` hook, and `ActionSchema` a `script` action,
// whose sandboxed JS body names a write to one of the four objects. It narrows
// the accept set of both schemas; no key is removed, so there is no tombstone,
// and no D2 conversion either: the move is an authoring choice no rewrite can
// make for the author.
export const entry: SemanticMigration = {
  id: 'hook-action-body-system-identity-assignment-write-refused',
  surface:
    'a hook declaring runAs system, or an action of type script, whose sandboxed js body source calls '
    + 'insert, update, delete, updateMany, deleteMany or upsert on ctx.api.object of sys_user_position, '
    + 'sys_user_permission_set, sys_invitation or sys_member',
  replacement:
    'For position holdings and permission-set grants, set the hook\'s `runAs` to `\'user\'`, or, for an '
    + 'action, make the grant from a flow whose `runAs` is `\'user\'` (an action of `type: \'flow\'` runs it '
    + 'as the invoking user): the ADR-0090 D12 delegated-administration gate then judges that user, admits '
    + 'a tenant-level or delegated administrator\'s grant, and records that user as the grant\'s '
    + '`granted_by`. For invitations and memberships, call the organization endpoints '
    + '(`POST /api/v1/auth/organization/invite-member`, `cancel-invitation`, `update-member-role`, '
    + '`remove-member`), which apply the invitation\'s placement and role-cap checks.',
  reason:
    'App-authored automation does not use elevation to write the four identity-assignment objects. The '
    + 'data middleware already refuses, with `PERMISSION_DENIED` (403), a governed write to '
    + '`sys_user_position`, `sys_user_permission_set`, `sys_invitation` or `sys_member` from a hook that '
    + 'runs as system and from an action body, which always runs as system, so such a body\'s write never '
    + 'landed; but every authoring door still accepted the body, and the author learned otherwise only '
    + 'from a failed write. The parse now refuses it too: `HookSchema` refuses a hook that declares '
    + '`runAs: \'system\'`, and `ActionSchema` a `type: \'script\'` action, whose sandboxed JS (`language: '
    + '\'js\'`) `body.source` calls `insert`, `update`, `delete`, `updateMany`, `deleteMany` or `upsert` '
    + 'on `ctx.api.object(...)` named with one of the four as a literal, on the handle or on a name the '
    + 'body bound it to, with one issue per object at `body.source`, at `objectstack validate`, at '
    + '`defineStack` and at the metadata save door (a 422). Unchanged: reads of the four objects, writes '
    + 'to every other object, a hook under `runAs: \'user\'` or `\'inherit\'`, an expression (L1) body, '
    + 'which performs no IO, and a code `handler`. The run-time refusal stays the enforcement for every '
    + 'elevated write. ⛔ NOT convertible: flipping a hook\'s `runAs` changes what every other write of '
    + 'the hook may do, and moving a grant to a flow or an invitation or membership change to an '
    + 'endpoint is a new call, not a rewrite of the body. A census at the change found no hook or action '
    + 'body in this repository that writes the four objects.',
  acceptanceCriteria:
    '`objectstack validate` reports no issue at `body.source` of a hook or an action: no hook that '
    + 'declares `runAs: \'system\'` and no `type: \'script\'` action has a sandboxed JS body that writes '
    + '`sys_user_position`, `sys_user_permission_set`, `sys_invitation` or `sys_member`. Each formerly '
    + 'affected hook either runs as `\'user\'` and, fired by an administrator\'s write, records the grant '
    + 'under that user\'s `granted_by`, or no longer writes the row; each formerly affected action hands '
    + 'the grant to a `runAs: \'user\'` flow or the change to the organization endpoint. Saving each such '
    + 'hook or action through the metadata API succeeds instead of answering a 422 that names '
    + '`body.source`.',
};
