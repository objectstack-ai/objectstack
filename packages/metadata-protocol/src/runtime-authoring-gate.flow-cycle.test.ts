// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29025] The gate-local `flow-undeclared-cycle` rule, on the pure gate,
 * driven from the corpus the engine's registration suite reads
 * (`@objectstack/metadata-core/testing`): the gate refuses exactly the flows
 * the engine refuses to register, with the engine's message, located on the
 * cycle-closing edge. The draft-read and publish doors over a real protocol
 * are pinned in `protocol.draft-publish-verdict.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { undeclaredFlowCycleMessage } from '@objectstack/metadata-core';
import { FLOW_CYCLE_CORPUS } from '@objectstack/metadata-core/testing';
import { evaluateRuntimeAuthoringGate, FLOW_UNDECLARED_CYCLE } from './runtime-authoring-gate.js';

describe('[#29025] the publish gate refuses the cycles the engine refuses', () => {
    for (const c of FLOW_CYCLE_CORPUS) {
        it(c.title, () => {
            const verdict = evaluateRuntimeAuthoringGate({
                type: 'flow', name: c.flow.name, state: 'active', body: structuredClone(c.flow),
            });
            const err = verdict.error as (Error & { issues: any[]; rulesRun: string[] }) | null;
            const cycleIssues = (err?.issues ?? []).filter((i) => i.rule === FLOW_UNDECLARED_CYCLE);
            if (c.cycle === null) {
                expect(cycleIssues).toEqual([]);
                return;
            }
            expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
            expect(err!.rulesRun).toContain(FLOW_UNDECLARED_CYCLE);
            const closing = c.flow.edges[c.closingEdgeIndex!]!;
            expect(cycleIssues).toEqual([{
                severity: 'error',
                rule: FLOW_UNDECLARED_CYCLE,
                where: `flow "${c.flow.name}" · edge "${closing.id}"`,
                path: `flows[0].edges[${c.closingEdgeIndex}]`,
                message: undeclaredFlowCycleMessage(c.cycle),
                hint: expect.any(String),
            }]);
        });
    }

    it('a draft is not gated (D1)', () => {
        const flow = FLOW_CYCLE_CORPUS.find((c) => c.cycle !== null)!.flow;
        const verdict = evaluateRuntimeAuthoringGate({ type: 'flow', name: flow.name, state: 'draft', body: structuredClone(flow) });
        expect(verdict.error).toBeNull();
    });

    it('a body with no edges array is judged as having none', () => {
        const verdict = evaluateRuntimeAuthoringGate({
            type: 'flow', name: 'bare', state: 'active',
            body: { name: 'bare', label: 'Bare', type: 'autolaunched', nodes: [{ id: 'start', type: 'start', label: 'Start' }] },
        });
        const issues = ((verdict.error as any)?.issues ?? []) as Array<{ rule: string }>;
        expect(issues.filter((i) => i.rule === FLOW_UNDECLARED_CYCLE)).toEqual([]);
    });
});
