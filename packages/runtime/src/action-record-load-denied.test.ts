// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14143] A handler must be able to tell "the caller cannot read this row"
 * from "this action legitimately has no record".
 *
 * ## The defect
 *
 * Both action doors load the subject row in the CALLER's own scope, swallow the
 * failure, and then stamp `record.id = recordId` under the condition
 * `record && record.id == null && recordId`. A failed load leaves `record` as
 * `{}` — so `record.id` is exactly `null`, and the stamp condition and the
 * load-failure condition COINCIDE. The body that follows runs ELEVATED
 * (`isSystem: true`, settled design — #3914), so authorization has to be
 * re-established inside the handler, and the predicate an author reaches for
 * first —
 *
 *     if (!ctx.record?.id) return refuse();
 *
 * — was therefore ALWAYS false, including on a row the caller cannot read.
 *
 * ⚠️ The stamp is NOT the defect and is deliberately kept: a new-record /
 * record-less action legitimately depends on `recordId` being in place. That is
 * the regression these tests pin alongside the fix — every "denied" case below
 * asserts `ctx.record.id` is STILL there.
 *
 * ## What is pinned
 *
 *  1. **The predicate is real, on BOTH doors.** REST `/actions` and the MCP
 *     `run_action` bridge each emit `recordLoadDenied: true` when the
 *     caller-scope load did not deliver the row. A signal only one door sets
 *     would be an authorization guard silently inert on the other — the same
 *     defect, one door over.
 *  2. **The stamp survives.** `ctx.record.id` is present in every denied case,
 *     and an object-less action invoked with a `recordId` still gets it.
 *  3. **The flag is ABSENT, not `false`, when nothing was refused** — the
 *     `referentialFieldClear` marker convention on this seam. Every such
 *     absence assertion has a FIRING POSITIVE CONTROL in the same file, on the
 *     same rig: the identical expectation shape reports `true` for the
 *     unauthorized caller, so an absence here cannot be a rig that never
 *     populates the key.
 *  4. **The body face carries it.** An inline `body` is the surface an AI
 *     author writes most, and its sandbox `ctx` is a FIXED key set — a key the
 *     dispatcher sets but the sandbox never marshals would read as `undefined`
 *     inside every body, re-manufacturing the always-false guard. Pinned by
 *     running a real QuickJS body.
 *
 * ## The RLS double is faithful on the one point that matters
 *
 * `find` here honours `options.context.userId`: the row exists and is returned
 * to its owner, and is INVISIBLE to anyone else — which is exactly how row-level
 * security manifests to `callData('get', …)`, and why the real
 * `recordNotFoundError` (404 `RECORD_NOT_FOUND`) is what the dispatcher then
 * catches. The tests below use the REAL `callData`, so nothing about the
 * refused/absent collapse is mocked away: an unseen row and a nonexistent id
 * reach the catch as the same error, which is precisely why the fix is a
 * separate channel rather than an inspection of the caught error.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';
import {
    callData,
    invokeBusinessAction,
    loadActionSubjectRecord,
    actionRecordLoadSignal,
    GLOBAL_ACTION_OBJECT_KEY,
} from './action-execution.js';
import { actionBodyRunnerFactory } from './sandbox/body-runner.js';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';

const OWNER = 'usr_owner';
const STRANGER = 'usr_stranger';
const RECORD_ID = 'case_1';

const ACTION = {
    name: 'close_case',
    label: 'Close',
    objectName: 'crm_case',
    type: 'script',
    target: 'close_case',
    ai: { exposed: true, description: 'Close a case.' },
};
const OBJECT_DEF = { name: 'crm_case', actions: [ACTION] };

/** The acting principal, as `resolveExecutionContext` builds one. */
function ec(userId: string) {
    return { userId, tenantId: 'org_1', positions: [], permissions: [], systemPermissions: [] };
}

/**
 * An engine whose reads are ROW-SCOPED: `crm_case:case_1` is visible to its
 * owner and to nobody else. This is the whole point of the double — a stub that
 * returned the row to everyone would pass while the defect was live.
 */
function makeQl() {
    const executeAction = vi.fn(async (_object: string, _action: string, _ctx: any) => ({ ok: true }));
    const schemaOf = (n: string) => (n === OBJECT_DEF.name ? OBJECT_DEF : undefined);
    const ql: any = {
        executeAction,
        getSchema: schemaOf,
        registry: { getObject: schemaOf, getItem: () => undefined },
        find: vi.fn(async (object: string, options?: any) => {
            if (object !== OBJECT_DEF.name) return [];
            const caller = options?.context?.userId;
            return caller === OWNER
                ? [{ id: RECORD_ID, status: 'open', owner_id: OWNER }]
                : [];
        }),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    return ql;
}

/** REST — `POST /actions/crm_case/close_case/case_1`. Returns the handler ctx. */
async function dispatchRest(userId: string, ql: any, path = `/crm_case/close_case/${RECORD_ID}`) {
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        listObjects: vi.fn(async () => [OBJECT_DEF]),
        getObject: vi.fn(async (n: string) => (n === OBJECT_DEF.name ? OBJECT_DEF : undefined)),
    };
    const kernel: any = {
        context: {
            getService: (n: string) =>
                n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : null,
        },
    };
    const context: any = { request: {}, environmentId: 'platform', executionContext: ec(userId) };
    const res: any = await (new HttpDispatcher(kernel) as any).handleActions(path, 'POST', {}, context);
    return { response: res.response, actionCtx: ql.executeAction.mock.calls[0]?.[2] };
}

/**
 * MCP — `run_action`. Wired to the REAL `callData`, so the row-scoped read and
 * its 404 are the ones production runs, not a hand-thrown stand-in.
 */
async function dispatchMcp(userId: string, ql: any, input: Record<string, unknown> = { recordId: RECORD_ID }) {
    const deps: any = { resolveService: async () => undefined, getObjectQL: async () => ql };
    const requestContext: any = { request: {}, environmentId: 'platform' };
    const caller = ec(userId);
    await invokeBusinessAction(deps, requestContext, ACTION.name, input as any, {
        driver: undefined,
        envId: 'platform',
        ec: caller,
        getMeta: () => ({ listObjects: async () => [OBJECT_DEF] }),
        callData: (action, params, dataDriver, scopeId, execCtx) =>
            callData(deps, requestContext, action, params, dataDriver, scopeId, execCtx),
    });
    return { actionCtx: ql.executeAction.mock.calls[0]?.[2] };
}

describe('#14143 — REST /actions tells a handler its caller-scope load was refused', () => {
    it('a caller who CANNOT read the row reaches the handler with recordLoadDenied === true', async () => {
        const ql = makeQl();
        const { actionCtx } = await dispatchRest(STRANGER, ql);

        expect(actionCtx).toBeDefined();
        expect(actionCtx.recordLoadDenied).toBe(true);

        // ⛔ The stamp is NOT removed — a record-less action depends on it, and
        // this is the coincidence that made the natural guard useless: the id
        // is here whether or not the caller can see the row, which is why the
        // flag above (and not `record.id`) is the authorization predicate.
        expect(actionCtx.record.id).toBe(RECORD_ID);
        expect(Boolean(actionCtx.record?.id)).toBe(true);
        // …and nothing of the row itself leaked to a caller who cannot read it.
        expect(actionCtx.record.status).toBeUndefined();
        expect(actionCtx.record.owner_id).toBeUndefined();
    });

    it('the row OWNER reaches the handler with the real row and no flag at all', async () => {
        const ql = makeQl();
        const { actionCtx } = await dispatchRest(OWNER, ql);

        expect(actionCtx.record).toMatchObject({ id: RECORD_ID, status: 'open', owner_id: OWNER });
        // ABSENT, not `false` — read as `ctx.recordLoadDenied === true`. The
        // firing control for this zero is the case above: same rig, same
        // expectation shape, and it reports `true`.
        expect('recordLoadDenied' in actionCtx).toBe(false);
        expect(actionCtx.recordLoadDenied).toBeUndefined();
    });

    it('a new-record action (no recordId) is untouched — no load, no flag', async () => {
        const ql = makeQl();
        const { actionCtx } = await dispatchRest(STRANGER, ql, '/crm_case/close_case');

        expect(actionCtx.record).toEqual({});
        expect('recordLoadDenied' in actionCtx).toBe(false);
        // No caller-scope read was even attempted for the subject row.
        expect(ql.find.mock.calls.filter((c: any[]) => c[0] === OBJECT_DEF.name)).toHaveLength(0);
    });
});

describe('#14143 — MCP run_action emits the SAME signal as the REST door', () => {
    it('a caller who CANNOT read the row reaches the handler with recordLoadDenied === true', async () => {
        const ql = makeQl();
        const { actionCtx } = await dispatchMcp(STRANGER, ql);

        expect(actionCtx.recordLoadDenied).toBe(true);
        expect(actionCtx.record.id).toBe(RECORD_ID);   // stamp preserved
        expect(actionCtx.record.status).toBeUndefined();
    });

    it('the row OWNER reaches the handler with the real row and no flag at all', async () => {
        const ql = makeQl();
        const { actionCtx } = await dispatchMcp(OWNER, ql);

        expect(actionCtx.record).toMatchObject({ id: RECORD_ID, status: 'open' });
        expect('recordLoadDenied' in actionCtx).toBe(false);
    });

    it('a record-less invocation (no recordId) is untouched — no load, no flag', async () => {
        const ql = makeQl();
        const { actionCtx } = await dispatchMcp(STRANGER, ql, {});

        expect(actionCtx.record).toEqual({});
        expect('recordLoadDenied' in actionCtx).toBe(false);
    });
});

describe('#14143 — loadActionSubjectRecord, the ONE producer both doors call', () => {
    it('object-less action with a recordId: no load is attempted, and the stamp STILL lands', async () => {
        const getRecord = vi.fn(async () => ({ record: { id: 'other' } }));
        const out = await loadActionSubjectRecord(GLOBAL_ACTION_OBJECT_KEY, RECORD_ID, getRecord);

        expect(getRecord).not.toHaveBeenCalled();
        // ⛔ The prohibition this test exists for: a record-less action still
        // gets its `recordId`.
        expect(out.record).toEqual({ id: RECORD_ID });
        expect(out.recordLoadDenied).toBe(false);
        expect(actionRecordLoadSignal(out)).toEqual({});
    });

    it('a thrown load is denied, and the stamp still lands', async () => {
        const out = await loadActionSubjectRecord('crm_case', RECORD_ID, async () => {
            throw Object.assign(new Error('Record case_1 not found in crm_case'), {
                code: 'RECORD_NOT_FOUND', status: 404,
            });
        });

        expect(out.recordLoadDenied).toBe(true);
        expect(out.record).toEqual({ id: RECORD_ID });
        expect(actionRecordLoadSignal(out)).toEqual({ recordLoadDenied: true });
    });

    it('a RESOLVED load carrying no row is denied too — declining to throw is not a successful load', async () => {
        const out = await loadActionSubjectRecord('crm_case', RECORD_ID, async () => ({ record: undefined }));

        expect(out.recordLoadDenied).toBe(true);
        expect(out.record).toEqual({ id: RECORD_ID });
    });

    it('a delivered row is not denied and is passed through untouched', async () => {
        const row = { id: RECORD_ID, status: 'open' };
        const out = await loadActionSubjectRecord('crm_case', RECORD_ID, async () => ({ record: row }));

        expect(out.recordLoadDenied).toBe(false);
        expect(out.record).toEqual(row);
        expect(actionRecordLoadSignal(out)).toEqual({});
    });

    it('no recordId at all: no load, no flag, no stamp', async () => {
        const getRecord = vi.fn(async () => ({ record: { id: 'x' } }));
        const out = await loadActionSubjectRecord('crm_case', undefined, getRecord);

        expect(getRecord).not.toHaveBeenCalled();
        expect(out.record).toEqual({});
        expect(out.recordLoadDenied).toBe(false);
    });
});

describe('#14143 — the signal crosses into a sandboxed action body', () => {
    const runner = new QuickJSScriptRunner();
    const SOURCE =
        'return { denied: ctx.recordLoadDenied === true, ' +
        'guard: !(ctx.record && ctx.record.id), id: ctx.record && ctx.record.id };';

    function bodyFn() {
        const factory = actionBodyRunnerFactory(runner, { ql: makeQl(), appId: 'crm' });
        return factory({
            name: ACTION.name,
            object: OBJECT_DEF.name,
            type: 'script',
            body: { language: 'js', source: SOURCE, capabilities: [] },
        } as any);
    }

    it('a body sees recordLoadDenied === true — while the OLD guard is still false', async () => {
        const out: any = await bodyFn()!({
            record: { id: RECORD_ID },
            recordLoadDenied: true,
            params: {},
        });

        expect(out.denied).toBe(true);
        // The pre-fix predicate, measured inside the VM: still false, because
        // the stamp is still there. That is why a body needs the new key.
        expect(out.guard).toBe(false);
        expect(out.id).toBe(RECORD_ID);
    });

    it('a body sees NOTHING when the load was fine — firing control for the zero above', async () => {
        const out: any = await bodyFn()!({
            record: { id: RECORD_ID, status: 'open' },
            params: {},
        });

        expect(out.denied).toBe(false);
        expect(out.id).toBe(RECORD_ID);
    });
});
