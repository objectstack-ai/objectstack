// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AuthProxyPlugin
 *
 * Mounts a single `/api/v1/auth/*` wildcard route on the host's Hono server
 * that forwards every request to the per-project `AuthManager` registered
 * by `ArtifactKernelFactory`.
 *
 * Why a dedicated plugin: AuthPlugin (better-auth) registers its routes by
 * grabbing the host's `http-server` service from its own `PluginContext`.
 * In objectos runtime mode AuthPlugin lives on a per-project kernel — it
 * has no access to the host's HTTP server, so its `kernel:ready` route
 * registration is a no-op. The dispatcher plugin's wildcard registration
 * via `IHttpServer.post('/auth/*', …)` proved unreliable in practice,
 * so this plugin uses Hono's raw app directly (same path AuthPlugin took
 * historically) which is rock solid.
 *
 * Routing:
 *   1. Resolve the project from the request hostname via `env-registry`.
 *   2. Acquire the project's kernel via `kernel-manager`.
 *   3. Look up the `auth` service on that kernel — this is the better-auth
 *      handler injected by `ArtifactKernelFactory`.
 *   4. Build a Web `Request` using the project's canonical baseUrl and
 *      hand it to the better-auth handler.
 *   5. Stream the response back through Hono.
 */

import type { Plugin, PluginContext } from '@objectstack/core';
import type { KernelManager } from './kernel-manager.js';
import type { EnvironmentDriverRegistry } from './environment-registry.js';

const AUTH_PREFIX = '/api/v1/auth';

// AuthCapableManager interface removed — unused (pickHandler uses duck typing on `any`).

function pickHandler(svc: any): ((req: Request) => Promise<Response>) | undefined {
    if (!svc) return undefined;
    // AuthManager exposes handleRequest(req) — preferred entry point.
    if (typeof svc.handleRequest === 'function') return svc.handleRequest.bind(svc);
    if (typeof svc.handler === 'function') return svc.handler.bind(svc);
    if (svc.api && typeof svc.api.handler === 'function') return svc.api.handler.bind(svc.api);
    // AuthManager keeps the better-auth instance under `auth`.
    if (svc.auth && typeof svc.auth.handler === 'function') return svc.auth.handler.bind(svc.auth);
    return undefined;
}

async function resolveAuthHandler(svc: any): Promise<((req: Request) => Promise<Response>) | undefined> {
    const direct = pickHandler(svc);
    if (direct) return direct;
    if (typeof svc?.getApi === 'function') {
        try {
            const api = await svc.getApi();
            return pickHandler(api) ?? pickHandler({ api });
        } catch {
            return undefined;
        }
    }
    return undefined;
}

export class AuthProxyPlugin implements Plugin {
    readonly name = 'com.objectstack.runtime.auth-proxy';
    readonly version = '1.0.0';

    init = async (_ctx: PluginContext): Promise<void> => {
        // No services registered — pure HTTP wiring during start().
    };

