// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D2.2 / D4 — the vendor app-credential exchanges and their handle.

import { describe, it, expect } from 'vitest';
import { isConnectorUpstreamUnavailable } from '@objectstack/spec/integration';
import {
    APP_CREDENTIAL_EXCHANGES,
    createAppCredentialHandle,
    requestAppCredentialToken,
    retryOnVendorTokenRefusal,
} from './app-credential.js';

const SECRET = 'app-secret-value-0123';

interface Seen { url: string; method?: string; headers: Record<string, string>; body?: string }

/** A fetch answering with `answer(n)` for the n-th call (1-based). */
function fetchAnswering(answer: (n: number, seen: Seen) => Response) {
    const seen: Seen[] = [];
    const impl = (async (url: string, init: RequestInit = {}) => {
        const s: Seen = {
            url,
            method: init.method,
            headers: { ...(init.headers as Record<string, string>) },
            body: typeof init.body === 'string' ? init.body : undefined,
        };
        seen.push(s);
        return answer(seen.length, s);
    }) as unknown as typeof fetch;
    return { impl, seen };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the vendor exchanges, each as its vendor documents it (ADR-0143 D2.2)', () => {
    it('feishu — client credentials at accounts.feishu.cn, form-encoded; the token is a bearer token', async () => {
        const { impl, seen } = fetchAnswering(() => json({ code: 0, access_token: 't-feishu', expires_in: 7200, token_type: 'Bearer' }));
        const token = await requestAppCredentialToken({
            connector: 'lark', exchange: APP_CREDENTIAL_EXCHANGES.feishu, appId: 'cli_a1', appSecret: SECRET, fetch: impl, now: () => 1_000,
        });
        expect(seen[0]).toMatchObject({ url: 'https://accounts.feishu.cn/oauth/v3/token', method: 'POST' });
        expect(seen[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
        expect(Object.fromEntries(new URLSearchParams(seen[0].body))).toEqual({
            grant_type: 'client_credentials', client_id: 'cli_a1', client_secret: SECRET,
        });
        expect(token).toEqual({ accessToken: 't-feishu', expiresAt: 1_000 + 7_200_000 });
        expect(APP_CREDENTIAL_EXCHANGES.feishu.present('t-feishu')).toEqual({ type: 'bearer', token: 't-feishu' });
    });

    it('dingtalk — the v1.0 accessToken API with a JSON body; the token rides x-acs-dingtalk-access-token', async () => {
        const { impl, seen } = fetchAnswering(() => json({ accessToken: 't-ding', expireIn: 7200 }));
        const token = await requestAppCredentialToken({
            connector: 'ding', exchange: APP_CREDENTIAL_EXCHANGES.dingtalk, appId: 'ding_key', appSecret: SECRET, fetch: impl, now: () => 0,
        });
        expect(seen[0]).toMatchObject({ url: 'https://api.dingtalk.com/v1.0/oauth2/accessToken', method: 'POST' });
        expect(JSON.parse(seen[0].body ?? '')).toEqual({ appKey: 'ding_key', appSecret: SECRET });
        expect(token).toEqual({ accessToken: 't-ding', expiresAt: 7_200_000 });
        expect(APP_CREDENTIAL_EXCHANGES.dingtalk.present('t-ding')).toEqual({
            type: 'api-key', key: 't-ding', headerName: 'x-acs-dingtalk-access-token',
        });
    });

    it('wecom — gettoken with corpid and corpsecret; the token rides the access_token query parameter', async () => {
        const { impl, seen } = fetchAnswering(() => json({ errcode: 0, errmsg: 'ok', access_token: 't-wecom', expires_in: 7200 }));
        const token = await requestAppCredentialToken({
            connector: 'wecom', exchange: APP_CREDENTIAL_EXCHANGES.wecom, appId: 'ww_corp', appSecret: SECRET, fetch: impl, now: () => 0,
        });
        const url = new URL(seen[0].url);
        expect(`${url.origin}${url.pathname}`).toBe('https://qyapi.weixin.qq.com/cgi-bin/gettoken');
        expect(seen[0].method).toBe('GET');
        expect(Object.fromEntries(url.searchParams)).toEqual({ corpid: 'ww_corp', corpsecret: SECRET });
        expect(token).toEqual({ accessToken: 't-wecom', expiresAt: 7_200_000 });
        expect(APP_CREDENTIAL_EXCHANGES.wecom.present('t-wecom')).toMatchObject({ type: 'api-key', key: 't-wecom', paramName: 'access_token' });
    });

    it.each([
        ['feishu', json({ code: 20002, error: 'invalid_client', error_description: `bad ${SECRET}` }, 400), '20002'],
        ['dingtalk', json({ code: 'invalidClientIdOrSecret', message: `bad ${SECRET}` }, 400), 'invalidClientIdOrSecret'],
        ['wecom', json({ errcode: 40001, errmsg: `invalid secret ${SECRET}` }), '40001'],
    ] as const)('⛔ %s — a refused exchange is the seam\'s 503 naming the vendor code, never the vendor\'s text', async (vendor, answer, code) => {
        const { impl } = fetchAnswering(() => answer);
        const err = (await requestAppCredentialToken({
            connector: 'inst', exchange: APP_CREDENTIAL_EXCHANGES[vendor], appId: 'id', appSecret: SECRET, fetch: impl,
        }).catch((e: unknown) => e)) as Error & { code?: string; status?: number };
        expect(err).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
        expect(err.message).toContain(`(${code})`);
        expect(err.message).toContain("connector instance 'inst'");
        expect(err.message).not.toContain(SECRET);
    });

    it('a 2xx answer without a token is refused too', async () => {
        const { impl } = fetchAnswering(() => json({ errcode: 0, errmsg: 'ok' }));
        await expect(requestAppCredentialToken({
            connector: 'inst', exchange: APP_CREDENTIAL_EXCHANGES.wecom, appId: 'id', appSecret: SECRET, fetch: impl,
        })).rejects.toMatchObject({ status: 503 });
    });

    it.each([429, 500, 503])('an HTTP %i from the token endpoint is operational: CONNECTOR_UPSTREAM_UNAVAILABLE', async (status) => {
        const { impl } = fetchAnswering(() => json({}, status));
        const err = await requestAppCredentialToken({
            connector: 'inst', exchange: APP_CREDENTIAL_EXCHANGES.feishu, appId: 'id', appSecret: SECRET, fetch: impl,
        }).catch((e: unknown) => e);
        expect(isConnectorUpstreamUnavailable(err)).toBe(true);
    });

    it('⛔ no answer is operational, and the refusal carries neither the URL nor the transport\'s error (WeCom\'s URL holds the secret)', async () => {
        const impl = (async (url: string) => { throw new Error(`getaddrinfo failed for ${url}`); }) as unknown as typeof fetch;
        const err = (await requestAppCredentialToken({
            connector: 'inst', exchange: APP_CREDENTIAL_EXCHANGES.wecom, appId: 'id', appSecret: SECRET, fetch: impl,
        }).catch((e: unknown) => e)) as Error;
        expect(isConnectorUpstreamUnavailable(err)).toBe(true);
        expect(err.message).not.toContain(SECRET);
        expect((err as { cause?: unknown }).cause).toBeUndefined();
    });

    it('the token request is never sent after a redirect', async () => {
        const { impl } = fetchAnswering(() => json({ code: 0, access_token: 't', expires_in: 60 }));
        let init: RequestInit | undefined;
        const spy = (async (url: string, i: RequestInit) => { init = i; return impl(url, i); }) as unknown as typeof fetch;
        await requestAppCredentialToken({ connector: 'inst', exchange: APP_CREDENTIAL_EXCHANGES.feishu, appId: 'id', appSecret: SECRET, fetch: spy });
        expect(init?.redirect).toBe('error');
    });
});

describe('the app-credential handle (ADR-0143 D4)', () => {
    it('exchanges once, then answers the cached token until the skew margin; concurrent asks share one exchange', async () => {
        let clock = 0;
        const { impl, seen } = fetchAnswering((n) => json({ code: 0, access_token: `t-${n}`, expires_in: 120 }));
        const handle = createAppCredentialHandle({ connector: 'lark', vendor: 'feishu', appId: 'id', appSecret: SECRET, fetch: impl, now: () => clock });

        const [a, b] = await Promise.all([handle.get(), handle.get({ organizationId: 'org_a' })]);
        expect(a.auth).toEqual({ type: 'bearer', token: 't-1' });
        expect(b.auth).toEqual({ type: 'bearer', token: 't-1' });
        expect(a.expiresAt).toBe(120_000);
        expect(seen).toHaveLength(1);

        clock = 89_000; // 31 s left: still outside the 30 s margin
        expect((await handle.get()).auth).toEqual({ type: 'bearer', token: 't-1' });
        clock = 91_000; // inside the margin
        expect((await handle.get()).auth).toEqual({ type: 'bearer', token: 't-2' });
        expect(seen).toHaveLength(2);
    });

    it('⛔ refresh drops the held token and exchanges again; concurrent refreshes share one exchange', async () => {
        const { impl, seen } = fetchAnswering((n) => json({ errcode: 0, access_token: `t-${n}`, expires_in: 7200 }));
        const handle = createAppCredentialHandle({ connector: 'wecom', vendor: 'wecom', appId: 'ww', appSecret: SECRET, fetch: impl, now: () => 0 });
        await handle.get();
        const [x, y] = await Promise.all([handle.refresh(), handle.refresh()]);
        expect(x.auth).toMatchObject({ key: 't-2' });
        expect(y.auth).toMatchObject({ key: 't-2' });
        expect(seen).toHaveLength(2);
    });
});

describe('the refresh-once rule on a vendor\'s in-body token refusal — WeCom early invalidation (ADR-0143 D4, Q3)', () => {
    const refused = { status: 200, ok: true, body: { errcode: 42001, errmsg: 'access_token expired' } };
    const accepted = { status: 200, ok: true, body: { errcode: 0, errmsg: 'ok' } };

    function handleSpy() {
        const refreshed: unknown[] = [];
        return { refreshed, handle: { refresh: async (r?: unknown) => { refreshed.push(r); return { auth: { type: 'bearer' as const, token: 'x' } }; } } };
    }

    it.each([40014, 42001])('⛔ errcode %i refreshes the handle once and repeats the call once', async (errcode) => {
        const { refreshed, handle } = handleSpy();
        let n = 0;
        const handlers = retryOnVendorTokenRefusal('wecom', 'wecom', handle, {
            request: async () => (++n === 1 ? { ...refused, body: { errcode } } : accepted),
        });
        await expect(handlers.request({}, { automation: { tenantId: 'org_a' } })).resolves.toEqual(accepted);
        expect(n).toBe(2);
        expect(refreshed).toEqual([{ organizationId: 'org_a' }]);
    });

    it('⛔ a second refusal ends in the seam\'s 503 naming the instance, and is not retried again', async () => {
        const { refreshed, handle } = handleSpy();
        let n = 0;
        const handlers = retryOnVendorTokenRefusal('wecom', 'wecom', handle, { request: async () => { n += 1; return refused; } });
        await expect(handlers.request({}, {})).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
        expect(n).toBe(2);
        expect(refreshed).toHaveLength(1);
    });

    it('CONTROL: any other answer is returned as is, with no refresh', async () => {
        const { refreshed, handle } = handleSpy();
        const other = { status: 200, ok: true, body: { errcode: 60011, errmsg: 'no privilege' } };
        const handlers = retryOnVendorTokenRefusal('wecom', 'wecom', handle, { request: async () => other });
        await expect(handlers.request({}, {})).resolves.toBe(other);
        expect(refreshed).toHaveLength(0);
    });

    it('a vendor that answers a refused token with a 401 keeps its handlers unwrapped (the provider\'s rule covers it)', () => {
        const handlers = { request: async () => accepted };
        expect(retryOnVendorTokenRefusal('lark', 'feishu', handleSpy().handle, handlers)).toBe(handlers);
        expect(retryOnVendorTokenRefusal('ding', 'dingtalk', handleSpy().handle, handlers)).toBe(handlers);
    });
});
