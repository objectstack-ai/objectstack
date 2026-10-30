// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MCP `resume_run`, runtime half (#15705): the bridge member that continues a
 * paused screen run, and the admission it applies.
 *
 * The maintainer's ruling on #15705 asked for a resume verb that passes the
 * SAME authorization and caller-scope checks as `run_action`, with #16370's
 * record-scope refusal named as the rule it must not get around. This file
 * drives the real bridge (`buildMcpBridge`, through `HttpDispatcher`) against
 * a stateful automation double. The double keeps paused runs, their trigger
 * identity and their screen, as the real engine does, and records a side
 * effect when a run completes. So every pin reads what the bridge made the
 * engine do, not only what it answered.
 *
 * The double stands in for the engine's own resume rules (the screen field
 * contract, `resumeAuthority`, the claim). Those are pinned on the real engine
 * in `@objectstack/service-automation`. What is pinned here is the door:
 *
 *  (a) a screen flow started by `run_action` WITHOUT its inputs pauses, and
 *      `resumeRun` with the values completes it. The side effect lands once.
 *      A two-screen wizard is walked by resuming twice.
 *  (b) a caller who may not resume is refused BEFORE the engine is asked:
 *      another user's run, a record the caller can no longer read, a missing
 *      capability, an action that is not AI-exposed, a run no flow action
 *      could have started, a disabled action, and a confirmation-gated action
 *      without `confirm`. Each refusal is asserted as `code` + `status`, and
 *      the run is shown to be still parked afterwards.
 *  (c) an unknown `runId` is refused 404, with the SAME envelope as another
 *      user's run: the door does not tell the two apart.
 *  (d) the engine's own answers reach the caller with the code and status the
 *      REST resume door gives for the same engine result, compared door
 *      against door for every row of the shared table.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';

const OBJECT = 'crm_lead';

const SCREEN_1 = {
    nodeId: 'screen_1',
    title: 'Schedule Follow-up',
    fields: [
        { name: 'subject', label: 'Subject', type: 'text', required: true },
        { name: 'dueDate', label: 'Due date', type: 'date', required: false },
    ],
};
const SCREEN_2 = {
    nodeId: 'screen_2',
    title: 'Confirm',
    fields: [{ name: 'priority', label: 'Priority', type: 'text', required: true }],
};

/** The card's specimen: an AI-exposed flow action whose flow opens on a screen. */
const SCHEDULE = {
    name: 'schedule_followup',
    label: 'Schedule Follow-up',
    objectName: OBJECT,
    type: 'flow',
    target: 'schedule_followup',
    locations: ['record_header'],
    ai: { exposed: true, description: 'Schedule a follow-up task for this lead.' },
};
/** Two screens in a row, so a resume can pause again. */
const WIZARD = {
    name: 'followup_wizard',
    label: 'Follow-up Wizard',
    objectName: OBJECT,
    type: 'flow',
    target: 'followup_wizard',
    locations: ['record_header'],
    ai: { exposed: true, description: 'Walk through a two-step follow-up wizard.' },
};
/** Gated on a capability the default caller does not hold. */
const GATED = {
    name: 'escalate_lead',
    label: 'Escalate',
    objectName: OBJECT,
    type: 'flow',
    target: 'escalate_lead',
    requiredPermissions: ['crm.escalate'],
    ai: { exposed: true, description: 'Escalate this lead to a manager.' },
};
/** The author asked for a human's confirmation. */
const CONFIRMED = {
    name: 'close_lead',
    label: 'Close Lead',
    objectName: OBJECT,
    type: 'flow',
    target: 'close_lead',
    ai: { exposed: true, requiresConfirmation: true, description: 'Close this lead for good.' },
};
/** A console-only flow action: not exposed to AI. */
const CONSOLE_ONLY = {
    name: 'merge_lead',
    label: 'Merge',
    objectName: OBJECT,
    type: 'flow',
    target: 'merge_lead',
};

