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
import { createHmac, randomUUID } from 'node:crypto';
import { runSetInitialPassword } from '@objectstack/plugin-auth';
import type { KernelManager } from './kernel-manager.js';
import type { EnvironmentDriverRegistry } from './environment-registry.js';

const AUTH_PREFIX = '/api/v1/auth';

/**
 * HMAC-SHA256 + base64 + percent-encode the resulting `value.signature`
 * payload — replicates `serializeSignedCookie` from `better-call` so the
 * env's better-auth `getSignedCookie` validator accepts the cookie we
 * write here (without pulling better-call into runtime's deps).
 */
function signSessionCookieValue(rawToken: string, secret: string): string {
    const signature = createHmac('sha256', secret).update(rawToken).digest('base64');
    return encodeURIComponent(`${rawToken}.${signature}`);
}

/**
 * Serialize a Set-Cookie header value matching better-auth's session-cookie
 * attributes. Attributes come from `authCookies.sessionToken.attributes`.
 */
function buildSetCookieHeader(
    name: string,
    encodedValue: string,
    attrs: Record<string, any> | undefined,
    maxAgeSec: number,
): string {
    const parts: string[] = [`${name}=${encodedValue}`];
    const a = attrs ?? {};
    if (a.path) parts.push(`Path=${a.path}`); else parts.push('Path=/');
    if (Number.isFinite(maxAgeSec) && maxAgeSec > 0) parts.push(`Max-Age=${Math.floor(maxAgeSec)}`);
    if (a.domain) parts.push(`Domain=${a.domain}`);
    if (a.sameSite) {
        const ss = String(a.sameSite);
        parts.push(`SameSite=${ss.charAt(0).toUpperCase() + ss.slice(1)}`);
    } else {
        parts.push('SameSite=Lax');
    }
    if (a.secure) parts.push('Secure');
    if (a.httpOnly !== false) parts.push('HttpOnly');
    if (a.partitioned) parts.push('Partitioned');
    return parts.join('; ');
}

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
                    let environmentId: string | undefined;
                    try {
                        const env = await envRegistry.resolveByHostname(host);
                        environmentId = env?.environmentId;
                    } catch {
                        // ignore
                    }
                    if (!environmentId) {
                        return c.json({ error: 'project_not_found', host }, 404);
                    }

                    const projectKernel = await kernelManager.getOrCreate(environmentId);
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
                            // Report the real local owner state. Earlier the
                            // proxy short-circuited to `hasOwner: true` as
                            // soon as the `objectstack-cloud` SSO provider
                            // was wired — the idea being "identity lives in
                            // cloud, JIT-create on first SSO callback". That
                            // forced every project to depend on cloud being
                            // reachable for first-time setup AND made the
                            // local /setup wizard unreachable. With SSO now
                            // demoted to an *optional* federation button,
                            // bootstrap status MUST reflect the project's
                            // own `sys_user` table so /setup can run when
                            // there is genuinely no local owner yet.
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

                    // ── sso-handoff-issue ─────────────────────────────
                    // POST /api/v1/auth/sso-handoff-issue
                    //
                    // Called server-to-server by cloud's `sso_as_owner`
                    // action. Cloud control plane (createCloudStack) has
                    // no kernel-manager, so it cannot write into the env's
                    // better-auth verification table itself — this endpoint
                    // does it locally where the env kernel lives.
                    //
                    // Auth: `Authorization: Bearer <OS_CLOUD_API_KEY>` must
                    // match `process.env.OS_CLOUD_API_KEY` on the env
                    // runtime. The same secret is shared between cloud and
                    // every env runtime (cloud uses it to verify env →
                    // cloud calls; we reuse it for the reverse direction).
                    //
                    // Body: { email, name?, by?, envId? } — payload that
                    // sso-exchange will JSON.parse from the verification
                    // value. Returns { token, expiresAt, ttlSec }.
                    if (c.req.method === 'POST' && subPath === 'sso-handoff-issue') {
                        try {
                            const expected = (process.env.OS_CLOUD_API_KEY ?? '').trim();
                            if (!expected) {
                                return c.json({ error: 'sso_handoff_disabled', reason: 'OS_CLOUD_API_KEY unset on env runtime' }, 503);
                            }
                            const authz = c.req.header('authorization') ?? '';
                            const provided = authz.toLowerCase().startsWith('bearer ')
                                ? authz.slice(7).trim()
                                : '';
                            if (!provided || provided !== expected) {
                                return c.json({ error: 'unauthorized' }, 401);
                            }

                            if (typeof authSvc?.getAuthContext !== 'function') {
                                return c.json({ error: 'auth_service_unavailable' }, 503);
                            }
                            const handoffAuthCtx: any = await authSvc.getAuthContext();
                            const internal = handoffAuthCtx?.internalAdapter;
                            if (!internal?.createVerificationValue) {
                                return c.json({ error: 'verification_api_unavailable' }, 503);
                            }

                            let body: any = {};
                            try { body = await c.req.json(); } catch { body = {}; }
                            const email = String(body?.email ?? '').toLowerCase().trim();
                            if (!email) return c.json({ error: 'email_required' }, 400);
                            const name = body?.name == null ? null : String(body.name);
                            const by = body?.by == null ? 'service' : String(body.by);
                            const envIdInBody = body?.envId == null ? null : String(body.envId);

                            const handoff = randomUUID().replace(/-/g, '')
                                + randomUUID().replace(/-/g, '');
                            const ttlSec = 60;
                            const expiresAt = new Date(Date.now() + ttlSec * 1000);
                            await internal.createVerificationValue({
                                identifier: `sso-handoff:${handoff}`,
                                value: JSON.stringify({ email, name, by, envId: envIdInBody ?? environmentId }),
                                expiresAt,
                            });
                            return c.json({
                                token: handoff,
                                expiresAt: expiresAt.toISOString(),
                                ttlSec,
                            });
                        } catch (err: any) {
                            ctx.logger?.error?.('[AuthProxyPlugin] sso-handoff-issue failed', err instanceof Error ? err : new Error(String(err)));
                            return c.json({ error: 'sso_handoff_issue_failed', message: String(err?.message ?? err) }, 500);
                        }
                    }

                    // ── sso-exchange ───────────────────────────────────
                    // GET /api/v1/auth/sso-exchange?token=<handoff>&next=/
                    //
                    // Consumes a single-use handoff token previously written
                    // by the cloud `sso_as_owner` action (via the
                    // sso-handoff-issue endpoint above), finds-or-creates
                    // the user in the env by email, mints a fresh better-auth
                    // session, sets the signed session cookie and 302s to
                    // `next`. If the user has no credential account yet, we
                    // redirect to the standalone /_console/set-password page
                    // so they can configure a disaster-recovery local password.
                    if (c.req.method === 'GET' && subPath === 'sso-exchange') {
                        try {
                            const token = (url.searchParams.get('token') ?? '').trim();
                            const nextRaw = url.searchParams.get('next') ?? '/';
                            const next = nextRaw.startsWith('/') ? nextRaw : '/';
                            if (!token) return c.text('missing token', 400);

                            if (typeof authSvc?.getAuthContext !== 'function') {
                                return c.text('auth service unavailable', 503);
                            }
                            const authCtx: any = await authSvc.getAuthContext();
                            const internal = authCtx?.internalAdapter;
                            if (!internal?.consumeVerificationValue) {
                                return c.text('verification API unavailable', 503);
                            }

                            const consumed = await internal.consumeVerificationValue(`sso-handoff:${token}`);
                            if (!consumed) return c.text('invalid or expired token', 401);
                            const expiresAt = consumed?.expiresAt ? new Date(consumed.expiresAt).getTime() : 0;
                            if (!expiresAt || expiresAt < Date.now()) return c.text('expired token', 401);

                            let payload: { email?: string; name?: string | null } = {};
                            try { payload = JSON.parse(String(consumed.value)); } catch { payload = { email: String(consumed.value) }; }
                            const email = String(payload.email ?? '').toLowerCase().trim();
                            if (!email) return c.text('handoff missing email', 400);

                            const found = await internal.findUserByEmail(email, { includeAccounts: true });
                            let userId: string | undefined = found?.user?.id;
                            let hasCredentialAccount = (found?.accounts ?? []).some((a: any) => a.providerId === 'credential' && a.password);

                            if (!userId) {
                                const created = await internal.createUser({
                                    email,
                                    name: payload.name ?? email,
                                    emailVerified: true,
                                });
                                userId = created?.id;
                                hasCredentialAccount = false;
                            }
                            if (!userId) return c.text('failed to provision user', 500);

                            const session = await internal.createSession(userId, false);
                            const rawToken: string | undefined = session?.token;
                            const sessionExpiresAt = session?.expiresAt ? new Date(session.expiresAt) : new Date(Date.now() + 7 * 24 * 3600 * 1000);
                            if (!rawToken) return c.text('failed to mint session', 500);

                            const secret: string = authCtx?.secret ?? '';
                            if (!secret) return c.text('auth secret unavailable', 503);
                            const cookieName: string = authCtx?.authCookies?.sessionToken?.name ?? 'better-auth.session_token';
                            const cookieAttrs = authCtx?.authCookies?.sessionToken?.attributes ?? {};
                            const encoded = signSessionCookieValue(rawToken, secret);
                            const maxAgeSec = Math.max(60, Math.floor((sessionExpiresAt.getTime() - Date.now()) / 1000));
                            const setCookie = buildSetCookieHeader(cookieName, encoded, cookieAttrs, maxAgeSec);

                            const finalNext = hasCredentialAccount
                                ? next
                                : `/_console/set-password?next=${encodeURIComponent(next)}`;
                            const headers = new Headers();
                            headers.set('Set-Cookie', setCookie);
                            headers.set('Location', finalNext);
                            headers.set('Cache-Control', 'no-store');
                            return new Response(null, { status: 302, headers });
                        } catch (err: any) {
                            ctx.logger?.error?.('[AuthProxyPlugin] sso-exchange failed', err instanceof Error ? err : new Error(String(err)));
                            return c.text(`sso-exchange failed: ${err?.message ?? String(err)}`, 500);
                        }
                    }

                    // ── set-initial-password ────────────────────────────
                    // POST /api/v1/auth/set-initial-password { newPassword }
                    //
                    // The "Set local password" affordance the sso-exchange
                    // recovery redirect points at. The full AuthPlugin registers
                    // this route, but AuthPlugin is skipped on a per-environment
                    // runtime, so without this the request falls through to
                    // better-auth (no such route) and 404s. Mirrors AuthPlugin's
                    // handler against THIS environment's auth context. (#1544)
                    if (c.req.method === 'POST' && subPath === 'set-initial-password') {
                        try {
                            let body: any = {};
                            try { body = await c.req.json(); } catch { body = {}; }
                            const newPassword: unknown = body?.newPassword;
                            if (typeof newPassword !== 'string' || newPassword.length === 0) {
                                return c.json({ success: false, error: { code: 'invalid_request', message: 'newPassword is required' } }, 400);
                            }
                            if (typeof authSvc?.getAuthContext !== 'function') {
                                return c.json({ success: false, error: { code: 'unavailable', message: 'Auth context unavailable' } }, 503);
                            }
                            // Resolve the caller's session on this environment.
                            let userId: string | undefined;
                            try {
                                const api = typeof authSvc.getApi === 'function' ? await authSvc.getApi() : null;
                                const session = await api?.getSession?.({ headers: c.req.raw.headers });
                                userId = session?.user?.id ? String(session.user.id) : undefined;
                            } catch { /* fall through to 401 */ }
                            if (!userId) {
                                return c.json({ success: false, error: { code: 'unauthorized', message: 'Sign in first' } }, 401);
                            }
                            const setPwCtx: any = await authSvc.getAuthContext();
                            if (!setPwCtx?.internalAdapter || !setPwCtx?.password) {
                                return c.json({ success: false, error: { code: 'unavailable', message: 'Auth context unavailable' } }, 503);
                            }
                            const minLen = setPwCtx.password?.config?.minPasswordLength ?? 8;
                            const maxLen = setPwCtx.password?.config?.maxPasswordLength ?? 128;
                            if (newPassword.length < minLen) {
                                return c.json({ success: false, error: { code: 'password_too_short', message: `Password must be at least ${minLen} characters` } }, 400);
                            }
                            if (newPassword.length > maxLen) {
                                return c.json({ success: false, error: { code: 'password_too_long', message: `Password must be at most ${maxLen} characters` } }, 400);
                            }
                            const accounts = await setPwCtx.internalAdapter.findAccounts(userId);
                            const existingCredential = accounts?.find?.((a: any) => a.providerId === 'credential' && a.password);
                            if (existingCredential) {
                                return c.json({ success: false, error: { code: 'credential_account_exists', message: 'A local password is already set for this account. Use change-password instead.' } }, 409);
                            }
                            const passwordHash = await setPwCtx.password.hash(newPassword);
                            await setPwCtx.internalAdapter.createAccount({
                                userId,
                                providerId: 'credential',
                                accountId: userId,
                                password: passwordHash,
                            });
                            return c.json({ success: true });
                        } catch (err: any) {
                            ctx.logger?.error?.('[AuthProxyPlugin] set-initial-password failed', err instanceof Error ? err : new Error(String(err)));
                            return c.json({ success: false, error: { code: 'set_password_failed', message: String(err?.message ?? err) } }, 500);
                        }
                    }

                    // ── set-initial-password ──────────────────────────
                    // POST /api/v1/auth/set-initial-password
                    //
                    // better-auth's `setPassword` is a server-only API (no
                    // HTTP route), and the full AuthPlugin — which exposes it
                    // as a custom route — is SKIPPED on a per-environment
                    // runtime. So without this short-circuit the request falls
                    // through to better-auth and 404s, dead-ending the
                    // `sso-exchange` → "Set local password" recovery flow
                    // (see #1544). Reuse the exact same wrapper the AuthPlugin
                    // uses so the two paths can never drift again.
                    if (c.req.method === 'POST' && subPath === 'set-initial-password') {
                        try {
                            if (typeof authSvc?.getApi !== 'function') {
                                return c.json({ success: false, error: { code: 'unavailable', message: 'Auth API unavailable' } }, 503);
                            }
                            const authApi = await authSvc.getApi();
                            const { status, body } = await runSetInitialPassword(authApi, c.req.raw);
                            return c.json(body, status);
                        } catch (err: any) {
                            ctx.logger?.error?.('[AuthProxyPlugin] set-initial-password failed', err instanceof Error ? err : new Error(String(err)));
                            return c.json({ success: false, error: { code: 'internal', message: err?.message ?? String(err) } }, 500);
                        }
                    }

                    const fn = await resolveAuthHandler(authSvc);
                    if (!fn) {
                        return c.json({ error: 'auth_service_unavailable', environmentId }, 503);
                    }

                    // Forward the original Web Request directly — better-auth
                    // accepts a standard `Request` and returns a `Response`.
                    const resp = await fn(c.req.raw);

                    // ── Cookie-leak cleanup ─────────────────────────────────
                    // Cloud previously set OS_COOKIE_DOMAIN=.objectos.ai,
                    // which made cloud's better-auth session cookies leak
                    // into every *.objectos.ai project subdomain and
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
