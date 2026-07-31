// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// cloud#927 — WHICH kernel answers the current-user endpoints.
//
// These three resolved their answer from the locator captured at REGISTRATION
// time. On a single-environment host that is the only kernel and therefore
// right. On a multi-tenant host it is the routing shell: cloud's
// `ArtifactKernelFactory` mounts `AuthPlugin` per ENVIRONMENT, and its host
// kernel deliberately has no `auth` at all ("AuthPlugin is intentionally NOT
// injected on the host"). So `ctx.getService('auth')` threw there, `resolveCtx`
// fell to its catch, and every authenticated tenant caller got
// `{authenticated:false}` — which objectui's `MePermissionsProvider` reads as
// ANONYMOUS and fails OPEN on (`return data.authenticated !== true`). The
// server still enforces per request, so it was not a bypass; the client's FLS
// hints were just systematically wrong.
//
// The framework already declares the seam for this: `kernel-resolver`
// (ADR-0006 Phase 5), which the dispatcher has consulted since. These endpoints
// not consulting it was the defect.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { registerCurrentUserEndpoints } from './current-user-endpoints';

const ME_PERMISSIONS = '/api/v1/auth/me/permissions';
const ME_LOCALIZATION = '/api/v1/auth/me/localization';
const ME_APPS = '/api/v1/me/apps';

/** A kernel stub whose `getService` throws for anything not seeded (like the real one). */
function kernelWith(services: Record<string, any>) {
    return {
        getService: <T,>(name: string): T => {
            if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
            return services[name] as T;
        },
    };
}

/** An `auth` service that resolves one fixed user. */
const authFor = (userId: string, extra: Record<string, unknown> = {}) => ({
    api: { getSession: vi.fn(async () => ({ user: { id: userId }, session: extra })) },
});

/**
 * Mount on a bare Hono app over `hostServices`. `resolveKernel` is installed as
 * the host's `kernel-resolver` service — after registration, so the tests also
 * pin that the seam is read LAZILY (cloud registers these routes before
 * `kernel.bootstrap()`, i.e. before the plugin that registers the resolver has
 * run its `init()`; capturing the service at registration time would find
 * nothing and silently keep the old behaviour).
 */
function mount(hostServices: Record<string, any>, resolveKernel?: (...a: any[]) => any) {
    const app = new Hono();
    const services: Record<string, any> = { ...hostServices };
    const kernel = kernelWith(services);
    const ctx = {
        logger: { debug() {}, warn() {} },
        getService: <T,>(name: string): T => kernel.getService<T>(name),
        getKernel: () => kernel,
    };

    registerCurrentUserEndpoints({ rawApp: app, ctx });

    // Registered AFTER — the lazy read is what makes this visible.
    if (resolveKernel) services['kernel-resolver'] = { resolveKernel };

    return { app, kernel, services };
}

const get = (app: any, path: string) =>
    app.request(`http://tenant.example.com${path}`, { headers: { host: 'tenant.example.com' } });

describe('the answer comes from the kernel that OWNS the request (cloud#927)', () => {
    it('a resolved environment kernel answers, not the routing shell', async () => {
        // The shell has no `auth` — exactly cloud's objectos host.
        const envKernel = kernelWith({ auth: authFor('usr_env') });
        const { app } = mount({}, async () => envKernel);

        const res = await get(app, ME_PERMISSIONS);

        expect(res.status).toBe(200);
        // Before this, the shell's missing `auth` made this `{authenticated:false}`
        // for every real caller — the fail-open the client then inherited.
        expect(await res.json()).toMatchObject({ authenticated: true, userId: 'usr_env' });
    });

    it('prefers the environment kernel over a host that DOES have auth', async () => {
        // Pins that resolution wins rather than merely filling a gap: a host with
        // its own identity must not answer for a tenant request.
        const envKernel = kernelWith({ auth: authFor('usr_env') });
        const { app } = mount({ auth: authFor('usr_host') }, async () => envKernel);

        expect(await (await get(app, ME_PERMISSIONS)).json()).toMatchObject({ userId: 'usr_env' });
    });

    it('routes /auth/me/localization and /me/apps through the same resolution', async () => {
        const envKernel = kernelWith({
            auth: authFor('usr_env'),
            // [#4251] `registry`, the public accessor — this stub pinned the
            // private `_registry` the handler used to reach through `as any`.
            objectql: { registry: { getAllApps: () => [{ name: 'env_app' }] } },
        });
        const { app } = mount({}, async () => envKernel);

        expect(await (await get(app, ME_LOCALIZATION)).json()).toMatchObject({ authenticated: true });
        expect(await (await get(app, ME_APPS)).json()).toEqual({ apps: [{ name: 'env_app' }] });
    });

    it('hands the resolver the prefix-stripped routePath the dispatcher would', async () => {
        // cloud's resolver applies its own path policy to `routePath` (control-plane
        // prefixes skip environment resolution), so the shape has to match.
        const seen: any[] = [];
        const envKernel = kernelWith({ auth: authFor('usr_env') });
        const { app, kernel } = mount({}, async (context: any, defaultKernel: any) => {
            seen.push({ routePath: context.routePath, isDefault: defaultKernel === kernel, headers: context.request?.headers });
            return envKernel;
        });

        await get(app, ME_PERMISSIONS);
        await get(app, ME_APPS);

        expect(seen.map((s) => s.routePath)).toEqual(['/auth/me/permissions', '/me/apps']);
        // The seam's second argument is the host kernel, as `KernelResolver` declares.
        expect(seen.every((s) => s.isDefault)).toBe(true);
        // Cloud's resolver reads `host` / `x-environment-id` off these.
        expect(seen[0].headers).toBeInstanceOf(Headers);
    });
});

