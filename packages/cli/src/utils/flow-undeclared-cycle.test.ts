// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29051] `findFlowCycleRefusals`: an undeclared cycle in a flow's TOP-LEVEL
 * graph (ADR-0044) is a row, located at the flow, in the engine's sentence.
 *
 * The cases are the judge's own corpus (`@objectstack/metadata-core/testing`),
 * the one the engine's registration and the runtime publish gate are driven
 * from, so the CLI refuses exactly the graphs they refuse. What the doors do
 * with a row is pinned end to end in `test/validate-flow-region-shape.test.ts`;
 * here the subject is the row.
 */

import { describe, expect, it } from 'vitest';

import { undeclaredFlowCycleMessage } from '@objectstack/metadata-core';
import { FLOW_CYCLE_CORPUS } from '@objectstack/metadata-core/testing';

import { findFlowCycleRefusals } from './flow-undeclared-cycle.js';

const located = (rows: ReturnType<typeof findFlowCycleRefusals>) => rows.map(({ path, code, flow }) => ({ path, code, flow }));

describe('[#29051] a top-level cycle not declared back is refused, as the engine refuses it', () => {
  for (const c of FLOW_CYCLE_CORPUS) {
    it(c.title, () => {
      const rows = findFlowCycleRefusals({ flows: [c.flow] });
      if (c.cycle === null) {
        expect(rows).toEqual([]);
        return;
      }
      expect(located(rows)).toEqual([{ path: 'flows[0]', code: 'VALIDATION_ERROR', flow: c.flow.name }]);
      expect(rows[0]!.message).toBe(`Flow '${c.flow.name}' would be refused at registration: ${undeclaredFlowCycleMessage(c.cycle)}`);
    });
  }

  it('an artifact\'s packages[] entry: located under its own entry, and the top level is not walked', () => {
    const refused = FLOW_CYCLE_CORPUS.find((c) => c.cycle !== null)!;
    const passes = FLOW_CYCLE_CORPUS.find((c) => c.cycle === null)!;
    const rows = findFlowCycleRefusals({
      flows: [refused.flow],
      packages: [
        { manifest: { id: 'com.example.a', flows: [passes.flow] } },
        { manifest: { id: 'com.example.b', flows: [passes.flow, refused.flow] } },
      ],
    });
    expect(located(rows)).toEqual([{ path: 'packages[1].manifest.flows[1]', code: 'VALIDATION_ERROR', flow: refused.flow.name }]);
  });
});
