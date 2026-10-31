// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #25251, ruling 6354966423 letter B — the D3 entry for the change of meaning
// the run-time arm landed in plugin-security: a `runAs: 'system'` run's governed
// writes to the four identity-assignment objects are refused. No key of any
// schema is added, removed, renamed or re-shaped (`runAs` keeps its two values
// and every flow still saves), so there is no tombstone and no D2 conversion:
// the move is an authoring choice no rewrite can make for the author.
export const entry: SemanticMigration = {
  id: 'flow-run-as-system-identity-assignment-write-refused',
  surface:
    'a flow declaring runAs system whose data nodes, or the writes they set off under the same context, '
    + 'insert, update, delete, transfer, restore or purge a row of sys_user_position, '
    + 'sys_user_permission_set, sys_invitation or sys_member',
  replacement:
    'For position holdings and permission-set grants, set the flow\'s `runAs` to `\'user\'`: the ADR-0090 '
    + 'D12 delegated-administration gate then judges the user the run acts for, admits a tenant-level or '
    + 'delegated administrator\'s grant, and records that user as the grant\'s `granted_by`. For invitations '
    + 'and memberships, call the organization endpoints (`POST /api/v1/auth/organization/invite-member`, '
    + '`cancel-invitation`, `update-member-role`, `remove-member`), which apply the invitation\'s placement '
    + 'and role-cap checks.',
  reason:
    'The data middleware returned early for every `isSystem` context, ahead of its gates, and a '
    + '`runAs: \'system\'` run\'s data nodes write under `isSystem` plus the run\'s `flowRunId`. So such a '
    + 'flow wrote position holdings and permission-set grants that the D12 gate never judged and that '
    + 'carried no `granted_by`, and invitation and membership rows that never passed the organization '
    + 'endpoints\' checks. The middleware now refuses, before that early return, an insert, update, delete, '
    + 'transfer, restore or purge of a row of the four objects from a context carrying both `isSystem` and '
    + 'a `flowRunId`, with `PERMISSION_DENIED` (403); nothing is written, the write node fails, and the '
    + 'run\'s result carries the refusal. This holds at any depth of the flow\'s own write, a cascade leg '
    + 'or a hook\'s write under the same context included. Unchanged: reads of the four objects, a system '
    + 'run\'s writes to every other object, a `runAs: \'user\'` run (it carries a `flowRunId` without '
    + '`isSystem` and meets the D12 gate as its user), and every platform writer whose system context '
    + 'carries no flow run (the seeders, better-auth and its reconciliation, invitation placement, the '
    + 'organization-administrator grant). ⛔ NOT convertible: flipping `runAs` changes what every other '
    + 'node of the flow may do, and moving an invitation or membership write to an endpoint is a new '
    + 'call, not a rewrite of the node. A census at the change found no flow in this repository or in '
    + 'hotcrm aimed at the four objects.',
  acceptanceCriteria:
    'No flow that declares `runAs: \'system\'` has a create, update, delete or upsert record node, or a '
    + 'hook its writes fire, that writes `sys_user_position`, `sys_user_permission_set`, `sys_invitation` '
    + 'or `sys_member`. Each formerly affected flow either runs as `\'user\'` and, triggered by an '
    + 'administrator, completes with the grant recorded under that user\'s `granted_by`, or no longer '
    + 'writes the row and the invitation or membership change goes through the organization endpoint. '
    + 'Running each such flow ends without a `PERMISSION_DENIED` refusal naming one of the four objects.',
};
