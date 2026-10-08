// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #15207 (ADR-0131 D7, C6 item 2) — the compliance ledger loses its injected
// organization column, and the organization a row is ABOUT stays in the
// existing attribution field tenant_id. A platform-object COLUMN retirement,
// not a spec-key retirement: no authorable spec key moves, so nothing lands in
// RETIRED_KEYS_BY_MAJOR and no D2 conversion exists to pair with. Existing
// rows keep the orphaned column until the v18 operator ceremony (ADR-0131 D14,
// D10 fate 1), which this entry does not perform.
export const entry: SemanticMigration = {
  id: 'sys-audit-log-organization-column-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'sys_audit_log.organization_id — the injected organization column left the compliance ledger '
    + '(packages/plugins/plugin-audit/src/objects/sys-audit-log.object.ts, which now declares '
    + 'systemFields.tenant false); the organization a row is about stays in the attribution field '
    + 'tenant_id, and an organization reader is scoped on it by a platform row policy',
  replacement:
    '`sys_audit_log.tenant_id`, the attribution field every writer stamps. Rewrite any authored '
    + 'filter, list-view column, report grouping, formula or seed key that names `organization_id` on '
    + '`sys_audit_log` to name `tenant_id`. A row about a deployment-level action leaves it empty. '
    + 'Under an organization wall an organization reader is scoped to the rows about its active '
    + 'organization by the platform row policy `sys_audit_log_org`, and a platform administrator '
    + 'reads every row',
  reason:
    'ADR-0131 D7: the audit ledger may hold rows about deployment-level actions, so the organization '
    + 'a row is about becomes a plain attribution field under a name the tenant-field resolver does not '
    + 'claim, never the tenancy anchor, and the object is governed by object permission, not by the '
    + 'wall. Writer census at commit 3ae59661dc of this repository\'s main branch: the record mirror, '
    + 'the record-view writer and the sign-in writer in plugin-audit, and the settings change writer in '
    + 'service-settings, stamp tenant_id and stamped the injected column with the same value; the '
    + 'platform-admin standing writer in plugin-security stamps both NULL, by ruling; the two '
    + 'administrative user writers in plugin-auth stamp neither. So the attribution field already '
    + 'carries every organization the column did. Under a walled posture the tenant wall compared the '
    + 'column to the caller organization, which hid every row about no organization from every reader, '
    + 'platform administrators included. The read scope moves to the security layer, where the '
    + 'engine computes it once: the platform row policy tenant_id equal to the caller organization, '
    + 'shipped in organization_admin, member_default and viewer_readonly and stripped when no wall is '
    + 'enforced, plus an explicit organization_admin entry for the ledger without viewAllRecords or '
    + 'modifyAllRecords, because the wildcard superuser bypass would otherwise skip the policy on an '
    + 'object with no tenant column and hand each organization administrator every organization\'s '
    + 'rows. Per-tenant retention windows partition on tenant_id. Existing databases: schema sync is '
    + 'additive, so the physical column stays and the boot drift report names it orphaned; once its '
    + 'values are confirmed equal to tenant_id, the operator drops it with os migrate apply '
    + '--allow-destructive, and any row where they differ is reported rather than dropped.',
  acceptanceCriteria:
    'No authored metadata names `organization_id` on `sys_audit_log`: the field resolver (lint and the '
    + 'data door) answers it as an unknown field. A row about a deployment-level action is written '
    + 'with `tenant_id` empty and no refusal. Under an organization wall an organization administrator '
    + 'lists the rows whose `tenant_id` is its active organization and no other, and a platform '
    + 'administrator lists every row, the rows with no `tenant_id` included. Under `single` the policy '
    + 'is stripped and the organization administrator lists every row, as before.',
};
