// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `permission-set-managed-by-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `permissionSetManagedByRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * Permission-set `managedBy` removed (protocol 18, #23891 — ADR-0049
 * enforce-or-remove; the liveness ledger's `dead` verdict of 2026-10-11).
 *
 * The key was the AUTHORED per-record provenance of ADR-0086 D3
 * (`package | platform | user`), and nothing ever read it: the retired
 * `bootstrapDeclaredPermissions` seeder stamped the `sys_permission_set.managed_by`
 * COLUMN and never read `ps.managedBy`, and the packaged-set lock decides
 * provenance from the package's artifact. Setup's form row nevertheless
 * promised that package upgrades update a `package` set and leave a
 * `platform` / `user` set alone. The tombstone on `PermissionSetSchema`
 * refuses it at parse (`PERMISSION_SET_MANAGED_BY_REMOVED` in
 * `security/permission.zod.ts`). The column is a different surface and is
 * untouched.
 *
 * ## Why a D2 strip
 *
 * Setup's form row wrote the key into stored `permission` rows, and a 17.x
 * build carried whatever an author wrote into its artifact. After the
 * tombstone the boot door and the metadata save door refuse such a set, and
 * only the D2 table is replayed at the rehydration seams
 * (`applyArtifactForwardConversions`, `applyConversionsToStoredItem`), so a
 * stored row or an installed package's artifact loads only through this
 * entry. The key leaves whatever it holds: the tombstone refuses every value,
 * so a strip that kept one would leave a set that cannot load. The strip is
 * lossless — no grant, owner or upgrade read the value; what an admin believed
 * it did is the D3 record, the semantic entry `permission-set-managed-by-retired`.
 * The emitted path names the set, as
 * `permission-admin-scope-binding-authoring-removed` does.
 */
const permissionSetManagedByRemoved: MetadataConversion = {
  id: 'permission-set-managed-by-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'permission.managedBy',
  summary:
    "permission-set key 'managedBy' removed (ADR-0049 enforce-or-remove — nothing ever read the authored "
    + "provenance: a set's provenance is the package that ships it, decided from that package's artifact and "
    + 'recorded as packageId; the sys_permission_set.managed_by column is unaffected. Delete the key)',
  apply(stack, emit) {
    return mapCollection(stack, 'permissions', (ps, path) => {
      // Name the set, not just its index: the notice is the only record an
      // upgrading author gets of WHICH set lost the key.
      const where = typeof ps.name === 'string' ? `${path}(${ps.name})` : path;
      return stripKeys(ps, ['managedBy'], emit, where);
    });
  },
  fixture: {
    before: {
      permissions: [
        // What Setup's form row wrote into a stored row.
        { name: 'crm_sales_rep', label: 'Sales Rep', packageId: 'crm', managedBy: 'package' },
        { name: 'env_reviewer', label: 'Env Reviewer', managedBy: 'user' },
        // Already canonical: rides through untouched, by reference.
        { name: 'env_reader', label: 'Env Reader' },
      ],
    },
    after: {
      permissions: [
        { name: 'crm_sales_rep', label: 'Sales Rep', packageId: 'crm' },
        { name: 'env_reviewer', label: 'Env Reviewer' },
        { name: 'env_reader', label: 'Env Reader' },
      ],
    },
    // One per set carrying the key.
    expectedNotices: 2,
  },
};

export { permissionSetManagedByRemoved };