const FLOW_SCREENS: Record<string, unknown[]> = {
    schedule_followup: [SCREEN_1],
    followup_wizard: [SCREEN_1, SCREEN_2],
    escalate_lead: [SCREEN_1],
    close_lead: [SCREEN_1],
    merge_lead: [SCREEN_1],
    orphan_flow: [SCREEN_1],
    send_digest: [SCREEN_1],
};

interface Run {
    runId: string;
    flowName: string;
    status: 'paused' | 'completed';
    userId?: string;
    object?: string;
    recordId?: string;
    /** The screens still to answer; `null` for a pause on a non-screen node. */
    screens: unknown[] | null;
}

/**
 * The automation double. `execute` pauses on the flow's first screen, as the
 * real engine does for a caller that did not answer it. `resume` checks the
 * screen's required fields (refusing with the engine's `INVALID_SCREEN_INPUT`
 * and leaving the run parked), then moves to the next screen or completes and
 * records the task the flow would create.
 */
function makeEngine() {
    const runs = new Map<string, Run>();
    const tasks: Array<Record<string, unknown>> = [];
    let n = 0;
    const engine = {
        runs,
        tasks,
        getFlow: vi.fn(async (name: string) => (FLOW_SCREENS[name] ? { name } : null)),
        execute: vi.fn(async (flowName: string, ctx: any) => {
            const runId = `run_${++n}`;
            runs.set(runId, {
                runId,
                flowName,
                status: 'paused',
                userId: ctx?.userId,
                object: ctx?.object,
                recordId: ctx?.record?.id,
                screens: [...(FLOW_SCREENS[flowName] ?? [])],
            });
            return { success: true, status: 'paused', runId, durationMs: 1, screen: FLOW_SCREENS[flowName]?.[0] };
        }),
        getRun: vi.fn(async (runId: string) => {
            const run = runs.get(runId);
            if (!run) return null;
            return {
                id: run.runId,
                flowName: run.flowName,
                status: run.status,
                startedAt: '2026-09-24T00:00:00.000Z',
                trigger: { type: 'manual', userId: run.userId, object: run.object, recordId: run.recordId },
                steps: [],
            };
        }),
        getSuspendedScreen: vi.fn(async (runId: string) => {
            const run = runs.get(runId);
            return run?.status === 'paused' && run.screens ? (run.screens[0] as any) ?? null : null;
        }),
        resume: vi.fn(async (runId: string, signal: any): Promise<any> => {
            const run = runs.get(runId);
            if (!run || run.status !== 'paused') {
                return { success: false, code: 'RUN_NOT_FOUND', error: `No suspended run '${runId}'` };
            }
            const screen: any = run.screens?.[0];
            const values = signal?.variables ?? {};
            const missing = (screen?.fields ?? []).filter((f: any) => f.required && values[f.name] === undefined);
            if (missing.length > 0) {
                return {
                    success: false,
                    code: 'INVALID_SCREEN_INPUT',
                    error: `Invalid screen input: required field '${missing[0].name}' is missing`,
                };
            }
            run.screens = run.screens?.slice(1) ?? null;
            if (run.screens && run.screens.length > 0) {
                return { success: true, status: 'paused', runId, durationMs: 1, screen: run.screens[0] };
            }
            run.status = 'completed';
            tasks.push({ flow: run.flowName, lead: run.recordId, by: run.userId, values });
            return { success: true, status: 'completed', output: { taskCreated: true }, durationMs: 2 };
        }),
    };
    return engine;
}

type Engine = ReturnType<typeof makeEngine>;

/**
 * Lead rows with an owner; the data double answers a caller only its own rows (RLS).
 *
 * [#25139] `merged` adds a `protocol` whose merged listing (`getMetaItems`)
 * serves the object, and empties the metadata service's `listObjects()`, the
 * way an `environmentId` kernel holds no copy of a package's object; `'throws'`
 * makes that listing fail while the metadata service still lists the object.
 *
 * [#25297] `standalone` are the `action` items no object embeds: the merged
 * listing serves them, and the metadata service's `loadMany('action')` holds
 * them only where there is no merged listing. `'action-throws'` makes the
 * merged `action` listing alone fail, the object listing still served.
 */
