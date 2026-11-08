// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31319] ONE composition of the answer to a thrown value: the runtime
 * dispatcher's exit (`HttpDispatcher.errorFromThrown`, every dispatcher
 * domain's catch through `deps.errorFromThrown`) and the `/api/v1/actions`
 * door (`actionsDoorAnswerOf`'s declared-status and rejection arms) both build
 * their envelope from `thrownAnswerOf` (`@objectstack/types`).
 *
 * The tie: for each throw below, the dispatcher's exit at the fallback the
 * `/actions` door would read (500 for a throw that declared a status, 400 for
 * a rejection) answers the SAME response, status and body, as the door. A
 * door that composed its own copy and let one term drift (the engine
 * duplicate's wire code or context, the demoted `declaredCode`, the
 * `userMessage`, the leaky 5xx withhold, the structured `details`) reds the
 * row that carries that term. Each row also states the term it carries, so
 * the two cannot agree on something nobody wrote down.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
// The dispatcher's reach loads this lazily; pay its first load during collection.
import '@objectstack/metadata';
import { DuplicateRecordError } from '@objectstack/objectql';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';

import { HttpDispatcher } from './http-dispatcher.js';

const OBJECT = 'crm_invoice';

/** A dispatcher whose `submit_signoff` action handler rejects with `thrown`. */
function makeDispatcher(thrown: unknown) {
    const objectDef = {
        name: OBJECT,
        actions: [{ name: 'submit_signoff', objectName: OBJECT, type: 'script', body: { language: 'js', source: 'return 1;' } }],
    };
    const ql: any = {
        executeAction: vi.fn(async () => { throw thrown; }),
        getSchema: (n: string) => (n === objectDef.name ? objectDef : undefined),
        registry: { getObject: (n: string) => (n === objectDef.name ? objectDef : undefined), getItem: () => undefined },
        find: vi.fn(async () => [{ id: 'inv_1' }]),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const kernel: any = {
        context: { getService: (n: string) => (n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : null) },
    };
    return new HttpDispatcher(kernel);
}

/** The `/actions` door's response to an action body that threw `thrown`. */
async function actionsDoor(thrown: unknown): Promise<{ status: number; body: any }> {
    const res: any = await makeDispatcher(thrown).handleActions(
        `/${OBJECT}/submit_signoff/inv_1`,
        'POST',
        {},
        { request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } } as any,
    );
    return res.response;
}

/** The dispatcher's exit for the same throw, at `fallbackStatus`. */
function dispatcherExit(thrown: unknown, fallbackStatus: number): { status: number; body: any } {
    return (makeDispatcher(undefined) as any).errorFromThrown(thrown, fallbackStatus);
}

afterEach(() => {
    vi.restoreAllMocks();
});

const ROWS: ReadonlyArray<{ term: string; fallback: number; thrown: () => unknown; carries: (error: any) => void }> = [
    {
        term: 'the engine duplicate: the ruled wire code and the REST arm\'s context',
        fallback: 500,
        thrown: () => new DuplicateRecordError(OBJECT, new Error('driver refusal'), 'email'),
        carries: (error) => {
            expect(error.code).toBe('UNIQUE_VIOLATION');
            expect(error.details).toMatchObject({ object: OBJECT, field: 'email' });
        },
    },
    {
        term: 'a producer that merely speaks DUPLICATE_RECORD keeps its own code',
        fallback: 500,
        thrown: () => Object.assign(new Error('That address is already on file'), { code: 'DUPLICATE_RECORD', status: 409 }),
        carries: (error) => expect(error.code).toBe('DUPLICATE_RECORD'),
    },
    {
        term: 'an unregistered code with a declared status: the closed code, the spelling demoted',
        fallback: 500,
        thrown: () => Object.assign(new Error('No leave days left.'), { code: 'LEAVE_EXHAUSTED', status: 409 }),
        carries: (error) => {
            expect(error.code).toBe('RESOURCE_CONFLICT');
            expect(error.declaredCode).toBe('LEAVE_EXHAUSTED');
        },
    },
    {
        term: 'a declared 5xx with leaky prose: the sentence withheld',
        fallback: 500,
        thrown: () => Object.assign(new Error('SQLITE_ERROR: no such table: crm_invoice_x'), { status: 503 }),
        carries: (error) => expect(error.message).toBe(INTERNAL_ERROR_MESSAGE),
    },
    {
        term: 'a declared userMessage rides beside the code',
        fallback: 500,
        thrown: () => Object.assign(new Error('Locked by finance.'), { code: 'RECORD_LOCKED', status: 409, userMessage: 'Ask finance to unlock it.' }),
        carries: (error) => {
            expect(error.code).toBe('RECORD_LOCKED');
            expect(error.userMessage).toBe('Ask finance to unlock it.');
        },
    },
    {
        term: 'a rejection with structured issues: VALIDATION_ERROR, issues in details',
        fallback: 400,
        thrown: () => Object.assign(new Error('Spec invalid.'), { issues: [{ path: ['name'], message: 'Required', code: 'invalid_type' }] }),
        carries: (error) => {
            expect(error.code).toBe('VALIDATION_ERROR');
            expect(error.details.issues).toHaveLength(1);
        },
    },
    {
        term: 'a record ValidationError: VALIDATION_FAILED, fields in details',
        fallback: 400,
        thrown: () => Object.assign(new Error('Validation failed'), { name: 'ValidationError', fields: [{ field: 'amount', message: 'Must be positive' }] }),
        carries: (error) => {
            expect(error.code).toBe('VALIDATION_FAILED');
            expect(error.details.fields).toEqual([{ field: 'amount', message: 'Must be positive' }]);
        },
    },
];

describe('[#31319] the dispatcher exit and the /actions door answer a throw through one composition', () => {
    for (const row of ROWS) {
        it(row.term, async () => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            const door = await actionsDoor(row.thrown());
            const exit = dispatcherExit(row.thrown(), row.fallback);
            expect(exit).toEqual({ status: door.status, body: door.body });
            row.carries(exit.body.error);
        });
    }
});
