// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9446 — `POST /api/v1/actions/:object/:action` with `type: 'flow'` answers
 * the #9378 status table, the same one the trigger routes answer.
 *
 * `dispatchFlowAction` (`action-execution.ts`) mapped **every**
 * `success: false` result to one answer:
 *
 * ```ts
 * err.status = 400;
 * err.code = 'FLOW_FAILED';
 * ```
 *
 * under a comment asserting *"The flow RAN and rejected"* — false for two of
 * the four exits it caught. A DISABLED flow invoked through an action came
 * back as `400 FLOW_FAILED`, telling the caller a run had failed when no node
 * ever executed, and the producer's own `result.code` was available and
 * ignored. Maintainer ruling, 2026-08-18, verbatim 「同意」: the table is a
 * property of the flow-dispatch CONTRACT, not of the trigger route, and this
 * door converges on it now.
 *
 * ## What this file pins, and why in two halves
 *
 * A suite that only asserted the new codes would stay green under a regression
 * that made every exit answer ONE code again — every row would still "have"
 * its code if they all shared it. So both halves are pinned:
 *
 *  1. each row answers its own status AND its own code, and
 *  2. the rows are DISTINGUISHABLE from each other — asserted as a set, so a
 *     collapse back to one answer reddens here whatever that one answer is.
 *
 * The second describe block pins the convergence itself: the same engine
 * result, driven through BOTH doors, answers the same status and the same
 * code. That is the ruling's actual content — a per-door assertion can be
 * satisfied by two copies of a rule, and two copies drifting apart is the
 * defect this card exists to close.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AutomationResult } from '@objectstack/spec/contracts';

import { HttpDispatcher } from './http-dispatcher.js';

const FLOW = 'crm_convert_lead_wizard';

const flowAction = {
    name: 'convert_lead',
    label: 'Convert Lead',
    objectName: 'crm_lead',
    type: 'flow',
    target: FLOW,
};

/**
 * A dispatcher serving both doors from ONE automation service — the shape the
 * real engine presents: `getFlow` reads the same flow map `execute` reads
 * (`engine.ts`), so it resolves `null` for exactly the names `execute` would
 * answer "not found" for, and `execute` returns an `AutomationResult` rather
 * than throwing.
 */
function makeDispatcher(opts: {
    result?: AutomationResult;
    flows?: string[];
    omitGetFlow?: boolean;
} = {}) {
    const names = opts.flows ?? [FLOW];
    const held = new Map(names.map((n) => [n, { name: n }]));
    const execute = vi.fn(async (): Promise<AutomationResult> => opts.result ?? { success: true, output: {} });
    const getFlow = vi.fn(async (name: string) => held.get(name) ?? null);
    const automation: Record<string, unknown> = opts.omitGetFlow ? { execute } : { execute, getFlow };

    const objectDef = { name: 'crm_lead', actions: [flowAction] };
    const executeAction = vi.fn(async () => ({ ran: 'script' }));
    const ql: any = {
        executeAction,
        getSchema: (name: string) => (name === objectDef.name ? objectDef : undefined),
        registry: {
            getObject: (name: string) => (name === objectDef.name ? objectDef : undefined),
            getItem: () => undefined,
        },
        find: vi.fn(async () => []),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const resolve = (n: string) =>
        n === 'objectql' || n === 'data' ? ql
        : n === 'metadata' ? metadata
        : n === 'automation' ? automation
        : null;
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (n: string) => resolve(n),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), execute, getFlow, executeAction };
}

const CTX: any = {
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u1', systemPermissions: [] },
};

/** Invoke the flow ACTION — door 2. */
const viaAction = (d: HttpDispatcher, action = 'convert_lead') =>
    d.handleActions(`/crm_lead/${action}`, 'POST', {}, CTX);

/** Trigger the same flow directly — door 1, the reference implementation. */
const viaTrigger = (d: HttpDispatcher, flow = FLOW) =>
    d.handleAutomation(`/${flow}/trigger`, 'POST', {}, CTX);

/** The engine's ran-and-failed exit: `status: 'failed'` is the producer's verdict. */
const RAN_AND_FAILED: AutomationResult = {
    success: false,
    status: 'failed',
    error: "Node 'create_opportunity' failed: Amount must be greater than zero",
    durationMs: 45,
};

