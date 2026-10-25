// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FlowEdgeSchema, STRUCTURAL_CONDITION_SHAPE_REFUSAL } from '@objectstack/spec/automation';
import { FlowSimulator } from '../flow-simulator';
import { validateFlowDraft, findCycle } from '../flow-sim-validate';
import type { SimEdge, SimNode } from '../flow-sim-types';

const run = (nodes: SimNode[], edges: SimEdge[], seed = {}, mocks = {}) => {
  const sim = new FlowSimulator(nodes, edges);
  sim.reset(seed, mocks);
  sim.runToEnd();
  return sim;
};

/**
 * An edge as the PLATFORM persists it, not as a test hand-writes it: authoring
 * input goes through `FlowEdgeSchema`, whose `EvaluatedExpressionInput` pipe rewrites a
 * bare guard string into the `{ dialect: 'cel', source }` envelope. So the
 * envelope is not an exotic spelling the simulator may decline to support — it
 * is THE canonical persisted form, and a fixture that spells it by hand could
 * drift from what the spec actually emits (objectui#3216).
 *
 * The `SimEdge` return annotation states the matching type-level claim, and it
 * is checked: `packages/app-shell/tsconfig.test.json` compiles every
 * `src/**\/*.test.ts` in the package, this file included, and the package's
 * `type-check` script chains it (`tsc --noEmit && tsc -p tsconfig.test.json`),
 * which is what CI's Type Check job runs. That was NOT so when this note was
 * written — the build tsconfig excludes `**\/*.test.ts`, app-shell's test tree
 * was then TEST_DEBT, and vitest erases types, so `tsc` saw nothing here
 * (objectui#3181). The package graduated in objectui#4040 and the debt table is
 * now empty.
 *
 * Still read the pin next door in `flow-sim-edge.types.test.ts` as the stronger
 * one: `PersistedEdge extends SimEdge` constrains the TYPE, where an annotation
 * on this helper only constrains what this helper returns.
 */
const specEdge = (e: Record<string, unknown>): SimEdge => FlowEdgeSchema.parse(e);

describe('validateFlowDraft', () => {
  it('flags a missing entry node', () => {
    const v = validateFlowDraft(
      [{ id: 'a', type: 'decision' }, { id: 'b', type: 'end' }],
      [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }],
    );
    expect(v.errors.some((e) => /entry node/.test(e.message))).toBe(true);
  });

  it('rejects multiple start nodes and edges to missing nodes', () => {
    const v = validateFlowDraft(
      [{ id: 's1', type: 'start' }, { id: 's2', type: 'start' }],
      [{ source: 's1', target: 'ghost' }],
    );
    expect(v.errors.some((e) => /start nodes/.test(e.message))).toBe(true);
    expect(v.errors.some((e) => /does not exist/.test(e.message))).toBe(true);
  });

  it('resolves the start node and warns on unreachable nodes', () => {
    const v = validateFlowDraft(
      [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }, { id: 'orphan', type: 'script' }],
      [{ source: 's', target: 'e' }],
    );
    expect(v.startNodeId).toBe('s');
    expect(v.warnings.some((w) => /unreachable/.test(w.message))).toBe(true);
  });

  // ADR-0044 DAG-modulo-back-edges validation ───────────────────────────────
  it('flags an UNMARKED cycle as an error', () => {
    const v = validateFlowDraft(
      [
        { id: 's', type: 'start' },
        { id: 'a', type: 'approval' },
        { id: 'w', type: 'wait' },
      ],
      [
        { source: 's', target: 'a' },
        { id: 'rev', source: 'a', target: 'w', label: 'revise' },
        // Closing edge left as a normal connection — an unmarked cycle.
        { id: 'loop', source: 'w', target: 'a', label: 'resubmit' },
      ],
    );
    expect(v.errors.some((e) => /Cycle detected/.test(e.message))).toBe(true);
  });

  it('cycle error carries the closing node path (for inline canvas highlighting)', () => {
    const v = validateFlowDraft(
      [
        { id: 's', type: 'start' },
        { id: 'a', type: 'approval' },
        { id: 'w', type: 'wait' },
      ],
      [
        { source: 's', target: 'a' },
        { source: 'a', target: 'w', label: 'revise' },
        { source: 'w', target: 'a', label: 'resubmit' },
      ],
    );
    const cyc = v.errors.find((e) => e.cycle);
    expect(cyc).toBeDefined();
    // The path closes the loop and names the involved nodes.
    expect(cyc!.cycle![0]).toBe(cyc!.cycle![cyc!.cycle!.length - 1]);
    expect(cyc!.cycle).toContain('a');
    expect(cyc!.cycle).toContain('w');
  });

  it('accepts a declared revise loop (closing edge typed "back")', () => {
    const v = validateFlowDraft(
      [
        { id: 's', type: 'start' },
        { id: 'a', type: 'approval' },
        { id: 'w', type: 'wait' },
        { id: 'end', type: 'end' },
      ],
      [
        { source: 's', target: 'a' },
        { id: 'ok', source: 'a', target: 'end', label: 'approve' },
        { id: 'rev', source: 'a', target: 'w', label: 'revise' },
        // The declared back-edge closes the loop — excluded from cycle checks.
        { id: 'back', source: 'w', target: 'a', label: 'resubmit', type: 'back' },
      ],
    );
    expect(v.errors.some((e) => /Cycle detected/.test(e.message))).toBe(false);
    expect(v.errors).toHaveLength(0);
  });

  it('flags a self-loop as a cycle', () => {
    const v = validateFlowDraft(
      [{ id: 's', type: 'start' }, { id: 'x', type: 'script' }],
      [{ source: 's', target: 'x' }, { source: 'x', target: 'x' }],
    );
    expect(v.errors.some((e) => /Cycle detected/.test(e.message))).toBe(true);
  });

  it('findCycle returns the closing path, or null for a DAG', () => {
    expect(findCycle(['a', 'b', 'c'], [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ])).toBeNull();
    const cycle = findCycle(['a', 'b'], [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ]);
    expect(cycle).not.toBeNull();
    // First and last node match — the path closes the loop.
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
  });
});

