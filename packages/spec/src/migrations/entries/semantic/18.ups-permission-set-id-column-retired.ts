// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #15211 (ADR-0131 D4/D10, C7b) — a platform-object COLUMN retirement, not a
// spec-key retirement: no authorable spec key moves, so nothing lands in
// RETIRED_KEYS_BY_MAJOR and no D2 conversion exists to pair with (the
// ups-delegated-from-column-retired shape).
export const entry: SemanticMigration = {
  id: 'ups-permission-set-id-column-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'sys_user_permission_set.permission_set_id — the legacy id reference of a permission-set grant '
    + 'left the platform grant table declared by plugin-security (packages/plugins/plugin-security/'
    + 'src/objects/sys-user-permission-set.object.ts), with its (permission_set_id) index. The unique '
    + 'index (user_id, permission_set_id, organization_id) is replaced by one on (user_id, '
    + 'permission_set, organization_id) declared unique per organization, whose NULL-safe organization '
    + 'key part also refuses a second platform-wide grant (organization NULL) of one set to one user, '
    + 'with 409 UNIQUE_VIOLATION',
  replacement:
    '`permission_set`, the machine name of the permission set the grant holds (ADR-0131 D4). Delete '
    + 'the key from any authored `sys_user_permission_set` seed row or data-door write that still '
    + 'carries it, and name the set instead. Existing databases: run the v18 ceremony. Plan it first, '
    + '`os migrate organization-ownership --out plan.json`, and review the file it writes; then '
    + '`os migrate organization-ownership --apply --backup-taken --plan-file plan.json` executes that plan: its verified '
    + 'rewrite names every grant from the column and its column-drops step then drops the two retired '
    + 'indexes and then the column. Restart the server afterwards',
  reason:
    'ADR-0131 D4 makes every reference to a catalog item a name, and D3 retired the permission-set '
    + 'catalog rows the id pointed at. Since then no writer fills the column and no reader confers '
    + 'anything through it: a grant holds its set by permission_set. D10 orders the column\'s removal '
    + 'after every grant names its set, which is the v18 ceremony\'s verified id-to-name rewrite: it '
    + 'reads the physical column by raw SQL, names each grant, verifies every name against the '
    + 'security catalog, and only then drops the column through the schema-drift machinery (schema '
    + 'sync is additive, so an undeclared column stays until it is dropped). The boot-time name '
    + 'backfill that did the same job is retired with it. The old unique index keyed the id, which '
    + 'grants written by name leave NULL, so it never refused a duplicate grant; a duplicate confers '
    + 'nothing more, but a revoke that deletes one row leaves the other granting. The new index keys '
    + 'the name, NULL-safe on the organization (ADR-0120 D3), so it is the one guard every writer and '
    + 'write path meets. The organization-administrator sweep writes no grant beside a legacy one the '
    + 'rewrite has not named. The ceremony deletes no grant: a legacy grant whose name its user already '
    + 'holds in its organization is not named and blocks the rewrite, naming both ids, and named '
    + 'duplicates block the column\'s drop, until the operator has removed one of each pair.',
  acceptanceCriteria:
    'No authored stack seed or client write names `permission_set_id` on `sys_user_permission_set`: '
    + 'the engine refuses the undeclared field with 400 INVALID_FIELD. A second grant of one set to '
    + 'one user in one organization is refused by the unique index with 409 UNIQUE_VIOLATION, '
    + 'platform-wide grants (organization NULL) included, on every write path. On a legacy database, after `os migrate organization-ownership --apply` the column '
    + 'is gone and the boot no longer reports it orphaned.',
};
