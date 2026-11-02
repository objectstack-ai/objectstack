// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29059] `findFlowRegionRefusals` never passes a flow it could not judge.
 *
 * The walk parses each flow with `FlowSchema` before it asks
 * `validateControlFlow` for the region verdict. The stack schema has already
 * parsed every flow it reads, and `FlowSchema` is idempotent on its own output,
 * so no authored stack reaches the refused-parse branch today; the cases below
 * hand the walk bodies the schema refuses, which is the only way to force it.
 * Before #29059 the branch was a bare `return`: no row, so `os validate` and
 * `os build` passed a flow whose region shape nobody had judged.
 *
 * What the door does with a row is pinned end to end in
 * `test/validate-flow-region-shape.test.ts`; here the subject is the row.
 */

import { describe, expect, it } from 'vitest';

import { undeclaredFlowCycleMessage } from '@objectstack/metadata-core';
import { FLOW_CYCLE_CORPUS } from '@objectstack/metadata-core/testing';

import { findFlowRegionRefusals } from './flow-region-shape.js';

/** A body `FlowSchema` refuses: `nodes` must be an array. */
const unparseable = (name?: string) => ({ ...(name === undefined ? {} : { name }), label: 'Broken', type: 'autolaunched', nodes: 'start', edges: [] });

const located = (rows: ReturnType<typeof findFlowRegionRefusals>) => rows.map(({ path, code, flow }) => ({ path, code, flow }));

describe('[#29059] a flow the flow schema refuses is a row, never a silent pass', () => {
  it('the stack\'s own flows: the row names the flow and its path', () => {
    const rows = findFlowRegionRefusals({ flows: [unparseable('rgn_broken')] });
    expect(located(rows)).toEqual([{ path: 'flows[0]', code: 'VALIDATION_ERROR', flow: 'rgn_broken' }]);
    expect(rows[0]!.message).toContain("'rgn_broken'");
    // The schema's own issue rides the row, so the author is told what it refused.
    expect(rows[0]!.message).toContain('nodes');
  });

  it('a body with no string name is named by its path', () => {
    const rows = findFlowRegionRefusals({ flows: [unparseable()] });
    expect(located(rows)).toEqual([{ path: 'flows[0]', code: 'VALIDATION_ERROR', flow: 'flows[0]' }]);
  });

  it('an artifact\'s packages[] entry: located under its own entry', () => {
    const rows = findFlowRegionRefusals({
      flows: [unparseable('rgn_top_level_not_walked')],
      packages: [{ manifest: { id: 'com.example.a', flows: [] } }, { manifest: { id: 'com.example.b', flows: [unparseable('rgn_broken')] } }],
    });
    expect(located(rows)).toEqual([{ path: 'packages[1].manifest.flows[0]', code: 'VALIDATION_ERROR', flow: 'rgn_broken' }]);
  });
});

/**
 * [#29051] An undeclared cycle in a flow's TOP-LEVEL graph (ADR-0044) is a row.
 *
 * The engine refuses such a flow at registration with
 * `findUndeclaredFlowCycle` (`@objectstack/metadata-core`), and the walk asks
 * the same judge. The cases are the judge's own corpus, the one the engine's
 * registration and the runtime publish gate are driven from, so the CLI
 * refuses exactly the graphs they refuse, in the engine's sentence.
 */
describe('[#29051] a top-level cycle not declared back is refused, as the engine refuses it', () => {
  for (const c of FLOW_CYCLE_CORPUS) {
    it(c.title, () => {
      const rows = findFlowRegionRefusals({ flows: [c.flow] });
      if (c.cycle === null) {
        expect(rows).toEqual([]);
        return;
      }
      expect(located(rows)).toEqual([{ path: 'flows[0]', code: 'VALIDATION_ERROR', flow: c.flow.name }]);
      expect(rows[0]!.message).toBe(`Flow '${c.flow.name}' would be refused at registration: ${undeclaredFlowCycleMessage(c.cycle)}`);
    });
  }

  it('a flow with both a cycle and a malformed region is refused for the cycle first, in the engine\'s order', () => {
    const rework = FLOW_CYCLE_CORPUS.find((c) => c.flow.name === 'cyc_rework_untyped')!;
    const flow = {
      ...rework.flow,
      nodes: rework.flow.nodes.map((node) =>
        node.id === 'check'
          ? { ...node, type: 'parallel', config: { branches: [{ nodes: [{ id: 'only', type: 'assignment', label: 'only' }], edges: [] }] } }
          : node),
    };
    const rows = findFlowRegionRefusals({ flows: [flow] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.message).toContain(undeclaredFlowCycleMessage(rework.cycle!));
  });
});
