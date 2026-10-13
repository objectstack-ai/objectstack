// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0131 D3 (stage W2 of the C3 card) — a runtime-door narrowing with no
// authorable key: under a walled tenancy posture a package that carries
// security catalog items is the platform operator's to install, upgrade,
// uninstall or delete. Registered because a caller that did so before is
// refused now, and an operator must be told who keeps that authority.
export const entry: SemanticMigration = {
  id: 'walled-catalog-package-writes-retired',
  // No backticks in `surface`: build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'on a group or isolated deployment, by a caller below the platform operator: '
    + 'POST /api/v1/marketplace/install-local of a package whose incoming version, or whose installed '
    + 'version on an upgrade, declares a position, permission set or capability; '
    + 'DELETE /api/v1/marketplace/install-local/:id of a package whose installed version declares one '
    + '(@objectstack/cloud-connection); and DELETE /api/v1/packages/:id of a package holding stored '
    + 'positions or permission sets on the runtime dispatcher',
  replacement:
    'the platform operator (the `PLATFORM_ADMIN` rung, the deployment\'s declared '
    + '`OS_PLATFORM_OWNER_EMAIL` owner) installs, upgrades, uninstalls and deletes those packages; '
    + 'a package with no catalog item installs, upgrades and uninstalls exactly as before. A custom '
    + 'package door asks `walledCatalogWriteVerdict` (`@objectstack/metadata-core`) once per catalog '
    + 'type the package declares, after its capability gate',
  reason:
    'ADR-0131 D3: on a shared-database multi-tenant deployment tenant admins cannot create or edit '
    + 'catalog items, and the operator defines the catalog for every tenant, including through '
    + 'managed packages. A package registers its catalog items environment-wide, so before this '
    + 'change a manage_metadata holder scoped to one organization could upgrade, uninstall or delete '
    + 'a package holding a permission set another organization\'s members hold, and change or remove '
    + 'what those members resolve.',
  acceptanceCriteria:
    'On an isolated or group deployment, an organization owner holding manage_metadata inside their '
    + 'own organization re-installs, at a new version, an operator-installed package whose permission '
    + 'set another organization\'s member holds: the answer is 403 FORBIDDEN, the message names the '
    + 'posture, and the member resolves exactly what it resolved before. The same owner\'s uninstall '
    + 'of that package answers 403 FORBIDDEN, and DELETE /api/v1/packages/<id> of a runtime package '
    + 'holding a permission set answers 403 PERMISSION_DENIED; the member keeps the set. The same owner '
    + 'installs, upgrades and uninstalls a package with no catalog item with 200. The platform operator '
    + 'does all of it with 200, and on a single deployment a manage_metadata holder does all of it '
    + 'exactly as before.',
};
