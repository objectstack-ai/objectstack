// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0131 D6/D12 (C5, stage S4) — the ruled retirement of the uninstall's
// organization-scope guard: once every package-owned metadata row is
// environment-wide, an uninstall is environment-wide by construction and an
// organization names nothing. Retires what `package-uninstall-explicit-all-tenants`
// (protocol 17) introduced.
export const entry: SemanticMigration = {
  id: 'package-uninstall-environment-wide',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the organizationId and allTenants members of the deletePackage request of '
    + '@objectstack/metadata-protocol (DeletePackageRequest), the two TENANT_SCOPE_REQUIRED refusals '
    + 'of deletePackage, and the organization-scope refusal of DELETE /api/v1/packages/:id on the '
    + 'runtime dispatcher',
  replacement:
    'call `deletePackage({ packageId })` with neither key: the uninstall removes every row bound to '
    + 'the package in this environment. A request still carrying `organizationId` or `allTenants` '
    + 'is refused with 400 `INVALID_REQUEST` and removes nothing; drop the key and retry. Who may '
    + 'uninstall is the package door\'s operator gate',
  reason:
    'The guard existed because an uninstall naming no organization once matched every '
    + 'organization\'s rows, so a cross-tenant uninstall had to be declared (allTenants: true) and a '
    + 'scoped one named (organizationId). ADR-0131 D6 removes that premise: no metadata write lands '
    + 'organization-scoped any more, so a package\'s rows belong to the environment and an '
    + 'organization names nothing. The HTTP door never sent allTenants, so an operator with no active '
    + 'organization could not uninstall over HTTP at all. The keys are refused rather than ignored, '
    + 'because a caller still sending one believes it scopes the uninstall. Legacy '
    + 'organization-scoped rows bound to the package are removed with it, as the declared '
    + 'cross-tenant uninstall removed them, rather than stranded for the promotion ceremony.',
  acceptanceCriteria:
    'DELETE /api/v1/packages/:id by a manage_metadata caller with no active organization succeeds '
    + 'and removes every sys_metadata row bound to the package, environment-wide and legacy '
    + 'organization-scoped alike; the same call with an active organization behaves identically. A '
    + 'deletePackage request carrying organizationId or allTenants (true or false) answers 400 '
    + 'INVALID_REQUEST and changes nothing. No response carries TENANT_SCOPE_REQUIRED. Remove both '
    + 'keys from every deletePackage caller, and any deploy script that passed allTenants: true.',
};