function makeHarness(
    opts: {
        actions?: any[]; standalone?: any[]; engine?: Engine; merged?: 'listing' | 'throws' | 'action-throws';
        /** [#27681] The object the actions are declared on (a `sys_*` name for the system-object cases). */
        objectName?: string;
    } = {},
) {
    const engine = opts.engine ?? makeEngine();
    const leads: Array<{ id: string; owner: string; name: string }> = [
        { id: 'lead_1', owner: 'u1', name: 'Ada' },
        { id: 'lead_2', owner: 'u2', name: 'Grace' },
    ];
    let disabled = new Set<string>();
    const object = {
        name: opts.objectName ?? OBJECT,
        label: 'Lead',
        fields: {},
        actions: opts.actions ?? [SCHEDULE, WIZARD, GATED, CONFIRMED, CONSOLE_ONLY],
    };
    const ql: any = {
        executeAction: vi.fn(),
        registry: { getObject: () => object },
        // Row-level security, as the data plane applies it: a caller reads only
        // the leads it owns, and a row it cannot read is simply not there.
        find: vi.fn(async (_o: string, q: any) => {
            const caller = q?.context?.userId;
            return leads.filter((l) => l.owner === caller && (q?.where?.id === undefined || l.id === q.where.id));
        }),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        isActionEnabled: (name: string) => !disabled.has(name),
    };
    const metadata: any = {
        listObjects: vi.fn(async () => (opts.merged === 'listing' ? [] : [object])),
        getObject: vi.fn(async () => object),
        loadMany: vi.fn(async () => (opts.merged ? [] : opts.standalone ?? [])),
    };
    const services: Record<string, unknown> = { objectql: ql, data: ql, metadata, automation: engine };
    const protocol = {
        getMetaItems: vi.fn(async (request: { type: string }) => {
            if (opts.merged === 'throws') throw new Error('merged listing unavailable');
            if (request.type === 'action') {
                if (opts.merged === 'action-throws') throw new Error('merged action listing unavailable');
                return { type: request.type, items: opts.standalone ?? [] };
            }
            return { type: request.type, items: request.type === 'object' ? [object] : [] };
        }),
    };
    if (opts.merged) services.protocol = protocol;
    const resolve = (name: string) => services[name] ?? null;
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    const dispatcher = new HttpDispatcher(kernel);
    const ctxFor = (userId: string, systemPermissions: string[] = []): any => ({
        request: {},
        environmentId: 'platform',
        executionContext: { userId, systemPermissions },
    });
    return {
        engine,
        leads,
        metadata,
        protocol,
        dispatcher,
        ctxFor,
        disable: (name: string) => { disabled = new Set([...disabled, name]); },
        bridgeFor: (userId: string, systemPermissions: string[] = []) =>
            (dispatcher as any).buildMcpBridge(ctxFor(userId, systemPermissions)),
    };
}

/** What a refusal carries: the ADR-0112 fields the MCP tool layer renders. */
async function refusalOf(p: Promise<unknown>): Promise<{ code: unknown; status: unknown; message: string; details?: any }> {
    try {
        await p;
    } catch (err: any) {
        return { code: err?.code, status: err?.status, message: String(err?.message), details: err?.details };
    }
    throw new Error('expected the call to be refused, and it resolved');
}

/** Start the card's specimen through `run_action`, WITHOUT the screen's inputs. */
async function startPaused(h: ReturnType<typeof makeHarness>, action = SCHEDULE.name, userId = 'u1', extra: any = {}) {
    const started = await h.bridgeFor(userId, extra.systemPermissions).runAction(action, {
        recordId: extra.recordId ?? 'lead_1',
        ...(extra.confirm ? { confirm: true } : {}),
    });
    expect(started.result.status).toBe('paused');
    expect(started.result.screen).toBeDefined();
    return started.result.runId as string;
}

