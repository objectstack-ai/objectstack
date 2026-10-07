// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * R2 `relationship/master-detail-required` — two tiers under one rule id.
 *
 * On a `sharingModel: 'controlled_by_parent'` object the master reference is
 * what the object's record access is derived through, and three declarable
 * shapes leave the security gate as the only thing refusing a detail record
 * saved without its master: `required` absent (or `false`), `required: true` +
 * `readonly: true`, and `required: true` + `system: true` (record validation
 * never checks a non-required field and skips readonly/system fields before its
 * required check). All three are refused here at `error` — the v18 narrowing of
 * the authoring contract (maintainer ruling of 2026-08-16, Direction 1).
 *
 * Before the narrowing the predicate was `required !== true` at `warning` on
 * every object, so the two flagged shapes drew no finding at ANY severity. The
 * cases below pin each shape separately for that reason: a one-line severity
 * flip would have turned the first red and left the other two silent.
 *
 * The other half is what keeps this from being a blanket escalation: outside
 * `controlled_by_parent` nothing at runtime refuses a non-required
 * `master_detail`, so there the verdict is unchanged — a `warning` on a missing
 * `required`, and silence on the two flagged shapes.
 */

import { describe, expect, it } from 'vitest';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { lintDataModel } from './data-model-rules.js';

const R2 = 'relationship/master-detail-required';

/** The master, plus one detail object carrying exactly the fields under test. */
const stack = (sharingModel: string | undefined, fields: unknown): unknown[] => [
  { name: 'work_order', sharingModel: 'private', fields: { name: { type: 'text' } } },
  { name: 'work_order_item', ...(sharingModel ? { sharingModel } : {}), fields },
];

const r2 = (objects: unknown[]) => lintDataModel(objects as any[]).filter((issue) => issue.rule === R2);

/** A `master_detail` reference to `work_order`, plus the shape under test. */
const masterRef = (shape: Record<string, unknown>) => ({
  order: { type: 'master_detail', reference: 'work_order', deleteBehavior: 'cascade', ...shape },
});

const UNSAFE_SHAPES: Array<[label: string, shape: Record<string, unknown>, path: string]> = [
  ['`required` absent', {}, 'objects[1].fields.order.required'],
  ['`required: false`', { required: false }, 'objects[1].fields.order.required'],
  ['`required: true` + `readonly: true`', { required: true, readonly: true }, 'objects[1].fields.order.readonly'],
  ['`required: true` + `system: true`', { required: true, system: true }, 'objects[1].fields.order.system'],
];

describe('R2 on a controlled_by_parent object — the three unsafe shapes are refused at error', () => {
  it.each(UNSAFE_SHAPES)('%s → one error, located at the defect', (_label, shape, path) => {
    const issues = r2(stack('controlled_by_parent', masterRef(shape)));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error', rule: R2, path });
  });

  // ── CONTROLS — the refusal must be able to stay silent, or the reds above
  // prove nothing about the shapes they name.
  it('CONTROL: `required: true` with neither flag is clean', () => {
    expect(r2(stack('controlled_by_parent', masterRef({ required: true })))).toEqual([]);
  });

  it('CONTROL: an explicit `readonly: false` / `system: false` is clean — the flag, not the key, is the defect', () => {
    expect(
      r2(stack('controlled_by_parent', masterRef({ required: true, readonly: false, system: false }))),
    ).toEqual([]);
  });

  it('a field carrying several defects is ONE finding whose fix names every edit', () => {
    const issues = r2(stack('controlled_by_parent', masterRef({ readonly: true, system: true })));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error', path: 'objects[1].fields.order.required' });
    expect(issues[0].fix).toContain('required: true');
    expect(issues[0].fix).toContain('readonly');
    expect(issues[0].fix).toContain('system');
  });

  // Scope is every `master_detail` of the object, as the builder half of the
  // same ruling enforces it — not only the one the runtime resolves as master.
  it('reports every master_detail field of the object, each on its own path', () => {
    const issues = r2(
      stack('controlled_by_parent', {
        order: { type: 'master_detail', reference: 'work_order', required: true },
        batch: { type: 'master_detail', reference: 'work_order', required: true, readonly: true },
        legacy: { type: 'master_detail', reference: 'work_order' },
      }),
    );
    expect(issues.map((issue) => [issue.severity, issue.path])).toEqual([
      ['error', 'objects[1].fields.batch.readonly'],
      ['error', 'objects[1].fields.legacy.required'],
    ]);
  });

  it('reads the array field form too', () => {
    const issues = r2(
      stack('controlled_by_parent', [{ name: 'order', type: 'master_detail', reference: 'work_order', required: true, system: true }]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error', path: 'objects[1].fields.order.system' });
  });

  it('a lookup is not R2’s subject, whatever the sharing model', () => {
    expect(
      r2(stack('controlled_by_parent', { order: { type: 'lookup', reference: 'work_order', readonly: true } })),
    ).toEqual([]);
  });
});

describe('R2 outside controlled_by_parent — the verdict is unchanged', () => {
  it.each([['private'], ['public_read'], ['public_read_write'], [undefined]])(
    'sharingModel %s: a missing `required` is still a warning, at `.required`',
    (sharingModel) => {
      const issues = r2(stack(sharingModel, masterRef({})));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        severity: 'warning',
        path: 'objects[1].fields.order.required',
        fix: 'required: true',
      });
    },
  );

  it.each([
    ['`required: true` + `readonly: true`', { required: true, readonly: true }],
    ['`required: true` + `system: true`', { required: true, system: true }],
  ])('sharingModel private: %s draws nothing, as before', (_label, shape) => {
    expect(r2(stack('private', masterRef(shape)))).toEqual([]);
  });
});

// What actually reaches the rule from the authoring builder. Under
// `controlled_by_parent`, `ObjectSchema.create()` forces an omitted `required`
// to `true` and refuses an explicit `false`, but never inspects `readonly` or
// `system` — so the two flagged shapes leave the builder intact, and this rule
// is the authoring-time refusal they meet.
describe('R2 over objects built by ObjectSchema.create()', () => {
  const build = (field: ReturnType<typeof Field.masterDetail>) =>
    ObjectSchema.create({
      name: 'work_order_item',
      sharingModel: 'controlled_by_parent',
      fields: { order: field },
    });

  it.each([
    ['readonly', { readonly: true }],
    ['system', { system: true }],
  ])('a %s master reference passes the builder (forced required) and is refused here', (flag, extra) => {
    const detail = build({ ...Field.masterDetail('work_order', { label: 'Work Order' }), ...extra });
    const issues = r2([{ name: 'work_order', sharingModel: 'private', fields: {} }, detail]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error', path: `objects[1].fields.order.${flag}` });
  });

  it('CONTROL: the builder’s forced `required: true` on a plain master reference lints clean', () => {
    const detail = build(Field.masterDetail('work_order', { label: 'Work Order' }));
    expect(r2([{ name: 'work_order', sharingModel: 'private', fields: {} }, detail])).toEqual([]);
  });
});
