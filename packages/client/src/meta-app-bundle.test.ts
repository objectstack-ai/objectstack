// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27627] `meta.getAppBundle` — the app metadata bundle read, conditional in
 * `getCached`'s spelling: `ifNoneMatch` in; `notModified`, `data` and
 * `etag: { value, weak }` out, with the server's `304` answered rather than
 * thrown as a failed request.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackClient } from './index';

const BUNDLE = {
    app: { type: 'app', name: 'crm', item: { name: 'crm' } },
    objects: [{ type: 'object', name: 'account', item: { name: 'account' } }],
    views: [],
    pages: [],
    dashboards: [],
};
const ETAG = `"${'a'.repeat(64)}"`;

function clientAnswering(status: number, body: unknown, etag?: string) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : status === 304 ? 'Not Modified' : 'Error',
        json: async () => body,
        headers: new Headers(etag ? { ETag: etag } : {}),
    });
    return { client: new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: fetchMock }), fetchMock };
}

describe('[#27627] meta.getAppBundle', () => {
    it('reads GET /meta/app/{appId}/bundle and answers the bundle with its validator', async () => {
        const { client, fetchMock } = clientAnswering(200, BUNDLE, ETAG);
        const answer = await client.meta.getAppBundle('crm app');
        expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/v1/meta/app/crm%20app/bundle');
        expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('If-None-Match')).toBeNull();
        expect(answer).toEqual({ notModified: false, data: BUNDLE, etag: { value: 'a'.repeat(64), weak: false } });
    });

    it('sends ifNoneMatch, and a 304 is answered `notModified` instead of thrown', async () => {
        const { client, fetchMock } = clientAnswering(304, undefined, ETAG);
        const answer = await client.meta.getAppBundle('crm', { ifNoneMatch: ETAG });
        expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('If-None-Match')).toBe(ETAG);
        expect(answer).toEqual({ notModified: true, etag: { value: 'a'.repeat(64), weak: false } });
    });

    it('a refusal still rejects with the server\'s code and status', async () => {
        const { client } = clientAnswering(403, { success: false, error: { code: 'PERMISSION_DENIED', message: 'No.' } });
        const err: any = await client.meta.getAppBundle('payroll').then(
            () => { throw new Error('expected the read to reject'); },
            (e) => e,
        );
        expect(err.httpStatus).toBe(403);
        expect(err.code).toBe('PERMISSION_DENIED');
    });
});
