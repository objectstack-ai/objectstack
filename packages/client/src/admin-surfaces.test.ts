// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `client.keys` / `client.shareLinks` / `client.security` — #3563 PR-3 gap
 * closures. Before these surfaces, the SDK had no way to mint an API key,
 * manage share links, or resolve suggested audience bindings; all three
 * domains were `gap` in the route ledger.
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

describe('client.keys', () => {
    it('create POSTs name + expires_at to /api/v1/keys and returns the one-time secret', async () => {
        const { client, fetchMock } = createMockClient({
            success: true,
            data: { id: 'k1', name: 'CI key', prefix: 'osk_abc', key: 'osk_abc.RAW', expires_at: '2027-01-01T00:00:00.000Z' },
        });

        const key = await client.keys.create({ name: 'CI key', expiresAt: '2027-01-01T00:00:00.000Z' });

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/keys');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ name: 'CI key', expires_at: '2027-01-01T00:00:00.000Z' });
        expect(key.key).toBe('osk_abc.RAW');
    });

    it('create sends an empty body object when no options are given', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { id: 'k1', key: 'raw' } });
        await client.keys.create();
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
    });
});

describe('client.shareLinks', () => {
    it('create POSTs object + recordId + options to /api/v1/share-links', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { id: 'sl1', token: 'tok_1' } });

        const link = await client.shareLinks.create('crm_account', 'acc_1', {
            permission: 'view',
            password: 'hunter2',
            label: 'For the auditor',
        });

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/share-links');
        expect(JSON.parse(init.body)).toEqual({
            object: 'crm_account',
            recordId: 'acc_1',
            permission: 'view',
            password: 'hunter2',
            label: 'For the auditor',
        });
        expect(link.token).toBe('tok_1');
    });

    it('list builds the query string and omits empty filters', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: [] });
        await client.shareLinks.list({ object: 'crm_account', includeRevoked: true });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/share-links?object=crm_account&includeRevoked=true',
        );

        await client.shareLinks.list();
        expect(String(fetchMock.mock.calls[1][0])).toBe('http://localhost:3000/api/v1/share-links');
    });

    it('revoke DELETEs by id or token, URL-encoded', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { ok: true } });
        await client.shareLinks.revoke('tok/with slash');
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/share-links/tok%2Fwith%20slash');
        expect(init.method).toBe('DELETE');
    });
});

describe('client.security.suggestedBindings', () => {
    it('list GETs /api/v1/security/suggested-bindings with optional filters', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { suggestions: [] } });
        await client.security.suggestedBindings.list({ status: 'pending', packageId: 'com.acme.crm' });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/security/suggested-bindings?status=pending&packageId=com.acme.crm',
        );

        await client.security.suggestedBindings.list();
        expect(String(fetchMock.mock.calls[1][0])).toBe(
            'http://localhost:3000/api/v1/security/suggested-bindings',
        );
    });

    it('confirm and dismiss POST to the id-scoped subroutes', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { ok: true } });
        await client.security.suggestedBindings.confirm('sug_1');
        await client.security.suggestedBindings.dismiss('sug_2');
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/security/suggested-bindings/sug_1/confirm',
        );
        expect(fetchMock.mock.calls[0][1].method).toBe('POST');
        expect(String(fetchMock.mock.calls[1][0])).toBe(
            'http://localhost:3000/api/v1/security/suggested-bindings/sug_2/dismiss',
        );
    });
});
