// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33100] The order an object's formula fields are computed in, and the
 * formulas that have none.
 *
 * A formula may read another formula (`f_total = record.f_sibling * 2`). The
 * engine computes the formulas of a row one after the other, writing each
 * value onto the row, so a formula reads another's value only when it is
 * computed after it. This answers that order — each formula after the
 * formulas it reads, otherwise the order given — and names every formula that
 * reads its own value, itself (`record.f_total * 2` on `f_total`) or through
 * the formulas it reads: such a formula has no order to be computed in.
 *
 * ONE answer for both seams that need it, so they cannot drift: the engine's
 * formula read plan (`orderFormulaPlan` in `@objectstack/objectql`) never
 * evaluates a cycle member and reports its sentence as the field's fault, and
 * the authoring lint (`@objectstack/lint`, the object door and `os build`)
 * refuses the same formula with the same sentence.
 *
 * The caller names the reads: for each formula, the formula fields of the same
 * object its expression reads, as the platform's member reader
 * ({@link analyzeRelationshipTraversals}' `bareFields`) names them. A read of
 * a name that is not a key of `reads` is ignored.
 */

/** {@link formulaReadOrder}'s answer. */
export interface FormulaReadOrder {
  /** Every formula of `reads`, each after the formulas it reads (a cycle member at the point its cycle closes). */
  order: string[];
  /** Each formula on a cycle, with the sentence naming its cycle; empty when there is none. */
  cycles: Map<string, string>;
}

/** The sentence a formula on a cycle is reported with, at read time and at authoring time alike. */
export function formulaCycleMessage(field: string, loop: readonly string[]): string {
  const at = loop.indexOf(field);
  const around = [...loop.slice(at), ...loop.slice(0, at), field];
  const steps = around.slice(0, -1).map((name, i) => `'${name}' reads '${around[i + 1]}'`).join(', ');
  return `formula '${field}' reads its own value through the formulas it reads (${steps}), so there is no `
    + 'order to compute it in and it has no value: a formula can read another formula only when that one does '
    + 'not read it back. Break the cycle, for instance by reading the stored fields the other formula reads.';
}

/** See the module docblock. */
export function formulaReadOrder(reads: ReadonlyMap<string, readonly string[]>): FormulaReadOrder {
  const state = new Map<string, 'visiting' | 'done'>();
  const path: string[] = [];
  const order: string[] = [];
  const cycles = new Map<string, string>();
  const visit = (name: string): void => {
    const seen = state.get(name);
    if (seen === 'done') return;
    if (seen === 'visiting') {
      const loop = path.slice(path.indexOf(name));
      for (const member of loop) {
        if (!cycles.has(member)) cycles.set(member, formulaCycleMessage(member, loop));
      }
      return;
    }
    state.set(name, 'visiting');
    path.push(name);
    for (const read of reads.get(name) ?? []) {
      if (reads.has(read)) visit(read);
    }
    path.pop();
    state.set(name, 'done');
    order.push(name);
  };
  for (const name of reads.keys()) visit(name);
  return { order, cycles };
}
