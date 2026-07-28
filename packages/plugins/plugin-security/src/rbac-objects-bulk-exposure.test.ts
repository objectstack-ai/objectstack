// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3026 follow-up — the RBAC config objects must expose the BATCH shape of the
 * write verbs they already grant.
 *
 * The #3391 P1 contract made the bulk gate `bulk ∧ derived(child)`: a batch
 * request is admitted only when the object grants the `bulk` PRIMITIVE *and*
 * the batched child operation is itself allowed. Before that, the `*Many`
 * routes only checked the child verb, so a boilerplate CRUD-five whitelist
 * (`get,list,create,update,delete`) batched fine. The companion fix — adding
 * the `bulk` primitive to every object carrying an explicit whitelist — was
 * applied only to the `platform-objects` package; these six RBAC objects live
 * in `plugin-security` and were missed, leaving `/batch`, `createMany`,
 * `updateMany` and `deleteMany` answering 405 on objects whose single-record
 * create/update/delete are wide open. `data-objectstack` rethrows that 405
 * without falling back to per-row writes, so multi-select delete in the Setup
 * grids surfaced it as a hard error.
 *
 * These pin the batch shape for each object. `bulk` is a legitimate PERMANENT
 * primitive declaration (#3543 kept it out of the legacy-verb reclaim), and an
 * explicit whitelist is deliberately retained here rather than deleted: all six
 * are `managedBy` (`config` or `system`), and `reconcileManagedApiMethods`
 * (ADR-0103 D3) early-returns on a non-array `apiMethods` — dropping the
 * whitelist would take the managed-write backstop with it.
 */

import { describe, expect, it } from 'vitest';
import { resolveEffectiveApiMethods, isApiOperationAllowed } from '@objectstack/spec/data';
import { SysCapability } from './objects/sys-capability.object';
import { SysPermissionSet } from './objects/sys-permission-set.object';
import { SysPosition } from './objects/sys-position.object';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object';
import { SysUserPosition } from './objects/sys-user-position.object';

const RBAC_OBJECTS = [
  ['sys_capability', SysCapability],
  ['sys_permission_set', SysPermissionSet],
  ['sys_position', SysPosition],
  ['sys_position_permission_set', SysPositionPermissionSet],
  ['sys_user_permission_set', SysUserPermissionSet],
  ['sys_user_position', SysUserPosition],
] as const;

describe('RBAC config objects — batch exposure (#3026 / #3391 P1 companion)', () => {
  for (const [name, obj] of RBAC_OBJECTS) {
    describe(name, () => {
      it('grants the bulk primitive alongside its single-record write verbs', () => {
        // The gap this closes: CRUD-five without `bulk` denies every batch
        // route while permitting the very same verbs one record at a time.
        expect(obj.enable?.apiMethods).toContain('bulk');
        for (const verb of ['get', 'list', 'create', 'update', 'delete'] as const) {
          expect(obj.enable?.apiMethods, `${name} must keep ${verb}`).toContain(verb);
        }
      });

      it('admits createMany / updateMany / deleteMany and /batch', () => {
        const eff = resolveEffectiveApiMethods(obj.enable);
        expect(eff.mode).toBe('restricted');
        for (const child of ['create', 'update', 'delete'] as const) {
          expect(
            isApiOperationAllowed(eff, 'bulk', { bulkChild: child }),
            `${name} batch ${child}`,
          ).toBe(true);
        }
      });

      it('keeps the whitelist explicit so the ADR-0103 D3 backstop still runs', () => {
        // `reconcileManagedApiMethods` bails on a non-array `apiMethods`, so an
        // absent whitelist silently disables managed-write stripping for these
        // objects. Deleting the line is NOT an equivalent refactor here.
        expect(Array.isArray(obj.enable?.apiMethods)).toBe(true);
      });
    });
  }
});
