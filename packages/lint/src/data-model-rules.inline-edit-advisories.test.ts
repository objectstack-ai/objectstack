// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * R5 `relationship/line-items-inline-edit` and R6
 * `relationship/association-inline-edit` ask one question of a relationship:
 * does the parent's form inline it at all?
 *
 * Since objectstack#35889 (maintainer ruling B, 「明细表应该改成指看分组的定义了」)
 * the answer is the PARENT's field groups: a group whose `relatedList` names the
 * child (a plain `master_detail`, or a `relatedList: 'primary'` FK) inlines it,
 * and the FK's `inlineEdit` only picks the form factor. So R5 stays silent on a
 * placed line-item child and suggests a group otherwise, whatever `inlineEdit`
 * says; R6 warns on a placed association and is silent otherwise.
 */

import { describe, expect, it } from 'vitest';
import { ObjectFieldGroupSchema } from '@objectstack/spec/data';
import { lintDataModel } from './data-model-rules.js';

const R5 = 'relationship/line-items-inline-edit';
const R6 = 'relationship/association-inline-edit';

const INLINE_VALUES = [undefined, true, 'grid', 'form'] as const;

/**
 * A parent plus one child whose `master_detail` back to it carries `inlineEdit`
 * (omitted when `undefined`); `placed` adds a parent field group naming the child.
 */
const stack = (child: string, inlineEdit: unknown, placed: boolean): any[] => [
  {
    name: 'order',
    fields: { name: { type: 'text' } },
    ...(placed ? { fieldGroups: [{ key: 'lines', relatedList: child }] } : {}),
  },
  {
    name: child,
    fields: {
      order: {
        type: 'master_detail',
        reference: 'order',
        required: true,
        deleteBehavior: 'cascade',
        ...(inlineEdit === undefined ? {} : { inlineEdit }),
      },
    },
  },
];

const hits = (objects: any[], rule: string) => lintDataModel(objects).filter((i) => i.rule === rule);

describe('R5 relationship/line-items-inline-edit — reads the parent field group', () => {
  it.each(INLINE_VALUES)('is silent when a parent group places the line items (inlineEdit: %s)', (inlineEdit) => {
    expect(hits(stack('order_line', inlineEdit, true), R5)).toEqual([]);
  });

  it.each(INLINE_VALUES)('suggests a parent field group when none places them (inlineEdit: %s)', (inlineEdit) => {
    const [issue, ...rest] = hits(stack('order_line', inlineEdit, false), R5);
    expect(rest).toEqual([]);
    expect(issue?.severity).toBe('suggestion');
    expect(issue?.path).toBe('objects[1].fields.order');
    expect(issue?.fix).toBe("add { key: 'order_line', label: 'order_line', relatedList: 'order_line' } to order.fieldGroups");
  });

  it('the printed group parses: a parent carrying it is placed and R5 goes silent', () => {
    const [parent, child] = stack('order_line', undefined, false);
    const printed = { key: 'order_line', label: 'order_line', relatedList: 'order_line' };
    expect(ObjectFieldGroupSchema.safeParse(printed).success).toBe(true);
    // CONTROL: the snippet R5 printed before, with no label, does not parse.
    expect(ObjectFieldGroupSchema.safeParse({ key: 'order_line', relatedList: 'order_line' }).success).toBe(false);
    expect(hits([{ ...parent, fieldGroups: [printed] }, child], R5)).toEqual([]);
  });

  it.each([true, false])('is silent on a FK declaring relatedList: %s, which no group may place', (relatedList) => {
    const [parent, child] = stack('order_line', undefined, false);
    const fk = { ...child.fields.order, relatedList };
    expect(hits([parent, { ...child, fields: { order: fk } }], R5)).toEqual([]);
  });
});

describe('R6 relationship/association-inline-edit — warns on a placed association', () => {
  it.each(INLINE_VALUES)('warns when a parent group places an association (inlineEdit: %s)', (inlineEdit) => {
    const [issue, ...rest] = hits(stack('order_comment', inlineEdit, true), R6);
    expect(rest).toEqual([]);
    expect(issue?.severity).toBe('warning');
    expect(issue?.path).toBe('objects[1].fields.order');
  });

  it.each(INLINE_VALUES)('is silent when no group places it (inlineEdit: %s)', (inlineEdit) => {
    expect(hits(stack('order_comment', inlineEdit, false), R6)).toEqual([]);
  });
});
