// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19961 — a `decision` branch with no `expression` is refused at
 * `AutomationEngine.registerFlow`, the second of the three doors.
 *
 * `DecisionConditionSchema` declares `expression` `z.string()`, not optional,
 * yet `conditions: [{ label: 'y' }]` registered clean: nothing parses a
 * decision's open `config` against that schema, and the expression ledger's
 * resolver skipped the absent value as "not authored". The run then failed at
 * the branch — the executor hands `evaluateCondition` a `{ dialect, source }`
 * envelope whose `source` is `undefined`, and the shape gate refuses it. The
 * build accepted what the run refused; the ledger now marks the slot
 * `required`, so the absent value goes through the same walk and the same
 * `predicateSlotRefusal` as the blank string (#17493).
 *
 * ## Which gate answers, measured rather than assumed
 *
 * `registerFlow` parses first (`canonicalizeStoredFlow` → `FlowSchema.parse`),
 * and the flow parse refuses the absent branch predicate itself — so the
 * refusal this door hands back is the PARSE's: a Zod issue with code `custom`,
 * anchored at the slot, whose message is `predicateSlotRefusal`'s. That is the
 * same two-layer shape the blank has (`predicate-slot-blank.test.ts`): the
 * engine's own ledger pass would refuse the value through the same call one
 * step later. The table below is the one `FlowSchema.parse` runs in `spec`
 * (`flow-decision-branch-expression-absent.test.ts`), so the two doors are
 * held to the same code, path and message.
 */
import { describe, expect, it, vi } from 'vitest';
import { PREDICATE_SLOT_STRING_REFUSAL, predicateSlotRefusal } from '@objectstack/spec/automation';

import { AutomationEngine } from './engine.js';
import { registerLogicNodes } from './builtin/logic-nodes.js';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;

type Node = Record<string, unknown>;

function flowWith(...middle: Node[]) {
    const nodes: Node[] = [{ id: 'start', type: 'start', label: 'Start' }, ...middle, { id: 'end', type: 'end', label: 'End' }];
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: String(nodes[i].id), target: String(n.id) }));
    return { name: 'absent_flow', label: 'Absent flow', type: 'autolaunched', nodes, edges };
}

/** A decision whose branches are written exactly as given — no key is added. */
const decision = (...branches: Node[]): Node => ({
    id: 'branch', type: 'decision', label: 'Branch', config: { conditions: branches },
});

/** What `registerFlow` threw, or `undefined` when it registered. */
function refusalOf(engine: AutomationEngine, flow: unknown): { message: string; issues?: Array<{ code: string; path: unknown[]; message: string }> } | undefined {
    try {
        engine.registerFlow('absent_flow', flow as never);
        return undefined;
    } catch (e) {
        return e as never;
    }
}

const TABLE: Array<{ name: string; branch: Node; refused: boolean; refusedWith?: unknown }> = [
    { name: 'no `expression` key — the #19961 shape', branch: { label: 'y' }, refused: true, refusedWith: undefined },
    { name: '`expression: null`', branch: { label: 'y', expression: null }, refused: true, refusedWith: null },
    { name: 'the predicate under the edge\'s spelling `condition`', branch: { label: 'y', condition: 'true' }, refused: true, refusedWith: undefined },
    { name: 'a blank string — the #17493 control', branch: { label: 'y', expression: '   ' }, refused: true, refusedWith: '   ' },
    { name: 'a real predicate — the accept control', branch: { label: 'y', expression: 'true' }, refused: false },
];

