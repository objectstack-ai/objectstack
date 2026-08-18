// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9462 — a declared endpoint (`type: 'flow'`) answers the #9378 status table,
 * the same one the trigger routes and `/actions` answer. Door 3 of 3.
 *
 * `executeFlow` (`endpoint-executor.ts`) ended with one unconditional line:
 *
 * ```ts
 * return successAnswer(await automation.execute(plan.flow, automationContext));
 * ```
 *
 * so EVERY outcome — including the three that never dispatched a node — left
 * this seam as `200 {"success":true,"data":{"success":false,…}}`: the double
 * envelope #3962 ruled out for `/actions`, on a surface an app publishes as
 * its own public API. A caller branching on the HTTP status read a refused
 * flow as a successful one.
 *
 * Maintainer ruling, 2026-08-18, verbatim 「同意」: the table is a property of
 * the flow-dispatch CONTRACT rather than of the trigger route, converged in
 * stages — this is the last stage, and it converges by CALLING
 * `flow-dispatch-status.ts` rather than by writing a third copy of the table.
 *
 * ## What this file pins, and why in three parts
 *
 * A suite that only asserted the new codes would stay green under a regression
 * that collapsed every exit back to one answer — each per-row assertion would
 * still be satisfiable by that one answer whenever it happened to be the row's
 * own. So:
 *
 *  1. each row answers its own status AND its own code;
 *  2. the rows are asserted as a SET, so a collapse reddens here whatever the
 *     surviving answer is; and
 *  3. the same `AutomationResult` is driven through ALL THREE doors and must
 *     come back with the same status and the same code. That is the ruling's
 *     actual content: per-door assertions are satisfiable by three copies of a
 *     rule, and three copies drifting apart is the defect being closed.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiEndpointSchema, ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { AutomationResult } from '@objectstack/spec/contracts';
import type { ApiEndpointMatch } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import {
    buildEndpointExecutionContext,
    executeEndpointTarget,
    type EndpointExecutionAnswer,
} from './endpoint-executor.js';
import { HttpDispatcher } from './http-dispatcher.js';

const FLOW = 'purge_inquiries';

/** The declared endpoint under test — the ADR-0121 D1 shape, defaults materialized. */
const FLOW_ENDPOINT = () =>
    ApiEndpointSchema.parse({
        name: 'showcase_purge',
        path: '/api/v1/apps/showcase/purge',
        method: 'POST',
        type: 'flow',
        target: FLOW,
    });

const EC: ExecutionContext = {
    userId: 'user-1',
    positions: ['sales_rep'],
    permissions: ['task_edit'],
    tenantId: 'tenant-9',
} as ExecutionContext;

/**
 * ONE automation service, shaped like the real engine: `getFlow` reads the same
 * flow map `execute` reads (`engine.ts`), so it resolves `null` for exactly the
 * names `execute` would answer "not found" for, and `execute` returns an
 * `AutomationResult` rather than throwing.
 *
 * The SAME object is handed to all three doors below, which is what makes the
 * parity block a comparison rather than three independent fixtures.
 */
function automationServiceWith(opts: {
    result?: AutomationResult;
    flows?: string[];
    omitGetFlow?: boolean;
} = {}) {
    const names = opts.flows ?? [FLOW];
    const held = new Map(names.map((n) => [n, { name: n }]));
    const execute = vi.fn(async (): Promise<AutomationResult> => opts.result ?? { success: true, output: {} });
    const getFlow = vi.fn(async (name: string) => held.get(name) ?? null);
    const service: Record<string, unknown> = opts.omitGetFlow ? { execute } : { execute, getFlow };
    return { service, execute, getFlow };
}

/** Drive the declared endpoint — door 3. */
async function viaEndpoint(service: unknown, body: unknown = {}): Promise<EndpointExecutionAnswer> {
    const match: ApiEndpointMatch = { endpoint: FLOW_ENDPOINT(), params: {} };
    const ctx = buildEndpointExecutionContext({
        request: {
            method: 'POST',
            path: '/api/v1/apps/showcase/purge',
            query: {},
            headers: {},
            body,
        },
        match,
        executionContext: EC,
        environmentId: 'env-7',
    });
    return executeEndpointTarget(ctx, {
        callData: vi.fn().mockResolvedValue({ ok: true }),
        automationService: service,
    });
}

