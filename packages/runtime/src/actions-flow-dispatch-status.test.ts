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
import { resolveThrownHttpError } from '@objectstack/types';

import { HttpDispatcher } from './http-dispatcher.js';
import { dispatchFlowAction, isFlowActionRefusal } from './action-execution.js';

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

/**
 * #9585 — the payload BESIDE the status. After #9446 the two doors agreed on
 * `400 FLOW_FAILED` and diverged on exactly one thing left: the trigger door
 * shipped the flow author's `errorMessage` and the run `summary` in
 * `error.details`, and `/actions` shipped neither — its throw is served
 * through `resolveThrownHttpError`, whose closed `details` list (#8016 /
 * #9106) deliberately drops a thrown `.details`. Maintainer ruling
 * (2026-08-19, Option B): a typed refusal carrier (`FlowActionRefusal`,
 * `action-execution.ts`) that the `/actions` handler recognises AHEAD of its
 * generic catch, carrying exactly those two fields; the shared resolver stays
 * untouched.
 *
 * The pins here are door-AGAINST-door wherever the contract is agreement:
 * this card exists because the doors diverged, and a suite that only checked
 * the `/actions` side would sit green while they drifted apart again.
 */
describe("#9585 — the failed run's artefacts ride BOTH doors' 400 details", () => {
    const AUTHOR_MESSAGE = 'We could not create the opportunity — check the amount and try again.';
    const SUMMARY = {
        selected: 0, acted: 0, skipped: 0, unmeasured: 0,
        nodes: [{ nodeId: 'create_opportunity', nodeType: 'create_record', status: 'failure', runs: 1, failures: 1 }],
    } as AutomationResult['summary'];
    /** The ran-and-failed exit WITH the artefacts the flow's author declared. */
    const FAILED_WITH_ARTEFACTS: AutomationResult = {
        ...RAN_AND_FAILED,
        errorMessage: AUTHOR_MESSAGE,
        summary: SUMMARY,
    };

    it("/actions delivers the author's errorMessage and the run summary in its 400 details", async () => {
        const { dispatcher } = makeDispatcher({ result: FAILED_WITH_ARTEFACTS });

        const res: any = await viaAction(dispatcher);

        expect(res.response.status).toBe(400);
        expect(res.response.body.error.code).toBe('FLOW_FAILED');
        // The author's text is DELIVERED — the declared ≠ delivered gap this
        // card closes — and it is not folded into the message either: the raw
        // engine error stays the human-readable message, still naming the flow
        // (this door's wording, unchanged since #3962).
        expect(res.response.body.error.details.errorMessage).toBe(AUTHOR_MESSAGE);
        expect(res.response.body.error.message).toContain(FLOW);
        expect(res.response.body.error.message).toContain("Node 'create_opportunity' failed");
        expect(res.response.body.error.message).not.toContain(AUTHOR_MESSAGE);
        // WHICH node failed survives — the summary's whole job.
        expect(res.response.body.error.details.summary).toEqual(SUMMARY);
        // `code` is promoted out of `details` into the declared field by the
        // shared envelope builder, never duplicated (`error-envelope.ts`).
        expect(res.response.body.error.details.code).toBeUndefined();
    });

    it('one failed run, two doors, ONE details payload — the drift pin', async () => {
        const { dispatcher } = makeDispatcher({ result: FAILED_WITH_ARTEFACTS });

        const action: any = await viaAction(dispatcher);
        const trigger: any = await viaTrigger(dispatcher);

        // The #9446 half: same status, same code …
        expect(action.response.status).toBe(400);
        expect(trigger.response.status).toBe(400);
        expect(action.response.body.error.code).toBe('FLOW_FAILED');
        expect(trigger.response.body.error.code).toBe('FLOW_FAILED');
        // … and the #9585 half: the payload beside them, compared DOOR AGAINST
        // DOOR rather than against a literal, so a door that drops or renames
        // either field reddens here even if its own per-door pin is edited in
        // the same change. (The messages differ on purpose — this door names
        // the flow, the trigger door's URL already does — so the message is
        // deliberately NOT part of this equality.)
        expect(action.response.body.error.details.errorMessage)
            .toBe(trigger.response.body.error.details.errorMessage);
        expect(action.response.body.error.details.summary)
            .toEqual(trigger.response.body.error.details.summary);
        // Anchor the compared value once, so both doors shipping `undefined`
        // can never satisfy the equality above.
        expect(trigger.response.body.error.details.errorMessage).toBe(AUTHOR_MESSAGE);
    });

    it('a failed run WITHOUT artefacts invents none, at either door', async () => {
        // `errorMessage` is set only when the author wrote one; `summary` only
        // when the engine measured one. Neither door manufactures an empty in
        // their place — absent means absent, at both doors identically.
        const { dispatcher } = makeDispatcher({ result: RAN_AND_FAILED });

        const action: any = await viaAction(dispatcher);
        const trigger: any = await viaTrigger(dispatcher);

        for (const res of [action, trigger]) {
            expect(res.response.status).toBe(400);
            expect(res.response.body.error.code).toBe('FLOW_FAILED');
            expect(res.response.body.error.details?.errorMessage).toBeUndefined();
            expect(res.response.body.error.details?.summary).toBeUndefined();
        }
    });

    it('a never-dispatched refusal ships NO run artefacts at either door, even when the result carries them', async () => {
        // A refused dispatch has no run to report — no author failure text, no
        // node log. A producer that stamps the incidental fields anyway must
        // not have them served as run evidence: the artefacts ride the
        // ran-and-failed row ONLY, the same no-inventing rule the trigger door
        // has always stated on its 400 arm.
        const { dispatcher } = makeDispatcher({
            result: { ...DISABLED, errorMessage: AUTHOR_MESSAGE, summary: SUMMARY },
        });

        const action: any = await viaAction(dispatcher);
        const trigger: any = await viaTrigger(dispatcher);

        for (const res of [action, trigger]) {
            expect(res.response.status).toBe(409);
            expect(res.response.body.error.code).toBe('FLOW_DISABLED');
            expect(res.response.body.error.details?.errorMessage).toBeUndefined();
            expect(res.response.body.error.details?.summary).toBeUndefined();
        }
    });

    it("a door that does not recognise the carrier serves yesterday's exact answer — and the shared resolver stays closed", async () => {
        // The MCP `run_action` bridge shares `dispatchFlowAction` and has no
        // recognition branch — by the ruling's scope, not by accident (#9585
        // is bounded to the one door). Its safety property is that the carrier
        // stamps `status`, `code` and `message` exactly as the plain throw it
        // replaced, so `resolveThrownHttpError` answers the same
        // `400 FLOW_FAILED` with the same text and only the run details stay
        // behind: degradation to the PREVIOUS answer, never to a different
        // one. The `details: undefined` pin is the ruling's other boundary
        // made mechanical — the resolver's closed list (#8016 / #9106) does
        // not read a thrown payload, and a future widening that made it do so
        // would redden here, surfacing the contradiction instead of landing it
        // silently.
        const automation = {
            execute: vi.fn(async () => FAILED_WITH_ARTEFACTS),
            getFlow: vi.fn(async () => ({ name: FLOW })),
        };
        const deps: any = { resolveService: async () => automation };

        let thrown: unknown;
        try {
            await dispatchFlowAction(deps, {} as any, flowAction, {
                objectName: 'crm_lead', record: {}, params: {}, ec: {}, envId: 'platform',
            });
        } catch (e) {
            thrown = e;
        }

        expect(isFlowActionRefusal(thrown)).toBe(true);
        const resolved = resolveThrownHttpError(thrown);
        expect(resolved.status).toBe(400);
        expect(resolved.code).toBe('FLOW_FAILED');
        expect(resolved.message).toContain(FLOW);
        expect(resolved.message).toContain("Node 'create_opportunity' failed");
        expect(resolved.details).toBeUndefined();
    });

    it('recognition is the BRAND, not the field shape — a lookalike throw stays on the generic path', async () => {
        // A script handler cannot impersonate the flow door's channel by
        // throwing `{ status, code, runDetails }`: the guard reads the
        // carrier's own brand. The lookalike still gets the ordinary
        // status-honouring exit (`errorFromThrown`), which drops the
        // unrecognised payload — exactly what every other thrower gets.
        expect(isFlowActionRefusal({
            status: 400, code: 'FLOW_FAILED', message: 'fake',
            runDetails: { errorMessage: 'not yours' },
        })).toBe(false);
    });
});
