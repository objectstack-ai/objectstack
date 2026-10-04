// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'approval-position-address-role-retired',
  surface:
    'approvals position address role:<position> — the approverId filter of the approvals '
    + 'request list, the actorId of every decision, and a stored pending_approvers slot',
  replacement:
    '`position:<position>`, the one spelling of a position address; a flow approver authored '
    + 'as `{ type: \'role\', value: <a position name> }` becomes '
    + '`{ type: \'position\', value: <the position> }`',
  reason:
    'The fourth face of the ADR-0090 D3 `role` retirement, beside '
    + '`actor-user-roles-to-positions` and `action-session-roles-to-positions`, and like them '
    + 'a runtime face with no spec schema. The approvals service read `role:<position>` as a '
    + 'second spelling of `position:<position>` wherever it compares a slot with the caller '
    + '(the "My Pending" filter, the participant gate, `viewer.can_act`, and the slot test of '
    + 'every decision), because 15.x-era slots and the stock console\'s identity list carried '
    + 'it. ADR-0090 D3 retires the word with no alias window, so once the pinned console sent '
    + '`position:<position>` the arm came out in one edit (maintainer ruling, 2026-10-04). '
    + '`position:<position>` is now the only position address: a `role:<position>` ask matches '
    + 'only a slot stored under that exact spelling, and a `role:<position>` actor is refused '
    + 'with 403 `FORBIDDEN`. '
    + 'The same ruling closed the one WRITER of the spelling. The deprecated `role` approver '
    + 'TYPE already resolved as `org_membership_level` (the org-membership tier: owner, admin, '
    + 'member), but when that lookup found no one the fallback slot kept the AUTHORED spelling, '
    + '`role:<value>`, and a holder of a same-named position decided it through the arm, so '
    + 'the runtime silently honoured a membership-tier declaration as a position. The fallback '
    + 'now writes the canonical `org_membership_level:<value>`, and no path writes a `role:` '
    + 'slot. '
    + 'Two classes of pending request are therefore decided only by the privileged override, '
    + 'or by a reassign to a real approver: a request a 15.x-era release stored as '
    + '`role:<position>`, and a new request from a flow that still authors '
    + '`{ type: \'role\', value: <a position name> }` and whose tier lookup finds no one. No '
    + 'stored slot is rewritten: the ruling refused a one-time rewrite as the permanent '
    + 'migration debt ADR-0090\'s first forcing fact names. '
    + 'Why this is a D3 semantic TODO and not a D2 conversion, on two independent grounds. '
    + 'FIRST, no metadata key moves: the address is runtime DATA (a request slot, a query '
    + 'parameter, a decision body\'s actor), never a `sys_metadata` row, so there is no source '
    + 'for a declarative transform to rewrite. SECOND, the one authored shape that leads here, '
    + '`{ type: \'role\', value: <x> }`, is ambiguous by construction: the deprecated alias '
    + 'means the membership TIER, and whether its author meant a position instead is a '
    + 'judgment only that author can make, so a mechanical rewrite to either type would guess. '
    + 'The `ApproverType` `role` alias itself is a separate retirement and is unchanged here. '
    + 'ADR-0090 D3, ADR-0087.',
  acceptanceCriteria:
    'No client sends `role:<position>` as an `approverId` or an `actorId`: every such value is '
    + '`position:<position>`, and a request routed to the position is listed for its holder, '
    + 'served with `viewer.can_act: true`, and decided by that holder with no `actorId` named. '
    + 'Every flow approver authored as `{ type: \'role\', value: <x> }` is reviewed by its '
    + 'author: `<x>` a position name becomes `{ type: \'position\', value: <x> }`, and `<x>` a '
    + 'membership tier (owner, admin, member) becomes '
    + '`{ type: \'org_membership_level\', value: <x> }`. `os lint` reports the first as '
    + '`approval-approver-not-membership-tier` and the second as '
    + '`approval-approver-type-deprecated`. Every pending request whose slot reads '
    + '`role:<position>`, or `org_membership_level:<a position name>` from such a flow, is '
    + 'either decided by a platform admin or a tenant admin of its organization (the approve '
    + 'or reject is recorded with `via_override: true` and resumes the run) or reassigned to '
    + 'the position\'s holder, who then decides it. Verify on a running app, as an admin: the '
    + 'pending list filtered by `approverId` set to each such slot address answers no rows.',
};