/** Every error answer must be the declared envelope, whatever produced it. */
function expectConformantError(answer: EndpointExecutionAnswer) {
    const body: any = answer.body;
    expect(BaseResponseSchema.safeParse(body).success).toBe(true);
    expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);
    expect(body.success).toBe(false);
    expect(ApiErrorSchema.safeParse(body.error).success).toBe(true);
    expect(body.error.httpStatus).toBe(answer.status);
    return body.error;
}

/** The engine's ran-and-failed exit: `status: 'failed'` is the producer's verdict. */
const RAN_AND_FAILED: AutomationResult = {
    success: false,
    status: 'failed',
    error: "Node 'purge_batch' failed: Amount must be greater than zero",
    durationMs: 45,
};

/** The engine's two never-dispatched exits, each stamped with its own code (#9415). */
const DISABLED: AutomationResult = {
    success: false, code: 'FLOW_DISABLED', error: `Flow '${FLOW}' is disabled`,
};
const NO_START_NODE: AutomationResult = {
    success: false, code: 'FLOW_NO_START_NODE', error: 'Flow has no start node',
};

describe('#9462 — a declared `type: flow` endpoint answers the four-row table', () => {
    it('row 1: a flow the service does not hold is 404, and is never dispatched', async () => {
        const { service, execute, getFlow } = automationServiceWith({ flows: [] });

        const answer = await viaEndpoint(service);

        expect(answer.status).toBe(404);
        const error = expectConformantError(answer);
        // Named, so the caller knows WHICH declared target failed to resolve.
        expect(error.message).toContain(FLOW);
        // The same shared probe the other two doors use, asked with the
        // declaration's own target; the engine is never asked to run a name
        // nothing holds.
        expect(getFlow).toHaveBeenCalledWith(FLOW);
        expect(execute).not.toHaveBeenCalled();
        // ⛔ Never the old answer: a 200 for a flow that does not exist.
        expect(answer.status).not.toBe(200);
    });

    it('row 2: a disabled flow is 409 FLOW_DISABLED, not a 200 carrying a false success flag', async () => {
        const { service } = automationServiceWith({ result: DISABLED });

        const answer = await viaEndpoint(service);

        expect(answer.status).toBe(409);
        const error = expectConformantError(answer);
        expect(error.code).toBe('FLOW_DISABLED');
        // The engine's own words survive — an operator needs to know WHICH flow
        // was refused and why enabling it will help.
        expect(error.message).toBe(DISABLED.error);
        // The double envelope is GONE: there is no inner `data.success` left
        // for a status-blind caller to have to read.
        expect((answer.body as any).data).toBeUndefined();
        expect((answer.body as any).success).toBe(false);
    });

    it('row 3: a flow with no start node is 422 FLOW_NO_START_NODE', async () => {
        const { service } = automationServiceWith({ result: NO_START_NODE });

        const answer = await viaEndpoint(service);

        expect(answer.status).toBe(422);
        const error = expectConformantError(answer);
        expect(error.code).toBe('FLOW_NO_START_NODE');
        expect(error.message).toBe(NO_START_NODE.error);
        expect((answer.body as any).data).toBeUndefined();
    });

    it('row 4: a run that dispatched and was rejected is 400 FLOW_FAILED, with the run’s own artefacts', async () => {
        const { service } = automationServiceWith({
            result: {
                ...RAN_AND_FAILED,
                errorMessage: 'Could not purge: the batch is locked',
                summary: {
                    selected: 3, acted: 0, skipped: 3, unmeasured: 0,
                    nodes: [{ nodeId: 'purge_batch', nodeType: 'update_record', status: 'failure', runs: 1, failures: 1 }],
                } as AutomationResult['summary'],
            },
        });

        const answer = await viaEndpoint(service);

        expect(answer.status).toBe(400);
        const error = expectConformantError(answer);
        expect(error.code).toBe('FLOW_FAILED');
        // The 400 arm carries the run's artefacts, byte-identical to the
        // trigger door — the flow AUTHOR's own failure text and the node
        // summary that says WHICH node failed. The ADR-0112 envelope has no
        // `data`, so `details` is the only place they can ride.
        expect((error.details as any).errorMessage).toBe('Could not purge: the batch is locked');
        expect((error.details as any).summary.nodes[0].nodeId).toBe('purge_batch');
    });

    it('the four rows are DISTINGUISHABLE — the half a per-row assertion cannot see', async () => {
        // A regression that collapsed the table back to one answer would leave
        // every per-row assertion above satisfiable by that one answer if it
        // happened to be the row's own. Asserted as a SET, it cannot.
        const answers = await Promise.all(
            [
                automationServiceWith({ flows: [] }),
                automationServiceWith({ result: DISABLED }),
                automationServiceWith({ result: NO_START_NODE }),
                automationServiceWith({ result: RAN_AND_FAILED }),
            ].map(async ({ service }) => {
                const answer = await viaEndpoint(service);
                return { status: answer.status, code: (answer.body as any).error?.code };
            }),
        );

        expect(answers.map((a) => a.status)).toEqual([404, 409, 422, 400]);
        expect(new Set(answers.map((a) => a.status)).size).toBe(4);
        // Codes too: two rows sharing a status would still be two different
        // facts, and an SDK branches on `code`.
        expect(new Set(answers.map((a) => a.code)).size).toBe(4);
        // Exactly ONE row may claim the flow ran.
        expect(answers.filter((a) => a.code === 'FLOW_FAILED')).toHaveLength(1);
        // And none of them is the old blanket 200.
        expect(answers.filter((a) => a.status === 200)).toHaveLength(0);
    });

    it('classifies off the producer’s verdict, never off `summary` / `durationMs`', async () => {
        // A refused dispatch carrying the incidental fields of a failed run is
        // still a refused dispatch. A door that sniffed shape instead of
        // reading the classification would answer 400 here.
        const { service } = automationServiceWith({
            result: {
                ...DISABLED,
                durationMs: 45,
                summary: {
                    selected: 0, acted: 0, skipped: 0, unmeasured: 0,
                    nodes: [{ nodeId: 'n', nodeType: 'create_record', status: 'failure', runs: 1, failures: 1 }],
                } as AutomationResult['summary'],
            },
        });

        const answer = await viaEndpoint(service);

        expect(answer.status).toBe(409);
        expect((answer.body as any).error.code).toBe('FLOW_DISABLED');
    });

    it('a successful run is UNCHANGED — 200 with the raw result in `data`', async () => {
        const { service } = automationServiceWith({ result: { success: true, output: { purged: 12 } } });

        const answer = await viaEndpoint(service);

        expect(answer.status).toBe(200);
        expect(answer.body).toEqual({ success: true, data: { success: true, output: { purged: 12 } }, meta: undefined });
    });

    it('a service without `getFlow` keeps the probe optional and still answers the result rows', async () => {
        // `getFlow?` is optional on `IAutomationService`. One that omits it
        // cannot be asked whether a flow exists, so this dispatches rather than
        // inventing a 404 — exactly as the other two doors behave.
        const { service, execute } = automationServiceWith({ omitGetFlow: true, result: DISABLED });

        const answer = await viaEndpoint(service);

        expect(execute).toHaveBeenCalledTimes(1);
        expect(answer.status).toBe(409);
        expect((answer.body as any).error.code).toBe('FLOW_DISABLED');
    });

    it('an UNCLASSIFIED refusal keeps today’s 200 — this door reads it the TRIGGER door’s way', async () => {
        // The residual the shared table deliberately does not own, and the one
        // place the three doors do not all agree. #5040 §4 makes a declared
        // `flow` endpoint a stable URL plus a policy layer over `POST
        // /automation/:name/trigger` — same context builder, same `execute`
        // call — so it answers as that route answers. `/actions` refuses the
        // residual under its own #3962 ruling about ITS route; adopting that
        // here would PROMOTE an exit the producer never classified, which is
        // the one thing the shared table's note says a door must not do.
        const { service } = automationServiceWith({ result: { success: false, error: 'something odd' } });

        const answer = await viaEndpoint(service);

        expect(answer.status).toBe(200);
        expect((answer.body as any).data).toEqual({ success: false, error: 'something odd' });
    });
});

