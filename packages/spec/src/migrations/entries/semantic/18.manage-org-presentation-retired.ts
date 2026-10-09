// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0131 D6 (C5, stage S3) — a platform-capability RETIREMENT, not a spec-key
// retirement: `systemPermissions` is a list of plain strings, so no authorable
// key moves, nothing lands in RETIRED_KEYS_BY_MAJOR and no D2 conversion exists
// to pair with. Measured: a permission set naming the capability still parses
// and loads (the schema accepts any string, and an undeclared name is
// back-derived as a capability the stack declares); only the grant goes inert.
export const entry: SemanticMigration = {
  id: 'manage-org-presentation-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the manage_org_presentation platform capability (its PLATFORM_CAPABILITIES entry in '
    + '@objectstack/spec security, the ORG_PRESENTATION_AUTHORING_CAPABILITY constant exported '
    + 'by @objectstack/metadata-core) and the arm of metaWriteCapabilityVerdict that admitted its '
    + 'holders to org-scoped writes of the five org-overridable types through the /meta item doors',
  replacement:
    'grant `manage_metadata` to whoever must author views, dashboards, reports, translations or '
    + 'email templates through Studio or `PUT /api/v1/meta/<type>/<name>`; such a write now lands '
    + 'environment-wide (`organization_id` NULL) and is served to every organization of the '
    + 'deployment. There is no organization-bounded authoring capability: delete '
    + '`manage_org_presentation` from every permission set\'s `systemPermissions`, and delete any '
    + 'import of `ORG_PRESENTATION_AUTHORING_CAPABILITY`. `metaWriteCapabilityVerdict` takes '
    + '`{ isSystem, systemPermissions, operation }`: drop the `canonicalType` and '
    + '`activeOrganizationId` members from the call',
  reason:
    'ADR-0131 D6 retires the per-organization overlay axis, and the /meta doors stop carrying an '
    + 'organization into a metadata write (the companion entry meta-doors-organization-scope-retired). '
    + 'The capability admitted an organization admin to exactly the writes those doors threaded '
    + 'into the admin\'s own organization; with no organization threaded, keeping it would have '
    + 'admitted its holders to environment-wide authoring, which is the reach of manage_metadata '
    + 'and a wider one than the capability ever granted. It was granted by no shipped permission '
    + 'set, so a deployment that never granted it by hand observes nothing.',
  acceptanceCriteria:
    'PLATFORM_CAPABILITY_NAMES no longer holds manage_org_presentation, so the authoring lint '
    + 'resolves the name only where a stack itself declares or grants it. A caller holding '
    + 'manage_org_presentation and not manage_metadata is answered 403 on PUT, DELETE, publish '
    + 'and rollback of /api/v1/meta/<type>/<name> (FORBIDDEN on the REST doors, PERMISSION_DENIED '
    + 'on the dispatcher), whatever its active organization. A persisted permission set naming the '
    + 'capability still loads and its other grants still apply. The sys_capability row the '
    + 'platform seeded for it earlier is not pruned (the seeder upserts only); it names a '
    + 'capability nothing consults, and an operator may delete it in Setup.',
};
