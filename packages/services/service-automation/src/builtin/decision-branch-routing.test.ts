// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { registerLogicNodes } from './logic-nodes.js';

/**
 * #4414 — a decision node declared three ways to route a branch and two of them
 * did nothing.
 *
 *   • `decision.config.conditions[].label` → `branchLabel` matched no out-edge
 *     label anywhere in the repo and fell back to the full edge set, silently.
 *   • `FlowEdgeSchema.isDefault` had ZERO readers: it parsed, it was documented
 *     as "the default path when no other conditions match", and it routed
 *     nothing.
 *   • `edge.condition` was the only one that worked.
 *
 * The consequence shipped in `examples/app-crm` — see the first block below.
 */

const warnings: string[] = [];

function createTestLogger(): any {
    return {
        info: () => {},
        warn: (msg: string) => { warnings.push(String(msg)); },
        error: () => {},
        debug: () => {},
        child: () => createTestLogger(),
    };
}

function createCtx(): any {
    return { logger: createTestLogger(), getService: () => undefined };
}

describe('decision branch routing (#4414)', () => {
    let engine: AutomationEngine;
    let visited: string[];

    beforeEach(() => {
        warnings.length = 0;
        visited = [];
        engine = new AutomationEngine(createTestLogger());
        registerLogicNodes(engine, createCtx());
        // A do-nothing terminal so a visited branch is observable without
        // dragging screen/CRUD executors into the test.
        engine.registerNodeExecutor({
            type: 'mark',
            async execute(node) {
                visited.push(node.id);
                return { success: true };
            },
        });
    });

    /** The guard from `examples/app-crm/src/flows/convert-lead.flow.ts`. */
    function guardFlow(opts: {
        conditions?: Array<{ label: string; expression: string }>;
        proceedIsDefault?: boolean;
    }) {
        return {
            name: 'guard',
            label: 'Guard',
            type: 'autolaunched' as const,
            variables: [{ name: 'lead', type: 'object', isInput: true }],
            nodes: [
                { id: 'start', type: 'start' as const, label: 'Start' },
                {
                    id: 'check', type: 'decision' as const, label: 'Already converted?',
                    ...(opts.conditions ? { config: { conditions: opts.conditions } } : {}),
                },
                { id: 'abort', type: 'mark' as const, label: 'Abort' },
                { id: 'proceed', type: 'mark' as const, label: 'Proceed' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'check' },
                {
                    id: 'e_yes', source: 'check', target: 'abort', label: 'Yes',
                    condition: "lead.status == 'converted'",
                },
                {
                    id: 'e_no', source: 'check', target: 'proceed', label: 'No',
                    ...(opts.proceedIsDefault ? { isDefault: true } : {}),
                },
            ],
        };
    }

    const run = (lead: Record<string, unknown>) =>
        engine.execute('guard', { params: { lead } } as any);

    // ── The shipped defect, and its fix ───────────────────────────────────

    it('runs BOTH branches when the fallback edge is merely unconditional', async () => {
        engine.registerFlow('guard', guardFlow({}));
        await run({ status: 'converted' });
        // This is the bug as reported: the abort screen AND the wizard behind it.
        expect(visited).toEqual(['abort', 'proceed']);
    });

    it('takes exactly one branch once the fallback edge is `isDefault`', async () => {
        engine.registerFlow('guard', guardFlow({ proceedIsDefault: true }));

        await run({ status: 'converted' });
        expect(visited).toEqual(['abort']);

        visited.length = 0;
        await run({ status: 'open' });
        expect(visited).toEqual(['proceed']);
    });

    // ── `isDefault` — BPMN default flow ───────────────────────────────────

    it('records a `skipped` step for a default edge passed over by a real branch', async () => {
        engine.registerFlow('guard', guardFlow({ proceedIsDefault: true }));
        await run({ status: 'converted' });
        const [log] = await engine.listRuns('guard');
        const skipped = log!.steps!.find((s) => s.nodeId === 'proceed');
        expect(skipped?.status).toBe('skipped');
        expect(skipped?.skippedBy).toMatchObject({ nodeId: 'check', edgeId: 'e_no' });
    });

    it('keeps a default edge out of the unconditional parallel fan-out', async () => {
        // Two plain unconditional edges still fan out; the default one does not
        // join them when a conditional sibling matched.
        engine.registerFlow('fanout', {
            name: 'fanout',
            label: 'Fanout',
            type: 'autolaunched',
            variables: [{ name: 'lead', type: 'object', isInput: true }],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'check', type: 'decision', label: 'Check' },
                { id: 'hit', type: 'mark', label: 'Hit' },
                { id: 'always', type: 'mark', label: 'Always' },
                { id: 'otherwise', type: 'mark', label: 'Otherwise' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'check' },
                { id: 'e2', source: 'check', target: 'hit', condition: "lead.status == 'converted'" },
                { id: 'e3', source: 'check', target: 'always' },
                { id: 'e4', source: 'check', target: 'otherwise', isDefault: true },
            ],
        });
        await engine.execute('fanout', { params: { lead: { status: 'converted' } } } as any);
        expect(visited).toContain('hit');
        expect(visited).toContain('always');
        expect(visited).not.toContain('otherwise');
    });

    it('takes the default edge when the node has no conditional siblings at all', async () => {
        engine.registerFlow('bare', {
            name: 'bare',
            label: 'Bare',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'only', type: 'mark', label: 'Only' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'only', isDefault: true }],
        });
        await engine.execute('bare');
        expect(visited).toEqual(['only']);
    });

    // ── `branchLabel` — no more silent fallback ───────────────────────────

    it('routes by branch label when an out-edge claims it', async () => {
        engine.registerFlow('guard', guardFlow({
            proceedIsDefault: true,
            conditions: [{ label: 'No', expression: 'true' }],
        }));
        await run({ status: 'converted' });
        // The decision selected 'No', which narrows traversal to `e_no` — the
        // abort branch is never even evaluated.
        expect(visited).toEqual(['proceed']);
        expect(warnings).toHaveLength(0);
    });

    it('warns — instead of silently falling back — when no out-edge claims the label', async () => {
        engine.registerFlow('guard', guardFlow({
            conditions: [
                { label: 'Yes — already converted', expression: "lead.status == 'converted'" },
                { label: 'No — proceed', expression: 'true' },
            ],
        }));
        await run({ status: 'converted' });

        expect(warnings.some((w) =>
            w.includes("selected branch 'Yes — already converted'")
            && w.includes("'Yes'") && w.includes("'No'")
            && w.includes('#4414'),
        )).toBe(true);
        // Behaviour is unchanged (a run mid-flight must not die on it) — but it
        // is no longer invisible.
        expect(visited).toEqual(['abort', 'proceed']);
    });

    it('reports no branch at all from a decision that declares no conditions', async () => {
        // The old executor returned `branchLabel: 'default'` here, a label no
        // out-edge in the repo ever carried — so EVERY decision node fell back
        // to the full edge set. Nothing to warn about now: there is no branch.
        engine.registerFlow('guard', guardFlow({ proceedIsDefault: true }));
        await run({ status: 'open' });
        expect(warnings).toHaveLength(0);
        expect(visited).toEqual(['proceed']);
    });

    // ── `conditions[].expression` is bare CEL, as declared ────────────────

    it('decides a branch on a bare-CEL predicate over a nested variable', async () => {
        engine.registerFlow('guard', guardFlow({
            proceedIsDefault: true,
            conditions: [
                { label: 'Yes', expression: "lead.status == 'converted'" },
                { label: 'No', expression: 'true' },
            ],
        }));
        // Handed to the legacy `{var}` template path — which is where a raw
        // string used to go — `lead.status` never resolves and the first branch
        // is decided by string comparison instead of by the record.
        await run({ status: 'converted' });
        expect(visited).toEqual(['abort']);

        visited.length = 0;
        await run({ status: 'open' });
        expect(visited).toEqual(['proceed']);
    });

    it('fails loudly on a brace-in-CEL decision predicate rather than deciding `false`', async () => {
        engine.registerFlow('guard', guardFlow({
            proceedIsDefault: true,
            conditions: [{ label: 'Yes', expression: "{lead.status} == 'converted'" }],
        }));
        const result = await run({ status: 'converted' });
        expect(result.success).toBe(false);
        expect(String(result.error)).toMatch(/template braces|bare CEL/);
    });

    it("lets the `default` sentinel claim the `isDefault` edge when no condition matched", async () => {
        engine.registerFlow('guard', guardFlow({
            proceedIsDefault: true,
            conditions: [{ label: 'Yes', expression: "lead.status == 'converted'" }],
        }));
        await run({ status: 'open' });
        // No declared condition matched → branch 'default' → the BPMN default
        // edge claims it, without the author also labelling that edge 'default'.
        expect(visited).toEqual(['proceed']);
        expect(warnings).toHaveLength(0);
    });
});
