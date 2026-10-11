// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0131 D3 (stage W of the C3 card) — a runtime-door narrowing with no
// authorable key: under a walled tenancy posture the security catalog's write
// doors admit only the platform operator. Registered because a caller that
// wrote catalog items before is refused now, and an operator must be told who
// keeps that authority and what a tenant does instead.
export const entry: SemanticMigration = {
  id: 'walled-catalog-tenant-writes-retired',
  // No backticks in `surface`: build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'on a group or isolated deployment, a write of a position, permission set or capability by a '
    + 'caller below the platform operator: PUT, DELETE, publish and rollback of /meta/position, '
    + '/meta/permission and /meta/capability on @objectstack/rest and the runtime dispatcher, the '
    + 'permission-set clone door (POST /security/permission-sets/:name/clone), and a '
    + 'data-door insert, update or delete on sys_position, sys_permission_set and sys_capability '
    + 'through @objectstack/plugin-security',
  replacement:
    'the platform operator (the `PLATFORM_ADMIN` rung, the deployment\'s declared '
    + '`OS_PLATFORM_OWNER_EMAIL` owner) defines the catalog, in Studio or through a managed package; '
    + 'an organization\'s administrators assign it to their own members through '
    + '`sys_user_position` and `sys_user_permission_set`, which are unchanged. A custom door that '
    + 'writes catalog items asks `walledCatalogWriteVerdict` (`@objectstack/metadata-core`) after '
    + '`metaWriteCapabilityVerdict`',
  reason:
    'ADR-0131 D3: on a shared-database multi-tenant deployment tenant admins cannot create or edit '
    + 'catalog items, and the operator defines the catalog for every tenant. The catalog is '
    + 'environment-level and every organization resolves it by name, so before this change a '
    + 'manage_metadata holder scoped to one organization could save over a permission set another '
    + 'organization\'s members hold and change what those members resolve.',
  acceptanceCriteria:
    'On an isolated or group deployment, an organization owner holding manage_metadata inside '
    + 'their own organization saves PUT /api/v1/meta/permission/<name>: the answer is 403 FORBIDDEN '
    + '(403 PERMISSION_DENIED on the runtime dispatcher), the message names the posture and the '
    + 'manage_metadata capability, and another organization\'s holder of that set resolves exactly '
    + 'what it resolved before. A data-door create on sys_position or sys_permission_set by the same '
    + 'caller answers 403 PERMISSION_DENIED and stores nothing. The platform operator saves the same '
    + 'item with 200, the same organization owner still assigns a catalog permission set to its own '
    + 'member with 201, and on a single deployment a manage_metadata holder saves catalog items '
    + 'exactly as before. Items saved before this change keep their bytes.',
};