/** The engine's two never-dispatched exits, each stamped with its own code (#9415). */
const DISABLED: AutomationResult = {
    success: false, code: 'FLOW_DISABLED', error: `Flow '${FLOW}' is disabled`,
};
const NO_START_NODE: AutomationResult = {
    success: false, code: 'FLOW_NO_START_NODE', error: 'Flow has no start node',
};

describe('#9446 — /actions answers the four-row flow-dispatch table', () => {
    it('row 1: a flow the service does not hold is 404, and is never dispatched', async () => {
        const { dispatcher, execute, getFlow } = makeDispatcher({ flows: [] });

        const res: any = await viaAction(dispatcher);

        expect(res.response.status).toBe(404);
        // Named, so the caller knows WHICH name failed to resolve — and that it
        // is the FLOW behind the action, not the action itself, that is missing.
        expect(res.response.body.error.message).toContain(FLOW);
        // The same shared probe the trigger door uses, asked with the action's
        // declared target; the engine is never asked to run a name nothing holds.
        expect(getFlow).toHaveBeenCalledWith(FLOW);
        expect(execute).not.toHaveBeenCalled();
        // ⛔ Never the old blanket answer: nothing ran, so "the flow failed" is
        // a false statement about what happened.
        expect(res.response.body.error.code).not.toBe('FLOW_FAILED');
    });

    it('row 2: a disabled flow is 409 FLOW_DISABLED, not a failed run', async () => {
        const { dispatcher } = makeDispatcher({ result: DISABLED });

        const res: any = await viaAction(dispatcher);

        expect(res.response.status).toBe(409);
        expect(res.response.body.error.code).toBe('FLOW_DISABLED');
        expect(res.response.body.error.httpStatus).toBe(409);
        // The engine's own words survive — an operator needs to know WHICH flow
        // was refused and why enabling it will help.
        expect(res.response.body.error.message).toBe(DISABLED.error);
        expect(res.response.body.error.code).not.toBe('FLOW_FAILED');
        // The #3962 single wrap holds: no inner envelope for a status-blind
        // caller to misread.
        expect(res.response.body.data).toBeUndefined();
        expect(res.response.body.success).toBe(false);
    });

    it('row 3: a flow with no start node is 422 FLOW_NO_START_NODE', async () => {
        const { dispatcher } = makeDispatcher({ result: NO_START_NODE });

        const res: any = await viaAction(dispatcher);

        expect(res.response.status).toBe(422);
        expect(res.response.body.error.code).toBe('FLOW_NO_START_NODE');
        expect(res.response.body.error.httpStatus).toBe(422);
        expect(res.response.body.error.message).toBe(NO_START_NODE.error);
        expect(res.response.body.error.code).not.toBe('FLOW_FAILED');
        expect(res.response.body.data).toBeUndefined();
        expect(res.response.body.success).toBe(false);
    });

    it('row 4: a run that dispatched and was rejected is still 400 FLOW_FAILED', async () => {
        const { dispatcher } = makeDispatcher({ result: RAN_AND_FAILED });

        const res: any = await viaAction(dispatcher);

        expect(res.response.status).toBe(400);
        expect(res.response.body.error.code).toBe('FLOW_FAILED');
        expect(res.response.body.error.httpStatus).toBe(400);
        // This door names the flow in its message and the trigger door does
        // not, deliberately: the flow name is in the trigger route's URL and is
        // nowhere in this one — a caller here asked for an ACTION.
        expect(res.response.body.error.message).toContain(FLOW);
        expect(res.response.body.error.message).toContain("Node 'create_opportunity' failed");
    });

    it('the four rows are DISTINGUISHABLE — the half a per-row assertion cannot see', async () => {
        // A regression that collapsed the table back to one answer would leave
        // every per-row assertion above satisfiable by that one answer if it
        // happened to be the row's own. Asserted as a SET, it cannot.
        const answers = await Promise.all(
            [
                makeDispatcher({ flows: [] }),
                makeDispatcher({ result: DISABLED }),
                makeDispatcher({ result: NO_START_NODE }),
                makeDispatcher({ result: RAN_AND_FAILED }),
            ].map(async ({ dispatcher }) => {
                const res: any = await viaAction(dispatcher);
                return { status: res.response.status, code: res.response.body.error.code };
            }),
        );

        expect(answers.map((a) => a.status)).toEqual([404, 409, 422, 400]);
        expect(new Set(answers.map((a) => a.status)).size).toBe(4);
        // Codes too: two rows sharing a status would still be two different
        // facts, and the SDK branches on `code`.
        expect(new Set(answers.map((a) => a.code)).size).toBe(4);
        // Exactly ONE row may claim the flow ran.
        expect(answers.filter((a) => a.code === 'FLOW_FAILED')).toHaveLength(1);
    });

    it('classifies off the producer\'s verdict, never off `summary` / `durationMs`', async () => {
        // A refused dispatch carrying the incidental fields of a failed run is
        // still a refused dispatch. If this door sniffed shape instead of
        // reading the classification, it would answer 400 here.
        const { dispatcher } = makeDispatcher({
            result: {
                ...DISABLED,
                durationMs: 45,
                summary: {
                    selected: 0, acted: 0, skipped: 0, unmeasured: 0,
                    nodes: [{ nodeId: 'n', nodeType: 'create_record', status: 'failure', runs: 1, failures: 1 }],
                } as AutomationResult['summary'],
            },
        });

        const res: any = await viaAction(dispatcher);

        expect(res.response.status).toBe(409);
        expect(res.response.body.error.code).toBe('FLOW_DISABLED');
    });

    it('a successful run still answers 200 with the single #3962 wrap', async () => {
        const { dispatcher } = makeDispatcher({ result: { success: true, output: { converted: true } } });

        const res: any = await viaAction(dispatcher);

        expect(res.response.status).toBe(200);
        expect(res.response.body.success).toBe(true);
        expect(res.response.body.data).toEqual({ success: true, output: { converted: true } });
    });

    it('a service without `getFlow` keeps the probe optional and still answers the result rows', async () => {
        // `getFlow?` is optional on `IAutomationService`. One that omits it
        // cannot be asked whether a flow exists, so this dispatches rather than
        // inventing a 404 — exactly as the trigger door behaves.
        const { dispatcher, execute } = makeDispatcher({ omitGetFlow: true, result: DISABLED });

        const res: any = await viaAction(dispatcher);

        expect(execute).toHaveBeenCalledTimes(1);
        expect(res.response.status).toBe(409);
        expect(res.response.body.error.code).toBe('FLOW_DISABLED');
    });

    it('an UNCLASSIFIED refusal still speaks HTTP here — never the #3962 double envelope', async () => {
        // The one place the two doors answer differently, and on purpose: the
        // trigger door leaves an unclassified `success: false` at 200 (it never
        // promotes an exit it was not told about), while this route settled in
        // #3962 that failures speak HTTP. So the residual stays `400
        // FLOW_FAILED` — what this exit has always answered — rather than
        // regressing to `200 {success:true,data:{success:false}}`.
        const { dispatcher } = makeDispatcher({ result: { success: false, error: 'something odd' } });

        const res: any = await viaAction(dispatcher);

        expect(res.response.status).toBe(400);
        expect(res.response.body.error.code).toBe('FLOW_FAILED');
        expect(res.response.body.data).toBeUndefined();
    });
});

