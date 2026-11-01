// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27627] `GET /api/v1/runtime/config` — the first request every Console load
 * makes, measured on the cloud at 0.5–1.4 s for 293 bytes with no
 * `Cache-Control` and no `ETag`. It now answers the weak validator of the
 * payload it serves (`representationEtag`, `@objectstack/types`), `private,
 * no-cache`, and a bodiless `304` on a matching `If-None-Match`; the payload is
 * per host and read per request, both inside the hashed bytes.
 *
 * And the per-request `Server-Timing` gate: this route serves everyone and
 * resolved nobody, so an admin's `X-OS-Debug-Timing` never opened the gate
 * here (the one route of 58 measured on `main` with no timing for an admin).
 * The caller is resolved only when that header is sent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithPerfDisclosure, type PerfDisclosureGate } from '@objectstack/observability';

// A plain recorder rather than a `vi.fn`: a spy wraps a rejected promise in a
// derived one nobody awaits, which vitest reports as unhandled even though
// the route catches the original.
const resolver = {
    calls: 0,
    answer: (async () => undefined) as () => Promise<unknown>,
};
vi.mock('@objectstack/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@objectstack/core')>()),
    resolveRequestExecutionContext: () => { resolver.calls += 1; return resolver.answer(); },
}));

const { RuntimeConfigPlugin } = await import('./runtime-config-plugin.js');

interface Answer { status: number; body: any; headers: Record<string, string> }

async function mountHandler(opts: { host?: string; resolveByHostname?: (h: string) => Promise<any> } = {}) {
    let handler: ((c: any) => Promise<Answer>) | undefined;
    const rawApp = {
        routes: [] as Array<{ method: string; path: string }>,
        get(path: string, h: (c: any) => Promise<Answer>) {
            this.routes.push({ method: 'GET', path });
            if (path === '/api/v1/runtime/config') handler = h;
        },
    };
    const services: Record<string, any> = { 'http-server': { getRawApp: () => rawApp }, auth: {}, objectql: {} };
    if (opts.resolveByHostname) services['env-registry'] = { resolveByHostname: opts.resolveByHostname };
    const ctx: any = {
        logger: { info() {}, warn() {} },
        getService: (n: string) => { const s = services[n]; if (!s) throw new Error(`no ${n}`); return s; },
        hooks: [] as Array<() => Promise<void>>,
        hook(_e: string, cb: () => Promise<void>) { this.hooks.push(cb); },
    };
    const plugin = new RuntimeConfigPlugin({ controlPlaneUrl: '' });
    await plugin.start(ctx);
    for (const cb of ctx.hooks) await cb();
    if (!handler) throw new Error('handler not mounted');
    // A Hono-shaped context that keeps what the handler hands `json` / `body`.
    return (requestHeaders: Record<string, string> = {}): Promise<Answer> => {
        const all: Record<string, string> = { host: opts.host ?? '', ...requestHeaders };
        return handler!({
            req: { header: (n: string) => all[n.toLowerCase()], raw: { headers: new Headers(all) } },
            json: (body: any, status = 200, headers: Record<string, string> = {}) => ({ status, body, headers }),
            body: (body: any, status = 200, headers: Record<string, string> = {}) => ({ status, body, headers }),
        });
    };
}

beforeEach(() => { resolver.calls = 0; resolver.answer = async () => undefined; });

describe('[#27627] runtime/config answers a validator of the payload it serves', () => {
    it('a weak ETag and private, no-cache — never public', async () => {
        const get = await mountHandler();
        const res = await get();
        expect(res.status).toBe(200);
        expect(res.headers.ETag).toMatch(/^W\/"[0-9a-f]{16}"$/);
        expect(res.headers['Cache-Control']).toBe('private, no-cache');
    });

    it('an unchanged payload revalidates to a bodiless 304', async () => {
        const get = await mountHandler();
        const etag = (await get()).headers.ETag;
        const again = await get({ 'if-none-match': etag });
        expect(again.status).toBe(304);
        expect(again.body).toBeNull();
        expect(again.headers.ETag).toBe(etag);
    });

    it('two hosts resolving different environments hold different tags; one never revalidates the other', async () => {
        const resolveByHostname = async (h: string) => (h === 'a.example.com' ? { environmentId: 'env_a' } : { environmentId: 'env_b' });
        const a = await (await mountHandler({ host: 'a.example.com', resolveByHostname }))();
        const getB = await mountHandler({ host: 'b.example.com', resolveByHostname });
        const b = await getB();
        expect(a.headers.ETag).not.toBe(b.headers.ETag);
        const crossed = await getB({ 'if-none-match': a.headers.ETag });
        expect(crossed.status).toBe(200);
        expect(crossed.body.defaultEnvironmentId).toBe('env_b');
    });

    it('the response never depends on who asked: no caller is resolved without the timing header', async () => {
        const get = await mountHandler();
        await get();
        await get({ cookie: 'session=abc' });
        expect(resolver.calls).toBe(0);
    });
});

describe('[#27627] runtime/config opens the per-request Server-Timing gate for an admin only', () => {
    const timed = async (posture: string | undefined, headers: Record<string, string>) => {
        resolver.answer = async () => (posture === undefined ? undefined : { userId: 'u1', posture });
        const get = await mountHandler();
        const gate: PerfDisclosureGate = { allowed: false };
        const res = await runWithPerfDisclosure(gate, () => get(headers));
        return { gate, res };
    };

    it('an admin who sends X-OS-Debug-Timing opens it', async () => {
        const { gate, res } = await timed('PLATFORM_ADMIN', { 'x-os-debug-timing': '1' });
        expect(gate.allowed).toBe(true);
        expect(resolver.calls).toBe(1);
        expect(res.status).toBe(200);
    });

    it('a member who sends it does not, and neither does a sessionless caller', async () => {
        expect((await timed('MEMBER', { 'x-os-debug-timing': '1' })).gate.allowed).toBe(false);
        expect((await timed(undefined, { 'x-os-debug-timing': '1' })).gate.allowed).toBe(false);
    });

    it('a resolution that fails leaves the gate closed and serves the payload unchanged', async () => {
        resolver.answer = async () => { throw new Error('authz store unavailable'); };
        const get = await mountHandler();
        const gate: PerfDisclosureGate = { allowed: false };
        const res = await runWithPerfDisclosure(gate, () => get({ 'x-os-debug-timing': '1' }));
        expect(gate.allowed).toBe(false);
        expect(res.status).toBe(200);
        expect(res.body.features).toBeDefined();
    });
});
