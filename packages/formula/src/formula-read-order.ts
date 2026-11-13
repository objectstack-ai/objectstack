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
 * ({@link analyzeRelationshipTraversals}) names them — the fields read as
 * values (`bareFields`) and the fields read through (`traversals`); both
 * callers pass that same set. A read of a name that is not a key of `reads`
 * is ignored.
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

/**
 * See the module docblock. A formula is on a cycle when its strongly
 * connected component of the read graph holds more than one formula, or it
 * reads itself: exactly the formulas that read their own value, whatever
 * order the formulas are given in. Each is named with one shortest loop
 * through it.
 */
export function formulaReadOrder(reads: ReadonlyMap<string, readonly string[]>): FormulaReadOrder {
  const edges = (name: string): string[] => (reads.get(name) ?? []).filter((read) => reads.has(read));
  // The evaluation order: each formula after the formulas it reads (post-order).
  const done = new Set<string>();
  const entered = new Set<string>();
  const order: string[] = [];
  const place = (name: string): void => {
    if (done.has(name) || entered.has(name)) return;
    entered.add(name);
    for (const read of edges(name)) place(read);
    done.add(name);
    order.push(name);
  };
  for (const name of reads.keys()) place(name);
  // The strongly connected components (Tarjan).
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const component = new Map<string, number>();
  const components: string[][] = [];
  const connect = (name: string): void => {
    index.set(name, counter);
    low.set(name, counter);
    counter += 1;
    stack.push(name);
    onStack.add(name);
    for (const read of edges(name)) {
      if (!index.has(read)) {
        connect(read);
        low.set(name, Math.min(low.get(name)!, low.get(read)!));
      } else if (onStack.has(read)) {
        low.set(name, Math.min(low.get(name)!, index.get(read)!));
      }
    }
    if (low.get(name) !== index.get(name)) return;
    const members: string[] = [];
    for (let member = stack.pop()!; ; member = stack.pop()!) {
      onStack.delete(member);
      component.set(member, components.length);
      members.push(member);
      if (member === name) break;
    }
    components.push(members);
  };
  for (const name of reads.keys()) if (!index.has(name)) connect(name);
  const cycles = new Map<string, string>();
  for (const name of reads.keys()) {
    const own = component.get(name)!;
    if (components[own]!.length === 1 && !edges(name).includes(name)) continue;
    cycles.set(name, formulaCycleMessage(name, shortestLoop(name, own, edges, component)));
  }
  return { order, cycles };
}

/** One shortest loop from `start` back to itself inside its component, `start` first. */
function shortestLoop(
  start: string,
  own: number,
  edges: (name: string) => string[],
  component: ReadonlyMap<string, number>,
): string[] {
  const previous = new Map<string, string>();
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head]!;
    for (const read of edges(at)) {
      if (component.get(read) !== own) continue;
      if (read === start) {
        const loop = [at];
        while (loop[0] !== start) loop.unshift(previous.get(loop[0]!)!);
        return loop;
      }
      if (previous.has(read)) continue;
      previous.set(read, at);
      queue.push(read);
    }
  }
  return [start];
}
