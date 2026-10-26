// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Debug run leaves a node and gates a screen field the way the runtime
 * does (objectui#10692, with objectui#10693 folded in). One row per case; each expectation is the
 * runtime's answer, read at objectstack main from:
 *
 * - `AutomationEngine.traverseNext` (`@objectstack/service-automation`) —
 *   successor selection. It has no rule per node type. Out-edges are split
 *   into three buckets: guarded (`edge.condition`, evaluated in order),
 *   default (`isDefault` with no condition, taken only when no guard was
 *   true) and unguarded (always taken). A `fault` edge is filtered out first.
 *   A branch label narrows the edges before the split; `'default'` is claimed
 *   by the `isDefault` edge too. Nothing taken → the branch ends, no error.
 * - the `decision` executor (`registerLogicNodes`) — a decision that declares
 *   `config.conditions` reports the first true entry's `label` as its branch,
 *   else `'default'`; one that declares none reports no branch.
 * - a screen field's `visibleWhen` is the CLIENT's to decide, over the screen's
 *   own declared fields plus the values being collected (spec
 *   `ScreenFieldSpec.visibleWhen`); the Debug run hands it to `ScreenView` raw
 *   and judges only its scope (objectui#10743). The runtime's resume door
 *   (`refuseInvalidScreenInput`) still reads the run's variables until
 *   objectstack#20178 lands.
 *
 * One row keeps a rule the runtime does not share, and says so: several true
 * guards take the first (objectstack#15429, ruling pending). The rows that
 * kept an unmodelled `{…}` token as written (objectui#10695) are gone with the
 * runtime's single-brace interpolator (objectstack#19939 S7): an assignment
 * value spelling one is refused, pinned in
 * `flow-simulator.guardsInterpolation-10615.test.ts` (objectui#12329).
 *
 * Every run goes through the real `FlowSimulator`.
 */

import { describe, it, expect } from 'vitest';
import { FlowSimulator } from '../flow-simulator';
import type { SimEdge, SimNode } from '../flow-sim-types';
import { buildScreenSpec } from '../../screen-spec';

const end = (id: string): SimNode => ({ id, type: 'end' });

function run(nodes: SimNode[], edges: SimEdge[], seed: Record<string, unknown> = {}) {
  const sim = new FlowSimulator(nodes, edges);
  sim.reset(seed);
  sim.runToEnd();
  return sim;
}

/** The node ids `run` reached, among `targets`, sorted. */
const reached = (sim: FlowSimulator, targets: string[]) =>
  targets.filter((t) => sim.state.visitedNodeIds.includes(t)).sort();

/** start → `mid` (of `type`, with `config`) → out-edges `edges`, targets `a`, `b`, `c`. */
function runFrom(
  type: string,
  edges: Array<Omit<SimEdge, 'source'>>,
  seed: Record<string, unknown> = {},
  config?: Record<string, unknown>,
) {
  const nodes: SimNode[] = [
    { id: 's', type: 'start' },
    { id: 'mid', type, ...(config ? { config } : {}) },
    end('a'),
    end('b'),
    end('c'),
  ];
  const sim = run(nodes, [{ source: 's', target: 'mid' }, ...edges.map((e) => ({ ...e, source: 'mid' }))], seed);
  return { sim, step: sim.state.steps.find((st) => st.nodeId === 'mid'), got: reached(sim, ['a', 'b', 'c']) };
}

describe('successor selection follows traverseNext for every node kind (objectui#10692)', () => {
  it('a decision out-edge with no condition and no isDefault is unguarded: always taken, with the default', () => {
    // traverseNext: `eu` is in the unconditional bucket; `ed` is the default
    // and no guard was true. Base visited only `b`.
    const { sim, got } = runFrom('decision', [
      { id: 'eu', target: 'a' },
      { id: 'ed', target: 'b', isDefault: true },
    ]);
    expect(got).toEqual(['a', 'b']);
    expect(sim.state.status).toBe('done');
  });

  it('a decision takes its unguarded edge beside a true guard, and passes over the default', () => {
    const { got } = runFrom(
      'decision',
      [
        { id: 'eg', target: 'a', condition: 'n > 1' },
        { id: 'eu', target: 'b' },
        { id: 'ed', target: 'c', isDefault: true },
      ],
      { n: 2 },
    );
    expect(got).toEqual(['a', 'b']);
  });

  it('a guarded edge out of a NON-decision node is evaluated: false is not taken', () => {
    // The card's example: an assignment `{ n: 2 }`, then an edge guarded
    // `n > 5`. Base took it.
    const { sim, got } = runFrom('assignment', [{ id: 'g', target: 'a', condition: 'n > 5' }], {}, { assignments: { n: 2 } });
    expect(got).toEqual([]);
    expect(sim.state.status).toBe('done');
  });

  it('control: a true guard out of a non-decision node is taken', () => {
    const { got } = runFrom('assignment', [{ id: 'g', target: 'a', condition: 'n > 1' }], {}, { assignments: { n: 2 } });
    expect(got).toEqual(['a']);
  });

  it('a non-decision node takes its default edge only when no guard was true', () => {
    const edges = [
      { id: 'g', target: 'a', condition: 'n > 5' },
      { id: 'ed', target: 'b', isDefault: true },
    ];
    expect(runFrom('get_record', edges, { n: 2 }).got).toEqual(['b']);
    expect(runFrom('get_record', edges, { n: 9 }).got).toEqual(['a']);
  });

  it('a guard that fails out of a non-decision node fails the run on that node', () => {
    // `evaluateCondition` throws on a CEL fault; the run fails there.
    const { sim, step, got } = runFrom('assignment', [{ id: 'g', target: 'a', condition: 'missing > 1' }]);
    expect(step?.status).toBe('error');
    expect(sim.state.status).toBe('error');
    expect(got).toEqual([]);
  });

  it('an edge with both isDefault and a condition is guarded: the condition wins', () => {
    const { got } = runFrom(
      'decision',
      [
        { id: 'gd', target: 'a', isDefault: true, condition: 'n > 5' },
        { id: 'eu', target: 'b' },
      ],
      { n: 2 },
    );
    expect(got).toEqual(['b']);
  });

  it('nothing taken ends the branch; the run is not an error', () => {
    const { sim, step, got } = runFrom('decision', [{ id: 'g', target: 'a', condition: 'n > 5' }], { n: 2 });
    expect(got).toEqual([]);
    expect(step?.status).toBe('ok');
    expect(step?.note).toMatch(/No out-edge was taken/);
    expect(sim.state.status).toBe('done');
  });

  it('a fault edge is not an ordinary successor', () => {
    const { got } = runFrom('assignment', [
      { id: 'f', target: 'a', type: 'fault' },
      { id: 'n', target: 'b' },
    ]);
    expect(got).toEqual(['b']);
  });

  it('kept as ruled, not the runtime: several true guards take the first (objectstack#15429)', () => {
    // The runtime takes every true guard; the ruling is pending, and until it
    // lands the Debug run keeps first-true, on every node kind alike.
    for (const type of ['decision', 'assignment']) {
      const { step, got } = runFrom(
        type,
        [
          { id: 'g1', target: 'a', condition: 'n > 0' },
          { id: 'g2', target: 'b', condition: 'n > 1' },
        ],
        { n: 2 },
      );
      expect(got).toEqual(['a']);
      expect(step?.note).toMatch(/first declared branch/);
    }
  });
});

describe('a decision that declares config.conditions routes by its branch label (objectui#10692)', () => {
  const labelled = [
    { id: 'yes', target: 'a', label: 'Yes' },
    { id: 'no', target: 'b', label: 'No' },
  ];
  const conditions = [{ label: 'Yes', expression: 'n > 5' }];

  it('the matched label narrows the out-edges to the one that carries it', () => {
    const { sim, got } = runFrom('decision', labelled, { n: 9 }, { conditions });
    expect(got).toEqual(['a']);
    expect(sim.state.status).toBe('done');
  });

  it('no entry matched and nothing claims "default": every out-edge is considered', () => {
    const { step, got } = runFrom('decision', labelled, { n: 2 }, { conditions });
    expect(got).toEqual(['a', 'b']);
    expect(step?.note).toMatch(/No out-edge carries the branch label "default"/);
  });

  it('"default" is claimed by the isDefault edge, and an unlabelled edge is held back', () => {
    const edges = [
      { id: 'yes', target: 'a', label: 'Yes', condition: 'n > 5' },
      { id: 'def', target: 'b', isDefault: true },
      { id: 'extra', target: 'c' },
    ];
    expect(runFrom('decision', edges, { n: 9 }, { conditions }).got).toEqual(['a']);
    expect(runFrom('decision', edges, { n: 2 }, { conditions }).got).toEqual(['b']);
  });

  it('a branch expression in {var} braces is refused, as registerFlow refuses it', () => {
    const { sim, step, got } = runFrom('decision', labelled, { n: 9 }, { conditions: [{ label: 'Yes', expression: '{n} > 5' }] });
    expect(step?.status).toBe('error');
    expect(step?.error).toMatch(/config\.conditions\[0\]\.expression/);
    expect(sim.state.status).toBe('error');
    expect(got).toEqual([]);
  });
});

describe('an approval resumes through the same successor selection (objectui#10692)', () => {
  it('the chosen branch edge is still guarded by its condition', () => {
    const sim = new FlowSimulator(
      [{ id: 's', type: 'start' }, { id: 'ap', type: 'approval' }, end('ok'), end('no')],
      [
        { source: 's', target: 'ap' },
        { id: 'app', source: 'ap', target: 'ok', label: 'approve', condition: 'n > 5' },
        { id: 'rej', source: 'ap', target: 'no', label: 'reject' },
      ],
    );
    sim.reset({ n: 2 });
    sim.runToEnd();
    sim.resume({ decision: 'approve' });
    sim.runToEnd();
    expect(reached(sim, ['ok', 'no'])).toEqual([]);
    expect(sim.state.status).toBe('done');
  });
});

describe('a screen field visibleWhen is decided live by the screen renderer; the Debug run judges its scope (objectui#10692, objectui#10693, objectui#10743)', () => {
  const screenNode = (visibleWhen: unknown): SimNode => ({
    id: 'scr',
    type: 'screen',
    config: { fields: [{ name: 'a', type: 'boolean' }, { name: 'b', visibleWhen }, { name: 'c' }] },
  });
  const pauseOn = (visibleWhen: unknown, seed: Record<string, unknown> = {}) => {
    const sim = run(
      [{ id: 's', type: 'start' }, screenNode(visibleWhen), end('e')],
      [
        { source: 's', target: 'scr' },
        { source: 'scr', target: 'e' },
      ],
      seed,
    );
    return sim.state.steps.find((st) => st.nodeId === 'scr');
  };

  it('the screen preview keeps every field and hands the predicate to ScreenView raw', () => {
    const spec = buildScreenSpec({
      id: 'scr',
      config: { fields: [{ name: 'a' }, { name: 'b', visibleWhen: 'a == true' }, { name: 'c', visibleWhen: 'missing > 1' }] },
    });
    expect(spec.fields.map((f) => [f.name, f.visibleWhen])).toEqual([
      ['a', undefined],
      ['b', 'a == true'],
      ['c', 'missing > 1'],
    ]);
  });

  it.each([
    ['a sibling field', 'a == true'],
    ['a sibling field under the record namespace', 'record.a == true'],
    ['control: no predicate', undefined],
  ])('%s: the pause carries no error and names no field', (_name, visibleWhen) => {
    const step = pauseOn(visibleWhen);
    expect(step?.status).toBe('paused');
    expect(step?.error).toBeUndefined();
    expect(step?.note ?? '').not.toMatch(/"b"/);
  });

  it.each([
    ['a run variable the run holds', 'missing > 1', { missing: 2 }],
    ['a run variable the run does not hold', 'missing > 1', {}],
    ["the runtime's vars root", 'vars.a == true', { a: true }],
    ['a {var} brace', '{a} == true', {}],
    ['a non-string', true, {}],
  ])('%s: the pause names the field as an error, and the run still pauses', (_name, visibleWhen, seed) => {
    const step = pauseOn(visibleWhen, seed);
    expect(step?.status).toBe('paused');
    expect(step?.error).toMatch(/"b"/);
    expect(step?.error).not.toMatch(/"a"|"c"/);
  });
});
