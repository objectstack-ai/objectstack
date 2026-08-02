// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3355 — the RBAC link tables' half of the `managedBy: 'system'` → `'system-data'`
 * equivalence pin.
 *
 * The PR claims "no enforcement moves": these objects were writable in v16 because
 * each re-opened create/edit/delete with a `userActions` block on top of the LOCKED
 * `system` default, and they are writable in v17 because the `system-data` default
 * grants those verbs outright. That is an argument; this file is the evidence.
 *
 * It fails in BOTH mis-edit directions, which is the point:
 * - a `userActions` block left behind that narrows a verb → the object resolves
 *   less than {@link V17_EXPECTED} and the per-object assert goes red;
 * - a bucket left on the old value (or moved to `engine-owned`) → same.
 *
 * The one DELIBERATE non-equivalence is `import`, and it is pinned as such rather
 * than waved past: `system` was locked-with-no-import and the `userActions` blocks
 * only ever re-opened create/edit/delete, so CSV import resolved FALSE; the
 * `system-data` default grants it. That flip is the maintainer's explicit
 * adjudication on #3355 ("默认 affordance 可写 create/edit/delete/import/exportCsv:
 * true"). It is an affordance only — the DelegatedAdminGate still adjudicates every
 * row a CSV import would write — but it IS new UI surface on the RBAC link tables,
 * so it gets its own named assertion that a future edit cannot flip back silently.
 */

import { describe, expect, it } from 'vitest';
import { resolveCrudAffordances } from '@objectstack/spec/data';
import { SysUserPosition } from './sys-user-position.object';
import { SysUserPermissionSet } from './sys-user-permission-set.object';
import { SysPositionPermissionSet } from './sys-position-permission-set.object';

/** What each object resolved to in v16: LOCKED `system` + `userActions: {c,e,d}`. */
const V16_EXPECTED = { create: true, import: false, edit: true, delete: true, exportCsv: true };

/** What each object resolves to in v17: the `system-data` default, no `userActions`. */
const V17_EXPECTED = { create: true, import: true, edit: true, delete: true, exportCsv: true };

/** The v16 declaration shape, reconstructed so the equivalence is computed, not asserted twice. */
const asV16 = (obj: { userActions?: unknown }) => ({
  managedBy: 'system',
  userActions: obj.userActions ?? { create: true, edit: true, delete: true },
});

const OBJECTS = [
  ['sys_user_position', SysUserPosition],
  ['sys_user_permission_set', SysUserPermissionSet],
  ['sys_position_permission_set', SysPositionPermissionSet],
] as const;

describe('#3355 — RBAC link tables move to `system-data` with their affordances intact', () => {
  for (const [name, obj] of OBJECTS) {
    describe(name, () => {
      it('declares the new bucket and no longer carries a redundant `userActions` block', () => {
        expect(obj.managedBy).toBe('system-data');
        // The whole point of the writable default: the re-open block is gone.
        expect(obj.userActions).toBeUndefined();
      });

      it('resolves the full-CRUD matrix from the bucket default alone', () => {
        expect(resolveCrudAffordances(obj as never)).toEqual(V17_EXPECTED);
      });

      it('is write-equivalent to its v16 self on create / edit / delete / exportCsv', () => {
        const v16 = resolveCrudAffordances(asV16(obj) as never);
        const v17 = resolveCrudAffordances(obj as never);
        expect(v16).toEqual(V16_EXPECTED); // the reconstruction is honest
        for (const verb of ['create', 'edit', 'delete', 'exportCsv'] as const) {
          expect(v17[verb], `${name}.${verb} must not move`).toBe(v16[verb]);
        }
      });

      it('gains CSV import — the one adjudicated delta, pinned so it cannot move silently', () => {
        expect(resolveCrudAffordances(asV16(obj) as never).import).toBe(false);
        expect(resolveCrudAffordances(obj as never).import).toBe(true);
      });
    });
  }
});
