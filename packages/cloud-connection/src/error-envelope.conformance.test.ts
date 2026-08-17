// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Error-envelope conformance for the `plugin-route` door (#9267).
 *
 * ## The door this covers, and why it had none
 *
 * A plugin that mounts its OWN Hono routes and answers refusals with its own
 * `c.json({ success: false, error: { … } })` is a THIRD way this platform emits
 * REST. Its bodies pass through neither the dispatcher's `errorFromThrown` nor
 * `packages/rest`'s responders, so none of the central narrowing and none of the
 * central conformance suites ever sees them. Measured on `origin/main` before
 * this file existed: `ApiErrorSchema|envelopeViolations|BaseResponseSchema`
 * matched ZERO lines anywhere in this package, source and tests alike, while
 * four plugin files here hand-build response envelopes.
 *
 * The tests that DID sit at this seam assert individual fields
 * (`res.payload.error.code`, `details.findings`). That is the assertion style
 * #3843 was filed about: it pins one key and notices nothing about the body
 * around it, so a body drifting off `BaseResponseSchema` keeps every one of them
 * green.
 *
 * ## What this file asserts, and what it deliberately does not
 *
 * Every case drives a REAL error exit through the route the plugin actually
 * mounts — `start()` + `kernel:ready`, the kernel's own lifecycle — and then
 * parses the emitted body against the declared contract rather than reading one
 * field off it:
 *
 *   1. `BaseResponseSchema.safeParse` — it parses as an envelope at all.
 *   2. `envelopeViolations` — it IS the declared envelope. `safeParse` alone
 *      passes `{ success: true }` with no payload and passes a payload
 *      duplicated into a stray top-level key (#4038 / #4049); this is the check
 *      that does not.
 *   3. `ApiErrorSchema.safeParse(body.error)` — the nested error is the declared
 *      error, INCLUDING that `code` is a member of the closed ADR-0112
 *      vocabulary. An invented spelling fails here rather than reaching a wire
 *      nobody audits, which is the specific way `UNIQUE_SCOPE_CONFIRMATION_REQUIRED`
 *      once shipped unregistered behind a green gate (#9246).
 *
 * The status and code are asserted too, but as the case's IDENTITY — proof the
 * exit under test is the one that ran — not as the conformance claim. A bare
 * `expect(...).toThrow()` or a lone `error.code` equality is not a rejection
 * pin: an unfixed producer emitting a naked `Error` keeps both green.
 *
 * What this file does NOT govern is the shape of `data`. That is each route's
 * own payload schema, and conflating the two is what let a payload type describe
 * a whole body before #3843.
 *
 * ## The other half
 *
 * A suite catches what it DRIVES. It structurally cannot see the exit nobody
 * wrote a case for, and this package's four plugin files carry ~80 hand-built
 * bodies between them. The structural half is
 * `scripts/check-route-envelope.mjs`, which counts non-conforming hand-built
 * Hono bodies across the whole repo as its third surface — added by #9267
 * alongside this file, for exactly that reason.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseResponseSchema, ApiErrorSchema, envelopeViolations } from '@objectstack/spec/api';
import { CloudConnectionPlugin } from './cloud-connection-plugin.js';
import { MarketplaceProxyPlugin } from './marketplace-proxy-plugin.js';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { RuntimeConfigPlugin } from './runtime-config-plugin.js';

// ── Shared harness ───────────────────────────────────────────────────────────

type Handler = (c: any, next?: any) => Promise<any>;
type Captured = { status: number; body: any };

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        put: (p: string, h: Handler) => routes.set(`PUT ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
        head: (p: string, h: Handler) => routes.set(`HEAD ${p}`, h),
        all: (p: string, h: Handler) => routes.set(`ALL ${p}`, h),
    };
}

/**
 * A Hono-ish context. `json` captures rather than serialises, so a case reads
 * the object the handler built — which is the thing the envelope governs.
 */
function makeC(opts: {
    url: string;
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
    headers?: Record<string, string>;
} ): { c: any; captured: Captured } {
    const captured: Captured = { status: 0, body: undefined };
    const h = new Headers(opts.headers ?? {});
    const c: any = {
        req: {
            url: opts.url,
            method: opts.method ?? 'GET',
            path: new URL(opts.url).pathname,
            raw: new Request(opts.url, { headers: h }),
            header: (n: string) => h.get(n) ?? undefined,
            json: async () => opts.body ?? {},
            param: (n: string) => opts.params?.[n],
            query: () => undefined,
        },
        header: () => undefined,
        json: (body: any, status?: number) => {
            captured.body = body;
            captured.status = status ?? 200;
            return captured;
        },
    };
    return { c, captured };
}

/**
 * The conformance assertion itself — the whole point of the file.
 *
 * Kept as one helper so every case is held to the SAME three checks: a case that
 * quietly dropped one would be indistinguishable from a case that passed it.
 */
function expectDeclaredErrorEnvelope(captured: Captured, expected: { status: number; code: string }) {
    const { status, body } = captured;
    const shown = JSON.stringify(body);

    // Identity of the exit under test — not the conformance claim.
    expect(status, `wrong exit ran: ${shown}`).toBe(expected.status);

    // 1. Parses as an envelope.
    const parsed = BaseResponseSchema.safeParse(body);
    expect(parsed.success, `body is not a BaseResponse: ${shown}`).toBe(true);

    // 2. IS the declared envelope — the check safeParse cannot express.
    expect(envelopeViolations(body), `not the declared envelope: ${shown}`).toEqual([]);

    // 3. The nested error is the declared error, code vocabulary included.
    expect(body.success).toBe(false);
    const err = ApiErrorSchema.safeParse(body.error);
    expect(
        err.success,
        `error is not an ApiError (an unregistered code fails HERE): ${shown} ${JSON.stringify(err.error?.issues ?? [])}`,
    ).toBe(true);
    expect(body.error.code).toBe(expected.code);

    // The pre-#3675 dialect and its #7035 sibling, explicitly dead on this door.
    expect(typeof body.error, `\`error\` is a bare string — the pre-#3675 dialect: ${shown}`).not.toBe('string');
    expect(body.code, `\`code\` sits BESIDE \`error\` rather than inside it: ${shown}`).toBeUndefined();
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
}

