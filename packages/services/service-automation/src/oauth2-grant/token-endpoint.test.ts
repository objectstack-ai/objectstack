// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D4 — the one token request a grant-bearing instance sends: client
// authentication, the four ways it fails, and the server text it never carries.
// The values below are obvious dummies.

import { describe, expect, it } from 'vitest';
import { ConnectorUpstreamUnavailableError } from '@objectstack/spec/integration';
import {
    OAuth2ClientRefusedError,
    OAuth2GrantRefusedError,
    OAuth2TokenResponseError,
    requestOAuth2Token,
} from './token-endpoint.js';

const TOKEN_URL = 'https://idp.example.com/oauth/token';

interface Sent {
    url: string;
    headers: Record<string, string>;
    body: URLSearchParams;
}

/** A fetch that records what was sent and answers `status` with `body` as JSON. */
function answering(status: number, body: unknown, sent: Sent[] = []): typeof fetch {
    return (async (url: string, init: RequestInit) => {
        sent.push({ url, headers: init.headers as Record<string, string>, body: new URLSearchParams(String(init.body)) });
        return new Response(body === undefined ? 'not json' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
}

const request = (fetchImpl: typeof fetch, over: Partial<Parameters<typeof requestOAuth2Token>[0]> = {}) => requestOAuth2Token({
    connector: 'crm',
    tokenUrl: TOKEN_URL,
    client: { clientId: 'client 1', clientSecret: 'dummy:secret&x' },
    params: { grant_type: 'client_credentials', scope: 'read write' },
    fetch: fetchImpl,
    ...over,
});

describe('ADR-0143 D4 — the token request', () => {
    it('authenticates a confidential client with HTTP Basic, each half form-encoded first (RFC 6749 §2.3.1)', async () => {
        const sent: Sent[] = [];
        await request(answering(200, { access_token: 'dummy-at', token_type: 'Bearer' }, sent));
        expect(sent).toHaveLength(1);
        expect(sent[0].url).toBe(TOKEN_URL);
        expect(sent[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
        // `client 1` → `client+1`, `dummy:secret&x` → `dummy%3Asecret%26x`, so the
        // colon inside the secret cannot split the pair.
        expect(sent[0].headers.authorization).toBe(`Basic ${Buffer.from('client+1:dummy%3Asecret%26x').toString('base64')}`);
        expect(sent[0].body.get('client_id')).toBeNull();
        expect(sent[0].body.get('grant_type')).toBe('client_credentials');
        expect(sent[0].body.get('scope')).toBe('read write');
    });

    it('a public client sends its client_id in the body and no Authorization header (§3.2.1)', async () => {
        const sent: Sent[] = [];
        await request(answering(200, { access_token: 'dummy-at', token_type: 'bearer' }, sent), { client: { clientId: 'pub' } });
        expect(sent[0].headers.authorization).toBeUndefined();
        expect(sent[0].body.get('client_id')).toBe('pub');
    });

    it('reads the answer: expiry measured from when the request was sent, a rotated refresh token, the granted scope', async () => {
        let clock = 1_000_000;
        const slow = (async (url: string, init: RequestInit) => {
            clock += 5_000; // the network took five seconds
            return answering(200, { access_token: 'dummy-at', token_type: 'Bearer', expires_in: 3600, refresh_token: 'dummy-rt', scope: 'read' })(url, init);
        }) as unknown as typeof fetch;
        const token = await request(slow, { now: () => clock });
        expect(token).toEqual({ accessToken: 'dummy-at', expiresAt: 1_000_000 + 3_600_000, refreshToken: 'dummy-rt', scope: 'read' });
    });

    it('an `expires_in` sent as a string is read; a missing one leaves the expiry unknown', async () => {
        const a = await request(answering(200, { access_token: 'a1', token_type: 'Bearer', expires_in: '60' }), { now: () => 0 });
        expect(a.expiresAt).toBe(60_000);
        const b = await request(answering(200, { access_token: 'a2', token_type: 'Bearer' }));
        expect(b).toEqual({ accessToken: 'a2' });
    });
});

describe('ADR-0143 D4 — how a token request fails', () => {
    it('no answer → CONNECTOR_UPSTREAM_UNAVAILABLE', async () => {
        const down = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
        await expect(request(down)).rejects.toBeInstanceOf(ConnectorUpstreamUnavailableError);
    });

    it.each([429, 500, 503])('HTTP %i → CONNECTOR_UPSTREAM_UNAVAILABLE, even with an error body', async (status) => {
        await expect(request(answering(status, { error: 'invalid_grant' }))).rejects.toBeInstanceOf(ConnectorUpstreamUnavailableError);
    });

    it('`invalid_grant` → the grant is refused (only a reconnect brings it back)', async () => {
        await expect(request(answering(400, { error: 'invalid_grant' }))).rejects.toBeInstanceOf(OAuth2GrantRefusedError);
    });

    it.each([
        [400, { error: 'invalid_client' }],
        [400, { error: 'unauthorized_client' }],
        [401, undefined],
    ])('HTTP %i %j → the client is refused', async (status, body) => {
        await expect(request(answering(status, body))).rejects.toBeInstanceOf(OAuth2ClientRefusedError);
    });

    it('any other refusal → a 503 SERVICE_UNAVAILABLE naming the registered code', async () => {
        await expect(request(answering(400, { error: 'invalid_scope' }))).rejects.toThrow(/\(invalid_scope\)/);
        await expect(request(answering(400, { error: 'invalid_scope' }))).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
        await expect(request(answering(400, { error: 'invalid_client' }))).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
        await expect(request(answering(400, { error: 'invalid_scope' }))).rejects.toBeInstanceOf(OAuth2TokenResponseError);
    });

    it('a 2xx without an access_token, or with a token that is not a bearer token, is refused', async () => {
        await expect(request(answering(200, { token_type: 'Bearer' }))).rejects.toThrow(/without an access_token/);
        await expect(request(answering(200, { access_token: 'dummy-at', token_type: 'mac' }))).rejects.toThrow(/not a bearer token/);
        await expect(request(answering(200, { access_token: 'dummy-at' }))).rejects.toThrow(/not a bearer token/);
    });

    it("⛔ never carries the authorization server's own text: an unregistered code or a description echoing a secret", async () => {
        const echo = { error: 'dummy-echo-of-secret-9387', error_description: 'your secret dummy:secret&x is wrong' };
        for (const status of [400, 403]) {
            const err = await request(answering(status, echo)).catch((e: Error) => e);
            expect(err).toBeInstanceOf(OAuth2TokenResponseError);
            expect((err as Error).message).toContain(`HTTP ${status}`);
            expect((err as Error).message).not.toContain('dummy-echo-of-secret-9387');
            expect((err as Error).message).not.toContain('dummy:secret');
        }
        const upstream = await request(answering(503, echo)).catch((e: Error) => e);
        expect((upstream as Error).message).not.toContain('dummy');
    });
});
