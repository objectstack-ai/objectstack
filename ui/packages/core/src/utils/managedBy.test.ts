import { describe, it, expect } from 'vitest';
import { MANAGED_BY_BUCKETS } from '@object-ui/types';
import {
  resolveEffectiveCrudAffordances,
  isWriteOptedIn,
  isSystemWritable,
  isObjectInlineEditable,
  normalizeUserAction,
  userActionPredicates,
  type UserActionsOverride,
} from './managedBy';

describe('resolveEffectiveCrudAffordances — bucket half, delegated to the spec', () => {
  it('defaults to the platform bucket (full CRUD) when managedBy is unset', () => {
    expect(resolveEffectiveCrudAffordances({})).toEqual({
      create: true, import: true, edit: true, delete: true, exportCsv: true,
    });
    expect(resolveEffectiveCrudAffordances(null)).toEqual(resolveEffectiveCrudAffordances({ managedBy: 'platform' }));
  });

  it('config: New/Edit/Delete + export, no import', () => {
    expect(resolveEffectiveCrudAffordances({ managedBy: 'config' })).toEqual({
      create: true, import: false, edit: true, delete: true, exportCsv: true,
    });
  });

  it('system / engine-owned / append-only / better-auth: export-only by default', () => {
    for (const managedBy of ['engine-owned', 'append-only', 'better-auth']) {
      expect(resolveEffectiveCrudAffordances({ managedBy })).toEqual({
        create: false, import: false, edit: false, delete: false, exportCsv: true,
      });
    }
  });

  it('userActions overrides the bucket default (ADR-0103 opened-up locked bucket)', () => {
    // Was `managedBy: 'system'`. Protocol 17 split that bucket
    // (objectstack#3355) and `'system'` is now simply an unknown value, which
    // falls back to the writable platform default — so it pinned nothing and
    // `import: false` was the assertion that noticed. `engine-owned` is the
    // locked bucket this was always about.
    const aff = resolveEffectiveCrudAffordances({ managedBy: 'engine-owned', userActions: { create: true, edit: true, delete: true } });
    expect(aff).toMatchObject({ create: true, edit: true, delete: true, import: false });
  });

  it('unknown bucket falls back to platform (defensive)', () => {
    expect(resolveEffectiveCrudAffordances({ managedBy: 'totally-unknown' }).edit).toBe(true);
  });

  it('#2614 object form: carries predicates, keys off enabled, boolean path unchanged', () => {
    const withPreds = resolveEffectiveCrudAffordances({
      managedBy: 'platform',
      userActions: { edit: { enabled: true, disabledWhen: 'record.locked == true' } },
    });
    expect(withPreds.edit).toBe(true);
    expect(withPreds.editPredicates).toEqual({ disabledWhen: 'record.locked == true' });
    // enabled omitted → falls back to the bucket default (platform edit = true)
    expect(resolveEffectiveCrudAffordances({ managedBy: 'platform', userActions: { edit: { disabledWhen: 'x' } } }).edit).toBe(true);
    // boolean form leaves predicates absent
    expect(resolveEffectiveCrudAffordances({ managedBy: 'system', userActions: { edit: true } }).editPredicates).toBeUndefined();
  });
});

describe('isWriteOptedIn', () => {
  it('true only for boolean true or { enabled: true }', () => {
    expect(isWriteOptedIn(true)).toBe(true);
    expect(isWriteOptedIn({ enabled: true })).toBe(true);
    expect(isWriteOptedIn(false)).toBe(false);
    expect(isWriteOptedIn({ enabled: false })).toBe(false);
    expect(isWriteOptedIn({ disabledWhen: 'x' })).toBe(false);
    expect(isWriteOptedIn(undefined)).toBe(false);
    expect(isWriteOptedIn(null)).toBe(false);
  });
});