// ── CloudConnectionPlugin — /api/v1/cloud-connection/* ───────────────────────

const CC = '/api/v1/cloud-connection';
const HOST = 'https://tenant.example.com';

async function mountCloudConnection(opts: {
    controlPlaneUrl?: string;
    controlPlaneApiKey?: string;
    singleEnvironment?: boolean;
    environmentId?: string;
    userId?: string;
    resolvesEnvironment?: boolean;
} = {}) {
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const auth = {
        api: {
            getSession: async () => (opts.userId ? { user: { id: opts.userId }, session: {} } : null),
        },
    };
    const services: Record<string, any> = {
        'env-registry': {
            resolveByHostname: async () =>
                (opts.resolvesEnvironment ? { environmentId: 'env-123' } : undefined),
        },
        'kernel-manager': { getOrCreate: async () => ({ getServiceAsync: async () => auth }) },
        auth,
        manifest: { register: vi.fn() },
    };
    const ctx: any = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no service ${name}`);
            return svc;
        },
        registerService: () => undefined,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const plugin = new CloudConnectionPlugin({
        controlPlaneUrl: opts.controlPlaneUrl ?? 'http://cloud.test',
        controlPlaneApiKey: opts.controlPlaneApiKey,
        singleEnvironment: opts.singleEnvironment,
        environmentId: opts.environmentId,
    } as any);
    await plugin.start(ctx);
    await hooks.get('kernel:ready')?.();
    return rawApp.routes;
}

async function driveCloudConnection(
    routes: Map<string, Handler>,
    key: string,
    opts: { body?: unknown } = {},
): Promise<Captured> {
    const handler = routes.get(key);
    if (!handler) throw new Error(`no handler for ${key} (have: ${[...routes.keys()].join(', ')})`);
    const [method, path] = key.split(' ');
    const { c, captured } = makeC({ url: `${HOST}${path}`, method, body: opts.body });
    await handler(c);
    return captured;
}

beforeEach(() => { delete process.env.OS_ENVIRONMENT_ID; delete process.env.OS_CLOUD_URL; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.OS_ENVIRONMENT_ID; delete process.env.OS_CLOUD_URL; });

describe('plugin-route door — CloudConnectionPlugin error exits (#9267)', () => {
    it('GET /status with no resolvable environment → 404 in the declared envelope', async () => {
        const routes = await mountCloudConnection({ resolvesEnvironment: false });
        expectDeclaredErrorEnvelope(
            await driveCloudConnection(routes, `GET ${CC}/status`),
            { status: 404, code: 'ENVIRONMENT_NOT_FOUND' },
        );
    });

    it('POST /bind/start without a session → 401 in the declared envelope', async () => {
        const routes = await mountCloudConnection({ resolvesEnvironment: true });
        expectDeclaredErrorEnvelope(
            await driveCloudConnection(routes, `POST ${CC}/bind/start`, { body: {} }),
            { status: 401, code: 'UNAUTHENTICATED' },
        );
    });

    it('POST /bind/poll without a session → 401 in the declared envelope', async () => {
        const routes = await mountCloudConnection({ resolvesEnvironment: true });
        expectDeclaredErrorEnvelope(
            await driveCloudConnection(routes, `POST ${CC}/bind/poll`, { body: { device_code: 'dc_1' } }),
            { status: 401, code: 'UNAUTHENTICATED' },
        );
    });

    it('POST /bind/poll with no device_code → 400 in the declared envelope', async () => {
        const routes = await mountCloudConnection({ resolvesEnvironment: true, userId: 'usr_1' });
        expectDeclaredErrorEnvelope(
            await driveCloudConnection(routes, `POST ${CC}/bind/poll`, { body: {} }),
            { status: 400, code: 'INVALID_REQUEST' },
        );
    });

    it('POST /unbind without a session → 401 in the declared envelope', async () => {
        const routes = await mountCloudConnection({ resolvesEnvironment: true });
        expectDeclaredErrorEnvelope(
            await driveCloudConnection(routes, `POST ${CC}/unbind`, { body: {} }),
            { status: 401, code: 'UNAUTHENTICATED' },
        );
    });

    it('POST /install without a session → 401 in the declared envelope', async () => {
        const routes = await mountCloudConnection({ resolvesEnvironment: true });
        expectDeclaredErrorEnvelope(
            await driveCloudConnection(routes, `POST ${CC}/install`, { body: { package_id: 'pkg_1' } }),
            { status: 401, code: 'UNAUTHENTICATED' },
        );
    });

    it('POST /install with a session but no cloud credential → 503 in the declared envelope', async () => {
        const routes = await mountCloudConnection({ resolvesEnvironment: true, userId: 'usr_1' });
        expectDeclaredErrorEnvelope(
            await driveCloudConnection(routes, `POST ${CC}/install`, { body: { package_id: 'pkg_1' } }),
            { status: 503, code: 'CLOUD_UNCONFIGURED' },
        );
    });

    it('POST /install past the credential gate with no package_id → 400 in the declared envelope', async () => {
        const routes = await mountCloudConnection({
            resolvesEnvironment: true, userId: 'usr_1', controlPlaneApiKey: 'svc-key',
        });
        expectDeclaredErrorEnvelope(
            await driveCloudConnection(routes, `POST ${CC}/install`, { body: {} }),
            { status: 400, code: 'INVALID_REQUEST' },
        );
    });

    it('GET /installed without a session → 401 in the declared envelope', async () => {
        const routes = await mountCloudConnection({ resolvesEnvironment: true });
        expectDeclaredErrorEnvelope(
            await driveCloudConnection(routes, `GET ${CC}/installed`),
            { status: 401, code: 'UNAUTHENTICATED' },
        );
    });

    it('GET /org-packages without a session → 401 in the declared envelope', async () => {
        const routes = await mountCloudConnection({ resolvesEnvironment: true });
        expectDeclaredErrorEnvelope(
            await driveCloudConnection(routes, `GET ${CC}/org-packages`),
            { status: 401, code: 'UNAUTHENTICATED' },
        );
    });

    /**
     * The exit this suite was worth writing for.
     *
     * `/bind/poll` relays RFC 8628 token-endpoint errors. Their spellings —
     * `expired_token`, `access_denied`, `invalid_grant` — are the UPSTREAM
     * vocabulary, and stamping one into `error.code` emitted a body that failed
     * its own contract twice over: an unregistered code in the closed ADR-0112
     * slot, and no `message` at all. Neither was visible to any assertion at
     * this seam, because none of them parsed the body.
     *
     * The verbatim spelling still reaches the caller — on `declaredCode`, the
     * open producer-authored channel ADR-0112 declares for precisely this case.
     * That is asserted here rather than left implicit: dropping it would be a
     * silent loss of what the caller used to be told.
     */
    it('POST /bind/poll relaying a terminal RFC 8628 error → 400 with the upstream spelling on `declaredCode`', async () => {
        const routes = await mountCloudConnection({ resolvesEnvironment: true, userId: 'usr_1' });
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 400,
            json: async () => ({ error: 'expired_token' }),
        })));

        const captured = await driveCloudConnection(routes, `POST ${CC}/bind/poll`, {
            body: { device_code: 'dc_expired' },
        });

        expectDeclaredErrorEnvelope(captured, { status: 400, code: 'DEVICE_CODE_FAILED' });
        expect(captured.body.error.declaredCode).toBe('expired_token');
        expect(captured.body.error.message).toContain('expired_token');
    });

    /**
     * The non-terminal half of the same exit, kept beside it: `authorization_pending`
     * is a 200 the Console polls on, and it must be a conformant SUCCESS body —
     * a success envelope carrying no `data`, or carrying a stray `error` key, is
     * exactly what `envelopeViolations` exists to catch.
     */
    it('POST /bind/poll while authorization is pending → 200 success envelope, no `error` key', async () => {
        const routes = await mountCloudConnection({ resolvesEnvironment: true, userId: 'usr_1' });
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 400,
            json: async () => ({ error: 'authorization_pending' }),
        })));

        const { status, body } = await driveCloudConnection(routes, `POST ${CC}/bind/poll`, {
            body: { device_code: 'dc_pending' },
        });

        expect(status).toBe(200);
        expect(BaseResponseSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
        expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);
        expect(body.success).toBe(true);
        expect(body.data.pending).toBe(true);
    });
});

// ── MarketplaceProxyPlugin — /api/v1/marketplace/* ───────────────────────────

async function mountMarketplaceProxy(controlPlaneUrl: string) {
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const ctx: any = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => (name === 'http-server' ? { getRawApp: () => rawApp } : undefined),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    await new MarketplaceProxyPlugin({ controlPlaneUrl, cacheDisabled: true } as any).start(ctx);
    await hooks.get('kernel:ready')?.();
    return rawApp.routes.get('ALL /api/v1/marketplace/*')!;
}

describe('plugin-route door — MarketplaceProxyPlugin error exits (#9267)', () => {
    it('GET with no control plane configured → 503 in the declared envelope', async () => {
        const handler = await mountMarketplaceProxy('off');
        const { c, captured } = makeC({
            url: 'http://env.test/api/v1/marketplace/packages',
            method: 'GET',
        });
        await handler(c, async () => 'NEXT');
        expectDeclaredErrorEnvelope(captured, { status: 503, code: 'MARKETPLACE_UNAVAILABLE' });
    });

    it('GET whose upstream fetch throws → 502 in the declared envelope', async () => {
        const handler = await mountMarketplaceProxy('http://cloud.test');
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
        const { c, captured } = makeC({
            url: 'http://env.test/api/v1/marketplace/packages',
            method: 'GET',
        });
        await handler(c, async () => 'NEXT');
        expectDeclaredErrorEnvelope(captured, { status: 502, code: 'MARKETPLACE_PROXY_FAILED' });
    });
});

// ── MarketplaceInstallLocalPlugin — /api/v1/marketplace/install-local ────────

const IL = '/api/v1/marketplace/install-local';

async function mountInstallLocal(opts: { storageDir: string; userId?: string; controlPlaneUrl?: string }) {
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const services: Record<string, any> = {
        manifest: { register: vi.fn() },
        auth: {
            api: {
                getSession: async () => (opts.userId ? { user: { id: opts.userId }, session: {} } : null),
            },
        },
        objectql: { syncSchemas: vi.fn(async () => undefined), find: async () => [] },
        metadata: {},
    };
    const ctx: any = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no service ${name}`);
            return svc;
        },
        registerService: () => undefined,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const plugin = new MarketplaceInstallLocalPlugin({
        controlPlaneUrl: opts.controlPlaneUrl ?? 'off',
        storageDir: opts.storageDir,
    } as any);
    await plugin.start(ctx);
    await hooks.get('kernel:ready')?.();
    return rawApp.routes;
}

