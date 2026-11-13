// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #33100 — a formula that reads its own value is refused at the object door
 * and by `os build`; a formula that reads another formula is not.
 *
 * The engine computes an object's formulas in dependency order, so
 * `f_total = record.f_sibling * 2` over the formula `f_sibling` reads the
 * computed value (`@objectstack/objectql`'s
 * `engine-formula-dependency-order.test.ts`). A formula on a cycle — itself
 * (`record.f_total * 2` on `f_total`), or two reading each other — has no
 * order to be computed in and reads null on every row, so the door refuses it
 * on each declared member, with the sentence the engine reports it with.
 */
import { describe, expect, it } from 'vitest';
import { formulaCycleMessage } from '@objectstack/formula';
import { EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';

const formula = (expression: string) => ({ type: 'formula', label: 'F', expression, returnType: 'number' });

/** The card's object, with the formulas given. `sharingModel` keeps `security-owd-unset` quiet. */
const xJob = (formulas: Record<string, unknown>) => ({
  name: 'x_job',
  label: 'Job',
  sharingModel: 'public_read_write',
  fields: {
    quantity: { type: 'number', label: 'Quantity' },
    unit_price: { type: 'number', label: 'Unit price' },
    ...formulas,
  },
});

const where = (field: string) => `object 'x_job' · field '${field}' expression`;

const gateObject = (item: unknown) =>
  runRuntimeAuthoringRules({ type: 'object', item, context: { objects: [] } });

const cycleFindings = <T extends { rule: string; message: string }>(fs: readonly T[]): T[] =>
  fs.filter((f) => f.rule === EXPRESSION_INVALID && f.message.includes('reads its own value'));

const dump = (r: unknown) => JSON.stringify(r, null, 2);

describe('#33100 — formula cycles at the object door and in the build', () => {
  it('a formula over a formula (the card\'s case) is accepted, in either declaration order', () => {
    for (const fields of [
      { f_sibling: formula('record.quantity * record.unit_price'), f_total: formula('record.f_sibling * 2') },
      { f_total: formula('record.f_sibling * 2'), f_sibling: formula('record.quantity * record.unit_price') },
    ]) {
      const result = gateObject(xJob(fields));
      expect(result.errors.filter((f) => f.rule === EXPRESSION_INVALID), dump(result)).toEqual([]);
    }
  });

  it('a chain of three formulas is accepted', () => {
    const result = gateObject(xJob({
      f_c: formula('record.f_b + 1'),
      f_b: formula('record.f_a * 2'),
      f_a: formula('record.quantity * record.unit_price'),
    }));
    expect(result.errors.filter((f) => f.rule === EXPRESSION_INVALID), dump(result)).toEqual([]);
  });

  it('a formula reading itself is REFUSED, located on its expression, in the engine\'s words', () => {
    const result = gateObject(xJob({ f_total: formula('record.f_total * 2') }));

    const errs = cycleFindings(result.errors);
    expect(errs, dump(result)).toHaveLength(1);
    expect(errs[0]).toMatchObject({ severity: 'error', where: where('f_total') });
    expect(errs[0]!.message).toContain(formulaCycleMessage('f_total', ['f_total']));
  });

  it('two formulas reading each other are REFUSED on each; a formula reading one of them is not', () => {
    const result = gateObject(xJob({
      f_x: formula('record.f_y + 1'),
      f_y: formula('record.f_x + 1'),
      f_reads: formula('record.f_x * 2'),
    }));

    const errs = cycleFindings(result.errors);
    expect(errs.map((e) => e.where), dump(result)).toEqual([where('f_x'), where('f_y')]);
    expect(errs[0]!.message).toContain(formulaCycleMessage('f_x', ['f_x', 'f_y']));
    expect(errs[1]!.message).toContain(formulaCycleMessage('f_y', ['f_x', 'f_y']));
  });

  it('the build refuses the same body with the same finding', () => {
    const stack = { objects: [xJob({ f_total: formula('record.f_total * 2') })] };
    const built = cycleFindings(runAuthoringRules('build', { normalized: stack, parsed: stack }));
    const door = cycleFindings(gateObject(stack.objects[0]).errors);

    expect(built, dump(built)).toHaveLength(1);
    expect(door).toHaveLength(1);
    expect({ where: built[0]!.where, message: built[0]!.message }).toEqual({ where: door[0]!.where, message: door[0]!.message });
  });
});
