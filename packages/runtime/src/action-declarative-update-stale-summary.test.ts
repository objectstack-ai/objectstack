// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28856] A declarative update action (`operation: 'update'`) whose write the
 * engine STORED but whose parent roll-up it could not recompute answers the
 * action it is, at both action doors — never the refusal, which told a caller
 * the action failed and invited it to run the action again.
 *
 * ## The defect, measured on `origin/main` (`3b920f6d`) before this file
 *
 * The engine reports that case as `ERR_SUMMARY_RECOMPUTE` ("the triggering
 * records WERE written", carrying `written`). The action's one write goes
 * through `callData('update')`, whose producers (the protocol's `updateData`,
 * and the ObjectQL fallback this rig runs) attach the WRITE's answer since
 * #28781 / #28782. `executeDeclarativeUpdateAction` never composed the
 * action's result from it, and neither door read the carrier:
 *
 * - REST `POST /actions/:object/:action` answered `500` with the refusal;
 * - the MCP bridge's `runAction` threw it, and the audit row said `failed`.
 *
 * ## What is pinned
 *
 * - REST answers `200` with the declarative result it answers when the
 *   recompute succeeds, and the audit row says `succeeded`;
 * - the MCP bridge's `runAction` throws the refusal carrying the action's
 *   `run_action` answer (`{ ok, action, objectName, recordId, result }`) for
 *   the tool to relay, and the audit row says `succeeded`;
 * - the update is applied exactly once at each door;
 * - a refusal before the write still answers exactly as before (ruling 5);
 * - the stale column is logged once, at `error`, by the REST door.
 *
 * The engine is a double whose `update` applies the write and then throws the
 * refusal as objectql's `SummaryRecomputeError` does; the real engine's throw
 * is pinned by #28781's REST suite.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { earnedAnswerOf } from '@objectstack/types';

import { HttpDispatcher } from './http-dispatcher.js';

const OBJECT = 'stl_case';
const RECORD = 'case_1';
const CLOSE = {
    name: 'close_case', label: 'Close', objectName: OBJECT, operation: 'update',
    patch: { status: 'closed' }, undoable: true, ai: { exposed: true, description: 'Close the case.' },
};

/** objectql's `SummaryRecomputeError`, as a write's caller reads it: by `code`, carrying `written`. */
function staleRefusal(written: unknown): Error {
    return Object.assign(new Error('Roll-up summary recompute failed after retries for 1 parent record(s); the triggering records WERE written.'), {
        code: 'ERR_SUMMARY_RECOMPUTE',
        written,
        failures: [{ childObject: OBJECT, parentObject: 'stl_account', parentId: 'a1', field: 'open_cases', error: new Error('sum over text') }],
    });
}

/**
 * The dispatcher over an engine whose `update` applies the write, then
 * reports the stale roll-up — or refuses before writing anything when the
 * caller is `u_reader`.
 */
function makeRig() {
    const events: any[] = [];
    const audit = { recordActionInvocation: vi.fn(async (e: any) => { events.push(e); }) };
    const row: Record<string, unknown> = { id: RECORD, status: 'open', owner: 'u_member' };
    const writes: string[] = [];

    const objectDef = {
        name: OBJECT,
        fields: { status: { type: 'text' }, owner: { type: 'text' } },
        actions: [CLOSE],
    };
    const schemaOf = (n: string) => (n === OBJECT ? objectDef : undefined);
    const ql: any = {
        executeAction: vi.fn(async (object: string, key: string) => {
            throw new Error(`Action '${key}' on object '${object}' not found`);
        }),
        getSchema: schemaOf,
        registry: { getObject: schemaOf, getItem: () => undefined },
        find: vi.fn(async (_object: string, q: any) => {
            const rows = q?.where?.id === RECORD ? [{ ...row }] : [];
            return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
        }),
        update: vi.fn(async (object: string, data: any, options?: any) => {
            assertEngineUpdateDispatch(data, options);
            if (options?.context?.userId === 'u_reader') {
                throw Object.assign(new Error(`You do not have permission to update ${object}`), { code: 'PERMISSION_DENIED', status: 403 });
            }
            Object.assign(row, data);
            writes.push(`update:${options?.where?.id}`);
            throw staleRefusal({ ...row });
        }),
        insert: vi.fn(),
        delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async (n: string) => schemaOf(n)),
    };
    const services: Record<string, unknown> = { objectql: ql, data: ql, metadata, audit };
    const resolve = (n: string) => services[n] ?? null;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
    const dispatcher = new HttpDispatcher(kernel);

    const ctx = (userId: string): any => ({
        request: { headers: { host: 'app.example.test' } },
        environmentId: 'platform',
        executionContext: { userId, tenantId: 'org_1', systemPermissions: [] },
    });

    /** REST `POST /actions/:object/:action/:id` — the console's click, the SDK's call. */
    const viaRest = async (userId = 'u_member') => {
        const res: any = await dispatcher.handleActions(`/${OBJECT}/${CLOSE.name}/${RECORD}`, 'POST', {}, ctx(userId));
        return res.response;
    };
    /** The real `/mcp` bridge's `runAction` — what the `run_action` tool calls. */
    const viaMcp = async (userId = 'u_member') => {
        const bridge = (dispatcher as any).buildMcpBridge(ctx(userId));
        try {
            return { value: await bridge.runAction(CLOSE.name, { objectName: OBJECT, recordId: RECORD }) };
        } catch (err: any) {
            return { err };
        }
    };
    return { events, row, writes, viaRest, viaMcp };
}