describe('plugin-route door — MarketplaceInstallLocalPlugin error exits (#9267)', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-envelope-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('POST without a session → 401 in the declared envelope', async () => {
        const routes = await mountInstallLocal({ storageDir: dir });
        const handler = routes.get(`POST ${IL}`)!;
        const { c, captured } = makeC({
            url: `http://env.test${IL}`,
            method: 'POST',
            body: { packageId: 'pkg_1' },
        });
        await handler(c);
        expectDeclaredErrorEnvelope(captured, { status: 401, code: 'UNAUTHENTICATED' });
    });

    it('GET (the listing) without a session → 401 in the declared envelope', async () => {
        const routes = await mountInstallLocal({ storageDir: dir });
        const handler = routes.get(`GET ${IL}`)!;
        const { c, captured } = makeC({ url: `http://env.test${IL}`, method: 'GET' });
        await handler(c);
        expectDeclaredErrorEnvelope(captured, { status: 401, code: 'UNAUTHENTICATED' });
    });

    it('DELETE without a session → 401 in the declared envelope', async () => {
        const routes = await mountInstallLocal({ storageDir: dir });
        const handler = routes.get(`DELETE ${IL}/:manifestId`)!;
        const { c, captured } = makeC({
            url: `http://env.test${IL}/app.test.crm`,
            method: 'DELETE',
            params: { manifestId: 'app.test.crm' },
        });
        await handler(c);
        expectDeclaredErrorEnvelope(captured, { status: 401, code: 'UNAUTHENTICATED' });
    });
});

