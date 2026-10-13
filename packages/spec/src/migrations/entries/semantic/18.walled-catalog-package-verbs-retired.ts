// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0131 D3 (stage W3 of the C3 card) — a runtime-door narrowing with no
// authorable key: under a walled tenancy posture the `/packages` verbs that
// publish, discard, roll back, revert, duplicate or adopt security catalog
// items are the platform operator's. Registered because a caller that ran them
// before is refused now, and an operator must be told who keeps that authority.
export const entry: SemanticMigration = {
  id: 'walled-catalog-package-verbs-retired',
  // No backticks in `surface`: build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'on a group or isolated deployment, by a caller below the platform operator, on the runtime '
    + 'dispatcher: POST /api/v1/packages/:id/publish-drafts, /discard-drafts and /revert when the package has a pending '
    + 'position, permission-set or capability draft; /rollback when a commit it would undo touched one; '
    + '/commits/:commitId/revert when that commit touched one, whatever package the URL names; '
    + '/duplicate when the published rows it copies hold one; and /adopt-orphans when the orphaned rows include one',
  replacement:
    'the platform operator (the `PLATFORM_ADMIN` rung, the deployment\'s declared '
    + '`OS_PLATFORM_OWNER_EMAIL` owner) runs those verbs on catalog-carrying packages. '
    + 'walled-environment-metadata-writes-retired then refuses the same caller those verbs on every '
    + 'package, whatever its drafts, commits or rows carry. A custom package door asks '
    + '`walledCatalogWriteVerdict` (`@objectstack/metadata-core`) after its capability gate',
  reason:
    'ADR-0131 D3: on a shared-database multi-tenant deployment tenant admins cannot create or edit '
    + 'catalog items, and the operator defines the catalog for every tenant. A package\'s catalog '
    + 'items are environment-wide, so before this change a manage_metadata holder scoped to one '
    + 'organization could publish an operator\'s pending catalog draft, roll back or revert the '
    + 'operator\'s published catalog change, discard the operator\'s draft, copy the operator\'s '
    + 'catalog items into a package of its own, or adopt the environment\'s catalog rows, and so '
    + 'change what another organization\'s members resolve.',
  acceptanceCriteria:
    'On an isolated or group deployment, the operator publishes a permission set in a writable '
    + 'package twice (the second adding manage_users) and leaves a third draft pending; another '
    + 'organization\'s member holds the set. An organization owner holding manage_metadata inside '
    + 'their own organization then calls publish-drafts, discard-drafts, revert, rollback to the first commit, '
    + 'commits/<second>/revert (also under a URL naming another package), duplicate and, into '
    + 'another package, adopt-orphans: each answers 403 PERMISSION_DENIED naming the posture, '
    + 'the draft stays pending, nothing is copied or rebound, and the member resolves exactly what it '
    + 'resolved before. The platform operator runs every verb on the catalog-carrying package with '
    + '200, and on a single deployment a manage_metadata holder runs them exactly as before.',
};
