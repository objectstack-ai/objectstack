// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16370] The caller-scope load's verdict is CONSUMED at all three action
 * doors, not at one of them.
 *
 * ## The defect
 *
 * `loadActionSubjectRecord` computes one verdict (`recordLoadDenied`) for every
 * door. Exactly ONE door consumed it as a refusal — the declarative update
 * (#15079, contract point 3). The **flow** door and the **script/body** door
 * spread the same verdict into the context as a field and PROCEEDED, so MCP
 * `run_action` on a `type: 'flow'` action answered
 *
 *     { "ok": true, …, "result": { "success": true, "status": "paused",
 *                                  "runId": "run_94fcb26b-…" } }
 *
 * for a `recordId` the caller cannot read — and, identically, for an id that
 * names nothing at all — while `get_record` answered "not found" and
 * `update_record` answered "no access" for that same id in the same session. A
 * persisted run existed for a row the caller had never demonstrated read access
 * to, and nothing in the response told the agent the row had not been
 * delivered.
 *
 * #15168 carried the verdict INTO the flow context and said in as many words
 * that "whether the automation engine acts on it … is a separate reading". This
 * file is that reading: the platform refuses, rather than delegating the
 * refusal to an author-written decision node that #15168's own docs describe as
 * opt-in.
 *
 * ## What is pinned
 *
 *  1. **Both doors × both surfaces.** The flow door and the script/body door,
 *     on the REST `/actions` route and on the MCP `run_action` bridge. A rule
 *     implemented at one door is the failure class #14143 and #15168 each paid
 *     for on this exact seam, so every case below is asserted on all four.
 *  2. **⛔ No run, no body.** The refusal lands BEFORE `automation.execute`
 *     (no persisted run) and BEFORE `executeAction` (no trusted, RLS-bypassing
 *     body). `expect(...).not.toHaveBeenCalled()` is the half that makes the
 *     status assertion mean anything — "refused afterwards" would answer 404
 *     with the run already created.
 *  3. ⭐ **The door is NOT an existence oracle.** An unreadable row and an id
 *     that names nothing produce the SAME envelope, compared field by field
 *     with the id itself normalised out. This is the property that keeps the
 *     card p1 rather than p0, and it is the report's step 4 re-run.
 *  4. **Record-less and new-record actions are byte-for-byte unchanged.** An
 *     object-less action key never attempts a load, so its verdict is never
 *     `true` and it still receives the `recordId` stamp — the regression that
 *     #14143 deliberately kept and that this card must not take away.
 *  5. **A load that SUCCEEDS still runs.** The owner reaches the flow and the
 *     handler exactly as before; this is the firing control that stops every
 *     zero above from being a rig that dispatches nothing.
 *
 * ## The RLS double is faithful on the one point that matters
 *
 * `find` honours `options.context.userId`: the row exists and is returned to
 * its owner, and is INVISIBLE to anyone else — which is how row-level security
 * manifests to `callData('get', …)`, and why the real `recordNotFoundError`
 * (404 `RECORD_NOT_FOUND`) is what the door then catches. The MCP cases run the
 * REAL `callData`, so nothing about the refused/absent collapse is mocked away.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';
import {
    callData,
    invokeBusinessAction,
    refuseDeniedSubjectLoad,
    loadActionSubjectRecord,
    GLOBAL_ACTION_OBJECT_KEY,
} from './action-execution.js';

const OWNER = 'usr_owner';
const STRANGER = 'usr_stranger';
const OBJECT = 'crm_case';
const RECORD_ID = 'case_1';
/** The report's step 4, verbatim: an id that names nothing at all. */
const GHOST_ID = 'does-not-exist-0000';
const FLOW_NAME = 'crm_case_escalate_wizard';

const SCRIPT_ACTION = {
    name: 'close_case',
    label: 'Close',
    objectName: OBJECT,
    type: 'script',
    target: 'close_case',
    ai: { exposed: true, description: 'Close a case.' },
};
const FLOW_ACTION = {
    name: 'escalate_case',
    label: 'Escalate',
    objectName: OBJECT,
    type: 'flow',
    target: FLOW_NAME,
    ai: { exposed: true, description: 'Escalate a case.' },
};
const OBJECT_DEF = { name: OBJECT, actions: [SCRIPT_ACTION, FLOW_ACTION] };

/**
 * The record-LESS pair: standalone action items with no `objectName`, so both
 * resolve to the object-less `GLOBAL_ACTION_OBJECT_KEY` on both surfaces. These
 * are the declarations whose behaviour must not move by one byte.
 */
const GLOBAL_SCRIPT_ACTION = {
    name: 'log_call',
    label: 'Log call',
    type: 'script',
    target: 'log_call',
    ai: { exposed: true, description: 'Log a call.' },
};
const GLOBAL_FLOW_ACTION = {
    name: 'escalate_global',
    label: 'Escalate (global)',
    type: 'flow',
    target: FLOW_NAME,
    ai: { exposed: true, description: 'Escalate, globally.' },
};
const STANDALONE = [GLOBAL_SCRIPT_ACTION, GLOBAL_FLOW_ACTION];

/** The acting principal, as `resolveExecutionContext` builds one. */
function ec(userId: string) {
    return { userId, tenantId: 'org_1', positions: [], permissions: [], systemPermissions: [] };
}

/**
 * An engine whose reads are ROW-SCOPED: `crm_case:case_1` is visible to its
 * owner and to nobody else, and no id but `case_1` exists at all. A double that
 * returned the row to everyone would pass while the defect was live.
 */
function makeQl() {
    const executeAction = vi.fn(async (_object: string, _action: string, _ctx: any) => ({ ok: true }));
    const schemaOf = (n: string) => (n === OBJECT ? OBJECT_DEF : undefined);
    return {
        executeAction,
        getSchema: schemaOf,
        registry: { getObject: schemaOf, getItem: () => undefined },
        find: vi.fn(async (object: string, options?: any) => {
            if (object !== OBJECT) return [];
            const caller = options?.context?.userId;
            const wanted = options?.filters?.[0]?.[2] ?? options?.where?.id;
            if (wanted !== undefined && wanted !== RECORD_ID) return [];
            return caller === OWNER ? [{ id: RECORD_ID, status: 'open', owner_id: OWNER }] : [];
        }),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    } as any;
}

/** Records the context handed to the automation service — and whether it ran. */
function makeAutomation() {
    return {
        execute: vi.fn(async (_flow: string, _context?: any) => ({
            success: true, status: 'paused', runId: 'run_test', durationMs: 1,
        })),
        getFlow: vi.fn(async (name: string) => (name === FLOW_NAME ? { name } : null)),
    };
}

/** The metadata service both doors read: objects, plus the standalone pair. */
function makeMetadata() {
    const standaloneByName = new Map(STANDALONE.map((a) => [a.name, a]));
    const synth = (type: string, name: string) =>
        (type === 'action' ? (standaloneByName.get(name) ?? null) : null);
    return {
        load: vi.fn(async (type: string, name: string) => synth(type, name)),
        loadDiagnosed: vi.fn(async (type: string, name: string) => ({
            data: synth(type, name), degraded: false, errors: [],
        })),
        loadMany: vi.fn(async (type: string) => (type === 'action' ? STANDALONE : [])),
        listObjects: vi.fn(async () => [OBJECT_DEF]),
        getObject: vi.fn(async (n: string) => (n === OBJECT ? OBJECT_DEF : undefined)),
    };
}

/** REST — `POST /actions/<path>`, through the real dispatcher. */
async function rest(userId: string, path: string) {
    const ql = makeQl();
    const automation = makeAutomation();
    const metadata = makeMetadata();
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
    const context: any = { request: {}, environmentId: 'platform', executionContext: ec(userId) };
    const res: any = await (new HttpDispatcher(kernel) as any).handleActions(path, 'POST', {}, context);
    return {
        response: res.response,
        automation,
        ql,
        actionCtx: ql.executeAction.mock.calls[0]?.[2],
        flowCtx: automation.execute.mock.calls[0]?.[1],
    };
}

/**
 * MCP — `run_action`, wired to the REAL `callData`, so the row-scoped read and
 * its 404 are the ones production runs rather than a hand-thrown stand-in.
 */
async function mcp(userId: string, name: string, input: Record<string, unknown>) {
    const ql = makeQl();
    const automation = makeAutomation();
    const metadata = makeMetadata();
    const deps: any = {
        resolveService: async (_ctx: any, service: string) => (service === 'automation' ? automation : undefined),
        getObjectQL: async () => ql,
    };
    const requestContext: any = { request: {}, environmentId: 'platform' };
    const run = () => invokeBusinessAction(deps, requestContext, name, input as any, {
        driver: undefined,
        envId: 'platform',
        ec: ec(userId),
        getMeta: () => metadata,
        callData: (action, params, dataDriver, scopeId, execCtx) =>
            callData(deps, requestContext, action, params, dataDriver, scopeId, execCtx),
    });
    return { run, automation, ql };
}

/** The refusal envelope, with the id normalised out so two ids compare equal. */
function envelopeOf(status: number, code: unknown, message: unknown, id: string) {
    return { status, code, message: String(message).split(id).join('<ID>') };
}

// ───────────────────────────────────────────────────────────────────────────
// The FLOW door — the one the card measured
// ───────────────────────────────────────────────────────────────────────────

describe('[#16370] flow door — a denied caller-scope load is refused before the run exists', () => {
    it('REST: a caller who cannot read the row gets 404 RECORD_NOT_FOUND and NO run is created', async () => {
        const { response, automation } = await rest(STRANGER, `/${OBJECT}/escalate_case/${RECORD_ID}`);

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('RECORD_NOT_FOUND');
        expect(response.body.error.message).toContain(RECORD_ID);
        expect(response.body.error.message).toContain(OBJECT);
        // ⭐ The half that makes the status mean something: refusing AFTER the
        // dispatch would answer 404 with a persisted run already created.
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('MCP: the same caller is thrown at, never answered `ok: true`, and NO run is created', async () => {
        const { run, automation } = await mcp(STRANGER, FLOW_ACTION.name, { recordId: RECORD_ID });

        await expect(run()).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('MCP: an id that names NOTHING is refused identically — the report\'s step 4', async () => {
        // Driven as the row's OWNER on purpose: the only thing wrong here is
        // the id, so a door that leaked existence would have to answer this
        // differently from the case above.
        const { run, automation } = await mcp(OWNER, FLOW_ACTION.name, { recordId: GHOST_ID });

        await expect(run()).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('REST: an id that names NOTHING is refused identically', async () => {
        const { response, automation } = await rest(OWNER, `/${OBJECT}/escalate_case/${GHOST_ID}`);

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('RECORD_NOT_FOUND');
        expect(automation.execute).not.toHaveBeenCalled();
    });

    it('a load that SUCCEEDS still starts the run — the firing control for every zero above', async () => {
        const { response, automation, flowCtx } = await rest(OWNER, `/${OBJECT}/escalate_case/${RECORD_ID}`);

        expect(response.status).toBe(200);
        expect(automation.execute).toHaveBeenCalledTimes(1);
        expect(automation.execute.mock.calls[0][0]).toBe(FLOW_NAME);
        expect(flowCtx.record).toMatchObject({ id: RECORD_ID, status: 'open', owner_id: OWNER });
        // Unchanged by this card: the verdict key is ABSENT, not `false`.
        expect('recordLoadDenied' in flowCtx).toBe(false);

        const viaMcp = await mcp(OWNER, FLOW_ACTION.name, { recordId: RECORD_ID });
        const result: any = await viaMcp.run();
        expect(result.ok).toBe(true);
        expect(viaMcp.automation.execute).toHaveBeenCalledTimes(1);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// The SCRIPT/BODY door — the identical second hole, fixed in the same PR
// ───────────────────────────────────────────────────────────────────────────

describe('[#16370] script/body door — the same verdict, the same refusal', () => {
    it('REST: a caller who cannot read the row gets 404 and NO trusted body is entered', async () => {
        const { response, ql } = await rest(STRANGER, `/${OBJECT}/close_case/${RECORD_ID}`);

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('RECORD_NOT_FOUND');
        // ⛔ The body runs ELEVATED (`isSystem: true`, #3914) — RLS/FLS
        // bypassing. It must not be entered at all for a caller who has not
        // demonstrated read access to its subject row.
        expect(ql.executeAction).not.toHaveBeenCalled();
    });

    it('MCP: the same caller is thrown at and NO trusted body is entered', async () => {
        const { run, ql } = await mcp(STRANGER, SCRIPT_ACTION.name, { recordId: RECORD_ID });

        await expect(run()).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
        expect(ql.executeAction).not.toHaveBeenCalled();
    });

    it('an id that names NOTHING is refused identically, on both surfaces', async () => {
        const viaRest = await rest(OWNER, `/${OBJECT}/close_case/${GHOST_ID}`);
        expect(viaRest.response.status).toBe(404);
        expect(viaRest.response.body.error.code).toBe('RECORD_NOT_FOUND');
        expect(viaRest.ql.executeAction).not.toHaveBeenCalled();

        const viaMcp = await mcp(OWNER, SCRIPT_ACTION.name, { recordId: GHOST_ID });
        await expect(viaMcp.run()).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
        expect(viaMcp.ql.executeAction).not.toHaveBeenCalled();
    });

    it('a load that SUCCEEDS still reaches the handler with the real row', async () => {
        const { response, actionCtx } = await rest(OWNER, `/${OBJECT}/close_case/${RECORD_ID}`);

        expect(response.status).toBe(200);
        expect(actionCtx.record).toMatchObject({ id: RECORD_ID, status: 'open', owner_id: OWNER });
        expect('recordLoadDenied' in actionCtx).toBe(false);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// ⭐ Not an existence oracle — the property the p1 grading rests on
// ───────────────────────────────────────────────────────────────────────────

describe('[#16370] the refusal discloses nothing — an unreadable row and a ghost id are ONE answer', () => {
    it('flow door: the two refusals are the same envelope, field for field', async () => {
        const denied = await rest(STRANGER, `/${OBJECT}/escalate_case/${RECORD_ID}`);
        const ghost = await rest(OWNER, `/${OBJECT}/escalate_case/${GHOST_ID}`);

        expect(envelopeOf(ghost.response.status, ghost.response.body.error.code,
            ghost.response.body.error.message, GHOST_ID))
            .toEqual(envelopeOf(denied.response.status, denied.response.body.error.code,
                denied.response.body.error.message, RECORD_ID));
        // ⛔ And neither of them created a run.
        expect(denied.automation.execute).not.toHaveBeenCalled();
        expect(ghost.automation.execute).not.toHaveBeenCalled();
    });

    it('script door: the two refusals are the same envelope, field for field', async () => {
        const denied = await rest(STRANGER, `/${OBJECT}/close_case/${RECORD_ID}`);
        const ghost = await rest(OWNER, `/${OBJECT}/close_case/${GHOST_ID}`);

        expect(envelopeOf(ghost.response.status, ghost.response.body.error.code,
            ghost.response.body.error.message, GHOST_ID))
            .toEqual(envelopeOf(denied.response.status, denied.response.body.error.code,
                denied.response.body.error.message, RECORD_ID));
    });

    it('MCP: the two thrown refusals carry the same code and status', async () => {
        const deniedErr = await mcp(STRANGER, FLOW_ACTION.name, { recordId: RECORD_ID })
            .then(({ run }) => run().then(() => null, (e: any) => e));
        const ghostErr = await mcp(OWNER, FLOW_ACTION.name, { recordId: GHOST_ID })
            .then(({ run }) => run().then(() => null, (e: any) => e));

        // Read as a SET so a collapse to one answer reddens here whatever that
        // one answer is — including the collapse to "both succeeded".
        expect([
            deniedErr && { code: deniedErr.code, status: deniedErr.status },
            ghostErr && { code: ghostErr.code, status: ghostErr.status },
        ]).toEqual([
            { code: 'RECORD_NOT_FOUND', status: 404 },
            { code: 'RECORD_NOT_FOUND', status: 404 },
        ]);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// The boundary — record-less and new-record actions, byte for byte
// ───────────────────────────────────────────────────────────────────────────

describe('[#16370] record-less and new-record actions keep the stamp behaviour unchanged', () => {
    it('REST: an object-less SCRIPT action invoked WITH a recordId still dispatches, stamp intact', async () => {
        const { response, actionCtx, ql } = await rest(STRANGER, `/global/log_call/${RECORD_ID}`);

        expect(response.status).toBe(200);
        expect(ql.executeAction).toHaveBeenCalledTimes(1);
        // ⛔ The prohibition this case exists for: the stamp is still there and
        // the verdict was never `true`, because no load was attempted at all.
        expect(actionCtx.record).toEqual({ id: RECORD_ID });
        expect('recordLoadDenied' in actionCtx).toBe(false);
        expect(ql.find.mock.calls.filter((c: any[]) => c[0] === OBJECT)).toHaveLength(0);
    });

    it('REST: an object-less FLOW action invoked WITH a recordId still starts its run', async () => {
        const { response, automation, flowCtx } = await rest(STRANGER, `/global/escalate_global/${RECORD_ID}`);

        expect(response.status).toBe(200);
        expect(automation.execute).toHaveBeenCalledTimes(1);
        expect(flowCtx.record).toEqual({ id: RECORD_ID });
        expect('recordLoadDenied' in flowCtx).toBe(false);
        // An object-less key carries no `object` on the flow context.
        expect('object' in flowCtx).toBe(false);
    });

    it('MCP: an object-less action invoked WITH a recordId still dispatches, stamp intact', async () => {
        const { run, ql } = await mcp(STRANGER, GLOBAL_SCRIPT_ACTION.name, { recordId: RECORD_ID });

        const result: any = await run();
        expect(result.ok).toBe(true);
        expect(ql.executeAction).toHaveBeenCalledTimes(1);
        expect(ql.executeAction.mock.calls[0][2].record).toEqual({ id: RECORD_ID });
    });

    it('MCP: a new-record invocation (no recordId at all) is untouched — no load, no refusal', async () => {
        const { run, ql } = await mcp(STRANGER, SCRIPT_ACTION.name, {});

        const result: any = await run();
        expect(result.ok).toBe(true);
        expect(ql.executeAction.mock.calls[0][2].record).toEqual({});
        expect(ql.find.mock.calls.filter((c: any[]) => c[0] === OBJECT)).toHaveLength(0);
    });

    it('REST: a new-record invocation (no recordId in the path) is untouched', async () => {
        const { response, actionCtx, ql } = await rest(STRANGER, `/${OBJECT}/close_case`);

        expect(response.status).toBe(200);
        expect(actionCtx.record).toEqual({});
        expect('recordLoadDenied' in actionCtx).toBe(false);
        expect(ql.find.mock.calls.filter((c: any[]) => c[0] === OBJECT)).toHaveLength(0);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// The shared refusal itself — ONE implementation, three doors
// ───────────────────────────────────────────────────────────────────────────

describe('[#16370] refuseDeniedSubjectLoad — the rule, isolated from every door', () => {
    it('throws the shared not-found envelope when the verdict is `true`', () => {
        let thrown: any;
        try {
            refuseDeniedSubjectLoad(OBJECT, RECORD_ID, { record: { id: RECORD_ID }, recordLoadDenied: true });
        } catch (e) { thrown = e; }

        expect(thrown).toBeDefined();
        expect(thrown.code).toBe('RECORD_NOT_FOUND');
        expect(thrown.status).toBe(404);
        expect(thrown.message).toBe(`Record ${RECORD_ID} not found in ${OBJECT}`);
    });

    it('returns silently when the verdict is `false` — and the stamp is NOT the predicate', () => {
        // ⛔ `record.id` is truthy in BOTH cases; re-deriving the verdict from
        // it is the #14143 defect verbatim, so this pair is what says the
        // implementation reads the flag and nothing else.
        expect(() => refuseDeniedSubjectLoad(OBJECT, RECORD_ID,
            { record: { id: RECORD_ID }, recordLoadDenied: false })).not.toThrow();
        expect(() => refuseDeniedSubjectLoad(OBJECT, RECORD_ID,
            { record: { id: RECORD_ID }, recordLoadDenied: true })).toThrow();
    });

    it('is unreachable for the two carved-out shapes, straight off the producer', async () => {
        // Record-less: an object-less key never attempts a load…
        const recordLess = await loadActionSubjectRecord(GLOBAL_ACTION_OBJECT_KEY, RECORD_ID,
            async () => { throw new Error('must not be called'); });
        expect(recordLess.recordLoadDenied).toBe(false);
        expect(() => refuseDeniedSubjectLoad(GLOBAL_ACTION_OBJECT_KEY, RECORD_ID, recordLess)).not.toThrow();

        // …and neither does a new-record invocation. Both keep their stamp
        // behaviour because the verdict they carry can never be `true`.
        const newRecord = await loadActionSubjectRecord(OBJECT, undefined,
            async () => { throw new Error('must not be called'); });
        expect(newRecord.recordLoadDenied).toBe(false);
        expect(() => refuseDeniedSubjectLoad(OBJECT, undefined, newRecord)).not.toThrow();
    });
});