describe('isSystemWritable (ADR-0103, simplified by objectstack#3355)', () => {
  it('true for the `system-data` bucket, with or without userActions', () => {
    // v17 pin: the BUCKET answers this now. Under ADR-0103 the writable half had
    // to be recovered from `userActions` because `system` doubled as the
    // engine-owned default; `system-data` states it outright, so a bare
    // declaration — the shape all 8 platform objects now use — must be true.
    expect(isSystemWritable({ managedBy: 'system-data' })).toBe(true);
    expect(isSystemWritable({ managedBy: 'system-data', userActions: { create: true } })).toBe(true);
    // …and a NARROW is still platform-schema/user-data, so still true.
    expect(isSystemWritable({ managedBy: 'system-data', userActions: { create: false } })).toBe(true);
  });
  it('false for the retired `system` value and for every other bucket', () => {
    // The retired value must not keep working through this helper — it is exactly
    // the silent-absorption path objectstack#3355 removed from the load path.
    expect(isSystemWritable({ managedBy: 'system', userActions: { create: true } } as never)).toBe(false);
    expect(isSystemWritable({ managedBy: 'engine-owned' })).toBe(false);
    // append-only / better-auth are never "system-writable" regardless of userActions
    expect(isSystemWritable({ managedBy: 'append-only', userActions: { create: true } })).toBe(false);
    expect(isSystemWritable({ managedBy: 'better-auth', userActions: { edit: true } })).toBe(false);
    expect(isSystemWritable({ managedBy: 'platform' })).toBe(false);
    expect(isSystemWritable(null)).toBe(false);
  });
});

describe('isObjectInlineEditable', () => {
  it('mirrors the resolved edit affordance (replaces the old NON_EDITABLE_BUCKETS set)', () => {
    // Non-editable buckets by default...
    for (const managedBy of ['engine-owned', 'append-only', 'better-auth']) {
      expect(isObjectInlineEditable({ managedBy })).toBe(false);
    }
    // ...editable buckets and opened-up system objects.
    expect(isObjectInlineEditable({ managedBy: 'platform' })).toBe(true);
    expect(isObjectInlineEditable({ managedBy: 'config' })).toBe(true);
    expect(isObjectInlineEditable({ managedBy: 'system', userActions: { edit: true } })).toBe(true);
    // an explicit edit:false disables even on an otherwise-editable bucket
    expect(isObjectInlineEditable({ managedBy: 'platform', userActions: { edit: false } })).toBe(false);
  });
});

// The ONE parser for the userActions override shape, now consumed by the grid
// row affordances and related-list row predicates (objectui#2712 follow-up) so
// no package re-implements the boolean / #2614 object-form parse locally.
describe('normalizeUserAction (the single override parser)', () => {
  it('a missing flag falls back to the caller-supplied bucket default', () => {
    expect(normalizeUserAction(undefined, true)).toEqual({ enabled: true });
    expect(normalizeUserAction(undefined, false)).toEqual({ enabled: false });
    expect(normalizeUserAction(null, true)).toEqual({ enabled: true });
  });

  it('a bare boolean wins over the default and carries no predicates', () => {
    expect(normalizeUserAction(true, false)).toEqual({ enabled: true });
    expect(normalizeUserAction(false, true)).toEqual({ enabled: false });
  });

  it('object form: enabled overrides the default; predicates ride alongside', () => {
    expect(normalizeUserAction({ enabled: false, disabledWhen: 'record.frozen' }, true))
      .toEqual({ enabled: false, predicates: { disabledWhen: 'record.frozen' } });
    // omitted `enabled` falls back to the base; only the present predicate key is set.
    expect(normalizeUserAction({ visibleWhen: 'a' }, true))
      .toEqual({ enabled: true, predicates: { visibleWhen: 'a' } });
    // object form without predicates is boolean-equivalent.
    expect(normalizeUserAction({ enabled: true }, false)).toEqual({ enabled: true });
  });
});

