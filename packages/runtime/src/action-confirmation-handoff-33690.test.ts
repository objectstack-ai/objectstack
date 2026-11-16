// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33690] The MCP `run_action` and `resume_run` doors under the amended
 * confirmation contract (`AI_ACTION_CONFIRMATION_CAPABILITY`,
 * `@objectstack/spec/contracts`; ADR-0011, the note on confirmation).
 *
 * On an action whose author declared `ai.requiresConfirmation: true`, the
 * caller's own `confirm: true` never runs it. The call is handed to the
 * host's pending-confirmation service (`IActionConfirmationService`,
 * registered under `ACTION_CONFIRMATION_SERVICE`) and answered
 * `status: 'pending_confirmation'` with the service's pending id; with no
 * service registered it is refused `428 ACTION_CONFIRMATION_REQUIRED`,
 * `details.reason: 'no_confirmation_service'`. An AI service account keeps its
 * ADR-0151 D3 rule 3 refusal (`reason: 'service_account'`), and is never
 * handed off.
 *
 * The real bridge (`buildMcpBridge`, through `HttpDispatcher`) is driven
 * against a kernel double, so every pin reads what the door made the engine
 * and the service double do, not only what it answered. The acceptance is
 * the card's: the same request sent N times executes 0 times, and every
 * attempt is held with a pending id.
 *
 * [#34209] The MCP tools no longer forward a `confirm` member: `run_action`
 * and `resume_run` REFUSE a call that carries it at their closed input
 * (maintainer ruling 6909355256), pinned in `@objectstack/mcp`'s
 * `mcp-action-confirmation-handoff-33690.test.ts`, which this package does not
 * depend on. So the primary pins here send the request the tool now forwards,
 * with no member. The bridge's input type still admits the member, and the
 * loops marked "below the tool" keep sending it: a bridge caller that is not
 * the tool still gets nothing for it (defense in depth).
 */

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/metadata';
import { describe, it, expect, vi } from 'vitest';

import { ACTION_CONFIRMATION_SERVICE, AI_ACTION_CONFIRMATION_MEMBER } from '@objectstack/spec/contracts';

import { HttpDispatcher } from './http-dispatcher.js';
import { actionConfirmationElicitSubject, actionConfirmationRefusal } from './action-execution.js';
import { dispatchAction } from './action-dispatch.js';

const OBJECT = 'crm_lead';

/** Author-gated script action. */
const GATED = {
    name: 'archive_lead', label: 'Archive Lead', objectName: OBJECT, type: 'script', target: 'archive_lead_impl',
    params: [{ name: 'note', type: 'text' }],
    ai: { exposed: true, description: 'Archive a lead.', requiresConfirmation: true },
};
/** Author-gated flow action whose flow opens on a screen. */
const GATED_FLOW = {
    name: 'close_lead', label: 'Close Lead', objectName: OBJECT, type: 'flow', target: 'close_lead',
    ai: { exposed: true, description: 'Close this lead for good.', requiresConfirmation: true },
};
/** Author-gated declarative update. */
const GATED_UPDATE = {
    name: 'mark_lost', label: 'Mark Lost', objectName: OBJECT, operation: 'update', patch: { status: 'lost' },
    ai: { exposed: true, description: 'Mark a lead lost.', requiresConfirmation: true },
};
/** Ungated (and destructive-looking): the heuristic gates nothing. */
const PLAIN = {
    name: 'touch_lead', label: 'Touch Lead', objectName: OBJECT, type: 'script', target: 'touch_lead_impl', mode: 'delete',
    ai: { exposed: true, description: 'Touch a lead.' },
};

const SCREEN = { nodeId: 'screen_1', title: 'Reason', fields: [{ name: 'reason', label: 'Reason', type: 'text', required: true }] };

const PERSON = { userId: 'u1', systemPermissions: [] as string[] };
const DELEGATED = { userId: 'u1', principalKind: 'agent', onBehalfOf: { userId: 'u1', principalKind: 'human' }, systemPermissions: [] as string[] };
const ACCOUNT = { userId: 'bot_1', principalKind: 'agent', systemPermissions: [] as string[] };

/** The host's pending-confirmation service double: records every hand-off, runs nothing. */
function makeConfirmationService() {
    let n = 0;
    return { submit: vi.fn(async (_handOff: unknown, _ec: unknown) => ({ pendingId: `pa_${++n}` })) };
}

function makeHarness(opts: { service?: unknown } = {}) {
    const leads = [
        { id: 'lead_1', owner: 'u1', name: 'Ada', status: 'open' },
        { id: 'lead_2', owner: 'u2', name: 'Grace', status: 'open' },
    ];
    const runs = new Map<string, { flowName: string; userId?: string; recordId?: string; status: string }>();
    let r = 0;
    const automation = {
        getFlow: vi.fn(async (name: string) => ({ name })),
        execute: vi.fn(async (flowName: string, ctx: any) => {
            const runId = `run_${++r}`;
            runs.set(runId, { flowName, userId: ctx?.userId, recordId: ctx?.record?.id, status: 'paused' });
            return { success: true, status: 'paused', runId, durationMs: 1, screen: SCREEN };
        }),
        getRun: vi.fn(async (runId: string) => {
            const run = runs.get(runId);
            return run ? {
                id: runId, flowName: run.flowName, status: run.status, startedAt: '2026-11-15T00:00:00.000Z',
                trigger: { type: 'manual', userId: run.userId, object: OBJECT, recordId: run.recordId }, steps: [],
            } : null;
        }),
        getSuspendedScreen: vi.fn(async (runId: string) => (runs.get(runId)?.status === 'paused' ? SCREEN : null)),
        resume: vi.fn(async (runId: string) => {
            const run = runs.get(runId)!;
            run.status = 'completed';
            return { success: true, status: 'completed', output: {}, durationMs: 1 };
        }),
    };
    // `nameField` names the record's title, which an elicitation carries (#33712).
    const object = { name: OBJECT, label: 'Lead', nameField: 'name', fields: { status: { type: 'text' }, name: { type: 'text' } }, actions: [GATED, GATED_FLOW, GATED_UPDATE, PLAIN] };
    const ql: any = {
        executeAction: vi.fn(async () => ({ ran: 'script' })),
        registry: { getObject: () => object, getItem: () => undefined },
        getSchema: () => object,
        listRegisteredActions: () => [
            { objectName: OBJECT, actionName: 'archive_lead_impl' },
            { objectName: OBJECT, actionName: 'touch_lead_impl' },
        ],
        // Row-level security: a caller reads only its own leads.
        find: vi.fn(async (_o: string, q: any) => {
            const caller = q?.context?.userId;
            return leads.filter((l) => l.owner === caller && (q?.where?.id === undefined || l.id === q.where.id));
        }),
        // No write verb: nothing here may write. A declarative update that
        // reached the write would throw on the missing `update`, and the pins
        // read that no write was attempted.
        update: undefined,
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => [object]),
        getObject: vi.fn(async () => object),
    };
    const services: Record<string, unknown> = {
        objectql: ql, data: ql, metadata, automation,
        ...(opts.service ? { [ACTION_CONFIRMATION_SERVICE]: opts.service } : {}),
    };
    const resolve = (name: string) => services[name] ?? null;
    const kernel: any = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };
    const dispatcher = new HttpDispatcher(kernel);
    const bridgeAs = (executionContext: Record<string, unknown>) =>
        (dispatcher as any).buildMcpBridge({ request: {}, environmentId: 'platform', executionContext });
    const viaRest = async (ec: unknown, action: string, recordId: string, body: unknown = {}) => {
        const res: any = await dispatcher.handleActions(`/${OBJECT}/${action}/${recordId}`, 'POST', body, {
            request: {}, environmentId: 'platform', executionContext: ec,
        } as any);
        return res.response as { status: number; body: any };
    };
    const viaHost = (ec: unknown, action: string, extra: Record<string, unknown> = {}) =>
        dispatchAction(kernel, { executionContext: ec as any, environmentId: 'platform', objectName: OBJECT, actionName: action, ...extra } as any);
    return { ql, automation, runs, leads, bridgeAs, viaRest, viaHost };
}