describe('MCP resumeRun — (a) a paused screen flow is completed', () => {
    it('run_action without the inputs pauses; resumeRun with the values completes it and the task lands once', async () => {
        const h = makeHarness();
        const runId = await startPaused(h);
        expect(h.engine.tasks).toHaveLength(0);

        const values = { subject: 'Call back', dueDate: '2026-10-01' };
        const resumed = await h.bridgeFor('u1').resumeRun(runId, { values });

        // run_action's envelope, with the engine's own answer inside it.
        expect(resumed).toEqual({
            ok: true,
            action: 'schedule_followup',
            objectName: OBJECT,
            recordId: 'lead_1',
            result: { success: true, status: 'completed', output: { taskCreated: true }, durationMs: 2 },
        });
        // The values reached the engine as the screen's variables, built one
        // field at a time: nothing else rides on the signal.
        expect(h.engine.resume).toHaveBeenCalledTimes(1);
        expect(h.engine.resume).toHaveBeenCalledWith(runId, { variables: values });
        // The side effect: the flow's task, for this lead, as this caller.
        expect(h.engine.tasks).toEqual([{ flow: 'schedule_followup', lead: 'lead_1', by: 'u1', values }]);
    });

    it('a two-screen wizard pauses again on its next screen, and a second resumeRun finishes it', async () => {
        const h = makeHarness();
        const runId = await startPaused(h, WIZARD.name);

        const first = await h.bridgeFor('u1').resumeRun(runId, { values: { subject: 'Step one' } });
        expect(first.result).toMatchObject({ status: 'paused', runId, screen: { nodeId: 'screen_2' } });
        expect(h.engine.tasks).toHaveLength(0);

        const second = await h.bridgeFor('u1').resumeRun(runId, { values: { priority: 'high' } });
        expect(second.result.status).toBe('completed');
        expect(h.engine.tasks).toHaveLength(1);
    });

    it('CONTROL — a submission missing a required field is the engine\'s 400, and the run stays parked', async () => {
        const h = makeHarness();
        const runId = await startPaused(h);

        const refused = await refusalOf(h.bridgeFor('u1').resumeRun(runId, { values: { dueDate: '2026-10-01' } }));
        // [#21724] The engine's own code. This pin used to name
        // `VALIDATION_ERROR`, the member the builder derived from the 400.
        expect(refused).toMatchObject({ code: 'INVALID_SCREEN_INPUT', status: 400 });
        expect(refused.message).toMatch(/required field 'subject'/);
        // Retry with the field: it completes.
        await h.bridgeFor('u1').resumeRun(runId, { values: { subject: 'Now complete' } });
        expect(h.engine.tasks).toHaveLength(1);
    });
});

