// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #15207 (ADR-0131 D7, C6 item 4) — the #12699 deployment declaration made
// total: an object a deployment declares platform-global
// (OrgScopingEntitlement.platformGlobalObjects) loses its injected organization
// column ON THAT DEPLOYMENT. A column retirement keyed on a deployment fact, not
// a spec-key retirement: no authorable key moves, so nothing lands in
// RETIRED_KEYS_BY_MAJOR and no D2 conversion exists to pair with. The stand-down
// semantics it replaces retire with it. Existing rows keep the orphaned column
// until the operator removes it (ADR-0131 D14; C7's inventory and the
// declarer's own backfill), which this entry does not perform.
export const entry: SemanticMigration = {
  id: 'platform-global-object-organization-column-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'OrgScopingEntitlement.platformGlobalObjects — an object a deployment declares platform-global no '
    + 'longer keeps its injected organization_id column with the organization wall stood down over it; on '
    + 'that deployment the injected-columns plan withholds the column, and the engine registers the object '
    + 'with no organization_id and declaring systemFields.tenant false',
  replacement:
    'Nothing to rewrite where no deployment declares the object. On the declaring deployment, the declared '
    + 'object has no `organization_id`: rewrite any authored filter, list-view column, report grouping, '
    + 'formula or seed key that names `organization_id` on it, or drop it; a write naming it is refused '
    + '`INVALID_FIELD` and a filter `INVALID_FILTER`. The object is governed by object permission, not by '
    + 'the organization wall',
  reason:
    'ADR-0131 D7: "an object a deployment declares platform-global gets no organization column on that '
    + 'deployment (the injected-columns plan reads the declaration), so Layer 0 and the driver agree by '
    + 'having nothing to scope". Before this, the declaration stood the security layer\'s organization '
    + 'wall down for the object while the column stayed, so the SQL driver went on scoping a read by the '
    + 'caller organization that the wall had stopped scoping — measured on a booted kernel with a fixture '
    + 'provider, before the change. ADR-0131 retires that stand-down ("replaced by D7\'s no-column"). The '
    + 'engine reads the declaration at its plugin start(), before the first schema sync: every plugin '
    + 'init() has completed by then (ADR-0116, the Phase 1/2 split) and the org-scoping provider registers '
    + 'the service in its init(), declared in providesServices, so an object registered earlier is '
    + 're-planned before its table is created. An absent declaration leaves every object\'s plan '
    + 'byte-identical; a malformed one is refused loudly and declares nothing. An object that declares its '
    + 'own organization_id keeps it and stays walled on it. Existing databases: schema sync is additive, so '
    + 'the physical column stays on a declaring deployment and the boot drift report names it orphaned; '
    + 'the operator removes it, and nothing moves at boot.',
  acceptanceCriteria:
    'On a deployment whose org-scoping service declares an object platform-global, the object is registered '
    + 'and provisioned with no `organization_id`, the security layer composes no organization wall on it, '
    + 'and a read carrying the caller organization reaches every row of its table; a non-declared object '
    + 'on the same deployment keeps its column and its wall. With no declaration, or a malformed one, every '
    + 'object keeps its column.',
};