async function refusalOf(p: Promise<unknown>): Promise<{ code: unknown; status: unknown; message: string; details?: any }> {
    try {
        await p;
    } catch (err: any) {
        return { code: err?.code, status: err?.status, message: String(err?.message), details: err?.details };
    }
    throw new Error('expected the call to be refused, and it resolved');
}

const N = 5;

describe('[#33690] run_action: a declared-gated action is handed to the person, never run on the caller\'s confirm', () => {
    it(`the same request, sent ${N} times, executes 0 times and is held ${N} times with a pending id`, async () => {
        const service = makeConfirmationService();
        const h = makeHarness({ service });
        const bridge = h.bridgeAs(PERSON);

        const answers: any[] = [];
        for (let i = 0; i < N; i++) {
            answers.push(await bridge.runAction(GATED.name, {
                recordId: 'lead_1', params: { note: 'stale' },
            }));
        }

        expect(h.ql.executeAction).not.toHaveBeenCalled();
        expect(service.submit).toHaveBeenCalledTimes(N);
        expect(answers.map((a) => a.pendingId)).toEqual(Array.from({ length: N }, (_, i) => `pa_${i + 1}`));
        for (const answer of answers) {
            expect(answer).toMatchObject({ status: 'pending_confirmation', actionName: GATED.name, objectName: OBJECT });
            expect(typeof answer.message).toBe('string');
            expect(answer.message).toContain(answer.pendingId);
            // A success, not a refusal, and nothing of the run_action envelope.
            expect(answer).not.toHaveProperty('ok');
            expect(answer).not.toHaveProperty('result');
        }
        // The hand-off is the contract's shape: the call, for the person it runs as.
        const [handOff, ec] = service.submit.mock.calls[0] as [any, any];
        expect(handOff).toEqual({
            actionName: GATED.name, objectName: OBJECT, recordId: 'lead_1', params: { note: 'stale' }, door: 'mcp',
        });
        expect(ec.userId).toBe('u1');
    });

    it('below the tool: a bridge caller passing the member is held all the same: the member is not read', async () => {
        for (const extra of [{}, { [AI_ACTION_CONFIRMATION_MEMBER]: false }, { [AI_ACTION_CONFIRMATION_MEMBER]: true }]) {
            const service = makeConfirmationService();
            const h = makeHarness({ service });
            const answer = await h.bridgeAs(PERSON).runAction(GATED.name, { recordId: 'lead_1', ...extra });
            expect(answer, JSON.stringify(extra)).toMatchObject({ status: 'pending_confirmation', pendingId: 'pa_1' });
            expect(h.ql.executeAction).not.toHaveBeenCalled();
        }
    });

    it('a delegated agent (acting for a person) is handed off too, for that person', async () => {
        const service = makeConfirmationService();
        const h = makeHarness({ service });
        const answer = await h.bridgeAs(DELEGATED).runAction(GATED.name, { recordId: 'lead_1' });
        expect(answer).toMatchObject({ status: 'pending_confirmation' });
        expect(h.ql.executeAction).not.toHaveBeenCalled();
        expect((service.submit.mock.calls[0] as any[])[1].onBehalfOf.userId).toBe('u1');
    });

    it('a gated FLOW action starts no run, and a gated declarative update writes nothing', async () => {
        const service = makeConfirmationService();
        const h = makeHarness({ service });
        const bridge = h.bridgeAs(PERSON);

        const flow = await bridge.runAction(GATED_FLOW.name, { recordId: 'lead_1' });
        expect(flow).toMatchObject({ status: 'pending_confirmation', actionName: GATED_FLOW.name });
        expect(h.automation.execute).not.toHaveBeenCalled();

        const update = await bridge.runAction(GATED_UPDATE.name, { recordId: 'lead_1' });
        expect(update).toMatchObject({ status: 'pending_confirmation', actionName: GATED_UPDATE.name });
    });

    it('a record the caller cannot read is refused 404 before anyone is asked: no hand-off, nothing run', async () => {
        const service = makeConfirmationService();
        const h = makeHarness({ service });

        const refused = await refusalOf(h.bridgeAs(PERSON).runAction(GATED.name, { recordId: 'lead_2' }));

        expect({ code: refused.code, status: refused.status }).toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
        expect(service.submit).not.toHaveBeenCalled();
        expect(h.ql.executeAction).not.toHaveBeenCalled();
    });

    it('no service registered: refused 428 ACTION_CONFIRMATION_REQUIRED, reason no_confirmation_service (below the tool: with the member too)', async () => {
        for (const extra of [{}, { [AI_ACTION_CONFIRMATION_MEMBER]: true }]) {
            const h = makeHarness();
            const refused = await refusalOf(h.bridgeAs(PERSON).runAction(GATED.name, { recordId: 'lead_1', ...extra }));
            expect({ code: refused.code, status: refused.status }, JSON.stringify(extra)).toEqual({
                code: 'ACTION_CONFIRMATION_REQUIRED', status: 428,
            });
            expect(refused.details).toEqual({
                actionName: GATED.name, objectName: OBJECT, confirmationMember: AI_ACTION_CONFIRMATION_MEMBER,
                reason: 'no_confirmation_service',
            });
            // No retry is prescribed: no request this caller sends runs it here.
            expect(refused.message).not.toContain(`'${AI_ACTION_CONFIRMATION_MEMBER}': true`);
            expect(refused.message).toContain('in the app');
            expect(h.ql.executeAction).not.toHaveBeenCalled();
        }
    });

    it('a service that answers no pending id is a fault, never a hand-off: thrown, and nothing run', async () => {
        const service = { submit: vi.fn(async () => ({})) };
        const h = makeHarness({ service });
        const thrown: any = await h.bridgeAs(PERSON).runAction(GATED.name, { recordId: 'lead_1' }).catch((e: unknown) => e);
        expect(thrown).toBeInstanceOf(Error);
        expect(String(thrown.message)).toContain('pendingId');
        expect(h.ql.executeAction).not.toHaveBeenCalled();
    });

    it('[ADR-0151 D3 rule 3] an AI service account is refused, never handed off: reason service_account (below the tool: with the member too)', async () => {
        for (const extra of [{}, { [AI_ACTION_CONFIRMATION_MEMBER]: true }]) {
            const service = makeConfirmationService();
            const h = makeHarness({ service });
            const refused = await refusalOf(h.bridgeAs(ACCOUNT).runAction(GATED.name, { recordId: 'lead_1', ...extra }));
            expect({ code: refused.code, status: refused.status }).toEqual({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428 });
            expect(refused.details).toEqual({
                actionName: GATED.name, objectName: OBJECT, confirmationMember: AI_ACTION_CONFIRMATION_MEMBER,
                reason: 'service_account',
            });
            expect(refused.message).toContain('An AI service account does not confirm an action for itself');
            expect(service.submit).not.toHaveBeenCalled();
            expect(h.ql.executeAction).not.toHaveBeenCalled();
            // Refused before the subject load, as before: nothing was read.
            expect(h.ql.find).not.toHaveBeenCalled();
        }
    });

    it('CONTROL: an action that declares no confirmation runs at once, and nobody is asked', async () => {
        const service = makeConfirmationService();
        const h = makeHarness({ service });
        const answer = await h.bridgeAs(PERSON).runAction(PLAIN.name, { recordId: 'lead_1' });
        expect(answer).toMatchObject({ ok: true, action: PLAIN.name });
        expect(h.ql.executeAction).toHaveBeenCalledTimes(1);
        expect(service.submit).not.toHaveBeenCalled();
    });
});