describe('FlowSimulator', () => {
  it('runs a linear flow to completion', () => {
    const sim = run(
      [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }],
      [{ source: 's', target: 'e' }],
    );
    expect(sim.state.status).toBe('done');
    expect(sim.state.visitedNodeIds).toEqual(['s', 'e']);
  });

  it('routes a decision to the first truthy edge', () => {
    const sim = run(
      [
        { id: 's', type: 'start' },
        { id: 'd', type: 'decision' },
        { id: 'hi', type: 'end' },
        { id: 'lo', type: 'end' },
      ],
      [
        { source: 's', target: 'd' },
        { id: 'e_hi', source: 'd', target: 'hi', condition: 'amount > 100' },
        { id: 'e_lo', source: 'd', target: 'lo', isDefault: true },
      ],
      { amount: 250 },
    );
    expect(sim.state.visitedNodeIds).toContain('hi');
    expect(sim.state.visitedNodeIds).not.toContain('lo');
    const dStep = sim.state.steps.find((s) => s.nodeId === 'd')!;
    expect(dStep.edges?.find((x) => x.selected)?.target).toBe('hi');
  });

  it('falls back to the default branch when no condition matches', () => {
    const sim = run(
      [
        { id: 's', type: 'start' },
        { id: 'd', type: 'decision' },
        { id: 'hi', type: 'end' },
        { id: 'lo', type: 'end' },
      ],
      [
        { source: 's', target: 'd' },
        { source: 'd', target: 'hi', condition: 'amount > 100' },
        { source: 'd', target: 'lo', isDefault: true },
      ],
      { amount: 5 },
    );
    expect(sim.state.visitedNodeIds).toContain('lo');
  });

  // Re-judged in objectui#10692: this used to expect an error. The runtime's
  // `traverseNext` takes nothing here and ends the branch with no error, so the
  // Debug run says so on the step and completes, as a real run does.
  it('ends the branch at a decision dead-end (no match, no default), as the runtime does', () => {
    const sim = run(
      [
        { id: 's', type: 'start' },
        { id: 'd', type: 'decision' },
        { id: 'hi', type: 'end' },
      ],
      [
        { source: 's', target: 'd' },
        { source: 'd', target: 'hi', condition: 'amount > 100' },
      ],
      { amount: 5 },
    );
    expect(sim.state.status).toBe('done');
    expect(sim.state.visitedNodeIds).not.toContain('hi');
    const dStep = sim.state.steps.find((s) => s.nodeId === 'd');
    expect(dStep?.status).toBe('ok');
    expect(dStep?.note).toMatch(/No out-edge was taken/);
  });

  it('surfaces a CEL evaluation error in the edge diagnostics', () => {
    const sim = run(
      [
        { id: 's', type: 'start' },
        { id: 'd', type: 'decision' },
        { id: 'x', type: 'end' },
      ],
      [
        { source: 's', target: 'd' },
        { source: 'd', target: 'x', condition: 'a b c (((' },
      ],
    );
    const dStep = sim.state.steps.find((s) => s.nodeId === 'd')!;
    expect(dStep.edges?.[0].error).toBeTruthy();
  });

  it('writes a mocked single outputVariable into the variables', () => {
    const sim = run(
      [
        { id: 's', type: 'start' },
        { id: 'g', type: 'get_record', config: { objectName: 'lead', outputVariable: 'lead' } },
        { id: 'e', type: 'end' },
      ],
      [
        { source: 's', target: 'g' },
        { source: 'g', target: 'e' },
      ],
      {},
      { g: { id: '1', name: 'Acme' } },
    );
    expect(sim.state.variables.lead).toEqual({ id: '1', name: 'Acme' });
    expect(sim.state.steps.find((s) => s.nodeId === 'g')?.status).toBe('mocked');
  });

  it('writes a mocked outputVariable for a function script', () => {
    const sim = run(
      [
        { id: 's', type: 'start' },
        { id: 'sc', type: 'script', config: { function: 'score_lead', outputVariable: 'score' } },
        { id: 'e', type: 'end' },
      ],
      [
        { source: 's', target: 'sc' },
        { source: 'sc', target: 'e' },
      ],
      {},
      { sc: 42 },
    );
    expect(sim.state.variables.score).toBe(42);
  });

  it('does NOT bind the legacy script outputVariables[] list (framework#4278)', () => {
    // The engine never binds those names — it binds the singular
    // `outputVariable` on the function path. Simulating the list taught
    // authors a binding that does not exist at run time.
    const sim = run(
      [
        { id: 's', type: 'start' },
        { id: 'sc', type: 'script', config: { script: 'x', outputVariables: ['score'] } },
        { id: 'e', type: 'end' },
      ],
      [
        { source: 's', target: 'sc' },
        { source: 'sc', target: 'e' },
      ],
      {},
      { sc: { score: 42 } },
    );
    expect(sim.state.variables.score).toBeUndefined();
  });

  it('pauses on a wait node and resumes', () => {
    const sim = new FlowSimulator(
      [
        { id: 's', type: 'start' },
        { id: 'w', type: 'wait' },
        { id: 'e', type: 'end' },
      ],
      [
        { source: 's', target: 'w' },
        { source: 'w', target: 'e' },
      ],
    );
    sim.reset();
    sim.runToEnd();
    expect(sim.state.status).toBe('paused');
    expect(sim.state.activeNodeId).toBe('w');
    sim.resume();
    sim.runToEnd();
    expect(sim.state.status).toBe('done');
    expect(sim.state.visitedNodeIds).toContain('e');
  });

  it('pauses on an input-bearing screen and merges provided outputs on resume', () => {
    const sim = new FlowSimulator(
      [
        { id: 's', type: 'start' },
        { id: 'scr', type: 'screen', config: { fields: [{ name: 'discount', label: 'Discount' }] } },
        { id: 'e', type: 'end' },
      ],
      [
        { source: 's', target: 'scr' },
        { source: 'scr', target: 'e' },
      ],
    );
    sim.reset();
    sim.runToEnd();
    expect(sim.state.pausedReason).toBe('screen');
    sim.resume({ screenOutputs: { discount: 10 } });
    sim.runToEnd();
    expect(sim.state.variables.discount).toBe(10);
    expect(sim.state.status).toBe('done');
  });

  it('passes a field-less screen through without pausing (engine parity)', () => {
    const sim = new FlowSimulator(
      [
        { id: 's', type: 'start' },
        { id: 'scr', type: 'screen' },
        { id: 'e', type: 'end' },
      ],
      [
        { source: 's', target: 'scr' },
        { source: 'scr', target: 'e' },
      ],
    );
    sim.reset();
    sim.runToEnd();
    expect(sim.state.status).toBe('done');
    expect(sim.state.visitedNodeIds).toContain('e');
    expect(sim.state.steps.find((st) => st.nodeId === 'scr')?.status).toBe('ok');
  });

  it('applies assignment config (assignments map, literals as written) to variables', () => {
    const sim = new FlowSimulator(
      [
        { id: 's', type: 'start' },
        { id: 'a', type: 'assignment', config: { assignments: { who: 'Ada', greeting: 'hi Ada' } } },
        { id: 'e', type: 'end' },
      ],
      [
        { source: 's', target: 'a' },
        { source: 'a', target: 'e' },
      ],
    );
    sim.reset();
    sim.runToEnd();
    expect(sim.state.variables.who).toBe('Ada');
    expect(sim.state.variables.greeting).toBe('hi Ada');
    expect(sim.state.status).toBe('done');
  });

  it('pauses at an approval and routes only the chosen decision branch', () => {
    const sim = new FlowSimulator(
      [
        { id: 's', type: 'start' },
        { id: 'a', type: 'approval' },
        { id: 'ok', type: 'end' },
        { id: 'no', type: 'end' },
      ],
      [
        { source: 's', target: 'a' },
        { id: 'app', source: 'a', target: 'ok', label: 'approve' },
        { id: 'rej', source: 'a', target: 'no', label: 'reject' },
      ],
    );
    sim.reset();
    sim.runToEnd();
    expect(sim.state.status).toBe('paused');
    expect(sim.state.pausedReason).toBe('approval');
    expect(sim.state.activeNodeId).toBe('a');
    sim.resume({ decision: 'approve' });
    sim.runToEnd();
    expect(sim.state.status).toBe('done');
    expect(sim.state.visitedNodeIds).toContain('ok');
    expect(sim.state.visitedNodeIds).not.toContain('no');
  });

  it('walks a full ADR-0044 revise loop: revise -> wait -> resubmit -> approve', () => {
    const sim = new FlowSimulator(
      [
        { id: 's', type: 'start' },
        { id: 'a', type: 'approval' },
        { id: 'w', type: 'wait' },
        { id: 'ok', type: 'end' },
        { id: 'no', type: 'end' },
      ],
      [
        { source: 's', target: 'a' },
        { id: 'app', source: 'a', target: 'ok', label: 'approve' },
        { id: 'rej', source: 'a', target: 'no', label: 'reject' },
        { id: 'rev', source: 'a', target: 'w', label: 'revise' },
        { id: 'back', source: 'w', target: 'a', label: 'resubmit', type: 'back' },
      ],
    );
    sim.reset();
    sim.runToEnd();                      // round 1 -> pause at approval
    expect(sim.state.pausedReason).toBe('approval');
    sim.resume({ decision: 'revise' });  // send back
    sim.runToEnd();                      // -> pause at wait
    expect(sim.state.pausedReason).toBe('wait');
    sim.resume();                        // resubmit -> back-edge -> approval
    sim.runToEnd();                      // round 2 -> pause at approval again
    expect(sim.state.pausedReason).toBe('approval');
    expect(sim.state.activeNodeId).toBe('a');
    sim.resume({ decision: 'approve' }); // approve round 2
    sim.runToEnd();
    expect(sim.state.status).toBe('done');
    expect(sim.state.visitedNodeIds).toContain('ok');
    expect(sim.state.visitedNodeIds).not.toContain('no');
    // The approval node suspended twice (two rounds) -> two paused steps.
    const pausedAtApproval = sim.state.steps.filter((st) => st.nodeId === 'a' && st.status === 'paused');
    expect(pausedAtApproval.length).toBe(2);
  });

  it('falls back to fanning out when an approval decision matches no out-edge', () => {
    const sim = new FlowSimulator(
      [
        { id: 's', type: 'start' },
        { id: 'a', type: 'approval' },
        { id: 'ok', type: 'end' },
        { id: 'no', type: 'end' },
      ],
      [
        { source: 's', target: 'a' },
        { id: 'app', source: 'a', target: 'ok', label: 'approve' },
        { id: 'rej', source: 'a', target: 'no', label: 'reject' },
      ],
    );
    sim.reset();
    sim.runToEnd();
    sim.resume({ decision: 'nope' });
    sim.runToEnd();
    // Unmatched label mirrors the engine's branch-label fallback: take all edges.
    expect(sim.state.visitedNodeIds).toContain('ok');
    expect(sim.state.visitedNodeIds).toContain('no');
  });

  it('guards against infinite loops with a step ceiling', () => {
    // The closing edge is a DECLARED back-edge so static validation passes
    // (ADR-0044) — leaving the runtime step ceiling as the backstop for a loop
    // that never settles (mirrors the engine's MAX_NODE_REENTRIES guard).
    const sim = new FlowSimulator(
      [
        { id: 's', type: 'start' },
        { id: 'a', type: 'assignment' },
        { id: 'b', type: 'assignment' },
      ],
      [
        { source: 's', target: 'a' },
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a', type: 'back' },
      ],
    );
    sim.reset();
    sim.runToEnd();
    expect(sim.state.status).toBe('error');
    expect(sim.state.error).toMatch(/step limit/i);
  });

  it('marks join_gateway as unsupported instead of faking it', () => {
    const sim = run(
      [
        { id: 's', type: 'start' },
        { id: 'j', type: 'join_gateway' },
        { id: 'e', type: 'end' },
      ],
      [
        { source: 's', target: 'j' },
        { source: 'j', target: 'e' },
      ],
    );
    const jStep = sim.state.steps.find((s) => s.nodeId === 'j')!;
    expect(jStep.status).toBe('skipped');
    expect(jStep.note).toMatch(/not modelled/i);
  });
});

