// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0131 D12 items 7–8 and D11 (ruling A on #23231) — a runtime-door
// narrowing with no authorable key: under a walled tenancy posture every
// environment-metadata write admits only the platform operator, whatever its
// type. The security catalog was the first case refused
// (walled-catalog-tenant-writes-retired, walled-catalog-package-writes-retired,
// walled-catalog-package-verbs-retired); this entry stops special-casing it.
// Registered because a caller that wrote objects, views, flows or packages
// before is refused now, and an operator must be told who keeps that authority.
export const entry: SemanticMigration = {
  id: 'walled-environment-metadata-writes-retired',
  // No backticks in `surface`: build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'on a group or isolated deployment, by a caller below the platform operator, whatever the metadata '
    + 'type: PUT, DELETE, publish and rollback of /meta/:type/:name on @objectstack/rest and PUT on the '
    + 'runtime dispatcher; every /api/v1/packages write on the runtime dispatcher (create, the manifest '
    + 'PATCH, enable, disable, publish, publish-drafts, discard-drafts, revert, rollback, '
    + 'commits/:commitId/revert, duplicate, adopt-orphans and delete); POST and DELETE of '
    + '/api/v1/marketplace/install-local (@objectstack/cloud-connection); and the /api/v1/automation '
    + 'definition writes (create, update, delete and clone)',
  replacement:
    'the platform operator (the `PLATFORM_ADMIN` rung, the deployment\'s declared '
    + '`OS_PLATFORM_OWNER_EMAIL` owner) authors the environment\'s metadata, in Studio or through a '
    + 'managed package; an organization that needs metadata of its own is given an environment of its '
    + 'own. An organization\'s administrators still assign the catalog\'s positions and permission sets '
    + 'to their own members. A custom door that writes environment metadata asks '
    + '`walledCatalogWriteVerdict` (`@objectstack/metadata-core`) after its capability gate, for every '
    + 'type, with no catalog pre-filter',
  reason:
    'ADR-0131 D12 items 7–8: a walled deployment is one environment with one schema and one catalog, '
    + 'the metadata-authoring capability is what headquarters IT holds and plant admins do not, and a '
    + 'plant cannot create a position, a permission set, a capability, a template or any metadata. D11: '
    + 'the rules are identical in every posture and only the wall differs. The environment definition '
    + 'ledger carries no organization column, so before this change a manage_metadata holder scoped to '
    + 'one organization could create or change an object, a view or a flow, publish, roll back or '
    + 'reset the operator\'s items, or install, upgrade, remove and edit packages, and every other '
    + 'organization read the result.',
  acceptanceCriteria:
    'On an isolated or group deployment, an organization owner holding manage_metadata inside their '
    + 'own organization saves an object, a view and a flow at /api/v1/meta, edits, publishes, rolls '
    + 'back and resets the operator\'s view, calls each of the thirteen /api/v1/packages write doors, '
    + 'installs, upgrades and uninstalls a package through install-local, and creates, updates, '
    + 'deletes and clones a flow at /api/v1/automation: each answers 403 (FORBIDDEN on the REST /meta '
    + 'doors and install-local, PERMISSION_DENIED on the dispatcher, /packages and /automation), the '
    + 'message names the posture and ADR-0131 D12 items 7–8, and another organization\'s member reads '
    + 'what the operator wrote, unchanged. The platform operator and the engine itself write at every '
    + 'one of those doors with 2xx, and on a single deployment a manage_metadata holder writes exactly '
    + 'as before. Items saved before this change keep their bytes.',
};