describe('[#33690] resume_run: a resume of a gated action is handed off carrying its run', () => {
    async function pausedRun(h: ReturnType<typeof makeHarness>): Promise<string> {
        // Started as the run_action door would have before the hand-off existed:
        // the engine's run, owned by `u1`, paused on its screen.
        const started: any = await h.automation.execute(GATED_FLOW.target, { userId: 'u1', object: OBJECT, record: { id: 'lead_1' } });
        h.automation.execute.mockClear();
        return started.runId;
    }

    it(`a resume sent ${N} times resumes 0 times; each call is held with a pending id carrying its run and values`, async () => {
        const service = makeConfirmationService();
        const h = makeHarness({ service });
        const runId = await pausedRun(h);

        for (let i = 0; i < N; i++) {
            const answer = await h.bridgeAs(PERSON).resumeRun(runId, { values: { reason: 'dup' } });
            expect(answer).toMatchObject({ status: 'pending_confirmation', pendingId: `pa_${i + 1}`, actionName: GATED_FLOW.name, objectName: OBJECT });
        }

        expect(h.automation.resume).not.toHaveBeenCalled();
        expect(h.runs.get(runId)?.status).toBe('paused');
        expect(service.submit).toHaveBeenCalledTimes(N);
        // The parked run rides the hand-off, so approving it resumes THAT run.
        expect((service.submit.mock.calls[0] as any[])[0]).toEqual({
            actionName: GATED_FLOW.name, objectName: OBJECT, recordId: 'lead_1', params: {}, door: 'mcp',
            run: { runId, values: { reason: 'dup' } },
        });
    });

    it('no service registered: refused 428, reason no_confirmation_service, and the run stays paused', async () => {
        const h = makeHarness();
        const runId = await pausedRun(h);
        const refused = await refusalOf(h.bridgeAs(PERSON).resumeRun(runId, { values: { reason: 'x' } }));
        expect({ code: refused.code, status: refused.status }).toEqual({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428 });
        expect(refused.details).toMatchObject({ actionName: GATED_FLOW.name, objectName: OBJECT, reason: 'no_confirmation_service' });
        expect(h.automation.resume).not.toHaveBeenCalled();
        expect(h.runs.get(runId)?.status).toBe('paused');
    });

    it('[ADR-0151 D3 rule 3] an AI service account\'s resume is refused, reason service_account, never handed off', async () => {
        const service = makeConfirmationService();
        const h = makeHarness({ service });
        const started: any = await h.automation.execute(GATED_FLOW.target, { userId: 'bot_1', object: OBJECT, record: { id: 'lead_1' } });
        const refused = await refusalOf(h.bridgeAs(ACCOUNT).resumeRun(started.runId, { values: { reason: 'x' } }));
        expect({ code: refused.code, status: refused.status }).toEqual({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428 });
        expect(refused.details).toMatchObject({ reason: 'service_account' });
        expect(service.submit).not.toHaveBeenCalled();
        expect(h.automation.resume).not.toHaveBeenCalled();
    });
});