describe('the default kernel still answers where the seam says it should', () => {
    it('no kernel-resolver at all — single-environment hosts are untouched', async () => {
        const { app } = mount({ auth: authFor('usr_host') });

        expect(await (await get(app, ME_PERMISSIONS)).json()).toMatchObject({ userId: 'usr_host' });
    });

    it('resolver returns undefined — the contract for an unscoped request', async () => {
        const { app } = mount({ auth: authFor('usr_host') }, async () => undefined);

        expect(await (await get(app, ME_PERMISSIONS)).json()).toMatchObject({ userId: 'usr_host' });
    });

    it('resolver hands back the default kernel itself', async () => {
        const { app, kernel } = mount({ auth: authFor('usr_host') }, async (_c: any, d: any) => d ?? kernel);

        expect(await (await get(app, ME_PERMISSIONS)).json()).toMatchObject({ userId: 'usr_host' });
    });

    it('a locator with no getKernel cannot be asked, so it answers itself', async () => {
        // Documented downgrade, not a neutral choice — a multi-tenant host that
        // omits `getKernel` gets the old (wrong) provenance back.
        const app = new Hono();
        const kernel = kernelWith({ auth: authFor('usr_host'), 'kernel-resolver': { resolveKernel: vi.fn() } });
        registerCurrentUserEndpoints({
            rawApp: app,
            ctx: { logger: { debug() {}, warn() {} }, getService: (n) => kernel.getService(n) },
        });

        expect(await (await get(app, ME_PERMISSIONS)).json()).toMatchObject({ userId: 'usr_host' });
    });
});

describe('a kernel that cannot be reached is a retryable error, never a fake anonymous', () => {
    it('surfaces a warming 503 with Retry-After', async () => {
        // cloud's `KernelWarmingError` shape: a cold environment kernel past the
        // wait budget. AuthProxyPlugin already answers 503 + Retry-After for it.
        // Only `statusCode` + `retryAfterSeconds` are load-bearing — its `code` is
        // read for the log line alone, so the fixture omits it rather than carry a
        // lowercase literal in a `code:` position (ADR-0112 D1).
        const warming = Object.assign(new Error('kernel warming'), {
            statusCode: 503, retryAfterSeconds: 4,
        });
        const { app } = mount({}, async () => { throw warming; });

        const res = await get(app, ME_PERMISSIONS);

        expect(res.status).toBe(503);
        expect(res.headers.get('Retry-After')).toBe('4');
        expect(await res.json()).toMatchObject({ error: 'environment_unavailable' });
    });

    it('a resolver failure with no status is a 503, not a fall-back to the shell', async () => {
        // Falling back would answer `{authenticated:false}` off the shell, which the
        // client reads as anonymous and fails OPEN on — worse than a retryable error.
        const { app } = mount({ auth: authFor('usr_host') }, async () => { throw new Error('registry down'); });

        const res = await get(app, ME_PERMISSIONS);

        expect(res.status).toBe(503);
        expect(await res.json()).not.toMatchObject({ authenticated: false });
    });

    it('applies to all three endpoints', async () => {
        const { app } = mount({}, async () => { throw new Error('registry down'); });

        for (const path of [ME_PERMISSIONS, ME_LOCALIZATION, ME_APPS]) {
            expect((await get(app, path)).status, path).toBe(503);
        }
    });

    it('passes a 4xx from the resolver through unchanged', async () => {
        const denied = Object.assign(new Error('nope'), { statusCode: 403 });
        const { app } = mount({}, async () => { throw denied; });

        expect((await get(app, ME_PERMISSIONS)).status).toBe(403);
    });
});