describe('MCP resumeRun — (b) a caller who may not resume is refused before the engine is asked', () => {
    it('ANOTHER user\'s run: 404, even for a caller who can read the record — and the run stays parked', async () => {
        const h = makeHarness();
        const runId = await startPaused(h);
        // u2 can read lead_1 too, so only the ownership check is being tested.
        h.leads[0].owner = 'u2';
        const stranger = await refusalOf(h.bridgeFor('u2').resumeRun(runId, { values: { subject: 'hijack' } }));
        expect(stranger).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
        expect(h.engine.resume).not.toHaveBeenCalled();
        expect(h.engine.tasks).toHaveLength(0);

        // Nothing was consumed: the run's own starter can still finish it.
        h.leads[0].owner = 'u1';
        await h.bridgeFor('u1').resumeRun(runId, { values: { subject: 'mine' } });
        expect(h.engine.tasks).toEqual([expect.objectContaining({ by: 'u1' })]);
    });

    it('a record the caller can no longer read: RECORD_NOT_FOUND / 404, run_action\'s own refusal', async () => {
        const h = makeHarness();
        const runId = await startPaused(h);
        // The lead is reassigned after the run started; RLS now hides it from u1.
        h.leads[0].owner = 'u3';
        const refused = await refusalOf(h.bridgeFor('u1').resumeRun(runId, { values: { subject: 'x' } }));
        expect(refused).toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
        expect(h.engine.resume).not.toHaveBeenCalled();

        // The same answer run_action gives for that record, from the same caller.
        const viaRunAction = await refusalOf(h.bridgeFor('u1').runAction(SCHEDULE.name, { recordId: 'lead_1' }));
        expect(viaRunAction).toMatchObject({ code: refused.code, status: refused.status, message: refused.message });
    });

    it('a capability the caller does not hold: PERMISSION_DENIED / 403, with run_action\'s reason', async () => {
        const h = makeHarness();
        const runId = await startPaused(h, GATED.name, 'u1', { systemPermissions: ['crm.escalate'] });
        const refused = await refusalOf(h.bridgeFor('u1').resumeRun(runId, { values: { subject: 'x' } }));
        expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(refused.message).toMatch(/requires capability \[crm\.escalate\]/);
        expect(h.engine.resume).not.toHaveBeenCalled();

        // CONTROL — the same caller holding the capability resumes it.
        await h.bridgeFor('u1', ['crm.escalate']).resumeRun(runId, { values: { subject: 'x' } });
        expect(h.engine.tasks).toHaveLength(1);
    });

    it('a run whose only action is not exposed to AI: PERMISSION_DENIED / 403, even though it is the caller\'s own', async () => {
        const h = makeHarness();
        // Started from the console (the REST trigger door would do the same):
        // the caller's own run, on a flow only a console-only action targets.
        const started: any = await h.engine.execute('merge_lead', { userId: 'u1', object: OBJECT, record: { id: 'lead_1' } });
        const refused = await refusalOf(h.bridgeFor('u1').resumeRun(started.runId, { values: { subject: 'x' } }));
        expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(refused.message).toMatch(/is not exposed to AI/);
        expect(h.engine.resume).not.toHaveBeenCalled();
    });

    it('a run no flow action could have started: PERMISSION_DENIED / 403', async () => {
        const h = makeHarness();
        const started: any = await h.engine.execute('orphan_flow', { userId: 'u1', object: OBJECT, record: { id: 'lead_1' } });
        const refused = await refusalOf(h.bridgeFor('u1').resumeRun(started.runId, { values: { subject: 'x' } }));
        expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(refused.message).toMatch(/no flow action targets that flow/);
        expect(h.engine.resume).not.toHaveBeenCalled();
    });

    it('an action switched off since the run started: ACTION_DISABLED / 409', async () => {
        const h = makeHarness();
        const runId = await startPaused(h);
        h.disable(SCHEDULE.name);
        const refused = await refusalOf(h.bridgeFor('u1').resumeRun(runId, { values: { subject: 'x' } }));
        expect(refused).toMatchObject({ code: 'ACTION_DISABLED', status: 409 });
        expect(h.engine.resume).not.toHaveBeenCalled();
    });

    it('a confirmation-gated action without confirm: ACTION_CONFIRMATION_REQUIRED / 428; with it, the run completes', async () => {
        const h = makeHarness();
        const runId = await startPaused(h, CONFIRMED.name, 'u1', { confirm: true });
        const refused = await refusalOf(h.bridgeFor('u1').resumeRun(runId, { values: { subject: 'x' } }));
        expect(refused).toMatchObject({ code: 'ACTION_CONFIRMATION_REQUIRED', status: 428 });
        expect(refused.details).toEqual({ actionName: 'close_lead', objectName: OBJECT, confirmationMember: 'confirm' });
        expect(h.engine.resume).not.toHaveBeenCalled();

        await h.bridgeFor('u1').resumeRun(runId, { values: { subject: 'x' }, confirm: true });
        expect(h.engine.tasks).toHaveLength(1);
    });

    it('a run paused on something other than a screen: 409, and the engine is not asked', async () => {
        const h = makeHarness();
        const runId = await startPaused(h);
        h.engine.runs.get(runId)!.screens = null; // now waiting on, say, a timer `wait`
        const refused = await refusalOf(h.bridgeFor('u1').resumeRun(runId, {}));
        expect(refused).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
        expect(h.engine.resume).not.toHaveBeenCalled();
    });
});

