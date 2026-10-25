// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Debug run evaluates an assignment's CEL value envelope (objectui#10537).
 *
 * The spec declares that an `assignments` map value may be the envelope
 * `{ dialect: 'cel', source }`, "evaluated by the expression engine to a
 * value" (`AssignmentValueSchema`), and the released executor evaluates it.
 * The simulator used to write the envelope into the variable as a literal
 * object and report the step `ok`, so the Debug run no longer mirrored the
 * runtime on the authoring path the editor's "Write as a CEL expression"
 * toggle offers (objectui#7588).
 *
 * Every run goes through the real `FlowSimulator`.
 */

import { describe, it, expect } from 'vitest';
import { FlowSimulator } from '../flow-simulator';
import type { SimNode } from '../flow-sim-types';

const cel = (source: string) => ({ dialect: 'cel', source });

/** start → assignment(config) → end, run to completion from `seed`. */
function runAssignment(config: Record<string, unknown>, seed: Record<string, unknown> = {}) {
  const nodes: SimNode[] = [
    { id: 's', type: 'start' },
    { id: 'a', type: 'assignment', config },
    { id: 'e', type: 'end' },
  ];
  const sim = new FlowSimulator(nodes, [
    { source: 's', target: 'a' },
    { source: 'a', target: 'e' },
  ]);
  sim.reset(seed);
  sim.runToEnd();
  const step = sim.state.steps.find((st) => st.nodeId === 'a');
  return { sim, step };
}

describe('assignment value envelopes are evaluated as CEL (objectui#10537)', () => {
  it('evaluates n * 2 to 4, after the earlier write in the same node', () => {
    const { sim, step } = runAssignment({ assignments: { n: 2, doubled: cel('n * 2') } });
    expect(sim.state.variables.doubled).toBe(4);
    expect(step?.status).toBe('ok');
    expect(step?.wrote).toEqual({ n: 2, doubled: 4 });
    expect(sim.state.status).toBe('done');
  });

  it('sees the value a variable has when its pair runs, not a later write', () => {
    const { sim } = runAssignment({ assignments: { doubled: cel('n * 2'), n: 5 } }, { n: 2 });
    expect(sim.state.variables.doubled).toBe(4);
    expect(sim.state.variables.n).toBe(5);
  });

  it("runs on the runtime's CEL engine: the stdlib and macros compute", () => {
    // The spec's own example for this slot. `@object-ui/core`'s legacy
    // expression evaluator has neither `joinNonEmpty` nor the `map` macro.
    const { sim, step } = runAssignment(
      { assignments: { digest: cel('joinNonEmpty(rows.map(r, r.subject), ", ")') } },
      { rows: [{ subject: 'a' }, { subject: '' }, { subject: 'b' }] },
    );
    expect(step?.status).toBe('ok');
    expect(sim.state.variables.digest).toBe('a, b');
  });

  it("binds the runtime's scope: `vars` resolves, and a dotted key nests", () => {
    const { sim } = runAssignment(
      { assignments: { tripled: cel('vars.n * 3'), total: cel('order.amount + 1') } },
      { n: 2, 'order.amount': 9 },
    );
    expect(sim.state.variables.tripled).toBe(6);
    expect(sim.state.variables.total).toBe(10);
    // Nesting the dotted key for evaluation does not rewrite the variables.
    expect(Object.keys(sim.state.variables).sort()).toEqual(['n', 'order.amount', 'total', 'tripled']);
  });
});

describe('an envelope that fails is reported, and never written as the object (objectui#10537)', () => {
  const cases: Array<[string, unknown]> = [
    ['a CEL error on the live values', cel('missing * 2')],
    ['a CEL parse error', cel('n *')],
    ['a `data` root, which the runtime scope does not bind', cel('data.n * 2')],
    ['a dialect other than cel', { dialect: 'template', source: '{n}' }],
    ['an envelope with no source', { dialect: 'cel' }],
    ['a blank source', cel('   ')],
  ];

  it.each(cases)('%s', (_name, envelope) => {
    const { sim, step } = runAssignment({ assignments: { n: 2, bad: envelope, after: 'x' } });
    expect(step?.status).toBe('error');
    expect(step?.error).toContain('assignments.bad');
    expect(sim.state.status).toBe('error');
    expect('bad' in sim.state.variables).toBe(false);
    // The pair before it was written, the pair after it was not, and the run
    // went no further — the runtime throws on this node.
    expect(step?.wrote).toEqual({ n: 2 });
    expect('after' in sim.state.variables).toBe(false);
    expect(sim.state.visitedNodeIds).not.toContain('e');
  });
});

describe('values that are not a map envelope keep their meaning (objectui#10537 controls)', () => {
  it('a {token} string is refused, not interpolated (objectui#12329)', () => {
    const { sim, step } = runAssignment({ assignments: { who: 'Ada', greeting: 'hi {who}' } });
    expect(step?.status).toBe('error');
    expect('greeting' in sim.state.variables).toBe(false);
    expect('who' in sim.state.variables).toBe(false);
  });

  it('a number and a plain object are written as they are', () => {
    const { sim, step } = runAssignment({ assignments: { count: 3, meta: { a: 1 }, source: { source: 'n * 2' } } });
    expect(step?.status).toBe('ok');
    expect(sim.state.variables.count).toBe(3);
    expect(sim.state.variables.meta).toEqual({ a: 1 });
    // No `dialect` key, so not an envelope: the look-alike is a literal.
    expect(sim.state.variables.source).toEqual({ source: 'n * 2' });
  });

  it('an envelope-shaped value in the legacy array is the literal object, as at runtime', () => {
    const { sim, step } = runAssignment(
      { assignments: [{ variable: 'lit', value: cel('n * 2') }] },
      { n: 2 },
    );
    expect(step?.status).toBe('ok');
    expect(sim.state.variables.lit).toEqual(cel('n * 2'));
  });

  it('an envelope-shaped value in the bare config is the literal object, as at runtime', () => {
    const { sim, step } = runAssignment({ lit: cel('n * 2') }, { n: 2 });
    expect(step?.status).toBe('ok');
    expect(sim.state.variables.lit).toEqual(cel('n * 2'));
  });
});
