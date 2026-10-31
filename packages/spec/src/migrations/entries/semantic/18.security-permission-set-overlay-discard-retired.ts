// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The ADR-0131 cutover retires the operator action that discarded an
// environment overlay of a package-declared permission set: no caller-reachable
// door creates such an overlay any more, and a database that still holds one is
// refused at cold boot (`security-catalog-environment-overlay-refused`), so the
// action had nothing it could reach on a running server. Registered because it
// removes an HTTP route, a Setup action and an optional contract member that an
// integration may call, and the remedy for the rows it used to clear is an
// offline step a human runs.
export const entry: SemanticMigration = {
  id: 'security-permission-set-overlay-discard-retired',
  surface:
    'POST /api/v1/security/permission-sets/:id/discard-overlay, the Discard Overlay action on '
    + 'sys_permission_set, and contracts.ISecurityService.discardPermissionSetOverlay with its '
    + 'PermissionSetOverlayDiscardResult type',
  replacement:
    'nothing to call at runtime. To clear an environment overlay of a package-declared permission '
    + 'set, run `os migrate security-catalog-overlays` with the flags and environment the deployment '
    + 'boots with: it lists every such row with no server running, and `--apply` deletes them (a '
    + 'history tombstone per row). To keep a customization of a packaged set, clone the set under a '
    + 'new name (the Clone action) and assign the clone',
  reason:
    'The action deleted the environment-wide sys_metadata row shadowing a package-declared '
    + 'permission set and re-projected its sys_permission_set row. Neither half has anything left '
    + 'to do. No door creates such an overlay: the metadata door seals a packaged permission set '
    + 'on every topology (ADR-0131 D6, whatever OS_METADATA_WRITABLE says), the data door refuses '
    + 'a save over one (the packaged lock), the data API cannot write sys_metadata, and a package '
    + 'declaring a name the environment holds is refused at install. An overlay stored before '
    + 'those refusals makes the cold boot refuse the deployment with NAMESPACE_CONFLICT (ADR-0048), '
    + 'so a server that could answer the route never holds one. And the resolver reads the '
    + 'security catalog, not sys_permission_set rows, so the re-projected row granted nothing. '
    + 'ADR-0048, ADR-0087, ADR-0131.',
  acceptanceCriteria:
    'No client, script or Setup customization calls '
    + '`POST /api/v1/security/permission-sets/:id/discard-overlay` or '
    + '`discardPermissionSetOverlay`, and no code imports `PermissionSetOverlayDiscardResult` '
    + '(tsc names each importer). `os migrate security-catalog-overlays` lists no row on the '
    + 'deployment\'s database and configuration (exit 0).',
};
