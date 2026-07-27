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
            data: { success: true, data: { converted: true } },
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

    it('invokeGlobal targets the wildcard shape /actions/global/:action', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { success: true } });
        await client.actions.invokeGlobal('nightly_cleanup', { params: { dryRun: true } });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/actions/global/nightly_cleanup',
        );
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ params: { dryRun: true } });
    });

    it('surfaces the handler business failure without throwing (inner success:false)', async () => {
        // The dispatcher reports handler throws as HTTP 200 with an inner
        // `{ success:false, error }` — a toastable business failure, not a
        // transport error (http-dispatcher.handleActions catch branch).
        const { client } = createMockClient({
            success: true,
            data: { success: false, error: 'Lead is already converted' },
        });
        const result = await client.actions.invoke('crm_lead', 'convert', { recordId: 'lead_1' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('Lead is already converted');
    });
});