// ---------------------------------------------------------------------------
// Cross-door parity — the ruling's actual content
// ---------------------------------------------------------------------------

/**
 * A dispatcher serving doors 1 and 2 from the SAME automation service object
 * the endpoint door is given, so a divergence can only come from the doors'
 * own readings and never from two different fixtures.
 */
function dispatcherOver(service: unknown) {
    const flowAction = {
        name: 'purge',
        label: 'Purge',
        objectName: 'showcase_inquiry',
        type: 'flow',
        target: FLOW,
    };
    const objectDef = { name: 'showcase_inquiry', actions: [flowAction] };
    const ql: any = {
        executeAction: vi.fn(async () => ({ ran: 'script' })),
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
        : n === 'automation' ? service
        : null;
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (n: string) => resolve(n),
        context: { getService: resolve },
    };
    return new HttpDispatcher(kernel);
}

const CTX: any = {
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'user-1', systemPermissions: [] },
};

/** Trigger the same flow directly — door 1, the route a declared endpoint aliases. */
const viaTrigger = (d: HttpDispatcher) => d.handleAutomation(`/${FLOW}/trigger`, 'POST', {}, CTX);

/** Invoke the same flow as an ACTION — door 2. */
const viaAction = (d: HttpDispatcher) => d.handleActions('/showcase_inquiry/purge', 'POST', {}, CTX);