describe('[#33690] CONTROL: the doors outside the amendment keep the member gate', () => {
    it('REST /actions stays outside the gate for a person: the gated action runs, and nobody is asked', async () => {
        const service = makeConfirmationService();
        const h = makeHarness({ service });
        const res = await h.viaRest(PERSON, GATED.name, 'lead_1');
        expect(res.status).toBe(200);
        expect(h.ql.executeAction).toHaveBeenCalledTimes(1);
        expect(service.submit).not.toHaveBeenCalled();
    });

    it('a host door under the `ai` posture still reads the member: refused without it, run with it, never handed off', async () => {
        const service = makeConfirmationService();
        const h = makeHarness({ service });
        const refused: any = await h.viaHost(PERSON, GATED.name, { recordId: 'lead_1', posture: 'ai' });
        expect({ status: refused.status, code: refused.body?.error?.code }).toEqual({ status: 428, code: 'ACTION_CONFIRMATION_REQUIRED' });
        expect(h.ql.executeAction).not.toHaveBeenCalled();
        const ran: any = await h.viaHost(PERSON, GATED.name, { recordId: 'lead_1', posture: 'ai', confirm: true });
        expect(ran.status).toBe(200);
        expect(h.ql.executeAction).toHaveBeenCalledTimes(1);
        expect(service.submit).not.toHaveBeenCalled();
    });

    it('[ADR-0151 D3 rule 3] REST /actions refuses an AI service account, now naming reason service_account', async () => {
        const h = makeHarness({ service: makeConfirmationService() });
        const res = await h.viaRest(ACCOUNT, GATED.name, 'lead_1', { [AI_ACTION_CONFIRMATION_MEMBER]: true });
        expect({ status: res.status, code: res.body?.error?.code }).toEqual({ status: 428, code: 'ACTION_CONFIRMATION_REQUIRED' });
        expect(res.body?.error?.details).toMatchObject({ reason: 'service_account' });
        expect(h.ql.executeAction).not.toHaveBeenCalled();
    });

    it('the member gate a host door asks still admits a person\'s confirm: true and refuses without it (no reason)', () => {
        expect(actionConfirmationRefusal({} as any, GATED, { [AI_ACTION_CONFIRMATION_MEMBER]: true }, OBJECT, PERSON)).toBeUndefined();
        const refused = actionConfirmationRefusal({} as any, GATED, {}, OBJECT, PERSON);
        expect({ code: refused?.code, status: refused?.status }).toEqual({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428 });
        expect(refused?.details).not.toHaveProperty('reason');
    });
});