describe('[#27681] MCP resumeRun — on a sys_* object, the same per-action gate as run_action', () => {
    const SYS_OBJECT = 'sys_probe_lead';

    it('a run of a flagged (`ai.exposed`) flow action resumes and completes', async () => {
        const h = makeHarness({ objectName: SYS_OBJECT, actions: [SCHEDULE, CONSOLE_ONLY] });
        const runId = await startPaused(h);
        const done = await h.bridgeFor('u1').resumeRun(runId, { values: { subject: 'Call back' } });
        expect(done).toMatchObject({ ok: true, action: SCHEDULE.name, objectName: SYS_OBJECT });
        expect(h.engine.resume).toHaveBeenCalledTimes(1);
    });

    it('a run of an UNFLAGGED one is refused with the system-object refusal (403), and the engine is not asked', async () => {
        const h = makeHarness({ objectName: SYS_OBJECT, actions: [SCHEDULE, CONSOLE_ONLY] });
        const started: any = await h.engine.execute('merge_lead', { userId: 'u1', object: SYS_OBJECT, record: { id: 'lead_1' } });
        const refused = await refusalOf(h.bridgeFor('u1').resumeRun(started.runId, { values: { subject: 'x' } }));
        expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(refused.message).toMatch(/is on a system object \('sys_probe_lead'\) and is not exposed via MCP/);
        expect(h.engine.resume).not.toHaveBeenCalled();
    });
});

describe('MCP resumeRun — (c) an unknown runId', () => {
    it('is refused 404, with exactly the envelope another user\'s run gets', async () => {
        const h = makeHarness();
        const runId = await startPaused(h);

        const unknown = await refusalOf(h.bridgeFor('u2').resumeRun('run_nope', { values: { subject: 'x' } }));
        const foreign = await refusalOf(h.bridgeFor('u2').resumeRun(runId, { values: { subject: 'x' } }));
        expect(unknown).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
        // The id is the only difference, so a caller cannot tell a run it did
        // not start from a run that does not exist.
        expect({ ...foreign, message: foreign.message.replace(runId, 'ID') })
            .toEqual({ ...unknown, message: unknown.message.replace('run_nope', 'ID') });

        // A FINISHED run of the caller's own answers the same way.
        await h.bridgeFor('u1').resumeRun(runId, { values: { subject: 'done' } });
        const finished = await refusalOf(h.bridgeFor('u1').resumeRun(runId, { values: { subject: 'again' } }));
        expect({ ...finished, message: finished.message.replace(runId, 'ID') })
            .toEqual({ ...unknown, message: unknown.message.replace('run_nope', 'ID') });
        expect(h.engine.resume).toHaveBeenCalledTimes(1);
    });

    it('an automation service that cannot say who started a run is refused 501, fail-closed', async () => {
        const engine = makeEngine();
        delete (engine as any).getRun;
        const h = makeHarness({ engine });
        const runId = await startPaused(h);
        const refused = await refusalOf(h.bridgeFor('u1').resumeRun(runId, { values: { subject: 'x' } }));
        expect(refused).toMatchObject({ code: 'NOT_IMPLEMENTED', status: 501 });
        expect(engine.resume).not.toHaveBeenCalled();
    });
});

