// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12329 — the Debug run evaluates what the engine evaluates since
 * objectstack#19939 S7 deleted its single-brace resolver. One pin per position
 * the simulator reads a value at:
 *
 * - `assignment`, in each of the three shapes its executor accepts: a value
 *   spelling a `{…}` token is refused before any variable is set, with the
 *   spec's `flowNodeValueTemplateRefusals` (the judge `registerFlow` refuses
 *   the flow with, and the executor's run-time twin). The map shape is pinned
 *   in `flow-simulator.guardsInterpolation-10615.test.ts`.
 * - `loop` with a `body`: `collection` is a value slot. A `{…}` token and a
 *   bare variable name are refused (the spec's two config judges), a CEL value
 *   envelope is evaluated, an inline array is iterated as written, and what is
 *   not a list fails the node.
 * - `loop` without a `body` (the legacy form no door judges): the executor
 *   reads `collection` as a variable name exactly as written, so `{leadList}`
 *   finds nothing.
 *
 * Expected refusals are read from the installed spec, never restated.
 */

import { describe, it, expect } from 'vitest';
import { flowNodeConfigRefusals, flowNodeValueTemplateRefusals } from '@objectstack/spec/automation';
import { FlowSimulator } from '../flow-simulator';
import type { SimNode } from '../flow-sim-types';

const BODY = { nodes: [{ id: 'inner', type: 'assignment', label: 'Inner' }], edges: [] };
const cel = (source: string) => ({ dialect: 'cel', source });

/** start → `node` → end, run from `seed`; the node's step and the run. */
function runNode(node: SimNode, seed: Record<string, unknown> = {}) {
  const sim = new FlowSimulator(
    [{ id: 's', type: 'start' }, node, { id: 'e', type: 'end' }],
    [
      { source: 's', target: node.id },
      { source: node.id, target: 'e' },
    ],
  );
  sim.reset(seed);
  sim.runToEnd();
  return { sim, step: sim.state.steps.find((st) => st.nodeId === node.id) };
}

const loop = (config: Record<string, unknown>): SimNode => ({ id: 'each', type: 'loop', label: 'Each', config });

describe('assignment — the legacy shapes refuse a {token} too (objectui#12329)', () => {
  const shapes: Array<[string, Record<string, unknown>]> = [
    ['the legacy array', { assignments: [{ variable: 'greeting', value: 'hi {who}' }] }],
    ['the bare config', { greeting: 'hi {who}' }],
  ];
  it.each(shapes)('%s', (_name, config) => {
    const expected = flowNodeValueTemplateRefusals('assignment', config)[0];
    expect(expected).toBeDefined();
    const { sim, step } = runNode({ id: 'a', type: 'assignment', config }, { who: 'Ada' });
    expect(step?.status).toBe('error');
    expect(step?.error).toContain(expected!.message);
    expect(sim.state.variables).toEqual({ who: 'Ada' });
  });

  it('control: a token-free legacy array is written as it is', () => {
    const { sim, step } = runNode({ id: 'a', type: 'assignment', config: { assignments: [{ variable: 'greeting', value: 'hi Ada' }] } });
    expect(step?.status).toBe('ok');
    expect(sim.state.variables.greeting).toBe('hi Ada');
  });
});

describe('loop with a body — collection is a value slot (objectui#12329)', () => {
  it('a CEL value envelope is evaluated, and the iterator takes the first item', () => {
    const { sim, step } = runNode(loop({ collection: cel('leadList'), iteratorVariable: 'lead', body: BODY }), {
      leadList: ['a', 'b'],
    });
    expect(step?.status).toBe('ok');
    expect(step?.note).toContain('leadList');
    expect(step?.note).toContain('2');
    expect(sim.state.variables.lead).toBe('a');
  });

  it('an inline array is iterated as written', () => {
    const { sim, step } = runNode(loop({ collection: ['x', 'y', 'z'], iteratorVariable: 'it', body: BODY }));
    expect(step?.status).toBe('ok');
    expect(step?.note).toContain('3');
    expect(sim.state.variables.it).toBe('x');
  });

  it('a {leadList} token is refused with the spec refusal, and binds nothing', () => {
    const config = { collection: '{leadList}', iteratorVariable: 'lead', body: BODY };
    const expected = flowNodeValueTemplateRefusals('loop', config)[0];
    expect(expected).toBeDefined();
    const { sim, step } = runNode(loop(config), { leadList: ['a'] });
    expect(step?.status).toBe('error');
    expect(step?.error).toContain(expected!.message);
    expect('lead' in sim.state.variables).toBe(false);
    expect(sim.state.status).toBe('error');
  });

  it('a bare variable name is refused by the loop contract', () => {
    const config = { collection: 'leadList', iteratorVariable: 'lead', body: BODY };
    expect(flowNodeValueTemplateRefusals('loop', config)).toEqual([]);
    const expected = flowNodeConfigRefusals('loop', config)[0];
    expect(expected).toBeDefined();
    const { step } = runNode(loop(config), { leadList: ['a'] });
    expect(step?.status).toBe('error');
    expect(step?.error).toContain(expected!.message);
  });

  it('an envelope that evaluates to no list fails the node', () => {
    const { step } = runNode(loop({ collection: cel('count'), iteratorVariable: 'it', body: BODY }), { count: 3 });
    expect(step?.status).toBe('error');
    expect(step?.error).toContain('count');
  });

  it('an envelope whose CEL fails fails the node', () => {
    const { step } = runNode(loop({ collection: cel('missing.items'), iteratorVariable: 'it', body: BODY }));
    expect(step?.status).toBe('error');
    expect(step?.error).toMatch(/^collection: /);
  });
});

describe('loop without a body — collection is a variable name, read as written (objectui#12329)', () => {
  it('a bare name of a list variable binds the iterator', () => {
    const { sim, step } = runNode(loop({ collection: 'leadList', iteratorVariable: 'lead' }), { leadList: ['a', 'b'] });
    expect(step?.status).toBe('ok');
    expect(step?.note).toContain('leadList');
    expect(sim.state.variables.lead).toBe('a');
  });

  it('{leadList} names no variable: nothing is bound, as at runtime', () => {
    const { sim, step } = runNode(loop({ collection: '{leadList}', iteratorVariable: 'lead' }), { leadList: ['a', 'b'] });
    expect(step?.status).toBe('ok');
    expect(step?.note).not.toContain('leadList');
    expect('lead' in sim.state.variables).toBe(false);
  });
});