describe('registerFlow refuses a decision branch with no `expression` (#19961)', () => {
    it.each(TABLE)('$name', async ({ branch, refused, refusedWith }) => {
        const engine = new AutomationEngine(silentLogger);
        const refusal = refusalOf(engine, flowWith(decision(branch)));
        if (!refused) {
            expect(refusal).toBeUndefined();
            expect(await engine.getFlow('absent_flow')).not.toBeNull();
            return;
        }
        expect(refusal).toBeDefined();
        expect(refusal!.issues?.map((i) => [i.code, i.path])).toEqual([
            ['custom', ['nodes', 1, 'config', 'conditions', 0, 'expression']],
        ]);
        expect(refusal!.issues![0].message).toBe(predicateSlotRefusal(refusedWith)!.message);
        expect(refusal!.issues![0].message.startsWith(PREDICATE_SLOT_STRING_REFUSAL)).toBe(true);
        expect(await engine.getFlow('absent_flow')).toBeNull();
    });

    it('refuses an absent branch inside an ADR-0031 region body, anchored where the author wrote it', () => {
        const refusal = refusalOf(new AutomationEngine(silentLogger), flowWith({
            id: 'sweep', type: 'loop', label: 'Sweep',
            config: { collection: '{items}', iteratorVariable: 'item', body: { nodes: [decision({ label: 'y' })], edges: [] } },
        }));
        expect(refusal?.issues?.map((i) => [i.code, i.path])).toEqual([
            ['custom', ['nodes', 1, 'config', 'body', 'nodes', 0, 'config', 'conditions', 0, 'expression']],
        ]);
    });

    it('CONTROL — a decision that declares no branch still registers: it routes by its out-edges', () => {
        expect(refusalOf(new AutomationEngine(silentLogger), flowWith({ id: 'branch', type: 'decision', label: 'B', config: {} }))).toBeUndefined();
        expect(refusalOf(new AutomationEngine(silentLogger), flowWith(decision()))).toBeUndefined();
    });
});

/**
 * What the refused shape DID at run time, measured on the real decision
 * executor — the ground the prescription stands on. It can no longer
 * register, so the run registers a placeholder and deletes the stored
 * branch's `expression` before executing, the way `predicate-slot-blank.test.ts`
 * measures the blank.
 *
 * The blank KEPT a run (it evaluated `false`), so its prescription can offer
 * `expression: 'false'` as "keep what ran". The absent predicate did not: the
 * run FAILED at the branch. So `'false'` is offered for what it is — keep the
 * branch and its label, never take it — and nothing is claimed to be kept.
 */
describe('what a decision branch with no `expression` did at run time (#19961)', () => {
    async function runOf(expression: string | undefined, placeholder = 'true') {
        const engine = new AutomationEngine(silentLogger);
        registerLogicNodes(engine, { logger: silentLogger, getService: () => undefined } as never);
        engine.registerNodeExecutor({ type: 'mark', async execute() { return { success: true }; } });
        engine.sealNodeTypeVocabulary();
        const parsed = engine.registerFlow('route', {
            name: 'route', label: 'Route', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'd', type: 'decision', label: 'D', config: { conditions: [{ label: 'y', expression: expression ?? placeholder }] } },
                { id: 'x', type: 'mark', label: 'x' },
                { id: 'fallback', type: 'mark', label: 'fallback' },
            ],
            edges: [
                { id: 'e0', source: 'start', target: 'd' },
                { id: 'e1', source: 'd', target: 'x', label: 'y' },
                { id: 'e2', source: 'd', target: 'fallback', isDefault: true },
            ],
        } as never);
        if (expression === undefined) {
            delete (parsed.nodes[1].config as { conditions: Array<Record<string, unknown>> }).conditions[0].expression;
        }
        const result = await engine.execute('route', { params: {} } as never);
        const [log] = await engine.listRuns('route');
        return {
            success: result.success,
            error: String(result.error ?? ''),
            ran: (log?.steps ?? []).filter((s) => s.status === 'success').map((s) => s.nodeId),
        };
    }

    it('the absent predicate failed the run at the branch — there was no run to keep', async () => {
        const run = await runOf(undefined);
        expect(run.success).toBe(false);
        expect(run.error).toContain('condition evaluation error');
        expect(run.ran).toEqual(['start']);
    });

    it('`expression: \'false\'` keeps the branch and never takes it — the run goes to the fallback', async () => {
        expect(await runOf('false')).toEqual({ success: true, error: '', ran: ['start', 'd', 'fallback'] });
    });
});