describe('userActionPredicates', () => {
  it('returns predicates independent of the enabled verdict, undefined otherwise', () => {
    expect(userActionPredicates(true)).toBeUndefined();
    expect(userActionPredicates(false)).toBeUndefined();
    expect(userActionPredicates(undefined)).toBeUndefined();
    expect(userActionPredicates({ enabled: true })).toBeUndefined();
    expect(userActionPredicates({ disabledWhen: 'x' })).toEqual({ disabledWhen: 'x' });
    expect(userActionPredicates({ visibleWhen: 'a', disabledWhen: 'b' }))
      .toEqual({ visibleWhen: 'a', disabledWhen: 'b' });
    // predicates survive even when the flag opts the action out.
    expect(userActionPredicates({ enabled: false, visibleWhen: 'a' })).toEqual({ visibleWhen: 'a' });
  });
});

describe('MANAGED_BY_BUCKETS', () => {
  it('is the closed 6-bucket union in canonical order (objectstack#3355 — `system` → `system-data`)', () => {
    expect(MANAGED_BY_BUCKETS).toEqual(['platform', 'config', 'system-data', 'engine-owned', 'append-only', 'better-auth']);
  });

  it('no longer carries the retired `system` value', () => {
    expect(MANAGED_BY_BUCKETS).not.toContain('system');
  });
});

describe('resolveEffectiveCrudAffordances — effective API operations (#3391)', () => {
  it('undefined effective set → affordances unchanged (backward-compatible)', () => {
    const platform = { managedBy: 'platform' };
    expect(resolveEffectiveCrudAffordances(platform)).toEqual(resolveEffectiveCrudAffordances(platform, undefined));
    expect(resolveEffectiveCrudAffordances(platform, undefined)).toEqual({
      create: true, import: true, edit: true, delete: true, exportCsv: true,
    });
  });

  it('ANDs each affordance bit with its API operation (create/import→create/import, edit→update, delete→delete, exportCsv→export)', () => {
    // A full-CRUD platform object whose server effective set is read-only + list-derived.
    const aff = resolveEffectiveCrudAffordances({ managedBy: 'platform' }, ['get', 'list', 'export']);
    expect(aff).toMatchObject({
      create: false, import: false, edit: false, delete: false, exportCsv: true,
    });
  });

  it('keeps a bit only when BOTH the affordance and the effective op allow it', () => {
    // create+update present → create/import/edit survive; no delete/list → delete/export drop.
    const aff = resolveEffectiveCrudAffordances({ managedBy: 'platform' }, ['create', 'update', 'import']);
    expect(aff.create).toBe(true);
    expect(aff.edit).toBe(true);
    expect(aff.import).toBe(true);
    expect(aff.delete).toBe(false);
    expect(aff.exportCsv).toBe(false);
  });

  it('empty effective set → all bits off (deny-all)', () => {
    expect(resolveEffectiveCrudAffordances({ managedBy: 'platform' }, [])).toMatchObject({
      create: false, import: false, edit: false, delete: false, exportCsv: false,
    });
  });

  it('never re-enables a bit the bucket/userActions already denied', () => {
    // config bucket has no import; even if the server would allow import, the
    // UI-intent axis keeps it off (intersection, never union).
    const aff = resolveEffectiveCrudAffordances({ managedBy: 'config' }, ['create', 'update', 'delete', 'import', 'export']);
    expect(aff.import).toBe(false); // config never imports
    expect(aff.create).toBe(true);
    expect(aff.exportCsv).toBe(true);
  });
});

