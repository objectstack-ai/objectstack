// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #15211 (ADR-0131 D6/D7, C7b) — one D3 entry per removed column, one per
// object of the sys_metadata family. A platform-object COLUMN retirement, not
// a spec-key retirement: no authorable spec key moves, so nothing lands in
// RETIRED_KEYS_BY_MAJOR and no D2 conversion exists to pair with (the
// sys-presence-organization-column-retired shape).
export const entry: SemanticMigration = {
  id: 'sys-metadata-commit-organization-column-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'sys_metadata_commit.organization_id — the declared organization column left the package commit log '
    + '(packages/metadata-core/src/objects/sys-metadata-commit.object.ts, which now declares systemFields.tenant false). '
    + 'Its indexes are re-keyed from (organization_id, package_id, created_at) and (organization_id, created_at) to (package_id, created_at) and (created_at).',
  replacement:
    'nothing on this table — metadata is the environment\'s (ADR-0131 D6), and no organization owns '
    + 'a row. Delete any authored filter, list-view column, report grouping, formula or seed key that '
    + 'names `organization_id` on `sys_metadata_commit`. Existing databases: run the v18 ceremony, '
    + '`os migrate organization-ownership --out PLAN` to write its plan for review, then '
    + '`os migrate organization-ownership --apply --plan-file PLAN`, which promotes or reports the legacy '
    + 'organization rows and then drops the physical column',
  reason:
    'ADR-0131 D6 retired the per-organization overlay axis: every metadata write now lands '
    + 'environment-wide with a NULL organization, every read is environment then code, and a legacy '
    + 'organization row is served by no read, and the v18 runtime refuses to start on a database still holding the column until the ceremony has run. The column therefore only holds '
    + 'the legacy rows the 17.x organization layer wrote, and the v18 ceremony owns those: under '
    + 'single it promotes the presentational customizations to environment rows and carries every '
    + 'public-form withdrawal onto the environment, fail-closed (the maintainer rulings on organization customizations and form withdrawals), and '
    + 'it reports the rest. Only then does its column-drops step drop the column, through the '
    + 'schema-drift machinery the drop needs: schema sync is additive, so an undeclared column stays '
    + 'and the boot drift report names it orphaned. The organization leaves every index key in the '
    + 'same change, because an index naming a dropped column is skipped on rebuild. Removing it '
    + 'TIGHTENS uniqueness where it was a key part (two organizations, or an organization and the '
    + 'environment, can share a key): a legacy database holds rows the re-keyed unique indexes '
    + 'refuse until the ceremony has run, and the ADR-0120 D4 index ceremony keeps the previous '
    + 'index and names them rather than drop a row.',
  acceptanceCriteria:
    'No authored metadata names `organization_id` on `sys_metadata_commit`: the field resolver (lint and the data '
    + 'door) answers it as an unknown field. A fresh database creates `sys_metadata_commit` with no organization '
    + 'column. On a legacy database, after `os migrate organization-ownership --apply --plan-file PLAN` the column is '
    + 'gone and the boot no longer reports it orphaned.',
};