describe('MCP resumeRun — (d) the engine\'s answers match the REST resume door, door against door', () => {
    // [#21724] The third column is the code BOTH doors must serve. Equality
    // alone held while both doors served the status-derived member
    // (`VALIDATION_ERROR` for the two 400s, `RESOURCE_NOT_FOUND` for the 404),
    // so each row now names the code as well.
    const ROWS: Array<[string, any, string]> = [
        ['PERMISSION_DENIED', { success: false, code: 'PERMISSION_DENIED', error: 'only its owning service may resume' }, 'PERMISSION_DENIED'],
        ['INVALID_SIGNAL', { success: false, code: 'INVALID_SIGNAL', error: 'reserved by the flow engine' }, 'INVALID_SIGNAL'],
        ['INVALID_SCREEN_INPUT', { success: false, code: 'INVALID_SCREEN_INPUT', error: 'Unknown screen field "nickname"' }, 'INVALID_SCREEN_INPUT'],
        ['RUN_NOT_FOUND', { success: false, code: 'RUN_NOT_FOUND', error: "Suspended node 'collect' no longer exists" }, 'RUN_NOT_FOUND'],
        ['STORE_UNAVAILABLE', { success: false, code: 'STORE_UNAVAILABLE' }, 'STORE_UNAVAILABLE'],
        ['RESUME_IN_PROGRESS', { success: false, code: 'RESUME_IN_PROGRESS', error: 'Run is already being resumed' }, 'RESUME_IN_PROGRESS'],
        ['FLOW_FAILED (stranded)', {
            success: false, error: 'tail blew up', status: 'stranded',
            errorMessage: 'Please contact support', summary: { nodes: [] },
        }, 'FLOW_FAILED'],
        ['FLOW_FAILED (plain)', { success: false, error: 'node blew up' }, 'FLOW_FAILED'],
    ];

    for (const [label, engineResult, code] of ROWS) {
        it(`${label}: same code, status, message and details on both doors`, async () => {
            const h = makeHarness();
            const runId = await startPaused(h);
            h.engine.resume.mockResolvedValue(engineResult);

            const mcp = await refusalOf(h.bridgeFor('u1').resumeRun(runId, { values: { subject: 'x' } }));
            const rest = await h.dispatcher.handleAutomation(
                `schedule_followup/runs/${runId}/resume`, 'POST', { inputs: { subject: 'x' } }, h.ctxFor('u1'),
            );
            expect(rest.response?.status).toBeGreaterThanOrEqual(400);
            expect(mcp.code).toBe(code);
            expect(mcp).toEqual({
                code: rest.response?.body?.error?.code,
                status: rest.response?.status,
                message: rest.response?.body?.error?.message,
                details: rest.response?.body?.error?.details,
            });
        });
    }
});

describe('MCP resumeRun — (e) the refusal a flow node met crosses the bridge as the REST door serves it (#24914)', () => {
    // Ruling B′ on #24914: the run's `innerRefusal` rides the FLOW_FAILED
    // details and its producer-marked `userMessage` the envelope's top level.
    // The bridge builds its error through the same `deps.error`, so both must
    // reach the thrown error exactly as the REST resume door answers them —
    // `details.innerRefusal` in `details`, `userMessage` as the error's own
    // `userMessage` field (the channel `declaredUserMessage` reads).
    const INNER = { code: 'UNIQUE_VIOLATION', message: "Duplicate record refused on 'crm_task'" };
    const USER_TEXT = 'A follow-up with this subject already exists.';

    it('innerRefusal and userMessage: same values on both doors, the message unchanged', async () => {
        const h = makeHarness();
        const runId = await startPaused(h);
        h.engine.resume.mockResolvedValue({
            success: false, status: 'stranded', error: "Node 'mk' failed: create_record(crm_task) failed: boom",
            innerRefusal: INNER, userMessage: USER_TEXT,
        });

        let thrown: any;
        try {
            await h.bridgeFor('u1').resumeRun(runId, { values: { subject: 'x' } });
        } catch (err) {
            thrown = err;
        }
        const rest = await h.dispatcher.handleAutomation(
            `schedule_followup/runs/${runId}/resume`, 'POST', { inputs: { subject: 'x' } }, h.ctxFor('u1'),
        );

        expect(thrown?.code).toBe('FLOW_FAILED');
        expect(thrown?.status).toBe(400);
        expect(rest.response?.status).toBe(400);
        expect(thrown?.details?.innerRefusal).toEqual(INNER);
        expect(thrown?.details?.innerRefusal).toEqual(rest.response?.body?.error?.details?.innerRefusal);
        expect(thrown?.userMessage).toBe(USER_TEXT);
        expect(thrown?.userMessage).toBe(rest.response?.body?.error?.userMessage);
        expect(thrown?.message).toBe("Node 'mk' failed: create_record(crm_task) failed: boom");
    });
});

