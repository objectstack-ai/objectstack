// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `client.actions` — the SDK path to server-registered action handlers
 * (`POST /api/v1/actions/...`), closing the largest #3563 gap: before this
 * surface, the whole `/actions` domain was unreachable from the SDK.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackClient } from './index';

function createMockClient(body: any, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        json: async () => body,
        headers: new Headers()
    });
    const client = new ObjectStackClient({
        baseUrl: 'http://localhost:3000',
        fetch: fetchMock
    });
    return { client, fetchMock };
}

describe('client.actions', () => {
    it('invoke POSTs to /api/v1/actions/:object/:action with recordId + params in the body', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { converted: true },  // #3962: single wrap — data IS the handler value
        });

        const result = await client.actions.invoke('crm_lead', 'convert', {
            recordId: 'lead_1',
            params: { create_opportunity: true },
        });

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/actions/crm_lead/convert');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({
            recordId: 'lead_1',
            params: { create_opportunity: true },
        });
        // unwrapResponse strips the transport envelope; the INNER envelope is
        // the action handler's own result.
        expect(result).toEqual({ success: true, data: { converted: true } });
    });

    it('invoke URL-encodes object and action names', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { success: true } });
        await client.actions.invoke('my object', 'do/thing');
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/actions/my%20object/do%2Fthing',
        );
    });

    it('invoke defaults params to {} and omits recordId when not given', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { success: true } });
        await client.actions.invoke('crm_lead', 'recalculate');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ params: {} });
    });

    it('invokeGlobal targets the object-less shape /actions/global/:action', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { success: true } });
        await client.actions.invokeGlobal('nightly_cleanup', { params: { dryRun: true } });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/actions/global/nightly_cleanup',
        );
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ params: { dryRun: true } });
    });

    it('still folds a PRE-#3962 server\'s 200-wrapped failure (legacy inner envelope)', async () => {
        // Servers older than #3962 reported a rejection as HTTP 200 with the
        // inner `{success:false, error}`. A current SDK still talks to them,
        // so the narrowly-detected legacy shape stays authoritative on a 2xx.
        const { client } = createMockClient({
            success: true,
            data: { success: false, error: 'Lead is already converted' },
        });
        const result = await client.actions.invoke('crm_lead', 'convert', { recordId: 'lead_1' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('Lead is already converted');
    });

    it('reports a dispatch failure (404) as the same non-throwing envelope (#3913)', async () => {
        // `client.fetch` throws on any non-2xx, but this surface's contract is
        // to REPORT, not throw — callers toast `result.error` rather than
        // wrapping every call in a try/catch.
        const { client } = createMockClient(
            { success: false, error: { message: "Action 'log_call' on object 'global' not found", code: 404 } },
            404,
        );
        const result = await client.actions.invokeGlobal('log_call');
        expect(result.success).toBe(false);
        // The message, not `[object Object]` — the error body's `error` is an
        // object on this shape.
        expect(result.error).toBe("Action 'log_call' on object 'global' not found");
    });

    it('reports a business rejection (400) with the message, non-throwing (#3962)', async () => {
        const { client } = createMockClient(
            {
                success: false,
                error: {
                    message: 'ValidationError: issued_on is required',
                    code: 400,
                    details: { code: 'VALIDATION_FAILED', fields: [{ field: 'issued_on' }] },
                },
            },
            400,
        );
        const result = await client.actions.invoke('crm_invoice', 'submit_signoff', { recordId: 'inv_1' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('ValidationError: issued_on is required');
    });

    it('passes a handler value that merely CONTAINS success-ish keys through untouched (#3962)', async () => {
        // Single wrap means data is handler-owned. Only the exact legacy
        // envelope shape (boolean `success`, no foreign keys) is unwrapped.
        const { client } = createMockClient({
            success: true,
            data: { success: true, rows: 3, data: { id: 'x' }, extra: 'mine' },
        });
        const result = await client.actions.invoke('crm_lead', 'sync');
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ success: true, rows: 3, data: { id: 'x' }, extra: 'mine' });
    });

    it('reports a 403 denial the same way', async () => {
        const { client } = createMockClient(
            { success: false, error: { message: 'Missing capability can_convert', code: 403 } },
            403,
        );
        const result = await client.actions.invoke('crm_lead', 'convert');
        expect(result.success).toBe(false);
        expect(result.error).toBe('Missing capability can_convert');
    });
});
