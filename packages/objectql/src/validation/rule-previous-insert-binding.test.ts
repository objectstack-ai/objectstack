// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23910] On INSERT a rule's CEL scope binds `previous` to `null` — there is
 * no prior row, and that is a fact the rule can read. `previous == null` is how
 * a rule says "this write creates the row", the same binding the flow engine
 * gives a record-after-write start condition on its create leg.
 *
 * Before: the insert path handed the evaluator no prior record, and the scope
 * builder omits an `undefined` root, so the identifier never existed. ANY
 * reference to it — the guard `previous == null` included — faulted
 * `Unknown variable: previous`. A rule written "on insert, or on an update
 * that moves a bound" refused a violating insert as `unevaluable`, naming the
 * fault, and its own message never reached the caller.
 *
 * Three things are pinned, because each alone leaves a hole:
 *
 *  1. every rule-evaluation seam that reads the scope binds it — a `script` /
 *     `cross_field` predicate, a `conditional`'s `when`, and a field's
 *     `requiredWhen` — so the guard decides an insert and the refusal is the
 *     rule's own;
 *  2. the same rule keeps reading the real prior row on update;
 *  3. an update whose prior row is NOT in hand keeps `previous` unbound: the
 *     row exists, so `null` there would answer "this is an insert" — a
 *     fabricated fact that would ADMIT a write the rule refuses.
 *
 * Refusals are read through the ADR-0112 envelope (`status` + `code`), then
 * the field error the rule produced.
 */

import { describe, it, expect } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';
import { evaluateValidationRules } from './rule-validator';

type Mode = 'insert' | 'update';

function refusalOf(run: () => unknown): { status: number; code: string; fields: any[] } {
  try {
    run();
  } catch (e) {
    const r = resolveThrownHttpError(e);
    return { status: r.status, code: r.code, fields: (r.details?.fields ?? (e as any).fields ?? []) as any[] };
  }
  throw new Error('expected the write to be refused, but it was admitted');
}

const FIELDS = {
  starts: { name: 'starts', label: 'Starts', type: 'number' },
  ends: { name: 'ends', label: 'Ends', type: 'number' },
  code: { name: 'code', label: 'Code', type: 'text' },
};

/** The guard shape the platform's own `validity_window_order` uses. */
const ORDER_MESSAGE = 'Ends must be after Starts.';
const orderSchema = {
  fields: FIELDS,
  validations: [
    {
      type: 'cross_field' as const,
      name: 'window_order',
      fields: ['ends', 'starts'],
      condition: {
        dialect: 'cel',
        source:
          '(previous == null || record.starts != previous.starts || record.ends != previous.ends)'
          + ' && record.starts != null && record.ends != null && record.ends <= record.starts',
      },
      message: ORDER_MESSAGE,
    },
  ],
};

const run = (schema: unknown, data: Record<string, unknown>, mode: Mode, previous?: Record<string, unknown> | null) =>
  () => evaluateValidationRules(schema as any, data, mode, previous === undefined ? {} : { previous });

describe('[#23910] insert binds `previous` to null — a predicate rule', () => {
  it('NEGATIVE — a violating insert is refused with the RULE\'s message, not an `unevaluable` fault', () => {
    const r = refusalOf(run(orderSchema, { starts: 5, ends: 3 }, 'insert'));
    expect([r.status, r.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(r.fields.map((f) => [f.field, f.code])).toEqual([['ends', 'rule_violation']]);
    expect(r.fields[0].constraint?.reason).not.toBe('unevaluable');
    expect(r.fields[0].message).toBe(ORDER_MESSAGE);
  });

  it('a valid insert is admitted', () => {
    expect(run(orderSchema, { starts: 3, ends: 5 }, 'insert')).not.toThrow();
  });

  it('the same rule still reads the prior row on update: moving a bound is judged, an unrelated edit is not', () => {
    const r = refusalOf(run(orderSchema, { ends: 1 }, 'update', { starts: 3, ends: 5 }));
    expect([r.status, r.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(r.fields[0].message).toBe(ORDER_MESSAGE);
    // A row already stored inverted takes an edit that moves neither bound —
    // `previous` is the stored row here, so the guard is false.
    expect(run(orderSchema, { code: 'x' }, 'update', { starts: 5, ends: 3 })).not.toThrow();
  });
});

describe('[#23910] insert binds `previous` to null — the other seams that read the scope', () => {
  it('NEGATIVE — a `conditional` whose `when` is `previous == null` runs its branch on insert', () => {
    const schema = {
      fields: FIELDS,
      validations: [
        {
          type: 'conditional' as const,
          name: 'new_rows_name_a_code',
          when: { dialect: 'cel', source: 'previous == null' },
          then: {
            type: 'script' as const,
            name: 'new_row_code_required',
            condition: { dialect: 'cel', source: 'record.code == null' },
            message: 'A new row names its code.',
          },
          message: 'A new row names its code.',
        },
      ],
    };
    const r = refusalOf(run(schema, { starts: 1 }, 'insert'));
    expect([r.status, r.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(r.fields[0].constraint?.reason).not.toBe('unevaluable');
    expect(r.fields[0].message).toBe('A new row names its code.');
    // On update the `when` is false over the real prior row: the branch never runs.
    expect(run(schema, { starts: 2 }, 'update', { starts: 1, code: null })).not.toThrow();
  });

  it('NEGATIVE — a field `requiredWhen: previous == null` is required on insert, not refused as unevaluable', () => {
    const schema = { fields: { ...FIELDS, code: { ...FIELDS.code, requiredWhen: 'previous == null' } } };
    const r = refusalOf(run(schema, { starts: 1 }, 'insert'));
    expect([r.status, r.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(r.fields.map((f) => [f.field, f.code])).toEqual([['code', 'required']]);
    expect(run(schema, { starts: 1, code: 'c1' }, 'insert')).not.toThrow();
    expect(run(schema, { starts: 2 }, 'update', { starts: 1, code: null })).not.toThrow();
  });

  it('NEGATIVE — an UNGUARDED `previous.<field>` read still has no verdict on insert, and the refusal names that read', () => {
    const schema = {
      fields: FIELDS,
      validations: [
        {
          type: 'script' as const,
          name: 'starts_frozen',
          condition: { dialect: 'cel', source: 'record.starts != previous.starts' },
          message: 'Starts cannot change.',
        },
      ],
    };
    const r = refusalOf(run(schema, { starts: 1 }, 'insert'));
    expect([r.status, r.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(r.fields[0].constraint).toMatchObject({ rule: 'starts_frozen', reason: 'unevaluable' });
    expect(r.fields[0].message).toContain("'previous.starts'");
  });
});

describe('[#23910] an update without its prior row keeps `previous` UNBOUND', () => {
  it('NEGATIVE — `previous != null && …` is refused as unevaluable, never admitted as if it were an insert', () => {
    const schema = {
      fields: FIELDS,
      validations: [
        {
          type: 'script' as const,
          name: 'updates_keep_starts_small',
          condition: { dialect: 'cel', source: 'previous != null && record.starts > 10' },
          message: 'An update keeps Starts at 10 or below.',
        },
      ],
    };
    // The bulk seam's spelling: the row exists, its state is not in hand.
    const r = refusalOf(run(schema, { starts: 11 }, 'update', null));
    expect([r.status, r.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(r.fields[0].constraint).toMatchObject({ rule: 'updates_keep_starts_small', reason: 'unevaluable' });
    // …while an insert, where `null` is the truth, is decided: the guard is false.
    expect(run(schema, { starts: 11 }, 'insert')).not.toThrow();
  });
});
