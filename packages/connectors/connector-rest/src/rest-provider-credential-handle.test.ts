// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D4 — the `rest` provider serves a grant-bearing instance (`oauth2`,
// `app-credential`) through the per-dispatch credential handle: asked on every
// request, refreshed once on an upstream `401` and retried once.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type {
    BorrowedConnectorAuth,
    ConnectorCredentialHandle,
    ConnectorCredentialRequest,
    ConnectorProviderContext,
} from '@objectstack/spec/integration';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { createRestProviderFactory } from './rest-provider.js';
import { ConnectorRestPlugin } from './connector-rest-plugin.js';

interface Sent { url: string; headers: Record<string, string> }

/** A fetch answering each call with the next status of `statuses` (the last one repeats). */
function scriptedFetch(statuses: number[]) {
    const sent: Sent[] = [];
    const impl = (async (url: string, init: RequestInit) => {
        sent.push({ url, headers: { ...(init.headers as Record<string, string>) } });
        const status = statuses[Math.min(sent.length - 1, statuses.length - 1)];
        return new Response(JSON.stringify({ n: sent.length }), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { impl, sent };
}

/** A handle answering `tok-1`, then `tok-2` after each refresh, recording what it was asked in the name of. */
function fakeHandle(present: (token: string) => BorrowedConnectorAuth = (token) => ({ type: 'bearer', token })) {
    const asked: Array<{ verb: 'get' | 'refresh'; request?: ConnectorCredentialRequest }> = [];
    let n = 1;
    const handle: ConnectorCredentialHandle = {
        connector: 'vendor',
        async get(request) { asked.push({ verb: 'get', request }); return { auth: present(`tok-${n}`) }; },
        async refresh(request) { asked.push({ verb: 'refresh', request }); n += 1; return { auth: present(`tok-${n}`) }; },
    };
    return { handle, asked };
}

function ctx(partial: Partial<ConnectorProviderContext>): ConnectorProviderContext {
    return { name: 'vendor', label: 'Vendor', type: 'api', providerConfig: { baseUrl: 'https://api.example.com' }, ...partial };
}

const dispatch = (organizationId?: string) => ({ automation: organizationId === undefined ? {} : { tenantId: organizationId } });

describe('rest provider — a grant-bearing instance through its credential handle (ADR-0143 D4)', () => {
    it('asks the handle on every request in the name of the run\'s organization, and sends the bearer token', async () => {
        const { impl, sent } = scriptedFetch([200]);
        const { handle, asked } = fakeHandle();
        const { handlers } = await createRestProviderFactory({ fetchImpl: impl })(ctx({ credentialHandle: handle }));

        await handlers.request({ path: '/a' }, dispatch('org_a'));
        await handlers.request({ path: '/b' }, dispatch('org_b'));

        expect(asked).toEqual([
            { verb: 'get', request: { organizationId: 'org_a' } },
            { verb: 'get', request: { organizationId: 'org_b' } },
        ]);
        expect(sent.map((s) => s.headers.Authorization)).toEqual(['Bearer tok-1', 'Bearer tok-1']);
    });

    it('a run with no organization asks the handle with none (D4 answers it from the only connection)', async () => {
        const { impl } = scriptedFetch([200]);
        const { handle, asked } = fakeHandle();
        const { handlers } = await createRestProviderFactory({ fetchImpl: impl })(ctx({ credentialHandle: handle }));
        await handlers.request({ path: '/a' }, dispatch());
        expect(asked).toEqual([{ verb: 'get', request: {} }]);
    });

    it('⛔ an upstream 401 refreshes once and retries once with the new token', async () => {
        const { impl, sent } = scriptedFetch([401, 200]);
        const { handle, asked } = fakeHandle();
        const { handlers } = await createRestProviderFactory({ fetchImpl: impl })(ctx({ credentialHandle: handle }));

        const out = await handlers.request({ path: '/a' }, dispatch('org_a'));

        expect(out).toMatchObject({ status: 200, ok: true });
        expect(asked.map((a) => a.verb)).toEqual(['get', 'refresh']);
        expect(sent.map((s) => s.headers.Authorization)).toEqual(['Bearer tok-1', 'Bearer tok-2']);
    });

    it('⛔ a second 401 ends in the seam\'s 503 refusal naming the instance, never the upstream\'s answer', async () => {
        const { impl, sent } = scriptedFetch([401]);
        const { handle } = fakeHandle();
        const { handlers } = await createRestProviderFactory({ fetchImpl: impl })(ctx({ credentialHandle: handle }));

        const err = await handlers.request({ path: '/a' }, dispatch('org_a')).catch((e: unknown) => e as Error & { code?: string; status?: number });
        expect(err).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
        expect((err as Error).message).toContain("connector instance 'vendor'");
        expect(sent).toHaveLength(2);
    });

    it('a handle\'s refusal is the dispatch\'s failure, and nothing is sent', async () => {
        const { impl, sent } = scriptedFetch([200]);
        const refusal = Object.assign(new Error("connector instance 'vendor' is not connected"), { code: 'SERVICE_UNAVAILABLE', status: 503 });
        const handle: ConnectorCredentialHandle = { connector: 'vendor', get: async () => { throw refusal; }, refresh: async () => { throw refusal; } };
        const { handlers } = await createRestProviderFactory({ fetchImpl: impl })(ctx({ credentialHandle: handle }));
        await expect(handlers.request({ path: '/a' }, dispatch('org_a'))).rejects.toBe(refusal);
        expect(sent).toHaveLength(0);
    });

    it('places a vendor token where the handle says: a header (DingTalk), or a query parameter (WeCom)', async () => {
        const { impl, sent } = scriptedFetch([200]);
        const header = fakeHandle((token) => ({ type: 'api-key', key: token, headerName: 'x-acs-dingtalk-access-token' }));
        const query = fakeHandle((token) => ({ type: 'api-key', key: token, headerName: 'access_token', paramName: 'access_token' }));
        const factory = createRestProviderFactory({ fetchImpl: impl });
        await (await factory(ctx({ credentialHandle: header.handle }))).handlers.request({ path: '/v1.0/x' }, dispatch());
        await (await factory(ctx({ credentialHandle: query.handle }))).handlers.request({ path: '/cgi-bin/x' }, dispatch());

        expect(sent[0].headers['x-acs-dingtalk-access-token']).toBe('tok-1');
        expect(new URL(sent[1].url).searchParams.get('access_token')).toBe('tok-1');
        expect(sent[1].headers.access_token).toBeUndefined();
    });

    it('⛔ a thrown transport error is scrubbed of the token a query parameter carried', async () => {
        const impl = (async (url: string) => { throw new Error(`connect failed for ${url}`); }) as unknown as typeof fetch;
        const { handle } = fakeHandle((token) => ({ type: 'api-key', key: `${token}-secretvalue`, headerName: 'access_token', paramName: 'access_token' }));
        const { handlers } = await createRestProviderFactory({ fetchImpl: impl })(
            ctx({ credentialHandle: handle, retryConfig: { strategy: 'no_retry' } as ConnectorProviderContext['retryConfig'] }),
        );
        const err = await handlers.request({ path: '/a' }, dispatch()).catch((e: unknown) => e as Error);
        expect(err.message).toContain('connect failed');
        expect(err.message).not.toContain('tok-1-secretvalue');
    });

    it('⛔ refuses a credential handle beside a static credential: a request is authenticated one way', () => {
        const { handle } = fakeHandle();
        expect(() => createRestProviderFactory()(ctx({ credentialHandle: handle, auth: { type: 'bearer', token: 't' } })))
            .toThrow(/a static 'bearer' credential and a credential handle/);
    });
});

describe('ConnectorRestPlugin — registers the provider as a credential-handle consumer (ADR-0143 D4)', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    /** Boot the automation service, the REST plugin and a registry declaring `declared`. */
    async function boot(declared: unknown[], credentialResolver: (ref: string) => string | undefined) {
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use(new AutomationServicePlugin({ credentialResolver }));
        kernel.use({
            name: 'test.registry',
            type: 'standard',
            version: '1.0.0',
            dependencies: ['com.objectstack.service-automation'],
            async init(c: { registerService(name: string, svc: unknown): void }) {
                c.registerService('objectql', { registry: { listItems: (t: string) => (t === 'connector' ? declared : []) } });
            },
            async start() {},
        } as never);
        kernel.use(new ConnectorRestPlugin());
        await kernel.bootstrap();
        return { kernel, engine: kernel.getService<AutomationEngine>('automation') };
    }

    it('says so on registration, so the host serves grant-bearing instances through it', async () => {
        const { kernel, engine } = await boot([], () => undefined);
        expect(engine.providerAppliesCredentialHandle('rest')).toBe(true);
        await kernel.shutdown();
    });

    it('⛔ end to end: a WeCom `app-credential` instance re-exchanges an early-invalidated token once and retries the call', async () => {
        const calls: string[] = [];
        let token = 0;
        let apiCalls = 0;
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
            const url = new URL(String(input));
            calls.push(`${url.host}${url.pathname}`);
            const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
            if (url.host === 'qyapi.weixin.qq.com' && url.pathname === '/cgi-bin/gettoken') {
                token += 1;
                return json({ errcode: 0, errmsg: 'ok', access_token: `wecom-token-${token}`, expires_in: 7200 });
            }
            apiCalls += 1;
            // WeCom answers an early-invalidated token inside an ordinary answer.
            return url.searchParams.get('access_token') === 'wecom-token-1'
                ? json({ errcode: 42001, errmsg: 'access_token expired' })
                : json({ errcode: 0, errmsg: 'ok', userid: 'zhangsan' });
        }));
        const { kernel, engine } = await boot(
            [{
                name: 'wecom_api',
                label: 'WeCom',
                type: 'api',
                provider: 'rest',
                providerConfig: { baseUrl: 'https://qyapi.weixin.qq.com' },
                auth: { type: 'app-credential', vendor: 'wecom', appId: 'ww_corp', credentialRef: 'WECOM_SECRET' },
            }],
            (ref) => (ref === 'WECOM_SECRET' ? 'corp-secret-value' : undefined),
        );

        expect(engine.getConnectorDegradedReason('wecom_api')).toBeUndefined();
        const out = await engine.resolveConnectorAction('wecom_api', 'request')!(
            { path: '/cgi-bin/user/get', query: { userid: 'zhangsan' } },
            { automation: { tenantId: 'org_a' } } as never,
        );

        expect(out).toMatchObject({ status: 200, body: { errcode: 0, userid: 'zhangsan' } });
        expect(token).toBe(2);
        expect(apiCalls).toBe(2);
        expect(calls).toEqual([
            'qyapi.weixin.qq.com/cgi-bin/gettoken',
            'qyapi.weixin.qq.com/cgi-bin/user/get',
            'qyapi.weixin.qq.com/cgi-bin/gettoken',
            'qyapi.weixin.qq.com/cgi-bin/user/get',
        ]);
        await kernel.shutdown();
    });
});