/**
 * [#33712] Step 1 of the amended contract: where the MCP door holds the
 * person's client (`door.elicitConfirmation`, passed by the tool only when the
 * client advertised `elicitation`), the person is asked there, after the same
 * gates the hand-off asks, and never for an AI service account. `accept` runs
 * the call once; `decline`, `cancel` and `timed_out` refuse it with their
 * contract reasons; nothing is handed off on any answer.
 */
type ElicitAnswer = 'accept' | 'decline' | 'cancel' | 'timed_out';
function makeElicitor(...answers: Array<ElicitAnswer | Error>) {
    const queue = [...answers];
    return vi.fn(async (_subject: Record<string, unknown>) => {
        const next = queue.shift() ?? 'cancel';
        if (next instanceof Error) throw next;
        return next;
    });
}

describe('[#33712] run_action: a client that can be elicited is asked in place, and its answer stands', () => {
    it('accept: the call dispatches exactly once, as any admitted call, and nothing is handed off', async () => {
        const service = makeConfirmationService();
        const h = makeHarness({ service });
        const elicitConfirmation = makeElicitor('accept');

        const answer = await h.bridgeAs(PERSON).runAction(
            GATED.name, { recordId: 'lead_1', params: { note: 'stale' } }, { elicitConfirmation },
        );

        expect(answer).toMatchObject({ ok: true, action: GATED.name, objectName: OBJECT, recordId: 'lead_1' });
        expect(h.ql.executeAction).toHaveBeenCalledTimes(1);
        expect(service.submit).not.toHaveBeenCalled();
        // The question names the action, the object and the record: its id, and
        // its title, which the caller-scope subject load read.
        expect(elicitConfirmation).toHaveBeenCalledTimes(1);
        expect(elicitConfirmation.mock.calls[0][0]).toEqual({
            actionName: GATED.name, actionLabel: GATED.label, objectName: OBJECT, recordId: 'lead_1', recordTitle: 'Ada',
        });
    });

    it('an accept covers that one call: the next call is asked again', async () => {
        const h = makeHarness({ service: makeConfirmationService() });
        const elicitConfirmation = makeElicitor('accept', 'decline');
        const bridge = h.bridgeAs(PERSON);
        await bridge.runAction(GATED.name, { recordId: 'lead_1' }, { elicitConfirmation });
        const refused = await refusalOf(bridge.runAction(GATED.name, { recordId: 'lead_1' }, { elicitConfirmation }));
        expect(refused.details).toMatchObject({ reason: 'declined' });
        expect(elicitConfirmation).toHaveBeenCalledTimes(2);
        expect(h.ql.executeAction).toHaveBeenCalledTimes(1);
    });

    for (const [answer, reason] of [
        ['decline', 'declined'],
        ['cancel', 'cancelled'],
        ['timed_out', 'timed_out'],
    ] as const) {
        it(`${answer}: refused 428 ACTION_CONFIRMATION_REQUIRED, reason ${reason}; nothing runs and nothing is handed off`, async () => {
            const service = makeConfirmationService();
            const h = makeHarness({ service });
            const refused = await refusalOf(h.bridgeAs(PERSON).runAction(
                GATED.name, { recordId: 'lead_1', [AI_ACTION_CONFIRMATION_MEMBER]: true }, { elicitConfirmation: makeElicitor(answer) },
            ));
            expect({ code: refused.code, status: refused.status }).toEqual({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428 });
            expect(refused.details).toEqual({
                actionName: GATED.name, objectName: OBJECT, confirmationMember: AI_ACTION_CONFIRMATION_MEMBER, reason,
            });
            expect(h.ql.executeAction).not.toHaveBeenCalled();
            expect(service.submit).not.toHaveBeenCalled();
        });
    }

    it('an elicitor that fails reads as a dismissal: reason cancelled, nothing runs', async () => {
        const h = makeHarness({ service: makeConfirmationService() });
        const refused = await refusalOf(h.bridgeAs(PERSON).runAction(
            GATED.name, { recordId: 'lead_1' }, { elicitConfirmation: makeElicitor(new Error('connection closed')) },
        ));
        expect(refused.details).toMatchObject({ reason: 'cancelled' });
        expect(h.ql.executeAction).not.toHaveBeenCalled();
    });

    it('[ADR-0151 D3 rule 3] an AI service account is refused before anyone is asked: reason service_account', async () => {
        const h = makeHarness({ service: makeConfirmationService() });
        const elicitConfirmation = makeElicitor('accept');
        const refused = await refusalOf(h.bridgeAs(ACCOUNT).runAction(GATED.name, { recordId: 'lead_1' }, { elicitConfirmation }));
        expect(refused.details).toMatchObject({ reason: 'service_account' });
        expect(elicitConfirmation).not.toHaveBeenCalled();
        expect(h.ql.executeAction).not.toHaveBeenCalled();
    });

    it('a record the caller cannot read is refused 404 before anyone is asked', async () => {
        const h = makeHarness({ service: makeConfirmationService() });
        const elicitConfirmation = makeElicitor('accept');
        const refused = await refusalOf(h.bridgeAs(PERSON).runAction(GATED.name, { recordId: 'lead_2' }, { elicitConfirmation }));
        expect({ code: refused.code, status: refused.status }).toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
        expect(elicitConfirmation).not.toHaveBeenCalled();
        expect(h.ql.executeAction).not.toHaveBeenCalled();
    });

    it('CONTROL: an action that declares no confirmation runs at once, and nobody is asked', async () => {
        const h = makeHarness({ service: makeConfirmationService() });
        const elicitConfirmation = makeElicitor('decline');
        const answer = await h.bridgeAs(PERSON).runAction(PLAIN.name, { recordId: 'lead_1' }, { elicitConfirmation });
        expect(answer).toMatchObject({ ok: true, action: PLAIN.name });
        expect(elicitConfirmation).not.toHaveBeenCalled();
    });
});

