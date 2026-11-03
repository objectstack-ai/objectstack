// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// Under a walled tenancy posture every external object states its organization
// scope (ADR-0015 §10, amended; maintainer ruling in the security channel,
// 2026-11-03). The declaration is a judgment about the remote data — whose rows
// they are — so no mechanical rewrite can make it; this entry tells the
// operator exactly what to declare.
export const entry: SemanticMigration = {
  id: 'external-object-organization-scope-declared',
  surface:
    "every object carrying an `external` block (an object bound to a datasource whose schema the platform does not "
    + "own — a federated table, a plugin driver, an API-backed source) in a deployment running the `isolated` or "
    + '`group` tenancy posture (OS_TENANCY_POSTURE)',
  replacement:
    'one of three declarations on each such object: an `organization_id` field of its own, when the remote rows '
    + 'carry the organization column and the driver returns it (map a remote column of another name onto it with '
    + "`external.columnMap: { <remote column>: 'organization_id' }`) — the rows are then walled by organization; "
    + '`tenancy: { enabled: false }` — the object is shared by every organization; or '
    + '`systemFields: { tenant: false }` — the same opt-out, spelled on the system fields',
  reason:
    'The platform provisions no storage for an external object, so the `organization_id` it injects into the '
    + "registered schema is a column the remote may not have. Whether an external object's rows belong to one "
    + 'organization or to every organization is a fact only the author knows, so under a walled posture the object '
    + 'states it. One that states none is refused by name when the boot completes (SecurityPlugin, `kernel:ready`), '
    + 'and an external object registered after the boot (Studio, a runtime datasource) that states nothing answers '
    + 'no row and accepts no write — every read is denied at Layer 0 and every insert, update and delete is refused '
    + '— until it does. An object a later plugin registers at `kernel:ready` or `kernel:bootstrapped`, or one on a '
    + 'host that withholds the boot-phase hooks, meets that denial rather than the boot refusal. '
    + '`tenancy.tenantField` naming a column other than `organization_id` is refused on '
    + 'an external object the same way: the organization wall keys on `organization_id` alone, and a declared '
    + 'tenant field is read only by storage the platform provisions. The `single` posture enforces no wall, owes '
    + 'no declaration and is unchanged. ADR-0015 §10 as amended, ADR-0095 D1.',
  acceptanceCriteria:
    'Under OS_TENANCY_POSTURE=isolated (or group) the deployment boots: no `[security] under the ... tenancy '
    + 'posture every external object states its organization scope` refusal is printed. For each external object '
    + 'declared with its own `organization_id`, a member of organization A reads only rows whose organization '
    + 'column equals A (a row missing the column reads to no one), with a driver that honours `where` and with one '
    + 'that ignores it. For each declared `tenancy: { enabled: false }` or `systemFields: { tenant: false }`, members of '
    + 'every organization read the same rows. A single-posture deployment behaves exactly as before.',
};
