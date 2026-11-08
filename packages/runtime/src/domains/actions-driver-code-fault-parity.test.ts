// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31317] A driver's own string code (`SQLITE_BUSY`) thrown inside an action
 * body answers at `/api/v1/actions` what `/api/v1/data` answers the same throw:
 * the door's 5xx fault, the driver's spelling and text off the wire.
 *
 * `/actions` used to answer it `400 VALIDATION_ERROR` with `declaredCode:
 * 'SQLITE_BUSY'`: a client refusal naming the backend. Its reader
 * (`actionsDoorAnswerOf`, `@objectstack/types`) now asks the `/data` door's own
 * classifier (`mapDataError`) whenever a status-less throw's code is not a
 * closed ADR-0112 code, and serves that door's fault when it reads one.
 *
 * Each §1 row asserts the literal `/actions` wire answer AND its equality with
 * `mapDataError` on a fresh copy of the same throw, so the two doors cannot
 * agree on something nobody wrote down. §2 holds the readings that stay.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
// The dispatcher's reach loads this lazily; pay its first load during collection.
import '@objectstack/metadata';
import { mapDataError } from '@objectstack/types';

import { HttpDispatcher } from '../http-dispatcher.js';
import { SandboxError } from '../sandbox/quickjs-runner.js';

const OBJECT = 'crm_invoice';

const scriptAction = {
    name: 'submit_signoff',
    objectName: OBJECT,
    type: 'script',
    body: { language: 'js', source: 'return 1;', capabilities: ['api.write'] },
};

/** A dispatcher whose action handler rejects with `thrown`. */
function makeDispatcher(thrown: unknown) {
    const objectDef = { name: OBJECT, actions: [scriptAction] };
    const ql: any = {
        executeAction: vi.fn(async () => { throw thrown; }),
        getSchema: (n: string) => (n === objectDef.name ? objectDef : undefined),
        registry: { getObject: (n: string) => (n === objectDef.name ? objectDef : undefined), getItem: () => undefined },
        find: vi.fn(async () => [{ id: 'inv_1', status: 'draft' }]),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const kernel: any = {
        context: {
            getService: (n: string) =>
                n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : null,
        },
    };
    return new HttpDispatcher(kernel);
}

/** The `/actions` door's response to an action body that threw `thrown`. */
async function actionsDoor(thrown: unknown): Promise<{ status: number; error: Record<string, unknown>; text: string }> {
    const res: any = await makeDispatcher(thrown).handleActions(
        `/${OBJECT}/submit_signoff/inv_1`,
        'POST',
        {},
        { request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } } as any,
    );
    return { status: res.response.status, error: res.response.body.error, text: JSON.stringify(res.response.body) };
}

/** The `/data` door's answer to the same throw: its classifier, `mapDataError`. */
function dataDoor(thrown: unknown): { status: number; code: unknown; message: unknown } {
    const door = mapDataError(thrown, OBJECT);
    return { status: door.status, code: door.body.code, message: door.body.error };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('[#31317] §1 a driver string code is the /data door\'s fault at /actions too', () => {
    const ROWS: ReadonlyArray<{ name: string; thrown: () => unknown; status: number; code: string; message: string; spelled: readonly string[] }> = [
        {
            name: 'SQLITE_BUSY with the driver\'s text: 500 DATABASE_ERROR, Internal data error',
            thrown: () => Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' }),
            status: 500, code: 'DATABASE_ERROR', message: 'Internal data error',
            spelled: ['SQLITE_BUSY', 'database is locked'],
        },
        {
            name: 'SQLITE_BUSY from the driver\'s own class (SqliteError): the same fault',
            thrown: () => Object.assign(new Error('SQLITE_BUSY: database is locked'), { name: 'SqliteError', code: 'SQLITE_BUSY' }),
            status: 500, code: 'DATABASE_ERROR', message: 'Internal data error',
            spelled: ['SQLITE_BUSY', 'database is locked'],
        },
        {
            name: 'a connection errno whose text names no store (ECONNREFUSED): 500 INTERNAL_ERROR',
            thrown: () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }),
            status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error',
            spelled: ['ECONNREFUSED', '127.0.0.1'],
        },
    ];

    for (const row of ROWS) {
        it(row.name, async () => {
            const log = vi.spyOn(console, 'error').mockImplementation(() => {});
            const actions = await actionsDoor(row.thrown());
            expect(actions.status).toBe(row.status);
            expect(actions.error.code).toBe(row.code);
            expect(actions.error.message).toBe(row.message);
            expect(actions.error).not.toHaveProperty('declaredCode');
            // One row per door: the same status and code, read off each door's own reader.
            const data = dataDoor(row.thrown());
            expect({ status: actions.status, code: actions.error.code, message: actions.error.message }).toEqual(data);
            for (const s of row.spelled) expect(actions.text).not.toContain(s);
            // The driver's words reach the operator instead.
            expect(log.mock.calls.some((c) => String(c[0]).includes(row.spelled[0]!))).toBe(true);
        });
    }
});

describe('[#31317] §2 CONTROLS — what the action body declared still answers as a refusal', () => {
    it('a closed ADR-0112 code with no status stays the 400 refusal with its own code', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const actions = await actionsDoor(Object.assign(new Error('Locked.'), { code: 'RECORD_LOCKED' }));
        expect(actions.status).toBe(400);
        expect(actions.error.code).toBe('RECORD_LOCKED');
        expect(actions.error.message).toBe('Locked.');
    });

    it('a bare Error stays the 400 VALIDATION_ERROR rejection with its own sentence', async () => {
        const actions = await actionsDoor(new Error('Lead is already converted'));
        expect(actions.status).toBe(400);
        expect(actions.error.code).toBe('VALIDATION_ERROR');
        expect(actions.error.message).toBe('Lead is already converted');
    });

    it('an unregistered code with a declared 4xx status keeps it, the spelling in declaredCode', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const actions = await actionsDoor(Object.assign(new Error('Over the limit.'), { code: 'CREDIT_LIMIT', status: 409 }));
        expect(actions.status).toBe(409);
        expect(actions.error.code).toBe('RESOURCE_CONFLICT');
        expect(actions.error.declaredCode).toBe('CREDIT_LIMIT');
    });

    it('a sandboxed body\'s unregistered code with no status stays the 400 refusal, as /data answers it', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const thrown = () => new SandboxError("action 'submit_signoff' threw: Over the limit.", 'Over the limit.', { code: 'CREDIT_LIMIT' });
        const actions = await actionsDoor(thrown());
        expect(actions.status).toBe(400);
        expect(actions.error.code).toBe('VALIDATION_ERROR');
        expect(actions.error.declaredCode).toBe('CREDIT_LIMIT');
        expect(actions.error.message).toBe('Over the limit.');
        expect(dataDoor(thrown()).status).toBe(400);
    });
});