describe('#9462 — all three doors read ONE table, so they cannot drift', () => {
    for (const [label, result, status, code] of [
        ['a disabled flow', DISABLED, 409, 'FLOW_DISABLED'],
        ['a flow with no start node', NO_START_NODE, 422, 'FLOW_NO_START_NODE'],
        ['a run that ran and failed', RAN_AND_FAILED, 400, 'FLOW_FAILED'],
    ] as Array<[string, AutomationResult, number, string]>) {
        it(`${label}: the declared endpoint, /actions and /automation/:name/trigger all answer ${String(status)}`, async () => {
            const { service } = automationServiceWith({ result });
            const dispatcher = dispatcherOver(service);

            const endpoint = await viaEndpoint(service);
            const trigger: any = await viaTrigger(dispatcher);
            const action: any = await viaAction(dispatcher);

            expect(endpoint.status).toBe(status);
            expect(trigger.response.status).toBe(status);
            expect(action.response.status).toBe(status);
            expect((endpoint.body as any).error.code).toBe(code);
            expect(trigger.response.body.error.code).toBe(code);
            expect(action.response.body.error.code).toBe(code);
        });
    }

    it('an unknown flow is 404 at all three doors, and none of them dispatches it', async () => {
        const { service, execute } = automationServiceWith({ flows: [] });
        const dispatcher = dispatcherOver(service);

        const endpoint = await viaEndpoint(service);
        const trigger: any = await viaTrigger(dispatcher);
        const action: any = await viaAction(dispatcher);

        expect(endpoint.status).toBe(404);
        expect(trigger.response.status).toBe(404);
        expect(action.response.status).toBe(404);
        expect(execute).not.toHaveBeenCalled();
    });

    it('a successful run is 200 at all three doors', async () => {
        const { service } = automationServiceWith({ result: { success: true, output: { purged: 1 } } });
        const dispatcher = dispatcherOver(service);

        const endpoint = await viaEndpoint(service);
        const trigger: any = await viaTrigger(dispatcher);
        const action: any = await viaAction(dispatcher);

        expect(endpoint.status).toBe(200);
        expect(trigger.response.status).toBe(200);
        expect(action.response.status).toBe(200);
    });

    it('the declared endpoint matches the TRIGGER door exactly on the unclassified residual', async () => {
        // Stated as a pin rather than left implicit: the residual is the one
        // outcome on which the three doors are not identical, and #5040 §4 is
        // what decides which pair must agree. `/actions` refusing it is its own
        // #3962 ruling and is asserted in `actions-flow-dispatch-status.test.ts`.
        const { service } = automationServiceWith({ result: { success: false, error: 'something odd' } });
        const dispatcher = dispatcherOver(service);

        const endpoint = await viaEndpoint(service);
        const trigger: any = await viaTrigger(dispatcher);

        expect(endpoint.status).toBe(200);
        expect(trigger.response.status).toBe(200);
    });
});