/**
 * objectui#3216 — the simulator reads an edge guard through `conditionText`,
 * the one reader every consumer of that field goes through.
 *
 * Both readers here (`flow-simulator.ts`'s decision routing and
 * `flow-sim-validate.ts`'s diagnostics) used to accept only a bare string and
 * return `undefined` for anything else. That made the simulator report
 * `Branch has no condition.` for — and skip — a branch the ENGINE evaluates
 * normally, i.e. it silently simulated semantics that differ from the runtime,
 * which is the one thing the simulator's own contract forbids. The spelling it
 * could not read is the spelling the platform itself produces (see
 * {@link specEdge}), so this was never "the simulator supports the shorthand
 * only"; it was a missing branch in two hand-rolled copies of one read.
 */
describe('decision guards in the spec expression envelope (#3216)', () => {
  const NODES: SimNode[] = [
    { id: 's', type: 'start' },
    { id: 'd', type: 'decision' },
    { id: 'hi', type: 'end' },
    { id: 'lo', type: 'end' },
  ];
  const START: SimEdge = { id: 'e_s', source: 's', target: 'd' };

  /** The decision's recorded evaluation of its out-edge to `target`. */
  const edgeEval = (sim: FlowSimulator, target: string) => {
    const step = sim.state.steps.find((x) => x.nodeId === 'd');
    const found = (step?.edges ?? []).find((x) => x.target === target);
    if (!found) throw new Error(`decision "d" recorded no evaluation for its edge to "${target}"`);
    return found;
  };

  it('the spec canonicalises a bare guard INTO the envelope (premise of this suite)', () => {
    const edge = specEdge({ id: 'e_hi', source: 'd', target: 'hi', condition: 'amount > 10' });
    expect(edge.condition).toEqual({ dialect: 'cel', source: 'amount > 10' });
  });

  it('selects the branch whose envelope guard is true (the issue repro)', () => {
    const guarded = specEdge({ id: 'e_hi', source: 'd', target: 'hi', condition: 'amount > 10' });
    const sim = run(NODES, [START, guarded, { id: 'e_lo', source: 'd', target: 'lo', isDefault: true }], { amount: 20 });

    expect(sim.state.visitedNodeIds).toContain('hi');
    expect(sim.state.visitedNodeIds).not.toContain('lo');
    const dStep = sim.state.steps.find((x) => x.nodeId === 'd');
    expect(dStep?.edges?.find((x) => x.selected)?.target).toBe('hi');
    // The timeline shows the guard it evaluated, not "Branch has no condition."
    const hiEval = edgeEval(sim, 'hi');
    expect(hiEval.condition).toBe('amount > 10');
    expect(hiEval.error).toBeUndefined();
  });

  it('EVALUATES an envelope guard rather than treating it as always-true', () => {
    const guarded = specEdge({ id: 'e_hi', source: 'd', target: 'hi', condition: 'amount > 10' });
    const sim = run(NODES, [START, guarded, { id: 'e_lo', source: 'd', target: 'lo', isDefault: true }], { amount: 5 });

    expect(sim.state.visitedNodeIds).toContain('lo');
    expect(sim.state.visitedNodeIds).not.toContain('hi');
    const hiEval = edgeEval(sim, 'hi');
    // False for the right REASON: the guard ran and was false…
    expect(hiEval.result).toBe(false);
    expect(hiEval.condition).toBe('amount > 10');
    // …not because the reader could not see a condition at all.
    expect(hiEval.error).toBeUndefined();
  });

  it('refuses an envelope with nothing readable to evaluate', () => {
    // There is no CEL source to run, and the simulator's rule is to say so
    // rather than fake a result — the fix widened the reader, it did not make
    // every object a condition. It used to say "Branch has no condition." and
    // take the default. The evaluated-slot rule the spec's edge schema applies
    // (`EvaluatedExpressionSchema`, a non-blank `source`) refuses an `ast`-only
    // envelope — `FlowEdgeSchema`, which `specEdge` above uses, admitted it
    // through 17.4.0 and refuses it at `condition` since 17.5.0, the version
    // this tree installs (objectui#11073) — so the runtime never registers the
    // flow, and since
    // objectui#10615 the Debug run stops on it too.
    //
    // `SimEdge` cannot describe this guard since objectui#8946: it carries the
    // edge slot's evaluated type. A draft is data, though, so the simulator
    // must still refuse one at run time, and this row feeds it one anyway.
    // @ts-expect-error — an `ast`-only guard has no `source`, and the edge slot's type requires one (objectui#8946).
    const astOnly: SimEdge = { id: 'e_hi', source: 'd', target: 'hi', condition: { dialect: 'cel', ast: { op: 'gt' } } };
    const sim = run(NODES, [START, astOnly, { id: 'e_lo', source: 'd', target: 'lo', isDefault: true }], { amount: 20 });

    const hiEval = edgeEval(sim, 'hi');
    // The shape rule answers first since `@objectstack/spec` 17.5.0: its
    // `structuralConditionRefusal` refuses an object carrying an `ast` but no
    // string `source`, before the evaluated-slot rule is reached. Through
    // 17.4.0 this row read `EVALUATED_EXPRESSION_SOURCE_REQUIRED`, the second
    // rule's sentence (objectui#11073).
    expect(hiEval.error).toContain(STRUCTURAL_CONDITION_SHAPE_REFUSAL);
    expect(hiEval.error).toContain('`ast`');
    expect(sim.state.status).toBe('error');
    expect(sim.state.visitedNodeIds).not.toContain('lo');
  });

  it('reports a dead-ending envelope guard as false, not as an absent condition', () => {
    const guarded = specEdge({ id: 'e_hi', source: 'd', target: 'hi', condition: 'amount > 10' });
    const sim = run(NODES, [START, guarded], { amount: 5 });

    // A dead end completes the run since objectui#10692, as it does at runtime.
    expect(sim.state.status).toBe('done');
    expect(sim.state.visitedNodeIds).not.toContain('hi');
    const hiEval = edgeEval(sim, 'hi');
    expect(hiEval.error).toBeUndefined();
    expect(hiEval.condition).toBe('amount > 10');
  });

  // The same under-read, one layer up: `validateFlowDraft` warns when a decision
  // guards EVERY out-edge and has no default (it may dead-end). Reading only the
  // bare string made a decision whose guards are envelopes silently exempt.
  it('warns about a missing default when every guard is an envelope', () => {
    const v = validateFlowDraft(NODES, [
      START,
      specEdge({ id: 'e_hi', source: 'd', target: 'hi', condition: 'amount > 10' }),
      specEdge({ id: 'e_lo', source: 'd', target: 'lo', condition: 'amount <= 10' }),
    ]);
    expect(v.warnings.some((w) => w.nodeId === 'd' && /no default branch/.test(w.message))).toBe(true);
  });

  it('does not warn when one branch is unguarded (that branch cannot dead-end)', () => {
    const v = validateFlowDraft(NODES, [
      START,
      specEdge({ id: 'e_hi', source: 'd', target: 'hi', condition: 'amount > 10' }),
      { id: 'e_lo', source: 'd', target: 'lo' },
    ]);
    expect(v.warnings.some((w) => w.nodeId === 'd' && /no default branch/.test(w.message))).toBe(false);
  });
});
