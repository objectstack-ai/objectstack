// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17493 (ruling A, 5651023407) — a blank string in a ledger `predicate` slot
 * is refused at `AutomationEngine.registerFlow`, the second of the three doors.
 *
 * The two slots are `decision`'s `config.conditions[].expression` and
 * `screen`'s `config.fields[].visibleWhen`. Until this card both registered a
 * `''` / `'   '` clean: the resolver skipped the blank as "not authored", and a
 * `decision` branch carrying it went to `evaluateCondition`, answered `false`,
 * and was never taken — with nothing said at any layer. #15572 had pinned that
 * admission as correct because the two sides agreed; the ruling is that
 * agreement is no defence (`decision-predicate-envelope.test.ts` carries that
 * pin, re-judged in place).
 *
 * ## Which gate answers, measured rather than assumed
 *
 * `registerFlow` parses first (`canonicalizeStoredFlow` → `FlowSchema.parse`),
 * and the flow parse refuses these values itself since this card — so the
 * refusal this door hands back is the PARSE's: a Zod issue with code `custom`,
 * anchored at the slot. That is what these pins assert, because it is what a
 * caller receives: the `/automation` write doors (`flowDefinitionRefusal` in
 * `runtime/src/domains/automation.ts`) answer a Zod refusal from
 * `registerFlow` as `400` `VALIDATION_FAILED`, one `details.fields[]` entry
 * per issue, keyed by the issue's path. The engine's own ledger pass refuses the same
 * value through the same `predicateSlotRefusal`, one step later — the same
 * two-layer shape a blank `edge.condition` has had since #15807.
 */
import { describe, expect, it, vi } from 'vitest';
import { PREDICATE_SLOT_STRING_REFUSAL } from '@objectstack/spec/automation';
import { EVALUATED_EXPRESSION_SOURCE_REQUIRED } from '@objectstack/spec';

import { AutomationEngine } from './engine.js';
import { registerLogicNodes } from './builtin/logic-nodes.js';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;

const BLANKS = ['', '   ', '\t\n '] as const;

type Node = Record<string, unknown>;

function flowWith(...middle: Node[]) {
    const nodes: Node[] = [{ id: 'start', type: 'start', label: 'Start' }, ...middle, { id: 'end', type: 'end', label: 'End' }];
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: String(nodes[i].id), target: String(n.id) }));
    return { name: 'blank_flow', label: 'Blank flow', type: 'autolaunched', nodes, edges };
}

const decision = (...expressions: unknown[]): Node => ({
    id: 'branch', type: 'decision', label: 'Branch',
    config: { conditions: expressions.map((expression, i) => ({ label: `b${i}`, expression })) },
});

const screen = (visibleWhen: unknown): Node => ({
    id: 'form', type: 'screen', label: 'Form',
    config: { fields: [{ name: 'amount', label: 'Amount', type: 'number', visibleWhen }] },
});

const loopAround = (inner: Node): Node => ({
    id: 'sweep', type: 'loop', label: 'Sweep',
    config: { collection: '{items}', itemVariable: 'item', body: { nodes: [inner], edges: [] } },
});

/** What `registerFlow` threw, or `undefined` when it registered. */
function refusalOf(engine: AutomationEngine, flow: unknown): { message: string; issues?: Array<{ code: string; path: unknown[]; message: string }> } | undefined {
    try {
        engine.registerFlow('blank_flow', flow as never);
        return undefined;
    } catch (e) {
        return e as never;
    }
}

