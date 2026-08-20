// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The final six #3563 gap closures (PR-5): meta published/drafts/FSM and the
 * automation descriptor/status routes. With these, every should-be-SDK
 * dispatcher route has an SDK expression and the ledger's gap ratchet is 0.
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

describe('client.meta (#3563 PR-5)', () => {
    it('getPublished passes compound names through unencoded', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { name: 'all_leads' } });
        await client.meta.getPublished('lead', 'views/all_leads');
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/meta/lead/views/all_leads/published',
        );
    });

    it('listDrafts builds the packageId/type query and omits empties', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { drafts: [] } });
        await client.meta.listDrafts({ packageId: 'com.acme.crm', type: 'object' });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/meta/_drafts?packageId=com.acme.crm&type=object',
        );
        await client.meta.listDrafts();
        expect(String(fetchMock.mock.calls[1][0])).toBe('http://localhost:3000/api/v1/meta/_drafts');
    });

    // #9180 step 2: the segment is SINGULAR. This pin is the SDK half of that
    // flip — the plural registration it used to call no longer exists on the
    // REST surface, so a regression here is a 404 in the field, not a style slip.
    it('getLegalNextStates hits the singular FSM route and forwards from=', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { object: 'crm_lead', field: 'status', from: 'new', next: ['contacted'] },
        });
        const out = await client.meta.getLegalNextStates('crm_lead', 'status', 'new');
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/meta/object/crm_lead/state/status?from=new',
        );
        expect(out.next).toEqual(['contacted']);

        // Omitted `from` → no query; the server answers next: null.
        await client.meta.getLegalNextStates('crm_lead', 'status');
        expect(String(fetchMock.mock.calls[1][0])).toBe(
            'http://localhost:3000/api/v1/meta/object/crm_lead/state/status',
        );
    });
});

describe('client.automation descriptors (#3563 PR-5)', () => {
    it('listActions forwards the paradigm/source/category filters', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { actions: [], total: 0 } });
        await client.automation.listActions({ paradigm: 'flow', category: 'crud' });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/automation/actions?paradigm=flow&category=crud',
        );
        await client.automation.listActions();
        expect(String(fetchMock.mock.calls[1][0])).toBe('http://localhost:3000/api/v1/automation/actions');
    });

    it('listConnectors forwards the type filter', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { connectors: [], total: 0 } });
        await client.automation.listConnectors({ type: 'rest' });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/automation/connectors?type=rest',
        );
    });

    it('getRuntimeStatus GETs the underscore-guarded _status route', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { flows: [{ name: 'f1', enabled: true, bound: true }], total: 1 },
        });
        const out = await client.automation.getRuntimeStatus();
        expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:3000/api/v1/automation/_status');
        expect(out.flows[0].bound).toBe(true);
    });
});