describe('[#33712] resume_run: a client that can be elicited is asked in place for the run\'s action', () => {
    async function pausedRun(h: ReturnType<typeof makeHarness>): Promise<string> {
        const started: any = await h.automation.execute(GATED_FLOW.target, { userId: 'u1', object: OBJECT, record: { id: 'lead_1' } });
        h.automation.execute.mockClear();
        return started.runId;
    }

    it('accept: the run resumes with the call\'s values, and nothing is handed off', async () => {
        const service = makeConfirmationService();
        const h = makeHarness({ service });
        const runId = await pausedRun(h);
        const elicitConfirmation = makeElicitor('accept');

        const answer = await h.bridgeAs(PERSON).resumeRun(runId, { values: { reason: 'done' } }, { elicitConfirmation });

        expect(answer).toMatchObject({ ok: true, action: GATED_FLOW.name, objectName: OBJECT });
        expect(h.automation.resume).toHaveBeenCalledTimes(1);
        expect(h.automation.resume.mock.calls[0]).toEqual([runId, { variables: { reason: 'done' } }]);
        expect(service.submit).not.toHaveBeenCalled();
        expect(elicitConfirmation.mock.calls[0][0]).toMatchObject({ actionName: GATED_FLOW.name, objectName: OBJECT, recordId: 'lead_1' });
    });

    it('decline: refused, reason declined, and the run stays paused', async () => {
        const service = makeConfirmationService();
        const h = makeHarness({ service });
        const runId = await pausedRun(h);
        const refused = await refusalOf(h.bridgeAs(PERSON).resumeRun(
            runId, { values: { reason: 'done' } }, { elicitConfirmation: makeElicitor('decline') },
        ));
        expect({ code: refused.code, status: refused.status }).toEqual({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428 });
        expect(refused.details).toMatchObject({ actionName: GATED_FLOW.name, objectName: OBJECT, reason: 'declined' });
        expect(h.automation.resume).not.toHaveBeenCalled();
        expect(h.runs.get(runId)?.status).toBe('paused');
        expect(service.submit).not.toHaveBeenCalled();
    });

    it('[ADR-0151 D3 rule 3] an AI service account\'s resume is refused before anyone is asked', async () => {
        const h = makeHarness({ service: makeConfirmationService() });
        const started: any = await h.automation.execute(GATED_FLOW.target, { userId: 'bot_1', object: OBJECT, record: { id: 'lead_1' } });
        const elicitConfirmation = makeElicitor('accept');
        const refused = await refusalOf(h.bridgeAs(ACCOUNT).resumeRun(started.runId, { values: { reason: 'x' } }, { elicitConfirmation }));
        expect(refused.details).toMatchObject({ reason: 'service_account' });
        expect(elicitConfirmation).not.toHaveBeenCalled();
        expect(h.automation.resume).not.toHaveBeenCalled();
    });
});

