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

/** One captured `warn` call — message AND structured meta (#6654 moved the
 *  computed branch label and the out-edge labels into the meta slot). */
type CapturedWarn = { msg: string; meta?: Record<string, any> };

const warnings: CapturedWarn[] = [];

function createTestLogger(): any {
    return {
        info: () => {},
        warn: (msg: string, meta?: Record<string, any>) => { warnings.push({ msg: String(msg), meta }); },
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
        // This harness IS an embedded host, so it owes the host's half of the
        // ADR-0018 contract: every executor it will contribute is registered
        // above, so the vocabulary is closed (#4771). Without it the first
        // `execute()` below reports the omission (#4792) and the
        // zero-warning assertions in this file — which are about #4414 routing,
        // not about node types — would count that line. Declaring the seal is
        // the honest fix; filtering the warning out of the assertions would have
        // hidden a real signal in every future test that borrows this harness.
        engine.sealNodeTypeVocabulary();
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

        // #6654 — the computed branch label is potentially record-derived and
        // the edge labels are flow-author metadata, so both moved out of the
        // message into the structured slot. The #4414 fact under test is
        // unchanged: the unclaimed selection is REPORTED, naming the computed
        // branch and every out-edge label.
        expect(warnings.some((w) =>
            w.msg.includes('no out-edge carries that label')
            && w.msg.includes('#4414')
            && w.meta?.branchLabel === 'Yes — already converted'
            && (w.meta?.outEdges as Array<{ label: string | null }>)
                .map((e) => e.label).includes('Yes')
            && (w.meta?.outEdges as Array<{ label: string | null }>)
                .map((e) => e.label).includes('No'),
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

    it('refuses a brace-in-CEL decision predicate rather than deciding `false`', () => {
        // #4414 made this loud (it used to string-compare and decide `false`
        // forever); #4439 put the slot on the expression ledger, so the refusal
        // now lands at REGISTRATION and never reaches a run. See the
        // registration block at the bottom of this file for the located
        // diagnostic.
        expect(() => engine.registerFlow('guard', guardFlow({
            proceedIsDefault: true,
            conditions: [{ label: 'Yes', expression: "{lead.status} == 'converted'" }],
        }))).toThrow(/template braces|bare CEL/);
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

/**
 * #4439 — the decision's branch predicate is now on the expression ledger, so
 * a brace-in-CEL predicate is a REGISTRATION error rather than a run-time one.
 *
 * #4414 made the failure loud; this makes it early. Before both, the raw string
 * went to the legacy `{var}` template path, `{lead.status}` never resolved, and
 * the branch was decided by string comparison — silently, forever.
 */
describe('decision branch predicate is validated at registration (#4439)', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
        registerLogicNodes(engine, createCtx());
    });

    const flowWith = (expression: string) => ({
        name: 'guard',
        label: 'Guard',
        type: 'autolaunched' as const,
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            { id: 'check', type: 'decision' as const, label: 'Check', config: { conditions: [{ label: 'Yes', expression }] } },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'check' },
            { id: 'e2', source: 'check', target: 'end', label: 'Yes' },
        ],
    });

    it('rejects a brace-in-CEL branch predicate, naming the slot', () => {
        const register = () => engine.registerFlow('guard', flowWith("{lead.status} == 'converted'"));
        expect(register).toThrow(/\{lead\.status\} == 'converted'/);
        expect(register).toThrow(/template braces|bare CEL/);
        // The diagnostic must locate it — a flow may carry several branches.
        expect(register).toThrow(/conditions\[0\]\.expression/);
    });

    it('accepts the bare-CEL spelling', () => {
        expect(() => engine.registerFlow('guard', flowWith("lead.status == 'converted'"))).not.toThrow();
    });
});

/**
 * The shape objectui's flow designer actually emits, pinned.
 *
 * `FlowEdgeInspector.applyBranch()` copies a decision branch onto the edge it
 * wires: a guarded branch becomes `{ condition, label }`, and the `true`/empty
 * branch becomes `{ isDefault: true, label }`. So Studio has been writing
 * `isDefault` since long before anything read it (#4414) — every Studio
 * "default/else" edge ran unconditionally, in parallel with whichever branch
 * matched. These flows are the ones enforcement changes, and they must now take
 * exactly one path.
 *
 * It is also the double declaration the authoring guide tells hand-writers to
 * avoid — node `conditions[]` AND per-edge `condition`s. It is correct here
 * only because the designer keeps the two in sync by construction, which is
 * exactly why it is worth pinning rather than assuming.
 */
describe('objectui-authored decision shape (FlowEdgeInspector.applyBranch)', () => {
    let engine: AutomationEngine;
    let visited: string[];

    beforeEach(() => {
        warnings.length = 0;
        visited = [];
        engine = new AutomationEngine(createTestLogger());
        registerLogicNodes(engine, createCtx());
        engine.registerNodeExecutor({
            type: 'mark',
            async execute(node) { visited.push(node.id); return { success: true }; },
        });
        engine.registerFlow('studio', {
            name: 'studio',
            label: 'Studio-authored',
            type: 'autolaunched',
            variables: [{ name: 'order_amount', type: 'number', isInput: true }],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'check', type: 'decision', label: 'Check Amount',
                    config: {
                        conditions: [
                            { label: 'High Value', expression: 'order_amount > 10000' },
                            { label: 'Standard', expression: 'true' },
                        ],
                    },
                },
                { id: 'escalate', type: 'mark', label: 'Escalate' },
                { id: 'auto', type: 'mark', label: 'Auto approve' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'check' },
                // The guarded branch: expression + label copied onto the edge.
                { id: 'e2', source: 'check', target: 'escalate', label: 'High Value', condition: 'order_amount > 10000', isDefault: false },
                // The `true` branch: written as the BPMN default edge, no condition.
                { id: 'e3', source: 'check', target: 'auto', label: 'Standard', isDefault: true },
            ],
        });
        // Same reason as the harness above: an embedded host closes its own
        // vocabulary once every executor is in (#4771/#4792), and every node
        // type this flow uses is registered above, so the seal is silent.
        engine.sealNodeTypeVocabulary();
    });

    it('takes only the guarded branch when it matches', async () => {
        await engine.execute('studio', { params: { order_amount: 20000 } } as any);
        expect(visited).toEqual(['escalate']);
        expect(warnings).toHaveLength(0);
    });

    it('takes only the default branch when it does not', async () => {
        await engine.execute('studio', { params: { order_amount: 5000 } } as any);
        expect(visited).toEqual(['auto']);
        expect(warnings).toHaveLength(0);
    });
});