describe('registerFlow refuses a blank string in a ledger predicate slot (#17493)', () => {
    describe.each(BLANKS)('the blank %j', (blank) => {
        it('decision branch `config.conditions[].expression` — refused, code `custom`, at the branch; nothing registered', async () => {
            const engine = new AutomationEngine(silentLogger);
            const refusal = refusalOf(engine, flowWith(decision(blank)));
            expect(refusal).toBeDefined();
            expect(refusal!.issues?.map((i) => [i.code, i.path])).toEqual([
                ['custom', ['nodes', 1, 'config', 'conditions', 0, 'expression']],
            ]);
            expect(refusal!.issues![0].message.startsWith(PREDICATE_SLOT_STRING_REFUSAL)).toBe(true);
            expect(await engine.getFlow('blank_flow')).toBeNull();
        });

        it('screen field `config.fields[].visibleWhen` — refused, code `custom`, at the field; nothing registered', async () => {
            const engine = new AutomationEngine(silentLogger);
            const refusal = refusalOf(engine, flowWith(screen(blank)));
            expect(refusal).toBeDefined();
            expect(refusal!.issues?.map((i) => [i.code, i.path])).toEqual([
                ['custom', ['nodes', 1, 'config', 'fields', 0, 'visibleWhen']],
            ]);
            expect(refusal!.issues![0].message.startsWith(PREDICATE_SLOT_STRING_REFUSAL)).toBe(true);
            expect(await engine.getFlow('blank_flow')).toBeNull();
        });
    });

    it('refuses a blank branch inside an ADR-0031 region body, anchored where the author wrote it', () => {
        const refusal = refusalOf(new AutomationEngine(silentLogger), flowWith(loopAround(decision('   '))));
        expect(refusal?.issues?.map((i) => [i.code, i.path])).toEqual([
            ['custom', ['nodes', 1, 'config', 'body', 'nodes', 0, 'config', 'conditions', 0, 'expression']],
        ]);
    });

    describe('CONTROLS — what this must NOT move', () => {
        it('a non-blank predicate still registers, on both slots', () => {
            expect(refusalOf(new AutomationEngine(silentLogger), flowWith(decision('record.amount > 10', 'true')))).toBeUndefined();
            expect(refusalOf(new AutomationEngine(silentLogger), flowWith(screen('amount > 0')))).toBeUndefined();
        });

        it('an absent predicate still registers', () => {
            expect(refusalOf(new AutomationEngine(silentLogger), flowWith(screen(undefined)))).toBeUndefined();
        });

        it('the structural `config.condition` keeps its own rule and sentence', () => {
            const refusal = refusalOf(new AutomationEngine(silentLogger),
                flowWith({ id: 'gate', type: 'decision', label: 'G', config: { condition: '   ' } }));
            expect(refusal?.message).toContain(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
            expect(refusal?.message).not.toContain(PREDICATE_SLOT_STRING_REFUSAL);
        });

        it('the EDGE slot keeps its own rule and sentence', () => {
            const flow = flowWith(decision('true'));
            (flow.edges[1] as Record<string, unknown>).condition = '   ';
            const refusal = refusalOf(new AutomationEngine(silentLogger), flow);
            expect(refusal?.message).toContain(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
            expect(refusal?.message).not.toContain(PREDICATE_SLOT_STRING_REFUSAL);
        });

        it('the EVALUATOR is untouched: a blank predicate a stored row still carries answers `false`', () => {
            // `registerFlow` refuses the value; `evaluateCondition` is the shared
            // evaluator and a public method, so its answer is its own contract.
            const engine = new AutomationEngine(silentLogger);
            expect(engine.evaluateCondition({ dialect: 'cel', source: '   ' } as never, new Map())).toBe(false);
        });
    });
});

/**
 * The run-preserving fix the refusal, the ADR-0087 entry and the changeset
 * prescribe for a blank decision branch — keep the branch, write
 * `expression: 'false'` — measured on the real decision executor against the
 * run the blank made. The blank can no longer register, so the "before" run
 * registers a placeholder and rewrites the stored branch to the blank.
 *
 * Dropping the branch is NOT that fix: a decision left with no branch is a
 * plain gateway (`logic-nodes.ts`), so every out-edge no `condition` or
 * `isDefault` gates runs — pinned last, because the prescription warns of it.
 */
describe('a blank decision branch rewritten to `false` runs what the blank ran (#17493)', () => {
    type Out = { target: string; label?: string; isDefault?: boolean };
    type Branch = { label: string; expression: string };

    /** `blankAt` names the branch that carries the blank in the "before" run. */
    const CASES: Record<string, { branches: Branch[]; blankAt: number; out: Out[]; ran: string[] }> = {
        'its only branch, beside an `isDefault` out-edge': {
            branches: [{ label: 'b0', expression: 'false' }], blankAt: 0,
            out: [{ target: 'x', label: 'b0' }, { target: 'y', isDefault: true }],
            ran: ['start', 'd', 'y'],
        },
        'a branch that is not the last': {
            branches: [{ label: 'b0', expression: 'false' }, { label: 'b1', expression: 'true' }], blankAt: 0,
            out: [{ target: 'x', label: 'b0' }, { target: 'y', label: 'b1' }, { target: 'z', isDefault: true }],
            ran: ['start', 'd', 'y'],
        },
        'its only branch, with no default out-edge': {
            branches: [{ label: 'b0', expression: 'false' }], blankAt: 0,
            out: [{ target: 'x', label: 'b0' }, { target: 'y' }],
            ran: ['start', 'd', 'x', 'y'],
        },
    };

    /**
     * With `blankAt`, the branch registers as `'true'` — a placeholder that
     * routes differently in every case — and is rewritten to the blank before
     * the run; `ran` below proves the rewrite held.
     */
    async function runOf(branches: Branch[] | undefined, out: Out[], blankAt?: number) {
        const warned: string[] = [];
        const logger = { ...silentLogger, warn: (msg: string) => { warned.push(String(msg)); } };
        const engine = new AutomationEngine(logger);
        registerLogicNodes(engine, { logger, getService: () => undefined } as never);
        engine.registerNodeExecutor({ type: 'mark', async execute() { return { success: true }; } });
        engine.sealNodeTypeVocabulary();
        const parsed = engine.registerFlow('route', {
            name: 'route', label: 'Route', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'd', type: 'decision', label: 'D',
                    ...(branches ? {
                        config: { conditions: branches.map((b, i) => ({ ...b, ...(i === blankAt ? { expression: 'true' } : {}) })) },
                    } : {}),
                },
                ...out.map((o) => ({ id: o.target, type: 'mark', label: o.target })),
            ],
            edges: [
                { id: 'e0', source: 'start', target: 'd' },
                ...out.map((o, i) => ({ id: `e${i + 1}`, source: 'd', ...o })),
            ],
        });
        if (blankAt !== undefined) {
            const stored = (parsed.nodes[1].config as { conditions: Branch[] }).conditions[blankAt];
            stored.expression = '   ';
        }
        await engine.execute('route', { params: {} } as never);
        const [log] = await engine.listRuns('route');
        return {
            ran: (log?.steps ?? []).filter((s) => s.status === 'success').map((s) => s.nodeId),
            unclaimedWarns: warned.filter((w) => w.includes('no out-edge carries that label')).length,
        };
    }

    it.each(Object.entries(CASES))('%s', async (_name, c) => {
        const before = await runOf(c.branches, c.out, c.blankAt);
        const after = await runOf(c.branches, c.out);
        expect(before.ran).toEqual(c.ran);
        expect(after).toEqual(before);
    });

    it('dropping a decision\'s only branch is not that fix: every ungated out-edge then runs', async () => {
        const c = CASES['its only branch, beside an `isDefault` out-edge'];
        expect((await runOf(c.branches, c.out, c.blankAt)).ran).toEqual(['start', 'd', 'y']);
        expect((await runOf([], c.out)).ran).toEqual(['start', 'd', 'y', 'x']);
        expect((await runOf(undefined, c.out)).ran).toEqual(['start', 'd', 'y', 'x']);
    });
});