describe('[#33712] run_action: an elicited accept dispatches on a read taken after the answer', () => {
    it('a record the caller can no longer read when they answer is refused, and nothing runs', async () => {
        const h = makeHarness({ service: makeConfirmationService() });
        const elicitConfirmation = vi.fn(async () => {
            h.leads[0] = { ...h.leads[0], owner: 'u2' };
            return 'accept' as const;
        });
        const refused = await refusalOf(h.bridgeAs(PERSON).runAction(GATED.name, { recordId: 'lead_1' }, { elicitConfirmation }));
        expect({ code: refused.code, status: refused.status }).toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
        expect(elicitConfirmation).toHaveBeenCalledTimes(1);
        expect(h.ql.executeAction).not.toHaveBeenCalled();
    });

    it('a record that changed while the question was open reaches the action as it is now', async () => {
        const h = makeHarness({ service: makeConfirmationService() });
        const elicitConfirmation = vi.fn(async () => {
            h.leads[0] = { ...h.leads[0], name: 'Ada Lovelace' };
            return 'accept' as const;
        });
        await h.bridgeAs(PERSON).runAction(GATED.name, { recordId: 'lead_1' }, { elicitConfirmation });
        expect(h.ql.executeAction).toHaveBeenCalledTimes(1);
        const actionContext: any = (h.ql.executeAction.mock.calls[0] as any[])[2];
        expect(actionContext.record).toMatchObject({ id: 'lead_1', name: 'Ada Lovelace' });
    });
});

describe('[#33712] the question names the record by the title its read served', () => {
    const SCHEMA = {
        name: OBJECT, nameField: 'display_title',
        fields: {
            name: { name: 'name', type: 'text' },
            display_title: { name: 'display_title', type: 'formula', expression: { dialect: 'cel', source: 'record.name + " (lead)"' } },
        },
    };

    it('the served value under the title pointer, as served', () => {
        const subject = actionConfirmationElicitSubject(GATED, GATED.name, OBJECT, 'lead_1', SCHEMA, { id: 'lead_1', name: 'Ada', display_title: 'Served Title' });
        expect(subject.recordTitle).toBe('Served Title');
    });

    it('a row the read served without its title has none: the title is never re-derived from the row', () => {
        const subject = actionConfirmationElicitSubject(GATED, GATED.name, OBJECT, 'lead_1', SCHEMA, { id: 'lead_1', name: 'Ada' });
        expect(subject).not.toHaveProperty('recordTitle');
        expect(subject.recordId).toBe('lead_1');
    });
});