// ── RuntimeConfigPlugin — the one exit that is NOT enveloped ─────────────────

/**
 * `GET /api/v1/runtime/config` answers a BARE payload —
 * `{ cloudUrl, singleEnvironment, defaultOrgId, defaultEnvironmentId, features,
 * branding }` — with no `success` flag and six top-level keys the envelope does
 * not declare.
 *
 * ⚠️ This is NOT blessed, and this pin is not an assertion that the shape is
 * right. It is the honest record of measured drift, in the same spirit as the
 * gate's `ratchet` state: the day someone envelopes this route, this test goes
 * red and tells them to delete it, which is exactly what a silent `it.skip` or a
 * missing case would fail to do.
 *
 * It is deliberately NOT fixed in #9267. The route is a discovery endpoint read
 * bare by the Console SPA before first paint — `initRuntimeConfig()` in
 * objectui's `app-shell/src/runtime-config.ts` reads `body.cloudUrl`,
 * `body.features`, `body.branding` off the top level — so enveloping it is a
 * cross-repo breaking wire change, not the "small and local to an error exit"
 * fix this card admits. Filed as #9364; the gate's third surface carries the
 * matching ratchet.
 */
describe('plugin-route door — RuntimeConfigPlugin is NOT enveloped (recorded, not blessed) (#9267)', () => {
    it('GET /runtime/config answers a bare payload — measured drift, pinned so a fix cannot pass unnoticed', async () => {
        const rawApp = makeRawApp();
        const hooks = new Map<string, any>();
        const ctx: any = {
            hook: (e: string, h: any) => hooks.set(e, h),
            getService: (name: string) =>
                (name === 'http-server' ? { getRawApp: () => rawApp, getApp: () => rawApp } : undefined),
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        };
        await new RuntimeConfigPlugin({ cloudUrl: 'http://cloud.test' } as any).start(ctx);
        await hooks.get('kernel:ready')?.();

        const handler = rawApp.routes.get('GET /api/v1/runtime/config');
        expect(handler, 'runtime/config was never mounted').toBeTypeOf('function');

        const { c, captured } = makeC({ url: 'http://env.test/api/v1/runtime/config' });
        await handler!(c);

        // The body does not parse as an envelope, and every reason is recorded.
        expect(BaseResponseSchema.safeParse(captured.body).success).toBe(false);
        expect(envelopeViolations(captured.body)).toEqual([
            'success is missing, must be a boolean',
            'stray top-level key `cloudUrl` — the payload belongs under `data`',
            'stray top-level key `singleEnvironment` — the payload belongs under `data`',
            'stray top-level key `defaultOrgId` — the payload belongs under `data`',
            'stray top-level key `defaultEnvironmentId` — the payload belongs under `data`',
            'stray top-level key `features` — the payload belongs under `data`',
            'stray top-level key `branding` — the payload belongs under `data`',
        ]);
    });
});
