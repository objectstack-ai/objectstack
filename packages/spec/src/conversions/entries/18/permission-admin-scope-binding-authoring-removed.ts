// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `permission-admin-scope-binding-authoring-removed`
// conversion (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `permissionAdminScopeBindingAuthoringRemoved` and lists it where it
// stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { isDict, stripKeys } from '../shared.js';

/**
 * The delegated-admin scope's `manageBindings` and `authorEnvironmentSets`
 * removed (protocol 18, #23488 — ADR-0049 enforce-or-remove; ruling of record
 * 6181988435, letter A).
 *
 * Both named a write door ADR-0131 D3 retired: `manageBindings` the
 * `sys_position_permission_set` binding rows, `authorEnvironmentSets` the
 * `sys_permission_set` rows. A position's sets are part of its definition and
 * a permission set is a definition; both are written through the metadata
 * door, which admits a `manage_metadata` holder and reads no `adminScope`. So
 * neither right was honoured anywhere. The tombstones on `AdminScopeSchema`
 * refuse both at parse (`ADMIN_SCOPE_MANAGE_BINDINGS_REMOVED` and
 * `ADMIN_SCOPE_AUTHOR_ENVIRONMENT_SETS_REMOVED` in
 * `security/permission.zod.ts`).
 *
 * ## Why a D2 strip
 *
 * Both keys carried a schema DEFAULT (`false`), so a 17.x parse wrote both
 * into every `adminScope` it emitted, whether or not the author wrote them:
 * a built artifact and a stored `permission` row that carry a scope carry
 * both. Setup's nested `adminScope` form and Studio's two switches wrote them
 * explicitly too. After the tombstones the boot door and the metadata save
 * door refuse such a set, and only the D2 table is replayed at the
 * rehydration seams (`applyArtifactForwardConversions`,
 * `applyConversionsToStoredItem`), so a built artifact or a stored row loads
 * only through this entry.
 *
 * Each key leaves whatever it holds, `true` included: the tombstone refuses
 * every value, so a strip that kept one would leave a set that cannot load.
 * The strip is lossless for every door that grants a right — nothing granted
 * either. The one decision the keys moved was the delegated-admin gate's
 * strict-containment comparison, which no longer reads them; that change is
 * the D3 record, the semantic entry
 * `permission-admin-scope-binding-authoring-retired`. The emitted path names
 * the set, as `email-template-category-is-system-removed` names its template.
 */
const permissionAdminScopeBindingAuthoringRemoved: MetadataConversion = {
  id: 'permission-admin-scope-binding-authoring-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'permission.adminScope.manageBindings / permission.adminScope.authorEnvironmentSets',
  summary:
    "delegated-admin scope keys 'manageBindings' and 'authorEnvironmentSets' removed (ADR-0049 "
    + 'enforce-or-remove — no door honoured either: a position\'s sets and a permission set are '
    + 'environment definitions written through the metadata door under manage_metadata, which reads '
    + "no adminScope. Delete both keys; a delegate's scope is placement, assignment and the allowlist)",
  apply(stack, emit) {
    return mapCollection(stack, 'permissions', (ps, path) => {
      const scope = (ps as { adminScope?: unknown }).adminScope;
      if (!isDict(scope)) return ps;
      // Name the set, not just its index: the notice is the only record an
      // upgrading author gets of WHICH set lost the keys.
      const where = typeof ps.name === 'string' ? `${path}(${ps.name}).adminScope` : `${path}.adminScope`;
      const stripped = stripKeys(scope, ['manageBindings', 'authorEnvironmentSets'], emit, where);
      if (stripped === scope) return ps;
      return { ...ps, adminScope: stripped };
    });
  },
  fixture: {
    before: {
      permissions: [
        {
          // What Setup's nested form or Studio's switches wrote: both keys
          // authored, one of them `true`.
          name: 'east_admin',
          label: 'East Admin',
          adminScope: {
            businessUnit: 'east',
            manageAssignments: true,
            manageBindings: true,
            authorEnvironmentSets: false,
            assignablePermissionSets: ['sales_user'],
          },
        },
        {
          // What a 17.x parse emitted for a scope whose author wrote neither
          // key: both defaults, materialized.
          name: 'west_admin',
          label: 'West Admin',
          adminScope: {
            businessUnit: 'west',
            includeSubtree: true,
            manageAssignments: true,
            manageBindings: false,
            authorEnvironmentSets: false,
            assignablePermissionSets: [],
          },
        },
        {
          // Already canonical, and a set with no scope at all — both ride
          // through untouched. The fixture's own control: the strip dispatches
          // on key presence, and copy-on-write keeps these references.
          name: 'north_admin',
          label: 'North Admin',
          adminScope: { businessUnit: 'north', manageAssignments: true, assignablePermissionSets: ['sales_user'] },
        },
        { name: 'sales_user', label: 'Sales User' },
      ],
    },
    after: {
      permissions: [
        {
          name: 'east_admin',
          label: 'East Admin',
          adminScope: {
            businessUnit: 'east',
            manageAssignments: true,
            assignablePermissionSets: ['sales_user'],
          },
        },
        {
          name: 'west_admin',
          label: 'West Admin',
          adminScope: {
            businessUnit: 'west',
            includeSubtree: true,
            manageAssignments: true,
            assignablePermissionSets: [],
          },
        },
        {
          name: 'north_admin',
          label: 'North Admin',
          adminScope: { businessUnit: 'north', manageAssignments: true, assignablePermissionSets: ['sales_user'] },
        },
        { name: 'sales_user', label: 'Sales User' },
      ],
    },
    // Four notices, one per STRIPPED KEY: both keys on `east_admin` and on
    // `west_admin`, none for `north_admin` or `sales_user`.
    expectedNotices: 4,
  },
};

export { permissionAdminScopeBindingAuthoringRemoved };
