// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35928] `POST /automation/_record-starts` — the record-update preview the
 * stage-change confirms read (ruling record 7073655354).
 *
 * The door is answered to a caller who can READ the record: the record is read
 * as the caller through the `/data` door's own `get` (`callData`), so a record
 * the caller cannot read answers that read's `404 RECORD_NOT_FOUND` and the
 * engine is never asked. The engine is handed the record as read (`previous`),
 * the record with the proposed fields applied (`record`) and the caller as the
 * writer; its answer is served as `data.flows`, parsed through the declared
 * response schema. Pinned both ways: refusals never reach the engine, and an
 * admitted call hands the engine exactly the record it read.
 */

import { describe, it, expect, vi } from 'vitest';
import { recordNotFoundError } from '@objectstack/core';
import { RecordUpdateStartsResponseSchema } from '@objectstack/spec/api';
import { ROUTE_LEDGER } from '../route-ledger.js';
import type { RecordUpdateStartsInput } from '@objectstack/spec/contracts';

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/metadata';

import { HttpDispatcher } from '../http-dispatcher.js';

const STORED = { id: 'p1', status: 'active', name: 'Apollo' };
const CLOSURE = { name: 'project_closure', label: 'Project Closure', startsApproval: true };

function makeDispatcher(opts: { withPreview?: boolean; readable?: boolean; answersNoRecord?: boolean } = {}) {
    const listRecordUpdateStarts = vi.fn((input: RecordUpdateStartsInput) =>
        input.record.status === 'completed' ? [CLOSURE] : []);
    // The caller-scoped read the `/data` door makes. An id the caller cannot
    // read is refused as an id naming no row (the protocol's own error).
    const getData = vi.fn(async ({ object, id }: any) => {
        if (opts.readable === false || id !== STORED.id) throw recordNotFoundError(object, id);
        if (opts.answersNoRecord) return { object, id };
        return { object, id, record: { ...STORED } };
    });
    const automation: Record<string, unknown> = { handlerReady: true, execute: vi.fn(), getFlow: vi.fn() };
    if (opts.withPreview !== false) automation.listRecordUpdateStarts = listRecordUpdateStarts;
    // The object the record belongs to, as the registry declares it.
    const objectql = { registry: { getObject: (name: string) => (name === 'project' ? { name, fields: { name: {}, status: {}, budget: {} } } : undefined) } };
    const services: Record<string, unknown> = { automation, protocol: { getData }, objectql };
    const resolve = (name: string) => services[name];
    const kernel: any = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };
    return { dispatcher: new HttpDispatcher(kernel), listRecordUpdateStarts, getData };
}

const MEMBER = () => ({ request: {}, executionContext: { userId: 'u_member', tenantId: 'org_1', systemPermissions: [] } }) as any;
const ANONYMOUS = () => ({ request: {}, executionContext: {} }) as any;
const BODY = { object: 'project', recordId: 'p1', changes: { status: 'completed' } };