describe('isObjectInlineEditable — effective API operations (#3546)', () => {
  it('undefined effective set → bucket affordance decides (backward-compatible)', () => {
    // platform is inline-editable by default; engine-owned is not.
    expect(isObjectInlineEditable({ managedBy: 'platform' })).toBe(true);
    expect(isObjectInlineEditable({ managedBy: 'platform' }, undefined)).toBe(true);
    expect(isObjectInlineEditable({ managedBy: 'engine-owned' })).toBe(false);
  });

  it('effective set WITHOUT `update` closes inline-edit even on an editable bucket', () => {
    // Server hands down a read-only effective set → no double-click/pencil.
    expect(isObjectInlineEditable({ managedBy: 'platform' }, ['get', 'list'])).toBe(false);
  });

  it('effective set WITH `update` keeps inline-edit on an editable bucket', () => {
    expect(isObjectInlineEditable({ managedBy: 'platform' }, ['get', 'update'])).toBe(true);
  });

  it('effective set never re-opens inline-edit the bucket already denied (intersection)', () => {
    // engine-owned resolves edit=false; even a server `update` grant can't
    // re-open it. (Was `'system'`, retired in protocol 17 — objectstack#3355.)
    expect(isObjectInlineEditable({ managedBy: 'engine-owned' }, ['get', 'update'])).toBe(false);
  });

  it('empty effective set → not inline-editable (deny-all)', () => {
    expect(isObjectInlineEditable({ managedBy: 'platform' }, [])).toBe(false);
  });
});

/**
 * [#5142] The `import` half of the toolbar-scope predicate pair.
 *
 * `@objectstack/spec@17.0.0` types `userActions.create` and `userActions.import`
 * identically and emits a predicate envelope for each; objectui#4646 consumed
 * only the `create` half and deliberately left this local type narrow
 * (`import?: boolean`) so the declaration stayed an honest statement of what the
 * renderer honoured. The consumer landed with #5142, so the type widened with
 * it.
 *
 * The pin below is COMPILE-time, and it is the only kind that can observe this
 * property: the widening erases at runtime, so vitest cannot see it. `tsc` can
 * — `packages/core/tsconfig.test.json` compiles this file and is chained from
 * the package's `type-check` script (objectui#3181), which is what CI runs.
 * Restore `import?: boolean` and the annotated constant below fails to compile.
 */
describe('#5142 — userActions.import carries the same object form as create', () => {
  /** COMPILE-TIME pin: the object form is assignable to the `import` key. */
  const IMPORT_OBJECT_FORM: UserActionsOverride['import'] = {
    enabled: true,
    visibleWhen: "os.user.profile == 'admin'",
    disabledWhen: 'features.readOnly == true',
  };

  it('carries importPredicates through the objectui-side #3391 intersection', () => {
    const aff = resolveEffectiveCrudAffordances({
      managedBy: 'platform',
      userActions: { import: IMPORT_OBJECT_FORM },
    });
    expect(aff.import).toBe(true);
    expect(aff.importPredicates).toEqual({
      visibleWhen: "os.user.profile == 'admin'",
      disabledWhen: 'features.readOnly == true',
    });
    // The `create` half is untouched by an `import`-only override — the two
    // envelopes are separate keys, not one shared toolbar bag.
    expect(aff.createPredicates).toBeUndefined();
  });

  it('the boolean arm of the union still carries no predicates', () => {
    const aff = resolveEffectiveCrudAffordances({ managedBy: 'platform', userActions: { import: true } });
    expect(aff.import).toBe(true);
    expect(aff.importPredicates).toBeUndefined();
  });

  it('predicates survive `enabled: false` — the object-level bit is what closes', () => {
    // The resolver reports both facts; refusing to surface a predicate for a
    // closed affordance is the CONSUMER's layering rule (ObjectView, #5142),
    // not the resolver's.
    const aff = resolveEffectiveCrudAffordances({
      managedBy: 'platform',
      userActions: { import: { enabled: false, visibleWhen: 'x' } },
    });
    expect(aff.import).toBe(false);
    expect(aff.importPredicates).toEqual({ visibleWhen: 'x' });
  });

  it('the widened key is the union, not `any` — a number is still a compile error', () => {
    // @ts-expect-error — widened to `boolean | RowCrudActionOverride`, and no further.
    const bad: UserActionsOverride['import'] = 42;
    expect(bad).toBe(42);
  });
});