describe('#9446 — both doors read ONE table, so they cannot drift', () => {
    // The ruling's actual content. Per-door assertions are satisfiable by two
    // copies of a rule; two copies drifting apart is the defect being closed,
    // and only a comparison can see it.
    for (const [label, result, status, code] of [
        ['a disabled flow', DISABLED, 409, 'FLOW_DISABLED'],
        ['a flow with no start node', NO_START_NODE, 422, 'FLOW_NO_START_NODE'],
        ['a run that ran and failed', RAN_AND_FAILED, 400, 'FLOW_FAILED'],
    ] as Array<[string, AutomationResult, number, string]>) {
        it(`${label}: /actions and /automation/:name/trigger answer the same status and code`, async () => {
            const { dispatcher } = makeDispatcher({ result });

            const action: any = await viaAction(dispatcher);
            const trigger: any = await viaTrigger(dispatcher);

            expect(action.response.status).toBe(status);
            expect(trigger.response.status).toBe(status);
            expect(action.response.body.error.code).toBe(code);
            expect(trigger.response.body.error.code).toBe(code);
        });
    }

    it('an unknown flow is 404 at both doors', async () => {
        const { dispatcher } = makeDispatcher({ flows: [] });

        const action: any = await viaAction(dispatcher);
        const trigger: any = await viaTrigger(dispatcher);

        expect(action.response.status).toBe(404);
        expect(trigger.response.status).toBe(404);
        expect(action.response.body.error.code).toBe(trigger.response.body.error.code);
    });
});
