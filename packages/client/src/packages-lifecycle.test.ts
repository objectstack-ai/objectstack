// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `client.packages` lifecycle methods — #3563 PR-4 gap closures. The eleven
 * routes beyond install/enable (ADR-0033 drafts, ADR-0067 commits, ADR-0070
 * portability) existed server-side with no SDK expression; Studio reached
 * them via raw fetch.
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

const BASE = 'http://localhost:3000/api/v1/packages';

describe('client.packages lifecycle (#3563 PR-4)', () => {
    it('update PATCHes the manifest fields to /packages/:id', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { id: 'com.acme.crm' } });
        await client.packages.update('com.acme.crm', { name: 'Acme CRM', version: '2.0.0' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe(`${BASE}/com.acme.crm`);
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(init.body)).toEqual({ name: 'Acme CRM', version: '2.0.0' });
    });

    it.each([
        ['publish',       (c: ObjectStackClient) => c.packages.publish('p1'),                 'POST', `${BASE}/p1/publish`, {}],
        ['publishDrafts', (c: ObjectStackClient) => c.packages.publishDrafts('p1'),           'POST', `${BASE}/p1/publish-drafts`, {}],
        ['discardDrafts', (c: ObjectStackClient) => c.packages.discardDrafts('p1', { actor: 'admin' }), 'POST', `${BASE}/p1/discard-drafts`, { actor: 'admin' }],
        ['revert',        (c: ObjectStackClient) => c.packages.revert('p1'),                  'POST', `${BASE}/p1/revert`, undefined],
        ['adoptOrphans',  (c: ObjectStackClient) => c.packages.adoptOrphans('p1'),            'POST', `${BASE}/p1/adopt-orphans`, {}],
    ] as const)('%s hits its lifecycle route', async (_name, call, method, url, expectedBody) => {
        const { client, fetchMock } = createMockClient({ success: true, data: { ok: true } });
        await call(client);
        const [gotUrl, init] = fetchMock.mock.calls[0];
        expect(String(gotUrl)).toBe(url);
        expect(init.method).toBe(method);
        if (expectedBody !== undefined) expect(JSON.parse(init.body)).toEqual(expectedBody);
        else expect(init.body).toBeUndefined();
    });

    it('listCommits GETs the ADR-0067 timeline', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { commits: [{ id: 'c1' }] } });
        const out = await client.packages.listCommits('p1');
        expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/p1/commits`);
        expect(out.commits).toHaveLength(1);
    });

    it('revertCommit POSTs to the commit-scoped subroute, URL-encoding both ids', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { ok: true } });
        await client.packages.revertCommit('p one', 'c/1');
        expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/p%20one/commits/c%2F1/revert`);
        expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    });

    it('rollback sends the required commitId in the body', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { ok: true } });
        await client.packages.rollback('p1', 'c9', { actor: 'admin' });
        expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/p1/rollback`);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ commitId: 'c9', actor: 'admin' });
    });

    it('export GETs the portable manifest', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { id: 'p1', objects: [] } });
        const manifest = await client.packages.export('p1');
        expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/p1/export`);
        expect(manifest.id).toBe('p1');
    });

    it('duplicate requires targetPackageId and forwards the renaming options', async () => {
        const { client, fetchMock } = createMockClient({ success: true, data: { ok: true } });
        await client.packages.duplicate('p1', 'p2', { targetName: 'Copy', targetNamespace: 'copy' });
        expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/p1/duplicate`);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
            targetPackageId: 'p2',
            targetName: 'Copy',
            targetNamespace: 'copy',
        });
    });
});
