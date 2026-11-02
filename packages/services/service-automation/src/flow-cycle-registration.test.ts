// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29025] The engine's registration refusal of an undeclared cycle, driven
 * from the corpus the runtime authoring gate's suite reads
 * (`@objectstack/metadata-core/testing`; the gate's half is
 * `runtime-authoring-gate.flow-cycle.test.ts` in `@objectstack/metadata-protocol`).
 *
 * Each case registers through `registerFlow`, the real door, and must be
 * refused exactly when the corpus names a cycle, with the judge's sentence —
 * the same sentence the gate's finding carries — so the publish and the
 * registration refuse one set of graphs.
 */

import { describe, expect, it } from 'vitest';
import { undeclaredFlowCycleMessage } from '@objectstack/metadata-core';
import { FLOW_CYCLE_CORPUS } from '@objectstack/metadata-core/testing';
import { AutomationEngine } from './engine.js';

function createTestLogger() {
    return {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        child: () => createTestLogger(),
    } as any;
}

describe('[#29025] registerFlow refuses the corpus cycles the publish gate refuses', () => {
    for (const c of FLOW_CYCLE_CORPUS) {
        it(c.title, () => {
            const engine = new AutomationEngine(createTestLogger());
            const register = () => engine.registerFlow(c.flow.name, structuredClone(c.flow));
            if (c.cycle === null) {
                expect(register).not.toThrow();
                return;
            }
            expect(register).toThrow(undeclaredFlowCycleMessage(c.cycle));
        });
    }
});
