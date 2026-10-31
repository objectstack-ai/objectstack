// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0131 D3 (C3 stage 8) — the four security-catalog row objects are retired.
// Registered because a client of their data and REST routes, a permission set
// granting object permissions on them, or a seed row targeting one must move to
// the security catalog instead.
export const entry: SemanticMigration = {
  id: 'catalog-row-objects-retired',
  surface:
    'the sys_position, sys_permission_set, sys_position_permission_set and sys_capability objects — their '
    + 'data and REST routes, their Setup object pages, object permissions naming them, and seed rows targeting them',
  replacement:
    'read and write the security catalog through the metadata door: `GET|PUT|DELETE /api/v1/meta/permission/:name` '
    + 'and `/api/v1/meta/position/:name` (a position names its sets in `permissionSets`), read-only '
    + '`GET /api/v1/meta/capability`; copy a set with `POST /api/v1/security/permission-sets/:name/clone`. '
    + 'Declare a capability with `defineCapability` (`stack.capabilities`) instead of a `sys_capability` seed row, '
    + 'and drop object permissions on the four names — they grant nothing',
  reason:
    'ADR-0131 D3: positions, permission sets and capabilities have one home, the environment registry, fed by '
    + 'package declarations and by environment metadata saved through the metadata door. The row objects that '
    + 'mirrored them were read by nothing that authorizes, so they are no longer registered; their physical '
    + 'tables and rows stay until the organization-ownership migration (ADR-0131 D10) takes them. ADR-0087.',
  acceptanceCriteria:
    'No client calls `/api/v1/data/` on one of the four names, no permission set grants object permissions on '
    + 'them, no seed dataset targets them, and every position, permission set and capability the deployment '
    + 'relies on is served by `GET /api/v1/meta/<type>/:name`.',
};
