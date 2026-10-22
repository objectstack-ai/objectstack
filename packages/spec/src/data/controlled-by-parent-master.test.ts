// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

// Read through the `@objectstack/spec/data` entry, not the module: the pin is
// on the PUBLISHED predicate a producer imports (#23272).
import {
  controlledByParentMasterRefusal,
  isControlledByParentMasterField,
  type ControlledByParentMasterShape,
} from './index';
import { ObjectSchema } from './object.zod';

/**
 * [#23272 · ADR-0055 §1] The exported exactly-one-master predicate and
 * `ObjectSchema` agree on every shape the v18 upgrade lists (#23270), and on
 * the one shape that satisfies the rule. A producer (cloud's AI default) asks
 * the export before it writes `controlled_by_parent`; if the export and the
 * parse ever disagreed, the producer would emit an object the parse refuses.
 */

const md = (reference: string, extra: Record<string, unknown> = {}) => ({
  type: 'master_detail',
  label: reference,
  reference,
  ...extra,
});
const lookup = (reference: string, extra: Record<string, unknown> = {}) => ({
  type: 'lookup',
  label: reference,
  reference,
  ...extra,
});

/** The parse's controlled_by_parent issues on one object: path and message. */
function cbpIssues(obj: Record<string, unknown>): Array<{ path: string; message: string }> {
  const parsed = ObjectSchema.safeParse(obj);
  if (parsed.success) return [];
  return parsed.error.issues
    .filter((i) => /declares sharingModel 'controlled_by_parent'/.test(i.message))
    .map((i) => ({ path: i.path.join('.'), message: i.message }));
}

const SHAPES: Array<[string, Record<string, unknown>, ControlledByParentMasterShape | undefined]> = [
  ['one required master_detail', { order: md('work_order', { required: true }) }, undefined],
  [
    'one required master_detail beside a lookup',
    { order: md('work_order', { required: true }), owner_ref: lookup('account', { required: true }) },
    undefined,
  ],
  [
    'two required master_details',
    { a: md('work_order', { required: true }), b: md('account', { required: true }) },
    'several-required-masters',
  ],
  ['two master_details, none required', { a: md('work_order'), b: md('account') }, 'several-masters'],
  ['one master_detail, required: false', { order: md('work_order', { required: false }) }, 'master-not-required'],
  ['one master_detail, required omitted', { order: md('work_order') }, 'master-not-required'],
  ['a required lookup only', { order: lookup('work_order', { required: true }) }, 'required-lookup-only'],
  ['no relation', { note: { type: 'text', label: 'Note' } }, 'no-master'],
  // [#25092] The one master is writable: `readonly` / `system` on it are refused.
  ['one required master_detail, readonly: true', { order: md('work_order', { required: true, readonly: true }) }, 'master-not-writable'],
  ['one required master_detail, system: true', { order: md('work_order', { required: true, system: true }) }, 'master-not-writable'],
  [
    'one required master_detail, readonly: true and system: true',
    { order: md('work_order', { required: true, readonly: true, system: true }) },
    'master-not-writable',
  ],
  [
    'one required master_detail, readonly: true, beside a required lookup',
    { order: md('work_order', { required: true, readonly: true }), owner_ref: lookup('account', { required: true }) },
    'master-not-writable',
  ],
  ['one required master_detail, readonly: false and system: false', { order: md('work_order', { required: true, readonly: false, system: false }) }, undefined],
  [
    'a readonly required master_detail beside a second required one is still two masters',
    { a: md('work_order', { required: true, readonly: true }), b: md('account', { required: true }) },
    'several-required-masters',
  ],
];