describe('[#25139] MCP resumeRun — the flow action that admits the run is read from the listing list_objects serves', () => {
    const VALUES = { subject: 'Call back' };

    it('where the metadata service holds no copy of the object, run_action starts the flow and resumeRun completes it from the merged listing', async () => {
        const h = makeHarness({ merged: 'listing' });
        const runId = await startPaused(h);
        const resumed = await h.bridgeFor('u1').resumeRun(runId, { values: VALUES });

        expect(resumed).toMatchObject({ ok: true, action: SCHEDULE.name, objectName: OBJECT, recordId: 'lead_1' });
        expect(h.engine.tasks).toHaveLength(1);
        expect(h.protocol.getMetaItems).toHaveBeenCalledWith({ type: 'object' });
        expect(h.metadata.listObjects).not.toHaveBeenCalled();
    });

    it('list_actions lists the object\'s flow actions from the same listing', async () => {
        const h = makeHarness({ merged: 'listing' });
        const names = ((await h.bridgeFor('u1').listActions()) as any[]).map((a) => a.name).sort();

        // Exposed to AI and permitted: GATED needs a capability u1 lacks, CONSOLE_ONLY is not exposed.
        expect(names).toEqual([CONFIRMED.name, WIZARD.name, SCHEDULE.name].sort());
        expect(h.metadata.listObjects).not.toHaveBeenCalled();
    });

    it('a merged listing that throws fails list_actions, run_action and resumeRun with its error, and the metadata service is not asked', async () => {
        const h = makeHarness({ merged: 'throws' });
        const bridge = h.bridgeFor('u1');
        const started = await h.engine.execute(SCHEDULE.target, { userId: 'u1', object: OBJECT, record: { id: 'lead_1' } });

        await expect(bridge.listActions()).rejects.toThrow('merged listing unavailable');
        await expect(bridge.runAction(SCHEDULE.name, { recordId: 'lead_1' })).rejects.toThrow('merged listing unavailable');
        await expect(bridge.resumeRun(started.runId, { values: VALUES })).rejects.toThrow('merged listing unavailable');
        expect(h.metadata.listObjects).not.toHaveBeenCalled();
        expect(h.engine.resume).not.toHaveBeenCalled();
    });
});

describe('[#25297] MCP resumeRun — an object-less flow action is read from the merged action listing', () => {
    /** A flow action that names no object, as a package's top-level action ships it. */
    const DIGEST = {
        name: 'send_digest',
        label: 'Send digest',
        type: 'flow',
        target: 'send_digest',
        ai: { exposed: true, description: 'Send the daily digest; no record involved.' },
    };
    const VALUES = { subject: 'Daily digest' };

    it('where the metadata service\'s loaders hold none, run_action starts it and resumeRun completes it from the merged listing', async () => {
        const h = makeHarness({ merged: 'listing', standalone: [DIGEST] });
        const started = await h.bridgeFor('u1').runAction(DIGEST.name, {});
        expect(started.result.status).toBe('paused');
        const resumed = await h.bridgeFor('u1').resumeRun(started.result.runId, { values: VALUES });

        expect(resumed).toMatchObject({ ok: true, action: DIGEST.name });
        expect(h.engine.tasks).toHaveLength(1);
        expect(h.protocol.getMetaItems).toHaveBeenCalledWith({ type: 'action' });
        expect(h.metadata.loadMany).not.toHaveBeenCalled();
    });

    it('list_actions lists it from the same listing', async () => {
        const h = makeHarness({ merged: 'listing', standalone: [DIGEST] });
        const names = ((await h.bridgeFor('u1').listActions()) as any[]).map((a) => a.name);

        expect(names).toContain(DIGEST.name);
        expect(h.metadata.loadMany).not.toHaveBeenCalled();
    });

    it('a merged action listing that throws fails list_actions, run_action and resumeRun with its error, and the metadata service is not asked', async () => {
        const h = makeHarness({ merged: 'action-throws', standalone: [DIGEST] });
        const bridge = h.bridgeFor('u1');
        const started = await h.engine.execute(DIGEST.target, { userId: 'u1' });

        await expect(bridge.listActions()).rejects.toThrow('merged action listing unavailable');
        await expect(bridge.runAction(DIGEST.name, {})).rejects.toThrow('merged action listing unavailable');
        await expect(bridge.resumeRun(started.runId, { values: VALUES })).rejects.toThrow('merged action listing unavailable');
        expect(h.metadata.loadMany).not.toHaveBeenCalled();
        expect(h.engine.resume).not.toHaveBeenCalled();
    });
});