    start = async (ctx: PluginContext): Promise<void> => {
        // Mount routes on kernel:ready so HonoServerPlugin has finished
        // registering the http-server service. Doing this in start() can
        // race with HonoServerPlugin.init/start ordering.
        ctx.hook('kernel:ready', async () => {
            let httpServer: any;
            try {
                httpServer = ctx.getService('http-server');
            } catch {
                ctx.logger?.warn?.('[AuthProxyPlugin] http-server not available — auth routes not mounted');
                return;
            }
            if (!httpServer || typeof httpServer.getRawApp !== 'function') {
                ctx.logger?.warn?.('[AuthProxyPlugin] http-server missing getRawApp() — auth routes not mounted');
                return;
            }

            const rawApp = httpServer.getRawApp();
            const kernelManager = ctx.getService<KernelManager>('kernel-manager');
            const envRegistry = ctx.getService<EnvironmentDriverRegistry>('env-registry');

            const handler = async (c: any) => {
                try {
                    const url = new URL(c.req.url);
                    const host = url.hostname;
                    let projectId: string | undefined;
                    try {
                        const env = await envRegistry.resolveByHostname(host);
                        projectId = env?.projectId;
                    } catch {
                        // ignore
                    }
                    if (!projectId) {
                        return c.json({ error: 'project_not_found', host }, 404);
                    }

                    const projectKernel = await kernelManager.getOrCreate(projectId);
                    let authSvc: any;
                    try {
                        authSvc = await (projectKernel as any).getServiceAsync?.('auth');
                    } catch { authSvc = undefined; }
                    if (!authSvc) {
                        try { authSvc = (projectKernel as any).getService?.('auth'); } catch { /* ignore */ }
                    }

                    // Custom non-better-auth endpoints. better-auth has no
                    // /config or /bootstrap-status route, so without these
                    // short-circuits the request would fall through to the
                    // better-auth handler and 404. The Account SPA needs
                    // /config to render the "Continue with ObjectStack"
                    // platform SSO button via SocialSignInButtons.
                    const subPath = url.pathname.startsWith(AUTH_PREFIX + '/')
                        ? url.pathname.substring(AUTH_PREFIX.length + 1)
                        : '';
                    if (c.req.method === 'GET' && (subPath === 'config' || subPath === 'bootstrap-status')) {
                        if (subPath === 'config') {
                            try {
                                const config = typeof authSvc?.getPublicConfig === 'function'
                                    ? authSvc.getPublicConfig()
                                    : null;
                                if (config) {
                                    return c.json({ success: true, data: config });
                                }
                                return c.json({ success: false, error: { code: 'auth_config_unavailable', message: 'AuthManager has no getPublicConfig()' } }, 503);
                            } catch (e: any) {
                                return c.json({ success: false, error: { code: 'auth_config_error', message: String(e?.message ?? e) } }, 500);
                            }
                        }
                        // bootstrap-status
                        try {
                            // When platform SSO is wired (cloud's
                            // objectstack-cloud OIDC provider is advertised),
                            // identity is delegated to the cloud control
                            // plane. The local sys_user table is empty by
                            // design — it gets JIT-populated on first
                            // successful SSO callback. We must NEVER force
                            // the tenant /setup wizard in that case: it
                            // would create a local owner whose credentials
                            // are unreachable (no /login form will be shown
                            // since SSO auto-redirect kicks in next visit).
                            try {
                                const pubCfg = typeof authSvc?.getPublicConfig === 'function'
                                    ? authSvc.getPublicConfig()
                                    : null;
                                const ssoProviders: Array<{ id?: string; enabled?: boolean }> = Array.isArray(pubCfg?.socialProviders)
                                    ? pubCfg.socialProviders
                                    : [];
                                const ssoWired = ssoProviders.some(
                                    (p) => p?.enabled !== false && p?.id === 'objectstack-cloud',
                                );
                                if (ssoWired) {
                                    return c.json({ hasOwner: true });
                                }
                            } catch {
                                // fall through to local count
                            }
                            const dataEngine = typeof authSvc?.getDataEngine === 'function'
                                ? authSvc.getDataEngine()
                                : null;
                            if (!dataEngine || typeof dataEngine.count !== 'function') {
                                return c.json({ hasOwner: true });
                            }
                            const count = await dataEngine.count('sys_user', {});
                            return c.json({ hasOwner: (count ?? 0) > 0 });
                        } catch {
                            return c.json({ hasOwner: true });
                        }
                    }

                    const fn = await resolveAuthHandler(authSvc);
                    if (!fn) {
                        return c.json({ error: 'auth_service_unavailable', projectId }, 503);
                    }

                    // Forward the original Web Request directly — better-auth
                    // accepts a standard `Request` and returns a `Response`.
                    const resp = await fn(c.req.raw);

                    // ── Cookie-leak cleanup ─────────────────────────────────
                    // Cloud previously set OS_COOKIE_DOMAIN=.objectos.app,
                    // which made cloud's better-auth session cookies leak
                    // into every *.objectos.app project subdomain and
                    // collide with each project's own session_token.
                    // The setting has been removed from cloud, but existing
                    // browsers still carry the wide-scoped cookies. Append
                    // delete instructions (Max-Age=0 + matching Domain) on
                    // every per-project auth response so the leaked cookies
                    // get drained on the next auth round-trip. Safe to keep
                    // long-term: it only deletes cookies on a parent domain
                    // that project containers never legitimately set.
                    const rootDomain = process.env.OS_ROOT_DOMAIN || '';
                    if (rootDomain) {
                        const leakyDomain = rootDomain.startsWith('.') ? rootDomain : `.${rootDomain}`;
                        const leakyNames = [
                            '__Secure-better-auth.session_token',
                            'better-auth.session_token',
                            '__Secure-better-auth.state',
                            'better-auth.state',
                            '__Secure-better-auth.csrf_token',
                            'better-auth.csrf_token',
                        ];
                        try {
                            for (const n of leakyNames) {
                                const isSecure = n.startsWith('__Secure-');
                                const attrs = `Max-Age=0; Path=/; Domain=${leakyDomain}; SameSite=Lax${isSecure ? '; Secure' : ''}`;
                                (resp as any).headers?.append?.('Set-Cookie', `${n}=; ${attrs}`);
                            }
                        } catch { /* best-effort cleanup */ }
                    }

                    return resp;
                } catch (err: any) {
                    (ctx.logger?.error as any)?.('[AuthProxyPlugin] auth dispatch failed', {
                        error: err?.message,
                        stack: err?.stack,
                    });
                    return c.json({
                        error: 'auth_dispatch_failed',
                        message: err?.message ?? String(err),
                    }, 500);
                }
            };

            // Mount on every method via Hono's `all`. AuthPlugin previously
            // registered with `rawApp.all('/api/v1/auth/*', handler)` — same
            // shape here.
            if (typeof rawApp.all === 'function') {
                rawApp.all(`${AUTH_PREFIX}/*`, handler);
            } else {
                for (const m of ['get', 'post', 'put', 'delete', 'patch', 'options'] as const) {
                    try { rawApp[m]?.(`${AUTH_PREFIX}/*`, handler); } catch { /* best effort */ }
                }
            }
            ctx.logger?.info?.(`[AuthProxyPlugin] auth proxy mounted at ${AUTH_PREFIX}/*`);
        });
    };
}