const DECLARATIVE_RESULT = {
    operation: 'update',
    object: OBJECT,
    id: RECORD,
    record: { id: RECORD, status: 'closed', owner: 'u_member' },
    undo: { type: 'update', objectName: OBJECT, recordId: RECORD, undoData: { status: 'open' }, redoData: { status: 'closed' } },
};

let errorLog: ReturnType<typeof vi.spyOn>;
beforeAll(() => { errorLog = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => { errorLog.mockRestore(); });

describe('[#28856] a declarative update action whose write landed under a failing roll-up answers the action it is', () => {
    it('REST action door: 200 with the declarative result, the update applied once, audit row succeeded', async () => {
        const rig = makeRig();
        const res = await rig.viaRest();
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual(DECLARATIVE_RESULT);
        expect(rig.writes).toEqual([`update:${RECORD}`]);
        expect(rig.row.status).toBe('closed');
        expect(rig.events).toHaveLength(1);
        expect(rig.events[0]).toMatchObject({ actionName: CLOSE.name, outcome: 'succeeded' });
        expect(rig.events[0]).not.toHaveProperty('status');
        expect(rig.events[0]).not.toHaveProperty('errorCode');
    });

    it('MCP bridge runAction: the refusal carries the run_action answer, the update applied once, audit row succeeded', async () => {
        const rig = makeRig();
        const out = await rig.viaMcp();
        expect(out.value).toBeUndefined();
        expect(earnedAnswerOf(out.err)).toEqual({ ok: true, action: CLOSE.name, objectName: OBJECT, recordId: RECORD, result: DECLARATIVE_RESULT });
        expect(rig.writes).toEqual([`update:${RECORD}`]);
        expect(rig.events).toHaveLength(1);
        expect(rig.events[0]).toMatchObject({ actionName: CLOSE.name, outcome: 'succeeded' });
        expect(rig.events[0]).not.toHaveProperty('errorCode');
    });

    it('a refusal before the write answers exactly as before at both doors, nothing written, audit row failed', async () => {
        const rig = makeRig();
        const res = await rig.viaRest('u_reader');
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('PERMISSION_DENIED');
        const out = await rig.viaMcp('u_reader');
        expect(out.err?.code).toBe('PERMISSION_DENIED');
        expect(earnedAnswerOf(out.err)).toBeUndefined();
        expect(rig.writes).toEqual([]);
        expect(rig.row.status).toBe('open');
        expect(rig.events.map((e) => e.outcome)).toEqual(['failed', 'failed']);
    });

    it('the stale column is logged once, at error', () => {
        const lines = errorLog.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes('could not be recomputed'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('"stl_account.open_cases"');
    });
});