describe('POST /automation/_record-starts (#35928)', () => {
    it('answers a member who can read the record the flows the change would start', async () => {
        const { dispatcher, listRecordUpdateStarts, getData } = makeDispatcher();

        const result = await dispatcher.handleAutomation('/_record-starts', 'POST', BODY, MEMBER());

        expect(result.response?.status).toBe(200);
        const parsed = RecordUpdateStartsResponseSchema.parse(result.response?.body);
        expect(parsed.data.flows).toEqual([CLOSURE]);
        // The record was read as the caller, and the engine handed exactly that read.
        expect(getData).toHaveBeenCalledWith(expect.objectContaining({ object: 'project', id: 'p1', context: expect.objectContaining({ userId: 'u_member' }) }));
        expect(listRecordUpdateStarts).toHaveBeenCalledWith({
            object: 'project',
            previous: STORED,
            record: { ...STORED, status: 'completed' },
            userId: 'u_member',
            tenantId: 'org_1',
        });
    });

    it('answers an empty list for a change that starts nothing', async () => {
        const { dispatcher } = makeDispatcher();

        const result = await dispatcher.handleAutomation('/_record-starts', 'POST', { ...BODY, changes: { status: 'on_hold' } }, MEMBER());

        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data).toEqual({ flows: [] });
    });

    it('refuses a caller who cannot read the record 404 RECORD_NOT_FOUND, and never asks the engine', async () => {
        const { dispatcher, listRecordUpdateStarts } = makeDispatcher({ readable: false });

        const result = await dispatcher.handleAutomation('/_record-starts', 'POST', BODY, MEMBER());

        expect(result.response?.status).toBe(404);
        expect(result.response?.body?.error?.code).toBe('RECORD_NOT_FOUND');
        expect(listRecordUpdateStarts).not.toHaveBeenCalled();
    });

    it('answers an unreadable record and an absent one alike', async () => {
        const unreadable = await makeDispatcher({ readable: false }).dispatcher.handleAutomation('/_record-starts', 'POST', BODY, MEMBER());
        const absent = await makeDispatcher().dispatcher.handleAutomation('/_record-starts', 'POST', { ...BODY, recordId: 'p_absent' }, MEMBER());
        const shape = (r: any) => ({ status: r.response?.status, code: r.response?.body?.error?.code });
        expect(shape(unreadable)).toEqual(shape(absent));
    });

    it('refuses an anonymous caller 401 before any read', async () => {
        const { dispatcher, getData, listRecordUpdateStarts } = makeDispatcher();

        const result = await dispatcher.handleAutomation('/_record-starts', 'POST', BODY, ANONYMOUS());

        expect(result.response?.status).toBe(401);
        expect(getData).not.toHaveBeenCalled();
        expect(listRecordUpdateStarts).not.toHaveBeenCalled();
    });

    it('refuses a malformed body 400 VALIDATION_FAILED on the member, before any read', async () => {
        const { dispatcher, getData } = makeDispatcher();

        const missing = await dispatcher.handleAutomation('/_record-starts', 'POST', { object: 'project', recordId: 'p1' }, MEMBER());
        expect(missing.response?.status).toBe(400);
        expect(missing.response?.body?.error?.code).toBe('VALIDATION_FAILED');
        expect(JSON.stringify(missing.response?.body)).toContain('changes');

        const extra = await dispatcher.handleAutomation('/_record-starts', 'POST', { ...BODY, nodes: true }, MEMBER());
        expect(extra.response?.status).toBe(400);
        expect(extra.response?.body?.error?.code).toBe('VALIDATION_FAILED');
        expect(getData).not.toHaveBeenCalled();
    });

    it('refuses any query parameter 400 VALIDATION_ERROR, before any read', async () => {
        const { dispatcher, getData } = makeDispatcher();

        const result = await dispatcher.handleAutomation('/_record-starts', 'POST', BODY, MEMBER(), { debug: '1' });

        expect(result.response?.status).toBe(400);
        expect(result.response?.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(getData).not.toHaveBeenCalled();
    });

    it('answers 501 on an engine without the preview, never a guessed empty list', async () => {
        const { dispatcher } = makeDispatcher({ withPreview: false });

        const result = await dispatcher.handleAutomation('/_record-starts', 'POST', BODY, MEMBER());

        expect(result.response?.status).toBe(501);
    });

    it('is not read as a flow name: a GET of the literal is not this door', async () => {
        const { dispatcher, listRecordUpdateStarts } = makeDispatcher();

        await dispatcher.handleAutomation('/_record-starts', 'GET', undefined, MEMBER());

        expect(listRecordUpdateStarts).not.toHaveBeenCalled();
    });

    it('refuses a change key that is not a field 400 VALIDATION_FAILED on that key, and never asks the engine', async () => {
        const { dispatcher, listRecordUpdateStarts } = makeDispatcher();

        const undeclared = await dispatcher.handleAutomation('/_record-starts', 'POST', { ...BODY, changes: { status: 'completed', stage_typo: 'x' } }, MEMBER());
        expect(undeclared.response?.status).toBe(400);
        expect(undeclared.response?.body?.error?.code).toBe('VALIDATION_FAILED');
        expect(JSON.stringify(undeclared.response?.body)).toContain('changes.stage_typo');

        const offGrammar = await dispatcher.handleAutomation('/_record-starts', 'POST', { ...BODY, changes: { '__proto__.x': 1 } }, MEMBER());
        expect(offGrammar.response?.status).toBe(400);
        expect(offGrammar.response?.body?.error?.code).toBe('VALIDATION_FAILED');

        const inherited = await dispatcher.handleAutomation('/_record-starts', 'POST', { ...BODY, changes: { constructor: 1 } }, MEMBER());
        expect(inherited.response?.status).toBe(400);
        expect(inherited.response?.body?.error?.code).toBe('VALIDATION_FAILED');

        expect(listRecordUpdateStarts).not.toHaveBeenCalled();
        expect(({} as Record<string, unknown>).x).toBeUndefined();
    });

    it('refuses a change on an object the registry does not declare, and never asks the engine', async () => {
        const { dispatcher, listRecordUpdateStarts, getData } = makeDispatcher();
        getData.mockImplementationOnce(async ({ object, id }: any) => ({ object, id, record: { id } }));

        const result = await dispatcher.handleAutomation('/_record-starts', 'POST', { ...BODY, object: 'unregistered' }, MEMBER());

        expect(result.response?.status).toBe(400);
        expect(result.response?.body?.error?.code).toBe('VALIDATION_FAILED');
        expect(listRecordUpdateStarts).not.toHaveBeenCalled();
    });

    it('refuses a read that answers no record 404 RECORD_NOT_FOUND, never previewing an empty row', async () => {
        const { dispatcher, listRecordUpdateStarts } = makeDispatcher({ answersNoRecord: true });

        const result = await dispatcher.handleAutomation('/_record-starts', 'POST', BODY, MEMBER());

        expect(result.response?.status).toBe(404);
        expect(result.response?.body?.error?.code).toBe('RECORD_NOT_FOUND');
        expect(listRecordUpdateStarts).not.toHaveBeenCalled();
    });
});

describe('[#35928] the contract: the ledger row names the schemas this suite parses with', () => {
    it('the record-starts row is SDK surface and names RecordUpdateStartsRequestSchema / RecordUpdateStartsResponseSchema', () => {
        const row = ROUTE_LEDGER.find((e) => e.route === 'POST /automation/_record-starts');
        expect(row, 'the record-starts row must exist in ROUTE_LEDGER').toBeDefined();
        expect(row!.disposition).toBe('sdk');
        expect(row!.client).toBe('automation.listRecordUpdateStarts');
        expect(row!.requestSchema).toBe('RecordUpdateStartsRequestSchema');
        expect(row!.responseSchema).toBe('RecordUpdateStartsResponseSchema');
    });
});
