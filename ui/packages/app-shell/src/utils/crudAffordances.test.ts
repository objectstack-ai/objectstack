/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * app-shell's view of `resolveEffectiveCrudAffordances` (re-exported from
 * `@object-ui/core` via `./crudAffordances`). Covers the managedBy bucket
 * defaults, the boolean overrides, and the objectui#2614 object form of
 * `userActions.edit` / `delete` (per-record CEL predicates).
 *
 * The bucket half is no longer objectui's to define — core delegates it to the
 * spec's own `resolveCrudAffordances()` (objectstack#4115). These assertions
 * therefore double as a parity gate: they fail if the spec ever re-buckets an
 * object class, which is exactly what the old hand-mirrored copy could not do.
 */
import { describe, it, expect } from 'vitest';
import { resolveEffectiveCrudAffordances } from './crudAffordances';

describe('resolveEffectiveCrudAffordances (app-shell re-export)', () => {
  it('defaults to the platform bucket when managedBy is unset', () => {
    expect(resolveEffectiveCrudAffordances({})).toEqual({
      create: true, import: true, edit: true, delete: true, exportCsv: true,
    });
  });

  it('applies the bucket default matrix (append-only → export only)', () => {
    expect(resolveEffectiveCrudAffordances({ managedBy: 'append-only' })).toEqual({
      create: false, import: false, edit: false, delete: false, exportCsv: true,
    });
  });

  it('boolean userActions override the bucket default per flag', () => {
    // `engine-owned`, not the retired `'system'` (protocol 17 split it —
    // objectstack#3355). The point is that `edit: true` opens ONLY edit, which
    // needs a bucket that denies both by default.
    const aff = resolveEffectiveCrudAffordances({ managedBy: 'engine-owned', userActions: { edit: true } });
    expect(aff.edit).toBe(true);
    expect(aff.delete).toBe(false);
  });

  describe('#2614 object form (per-record CEL predicates)', () => {
    it('carries predicates through and resolves enabled from the bucket default', () => {
      const aff = resolveEffectiveCrudAffordances({
        userActions: {
          edit: { disabledWhen: 'record.frozen == true' },
          delete: { visibleWhen: { dialect: 'cel', source: 'record.frozen != true' } },
        },
      });
      expect(aff.edit).toBe(true);
      expect(aff.delete).toBe(true);
      expect(aff.editPredicates).toEqual({ disabledWhen: 'record.frozen == true' });
      expect(aff.deletePredicates).toEqual({ visibleWhen: { dialect: 'cel', source: 'record.frozen != true' } });
    });

    it('object form enabled:false opts out like the bare boolean', () => {
      const aff = resolveEffectiveCrudAffordances({
        userActions: { edit: { enabled: false, disabledWhen: 'record.frozen == true' } },
      });
      expect(aff.edit).toBe(false);
      // Predicates still surface — the caller decides what a disabled
      // affordance means; the grid path drops them with canEdit=false.
      expect(aff.editPredicates).toEqual({ disabledWhen: 'record.frozen == true' });
    });

    it('object form without predicates is byte-identical to the boolean path', () => {
      const aff = resolveEffectiveCrudAffordances({ userActions: { edit: { enabled: true }, delete: {} } });
      expect(aff).toEqual({
        create: true, import: true, edit: true, delete: true, exportCsv: true,
      });
      expect('editPredicates' in aff).toBe(false);
      expect('deletePredicates' in aff).toBe(false);
    });
  });
});