describe('controlledByParentMasterRefusal — the export and ObjectSchema agree (#23272)', () => {
  it.each(SHAPES)('%s', (_label, fields, shape) => {
    const obj = { name: 'work_order_item', label: 'Work Order Item', sharingModel: 'controlled_by_parent', fields };
    const refusal = controlledByParentMasterRefusal(obj.name, obj.sharingModel, obj.fields);
    const issues = cbpIssues(obj);

    expect(refusal?.shape).toBe(shape);
    if (refusal === undefined) {
      expect(issues).toEqual([]);
      // Accepted WHOLE — not a refinement that never ran because something else failed first.
      expect(ObjectSchema.safeParse(obj).success).toBe(true);
    } else {
      expect(issues).toEqual([{ path: refusal.path, message: refusal.message }]);
    }
  });

  it('answers undefined for any other sharing model, as the parse accepts it', () => {
    for (const sharingModel of ['private', 'public_read', 'public_read_write']) {
      const obj = { name: 'pair', label: 'Pair', sharingModel, fields: { a: md('x', { required: true }), b: md('y', { required: true }) } };
      expect(controlledByParentMasterRefusal(obj.name, obj.sharingModel, obj.fields)).toBeUndefined();
      expect(cbpIssues(obj)).toEqual([]);
    }
  });
});

describe('isControlledByParentMasterField — the field half the refusal counts (#23272)', () => {
  it.each([
    ['a required master_detail', md('x', { required: true }), true],
    // The flags are judged on the object's one master, not here: the field is still the master.
    ['a required master_detail, readonly: true', md('x', { required: true, readonly: true }), true],
    ['a required master_detail, system: true', md('x', { required: true, system: true }), true],
    ['a master_detail, required: false', md('x', { required: false }), false],
    ['a master_detail, required omitted', md('x'), false],
    ['a master_detail, required "true" (not a boolean)', md('x', { required: 'true' }), false],
    ['a required lookup', lookup('x', { required: true }), false],
    ['a text field', { type: 'text', required: true }, false],
    ['undefined', undefined, false],
    ['null', null, false],
    ['a string', 'master_detail', false],
  ])('%s → %s', (_label, field, expected) => {
    expect(isControlledByParentMasterField(field)).toBe(expected);
  });

  it('is the count the refusal makes: exactly one counting field, and a writable one, satisfies the rule', () => {
    for (const [, fields] of SHAPES) {
      const counted = Object.values(fields).filter(isControlledByParentMasterField) as Array<Record<string, unknown>>;
      const writable = counted.length === 1 && counted[0]!.readonly !== true && counted[0]!.system !== true;
      const refusal = controlledByParentMasterRefusal('o', 'controlled_by_parent', fields);
      expect(refusal === undefined).toBe(writable);
    }
  });
});

describe('#25092 a one master marked readonly or system is refused at authoring, through the one rule', () => {
  it('names the object, the field and every flag, and prescribes dropping them', () => {
    const refusal = controlledByParentMasterRefusal('work_order_item', 'controlled_by_parent', {
      order: md('work_order', { required: true, readonly: true, system: true }),
    });
    expect(refusal).toMatchObject({ path: 'fields', shape: 'master-not-writable', masterDetails: ['order'] });
    expect(refusal!.message).toMatch(
      /^Object 'work_order_item' declares sharingModel 'controlled_by_parent' with its one required `master_detail`, `order`, marked `readonly: true` and `system: true`\./,
    );
    expect(refusal!.message).toContain('Remove `readonly: true` and `system: true` from `order`');
  });

  it('ObjectSchema.create() refuses it too: the builder forces `required` and the parse it ends in refuses the flag', () => {
    const build = () =>
      ObjectSchema.create({
        name: 'work_order_item',
        sharingModel: 'controlled_by_parent',
        fields: { order: { type: 'master_detail', label: 'Order', reference: 'work_order', readonly: true } },
      });
    let thrown: unknown;
    try {
      build();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ZodError);
    const issues = (thrown as ZodError).issues.filter((i) => /declares sharingModel 'controlled_by_parent'/.test(i.message));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['fields']);
    expect(issues[0]!.message).toContain('with its one required `master_detail`, `order`, marked `readonly: true`');
  });

  it('control: the same builder call without the flag builds', () => {
    const obj = ObjectSchema.create({
      name: 'work_order_item',
      sharingModel: 'controlled_by_parent',
      fields: { order: { type: 'master_detail', label: 'Order', reference: 'work_order' } },
    });
    expect((obj.fields.order as { required?: unknown }).required).toBe(true);
  });
});
