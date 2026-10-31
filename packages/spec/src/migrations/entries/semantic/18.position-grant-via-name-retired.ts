// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A TS/API surface, never stored in stack metadata: `PositionGrantVia` types a
// served description (`describePositionGrants`, `GET /meta/position?include=grants`),
// so there is no source for the chain to rewrite and this entry is the whole
// ADR-0087 registration. The runtime half (the position-name fold itself) carries
// no entry of its own: it moved no authorable key, spelling or stored shape.
export const entry: SemanticMigration = {
  id: 'position-grant-via-name-retired',
  surface:
    'PositionGrantVia on @objectstack/spec/contracts (the via of each entry of '
    + 'PositionGrantSummary.permissionSets, served as _grantedPermissionSets on the position list '
    + 'read with include=grants) loses its name member',
  replacement:
    '(no replacement member — `via` is `\'definition\'` on every entry. Code that branched on '
    + '`via === \'name\'` deletes that branch: the compiler names it (TS2367, the two types have no '
    + 'overlap). To have a position grant the permission set that shares its name, name the set in the '
    + 'position\'s `permissionSets`.)',
  reason:
    'ADR-0131 D3/D4 and the retirement of the position-name fold: a position grants only the sets its '
    + 'definition names, so a set that merely shares its name is neither granted nor described. Since '
    + 'the security plugin stopped requesting a held position\'s name as a set name, nothing serves '
    + '`via: \'name\'`; a published member no producer can emit invites a consumer to keep a branch, '
    + 'such as a by-name badge, that can only be dead or wrong (ADR-0049 enforce-or-remove).',
  acceptanceCriteria:
    'No code compares a `PositionGrantVia` value with `\'name\'` (TS2367 after upgrade). '
    + '`GET /api/v1/meta/position?include=grants` serves `via: \'definition\'` on every entry of '
    + '`_grantedPermissionSets`, exactly as before this change. No authored metadata document ever carried '
    + 'the type, so `os migrate meta` has nothing to visit.',
};
