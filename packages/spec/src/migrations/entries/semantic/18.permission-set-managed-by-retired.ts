// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23891 (ADR-0049 enforce-or-remove) — the D3 entry of the
// `permission-set-managed-by-removed` family (one D3 entry per retirement
// family, even when D2 is lossless). Registered key:
// `security/PermissionSet:managedBy`. The strip changes no access decision and
// no upgrade; what it leaves is whatever an admin or author believed the value
// did.
export const entry: SemanticMigration = {
  id: 'permission-set-managed-by-retired',
  surface: 'permissions[].managedBy — the authored per-record provenance (package / platform / user) on a '
    + 'permission set',
  replacement: 'Nothing: delete the key. A set\'s provenance is the package that ships it, decided from that '
    + 'package\'s artifact and recorded as packageId; a set authored in this system carries neither. The '
    + 'sys_permission_set.managed_by column the platform keeps is a different surface and is unchanged.',
  reason: 'The D2 conversion `permission-set-managed-by-removed` deletes `managedBy` from every permission set '
    + 'in author sources, stored permission rows and built artifacts, and the delete is lossless: no seeder, '
    + 'package upgrade, lock or gate ever read the authored key, so no set changes who owns it, what an '
    + 'upgrade does to it, or what it grants. The judgment is about what people believed. Setup\'s form offered '
    + 'Package (upgrade-owned metadata), Platform and User (environment config), and its help text said a '
    + 'Package set is updated by package upgrades while a Platform or User set is left alone. Neither was '
    + 'true: an upgrade updates the sets its package ships, whatever the value; a set marked Package that no '
    + 'package ships was never updated; and a package-shipped set marked Platform or User was never shielded. '
    + 'Any runbook or customization plan that relied on the value to keep an upgrade off a set needs another '
    + 'path — for a packaged set, clone it and edit the clone.',
  acceptanceCriteria: 'No authored or stored permission set carries `managedBy`; the parse refuses the key '
    + 'with the prescription. Every set\'s grants are unchanged. Every customization that relied on '
    + 'managedBy to survive a package upgrade lives on a clone of the packaged set, not on the set itself.',
};
