// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29025] The flow-cycle judge on its own corpus. The engine's registration
 * (`@objectstack/service-automation`) and the runtime authoring gate
 * (`@objectstack/metadata-protocol`) are driven from the same corpus in their
 * own suites; this file pins what the judge itself answers.
 */

import { describe, expect, it } from 'vitest';
import { findUndeclaredFlowCycle, undeclaredFlowCycleMessage } from './flow-cycle.js';
import { FLOW_CYCLE_CORPUS } from './flow-cycle-corpus.js';

describe('[#29025] findUndeclaredFlowCycle', () => {
    for (const c of FLOW_CYCLE_CORPUS) {
        it(c.title, () => {
            const found = findUndeclaredFlowCycle(c.flow);
            if (c.cycle === null) {
                expect(found).toBeNull();
                return;
            }
            expect(found).toEqual({
                path: c.cycle,
                closingEdgeIndex: c.closingEdgeIndex,
                message: undeclaredFlowCycleMessage(c.cycle),
            });
        });
    }

    it('the corpus holds both verdicts, so no face can pass it by refusing everything or nothing', () => {
        const refused = FLOW_CYCLE_CORPUS.filter((c) => c.cycle !== null).length;
        expect(refused).toBeGreaterThanOrEqual(3);
        expect(FLOW_CYCLE_CORPUS.length - refused).toBeGreaterThanOrEqual(3);
        expect(new Set(FLOW_CYCLE_CORPUS.map((c) => c.flow.name)).size).toBe(FLOW_CYCLE_CORPUS.length);
    });

    it('the message names the walk and the back-edge remedy', () => {
        const message = undeclaredFlowCycleMessage(['a', 'b', 'a']);
        expect(message.startsWith('Flow contains a cycle: a → b → a.')).toBe(true);
        expect(message).toContain("type: 'back'");
    });

    it('an edge whose endpoint names no node takes no part', () => {
        expect(findUndeclaredFlowCycle({
            nodes: [{ id: 'a' }],
            edges: [{ source: 'a', target: 'ghost' }, { source: 'ghost', target: 'a' }],
        })).toBeNull();
    });
});
