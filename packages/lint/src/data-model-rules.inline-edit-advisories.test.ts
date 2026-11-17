// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * R5 `relationship/line-items-inline-edit` and R6
 * `relationship/association-inline-edit` ask one question of a relationship:
 * is it edited inline within the parent's form at all?
 *
 * `FieldSchema.inlineEdit` accepts `true`, `'grid'` and `'form'`, and every
 * reader treats all three as inline-edited (the console's inline subforms, the
 * spec's body-table predicate, the sibling `relationship/inline-edit-needs-bulk`
 * rule). So R5 stays silent on any of the three — telling an author who chose
 * `'grid'` to "consider inlineEdit: true" would replace the mode they picked —
 * and R6 warns on any of the three, because a `'grid'` or `'form'` association
 * clutters the parent's entry form exactly as `true` does. Absent (and `false`)
 * is the control on both sides: R5 suggests, R6 is silent.
 */

import { describe, expect, it } from 'vitest';
import { lintDataModel } from './data-model-rules.js';

const R5 = 'relationship/line-items-inline-edit';
const R6 = 'relationship/association-inline-edit';

const INLINE_VALUES = [true, 'grid', 'form'] as const;

/** A parent plus one child whose `master_detail` back to it carries `inlineEdit` (omitted when `undefined`). */
const stack = (child: string, inlineEdit: unknown): any[] => [
  { name: 'order', fields: { name: { type: 'text' } } },
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

describe('R5 relationship/line-items-inline-edit — silent on every inline-edit mode', () => {
  it.each(INLINE_VALUES)('is silent when the line-item relationship declares inlineEdit: %s', (inlineEdit) => {
    expect(hits(stack('order_line', inlineEdit), R5)).toEqual([]);
  });

  it.each([undefined, false])('suggests inline editing when inlineEdit is %s', (inlineEdit) => {
    const [issue, ...rest] = hits(stack('order_line', inlineEdit), R5);
    expect(rest).toEqual([]);
    expect(issue?.severity).toBe('suggestion');
    expect(issue?.path).toBe('objects[1].fields.order.inlineEdit');
  });
});

describe('R6 relationship/association-inline-edit — warns on every inline-edit mode', () => {
  it.each(INLINE_VALUES)('warns when an association relationship declares inlineEdit: %s', (inlineEdit) => {
    const [issue, ...rest] = hits(stack('order_comment', inlineEdit), R6);
    expect(rest).toEqual([]);
    expect(issue?.severity).toBe('warning');
    expect(issue?.path).toBe('objects[1].fields.order.inlineEdit');
  });

  it.each([undefined, false])('is silent when inlineEdit is %s', (inlineEdit) => {
    expect(hits(stack('order_comment', inlineEdit), R6)).toEqual([]);
  });
});
