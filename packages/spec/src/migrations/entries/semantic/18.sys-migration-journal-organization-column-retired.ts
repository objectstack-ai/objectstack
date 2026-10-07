// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #15207 (ADR-0131 D7, C6) — one D3 entry per removed column, as the card
// requires. A platform-object COLUMN retirement, not a spec-key retirement: no
// authorable spec key moves, so nothing lands in RETIRED_KEYS_BY_MAJOR and no
// D2 conversion exists to pair with (the ups-delegated-from-column-retired
// shape). The writer census behind the verdict is cited in the reason.
export const entry: SemanticMigration = {
  id: 'sys-migration-journal-organization-column-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'sys_migration_journal.organization_id — the injected organization column left the migration '
    + 'run journal (packages/platform-objects/src/system/sys-migration-journal.object.ts, which now '
    + 'declares systemFields.tenant false), and reading the table now requires the '
    + 'manage_platform_settings capability',
  replacement:
    'nothing on this table — `sys_migration_journal` is deployment-level state (ADR-0131 D7) and '
    + 'no organization owns a row. Delete any authored filter, list-view column, report grouping, '
    + 'formula or seed key that names `organization_id` on `sys_migration_journal`. A principal '
    + 'that must read the table needs the `manage_platform_settings` capability, which platform '
    + 'administrators hold',
  reason:
    'ADR-0131 D7: a table whose rows no writer attributes to an organization is deployment-level '
    + 'and loses the column; the writer decides membership, not the name. Writer census at commit '
    + 'e67ba80049 of this repository\'s main branch: the sole writer is the @objectstack/core '
    + 'migration runner: one append site, under a system context or under the transaction it opened '
    + 'with one, and the row contract MigrationJournalEventSchema has no organization field to '
    + 'carry. So the injected column only ever held NULL. The census is the same procedure that '
    + 'reports the organization-stamping writers of sys_http_delivery, sys_secret and sys_email, so '
    + 'it can fire. Under a walled posture the tenant wall compared that NULL to the caller '
    + 'organization and hid every row from every reader, platform administrators included; with no '
    + 'column there is no wall, and the table is governed by object permission instead (D7). The '
    + 'capability gate is part of the same change, not a follow-up: the organization_admin grant '
    + 'carries the superuser bits on every object, so without it a walled deployment would hand '
    + 'each organization administrator every other organization\'s rows. Existing databases: schema '
    + 'sync is additive, so the physical column stays and the boot drift report names it orphaned; '
    + 'by the census it holds only NULL, so dropping it loses nothing. The operator drops it with '
    + 'os migrate apply --allow-destructive, the remedy the drift report names.',
  acceptanceCriteria:
    'No authored metadata names `organization_id` on `sys_migration_journal`: the field resolver '
    + '(lint and the data door) now answers it as an unknown field. On every tenancy posture a '
    + 'principal without `manage_platform_settings` is refused 403 PERMISSION_DENIED on a read of '
    + '`sys_migration_journal`, and a platform administrator lists every row with no organization '
    + 'filter. After os migrate apply --allow-destructive the boot no longer reports the orphaned '
    + 'column.',
};
