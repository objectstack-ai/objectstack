// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * CloudConnectionPlugin — the runtime-side client surface for a cloud
 * control plane (ADR-0008 Phase 1).
 *
 * Mounts the same-origin `/api/v1/cloud-connection/*` routes the Console
 * marketplace depends on:
 *
 *   GET  /api/v1/cloud-connection/status        — is this env bound to a cloud account?
 *   POST /api/v1/cloud-connection/bind/start    — begin an RFC 8628 device-code bind
 *   POST /api/v1/cloud-connection/bind/poll     — poll device token + persist the binding
 *   POST /api/v1/cloud-connection/install       — install a package via the control plane
 *   GET  /api/v1/cloud-connection/installation  — single-package installed-state probe
 *   GET  /api/v1/cloud-connection/installed     — env's full installed list (Installed view)
 *   GET  /api/v1/cloud-connection/org-packages  — owning org's own catalog ("Your organization")
 *
 * History: these routes started as app-level wiring in
 * `apps/objectos/cloud-runtime-plugins.ts` (two ad-hoc plugins). ADR-0008
 * Phase 1 consolidates them here as ONE plugin so both deployment shapes —
 * `apps/objectos` (multi-tenant) and `apps/objectos-ee` (single-environment)
 * — wire the same canonical implementation. ADR-0008 Phase 2 moves this
 * surface into the open `@objectstack/cloud-connection` package; keep this
 * file dependency-light (structural Plugin types, no @objectstack/core) so
 * the move is mechanical.
 *
 * ## Environment & session resolution — two modes
 *
 * Multi-tenant (default): the request hostname is resolved to an environment
 * via the host kernel's `env-registry` service, and the caller's session is
 * validated against that environment's OWN per-env kernel (via
 * `kernel-manager`) — auth is per-environment (ADR-0006).
 *
 * Single-environment (`singleEnvironment: true`, e.g. objectos-ee): there is
 * no registry/manager; the environment id comes from config
 * (`environmentId` / `OS_ENVIRONMENT_ID`, typically assigned when the
 * runtime is bound to a control plane) and sessions are validated against
 * the host kernel's own `auth` service. Routes degrade gracefully when the
 * id is not (yet) configured: status reports `bound:false`; the others 404.
 *
 * ## Why a same-origin proxy at all
 *
 * The SPA cannot call the control plane from a tenant subdomain — that is a
 * cross-origin, cross-site-cookie request the browser blocks. So the runtime
 * answers on its own origin, authorizes against the environment's session,
 * and talks to the control plane server-to-server (env→cloud service
 * credential today; the device-code-bound `sys_cloud_connection` token for
 * self-hosted runtimes).
 */

// Minimal structural plugin contract — keep this module independent of
// @objectstack/core so the ADR-0008 Phase 2 move to the open package stays
// mechanical (mirrors the other plugins in this package).
interface PluginContext {
    hook(event: string, handler: (...args: any[]) => any): void;
    getService<T = any>(name: string): T;
    logger?: {
        info?: (msg: string) => void;
        warn?: (msg: string) => void;
        error?: (msg: string, err?: unknown) => void;
    };
}
interface Plugin {
    readonly name: string;
    readonly version: string;
    init(ctx: PluginContext): Promise<void>;
    start(ctx: PluginContext): Promise<void>;
}

import { hostname } from 'node:os';
import { ConnectionCredentialStore } from './connection-credential-store.js';
import { CLOUD_CONNECTION_UI_BUNDLE } from './cloud-connection-ui.js';

const CLOUD_CONNECTION_PREFIX = '/api/v1/cloud-connection';

export interface CloudConnectionPluginConfig {
    /** Control-plane base URL. Default: `OS_CLOUD_URL` (read lazily at kernel:ready). */
    controlPlaneUrl?: string;
    /** env→cloud service credential. Default: `OS_CLOUD_API_KEY`. */
    controlPlaneApiKey?: string;
    /** OAuth device-flow client id. Default: `OS_CLI_CLIENT_ID` → `objectstack-cli`. */
    deviceClientId?: string;
    /**
     * Fixed environment id (single-environment runtimes). Default:
     * `OS_ENVIRONMENT_ID`. In multi-tenant mode leave unset — the id is
     * resolved per-request from the hostname via `env-registry`.
     */
    environmentId?: string;
    /**
     * Single-environment mode (objectos-ee shipped shape): skip the
     * env-registry/kernel-manager lookups and validate sessions against the
     * host kernel's own `auth` service.
     */
    singleEnvironment?: boolean;
    /**
     * Override the on-disk credential store location. Defaults to
     * `<cwd>/.objectstack/cloud-connection.json` — where the bind flow
     * persists the `oscc_…` runtime bearer for self-hosted runtimes.
     */
    credentialPath?: string;
}

export class CloudConnectionPlugin implements Plugin {
    readonly name = 'com.objectstack.cloud.connection';
    readonly version = '0.3.0';

    private readonly cfg: CloudConnectionPluginConfig;
    private readonly store: ConnectionCredentialStore;

    constructor(config: CloudConnectionPluginConfig = {}) {
        this.cfg = config;
        this.store = new ConnectionCredentialStore(config.credentialPath);
    }

    init = async (_ctx: PluginContext): Promise<void> => { /* HTTP wiring on kernel:ready */ };

    start = async (ctx: PluginContext): Promise<void> => {
        ctx.hook('kernel:ready', async () => {
            const httpServer: any = (() => { try { return ctx.getService('http-server'); } catch { return undefined; } })();
            if (!httpServer || typeof httpServer.getRawApp !== 'function') {
                ctx.logger?.warn?.('[CloudConnectionPlugin] http-server unavailable — routes not mounted');
                return;
            }
            const rawApp = httpServer.getRawApp();
            // Env vars are read here (not at construction) so a host can set
            // them between config load and kernel boot — preserves the
            // behavior of the original app-level wiring.
            const cloudUrl = (this.cfg.controlPlaneUrl ?? process.env.OS_CLOUD_URL ?? '').trim().replace(/\/+$/, '');
            const cloudApiKey = (this.cfg.controlPlaneApiKey ?? process.env.OS_CLOUD_API_KEY ?? '').trim();
            const deviceClientId = (this.cfg.deviceClientId ?? process.env.OS_CLI_CLIENT_ID ?? 'objectstack-cli').trim();
            const deviceScope = 'openid profile email';

            // Effective control-plane credential, resolved PER REQUEST:
            // cloud-hosted runtimes carry the env→cloud service key; a
            // self-hosted runtime presents the `oscc_…` bearer the bind flow
            // persisted. Lazy so a bind that completes while the runtime is
            // up takes effect without a restart.
            const credential = (): string => cloudApiKey || this.store.read()?.runtimeToken || '';
            const authHeaders = (): Record<string, string> => {
                const cred = credential();
                return cred ? { Authorization: `Bearer ${cred}` } : {};
            };

            const hostOf = (c: any): string => {
                try { return new URL(c.req.url).hostname; } catch { return ''; }
            };

            const resolveEnvironmentId = async (c: any): Promise<string | undefined> => {
                const fixed = (this.cfg.environmentId ?? process.env.OS_ENVIRONMENT_ID ?? '').trim();
                // The CLI's local-dev defaults ('env_local' / 'proj_local')
                // identify the LOCAL kernel, not a cloud environment — never
                // present them to the control plane as one (they would 404
                // the bind and resurrect the phantom-environment confusion
                // ADR runtime-identity-binding removes).
                if (fixed && fixed !== 'env_local' && fixed !== 'proj_local') return fixed;
                if (this.cfg.singleEnvironment) {
                    // A completed bind persisted the environment id — a
                    // self-hosted runtime needs no OS_ENVIRONMENT_ID after it.
                    return this.store.read()?.environmentId || undefined;
                }
                try {
                    const envRegistry = ctx.getService<any>('env-registry');
                    const env = await envRegistry?.resolveByHostname?.(hostOf(c));
                    return env?.environmentId;
                } catch {
                    return undefined;
                }
            };

            // SDUI surface: the binding page + Setup-nav entry ship with the
            // plugin as metadata (ADR-0029 K2); the console only provides the
            // registered `cloud-connection:panel` widget. Best-effort — a
            // kernel without a manifest service simply has no Setup entry.
            try {
                const manifest = ctx.getService<{ register(m: any): void }>('manifest');
                manifest?.register?.(CLOUD_CONNECTION_UI_BUNDLE);
            } catch { /* no manifest service — headless kernel */ }

            const sessionFromAuthService = async (authSvc: any, rawReq: Request): Promise<{ userId?: string } | null> => {
                const api = typeof authSvc?.getApi === 'function' ? await authSvc.getApi() : authSvc?.api ?? authSvc;
                const session = await api?.getSession?.({ headers: rawReq.headers });
                const userId = session?.user?.id ? String(session.user.id) : undefined;
                return userId ? { userId } : null;
            };

            const resolveSession = async (environmentId: string, rawReq: Request): Promise<{ userId?: string } | null> => {
                try {
                    if (this.cfg.singleEnvironment) {
                        // Single-env: the host kernel owns auth.
                        let authSvc: any;
                        try { authSvc = ctx.getService('auth'); } catch { /* ignore */ }
                        if (!authSvc) return null;
                        return await sessionFromAuthService(authSvc, rawReq);
                    }
                    // Multi-tenant: auth lives on the environment's own kernel.
                    const kernelManager = ctx.getService<any>('kernel-manager');
                    const kernel = await kernelManager?.getOrCreate?.(environmentId);
                    let authSvc: any;
                    try { authSvc = await kernel?.getServiceAsync?.('auth'); } catch { /* ignore */ }
                    if (!authSvc) { try { authSvc = kernel?.getService?.('auth'); } catch { /* ignore */ } }
                    if (!authSvc) return null;
                    return await sessionFromAuthService(authSvc, rawReq);
                } catch {
                    return null;
                }
            };

            // GET /status — is this runtime bound to a cloud account?
            rawApp.get(`${CLOUD_CONNECTION_PREFIX}/status`, async (c: any) => {
                const environmentId = await resolveEnvironmentId(c);
                const stored = this.store.read();
                const runtimeId = stored?.runtimeId;
                if (!environmentId && !this.cfg.singleEnvironment) {
                    return c.json({ success: false, error: { code: 'environment_not_found' } }, 404);
                }
                // A single-env runtime with no env id and no credential is
                // simply not bound yet — valid state, not an error.
                if (!environmentId && !credential()) {
                    return c.json({ success: true, data: { environmentId: null, runtimeId: runtimeId ?? null, bound: false, provider: 'objectstack-cloud', connection: null } });
                }
                // Prefer the real sys_cloud_connection from the control plane.
                // The oscc_ bearer self-identifies; service-key callers query
                // by environment_id (cloud-hosted) or runtime_id (claim).
                if (cloudUrl) {
                    try {
                        const qs = environmentId
                            ? `?environment_id=${encodeURIComponent(environmentId)}`
                            : runtimeId ? `?runtime_id=${encodeURIComponent(runtimeId)}` : '';
                        const resp = await fetch(`${cloudUrl}/api/v1/cloud-connection/status${qs}`, {
                            headers: authHeaders(),
                        });
                        if (resp.ok) {
                            const json: any = await resp.json().catch(() => null);
                            const data = json?.data ?? {};
                            const bound = Boolean(data.bound) || Boolean(credential());
                            return c.json({ success: true, data: {
                                environmentId: environmentId ?? null,
                                runtimeId: data.runtime_id ?? runtimeId ?? null,
                                bound,
                                provider: 'objectstack-cloud',
                                connection: data.connection ?? null,
                            } });
                        }
                    } catch { /* fall through to implicit */ }
                }
                const bound = Boolean(credential());
                return c.json({ success: true, data: { environmentId: environmentId ?? null, runtimeId: runtimeId ?? null, bound, provider: 'objectstack-cloud', connection: null } });
            });

            // POST /bind/start — begin a device-code bind. The runtime is the
            // genuine RFC 8628 client: it asks the cloud for a device + user
            // code, returns them to the Setup UI, and the operator approves in
            // the cloud console.
            rawApp.post(`${CLOUD_CONNECTION_PREFIX}/bind/start`, async (c: any) => {
                let body: any = {};
                try { body = await c.req.json(); } catch { body = {}; }
                // Self-hosted (single-env) runtimes need NO environment id —
                // registration happens cloud-side at approval (ADR
                // runtime-identity-binding). An explicit environment_id in the
                // body is still honored for cloud-hosted-style binds.
                let environmentId = await resolveEnvironmentId(c);
                if (!environmentId && this.cfg.singleEnvironment) {
                    environmentId = String(body?.environment_id ?? body?.environmentId ?? '').trim() || undefined;
                }
                if (!environmentId && !this.cfg.singleEnvironment) {
                    return c.json({ success: false, error: { code: 'environment_not_found' } }, 404);
                }
                const session = await resolveSession(environmentId ?? '', c.req.raw);
                if (!session?.userId) return c.json({ success: false, error: { code: 'unauthenticated', message: 'Sign in to this environment to connect a cloud account.' } }, 401);
                if (!cloudUrl) return c.json({ success: false, error: { code: 'cloud_unconfigured', message: 'No cloud control plane configured.' } }, 503);
                try {
                    const resp = await fetch(`${cloudUrl}/api/v1/auth/device/code`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ client_id: deviceClientId, scope: deviceScope }),
                    });
                    const json: any = await resp.json().catch(() => ({}));
                    if (!resp.ok) return c.json({ success: false, error: { code: 'device_code_failed', message: json?.error ?? `device/code ${resp.status}` } }, 502);
                    // Device context for the approval page (ADR
                    // runtime-identity-binding §2.3): name the requesting
                    // runtime in the verification URL so the approver sees
                    // WHAT they are authorizing. Display-only — informed
                    // consent, not an authenticity proof (the page carries
                    // the "only approve if you started this" warning).
                    const withContext = (uri: unknown): string | undefined => {
                        if (typeof uri !== 'string' || !uri) return undefined;
                        try {
                            const u = new URL(uri);
                            try { u.searchParams.set('runtime_name', hostname()); } catch { /* no hostname */ }
                            const ver = (process.env.OS_RUNTIME_VERSION ?? this.version) || '';
                            if (ver) u.searchParams.set('runtime_version', ver);
                            return u.toString();
                        } catch { return uri; }
                    };
                    return c.json({ success: true, data: {
                        device_code: json.device_code,
                        user_code: json.user_code,
                        verification_uri: withContext(json.verification_uri),
                        verification_uri_complete: withContext(json.verification_uri_complete),
                        interval: json.interval ?? 5,
                        expires_in: json.expires_in ?? 600,
                    } });
                } catch (err: any) {
                    ctx.logger?.error?.('[CloudConnectionPlugin] bind/start failed', err instanceof Error ? err : new Error(String(err)));
                    return c.json({ success: false, error: { code: 'device_code_failed', message: String(err?.message ?? err) } }, 502);
                }
            });

            // POST /bind/poll { device_code } — polls the cloud token endpoint.
            // While pending, returns { pending: true }. On success, exchanges
            // the operator token for a persisted sys_cloud_connection via the
            // control plane's /bind.
            rawApp.post(`${CLOUD_CONNECTION_PREFIX}/bind/poll`, async (c: any) => {
                let body: any = {};
                try { body = await c.req.json(); } catch { body = {}; }
                let environmentId = await resolveEnvironmentId(c);
                if (!environmentId && this.cfg.singleEnvironment) {
                    environmentId = String(body?.environment_id ?? body?.environmentId ?? '').trim() || undefined;
                }
                if (!environmentId && !this.cfg.singleEnvironment) {
                    return c.json({ success: false, error: { code: 'environment_not_found' } }, 404);
                }
                const session = await resolveSession(environmentId ?? '', c.req.raw);
                if (!session?.userId) return c.json({ success: false, error: { code: 'unauthenticated' } }, 401);
                if (!cloudUrl) return c.json({ success: false, error: { code: 'cloud_unconfigured' } }, 503);

                const deviceCode = String(body?.device_code ?? body?.deviceCode ?? '').trim();
                if (!deviceCode) return c.json({ success: false, error: { code: 'invalid_request', message: 'device_code is required' } }, 400);

                try {
                    const tokResp = await fetch(`${cloudUrl}/api/v1/auth/device/token`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode, client_id: deviceClientId }),
                    });
                    const tok: any = await tokResp.json().catch(() => ({}));
                    const accessToken = tok?.access_token;
                    if (!accessToken) {
                        // RFC 8628 polling errors: authorization_pending / slow_down
                        // are non-terminal; everything else is terminal.
                        const errCode = String(tok?.error ?? `device/token ${tokResp.status}`);
                        const pending = errCode === 'authorization_pending' || errCode === 'slow_down';
                        return c.json({ success: pending, data: { pending }, error: pending ? undefined : { code: errCode } }, pending ? 200 : 400);
                    }
                    // Persist the binding through the control plane. The
                    // registration claim rides along (ADR
                    // runtime-identity-binding §2.3): hostname + version name
                    // the device; a stored runtime_id keeps the identity
                    // stable across re-binds (claim verified cloud-side).
                    const stored = this.store.read();
                    const bindResp = await fetch(`${cloudUrl}/api/v1/cloud-connection/bind`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...(cloudApiKey ? { Authorization: `Bearer ${cloudApiKey}` } : {}) },
                        body: JSON.stringify({
                            ...(environmentId ? { environment_id: environmentId } : {}),
                            ...(stored?.runtimeId ? { runtime_id: stored.runtimeId } : {}),
                            name: (() => { try { return hostname(); } catch { return undefined; } })(),
                            runtime_version: (process.env.OS_RUNTIME_VERSION ?? this.version) || undefined,
                            token: accessToken,
                            scope: deviceScope,
                        }),
                    });
                    const bindJson: any = await bindResp.json().catch(() => ({ success: false, error: 'bind failed (no body)' }));
                    // The bind response carries the one-time runtime bearer.
                    // Persist it HERE (server-side, 0600 file) and STRIP it
                    // from what goes back to the browser — the SPA never
                    // holds the credential.
                    const runtimeToken = bindJson?.data?.runtime_token;
                    if (bindResp.ok && typeof runtimeToken === 'string' && runtimeToken) {
                        try {
                            this.store.write({
                                runtimeToken,
                                runtimeId: bindJson?.data?.runtime_id ?? bindJson?.data?.connection?.runtime_id ?? undefined,
                                environmentId: environmentId || undefined,
                                controlPlaneUrl: cloudUrl,
                                organizationId: bindJson?.data?.connection?.organization_id ?? undefined,
                                accountEmail: bindJson?.data?.connection?.account_email ?? undefined,
                                boundAt: bindJson?.data?.connection?.bound_at ?? new Date().toISOString(),
                            });
                        } catch (err: any) {
                            ctx.logger?.error?.('[CloudConnectionPlugin] failed to persist runtime credential', err instanceof Error ? err : new Error(String(err)));
                        }
                        delete bindJson.data.runtime_token;
                    }
                    return c.json(bindJson, bindResp.status as any);
                } catch (err: any) {
                    ctx.logger?.error?.('[CloudConnectionPlugin] bind/poll failed', err instanceof Error ? err : new Error(String(err)));
                    return c.json({ success: false, error: { code: 'bind_failed', message: String(err?.message ?? err) } }, 502);
                }
            });

            // POST /unbind — disconnect this runtime from the control plane.
            // Revokes the connection server-side (best-effort) and clears the
            // local credential. Requires an environment session, mirroring
            // bind/start.
            rawApp.post(`${CLOUD_CONNECTION_PREFIX}/unbind`, async (c: any) => {
                const environmentId = await resolveEnvironmentId(c);
                if (!environmentId && !this.cfg.singleEnvironment) {
                    return c.json({ success: false, error: { code: 'environment_not_found' } }, 404);
                }
                const session = await resolveSession(environmentId ?? '', c.req.raw);
                if (!session?.userId) return c.json({ success: false, error: { code: 'unauthenticated' } }, 401);

                // Revoke cloud-side FIRST (the oscc_ bearer self-identifies;
                // env-keyed bindings name the environment), then clear the
                // local credential regardless — a device signing out must not
                // leave a live token behind when the control plane is up.
                let revoked = false;
                if (cloudUrl && credential()) {
                    try {
                        const resp = await fetch(`${cloudUrl}/api/v1/cloud-connection/revoke`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...authHeaders() },
                            body: JSON.stringify(environmentId ? { environment_id: environmentId } : {}),
                        });
                        revoked = resp.ok;
                    } catch { /* control plane unreachable — local clear still proceeds */ }
                }
                const cleared = (() => { try { return this.store.clear(); } catch { return false; } })();
                return c.json({ success: true, data: { environmentId: environmentId ?? null, revoked, cleared } });
            });

            // POST /install { package_id, seed_sample_data? } — in-environment
            // marketplace install. Authorizes the caller against the
            // environment's own session (SSO-as-owner only ever admits org
            // owners/admins), then performs the install against the cloud
            // control plane using the env→cloud service credential.
            rawApp.post(`${CLOUD_CONNECTION_PREFIX}/install`, async (c: any) => {
                const environmentId = await resolveEnvironmentId(c);
                if (!environmentId) return c.json({ success: false, error: { code: 'environment_not_found' } }, 404);

                // Local authz: require a valid env session. (TODO: tighten to an
                // explicit env-admin role check; today only owners/admins obtain
                // a session via SSO-as-owner.)
                const session = await resolveSession(environmentId, c.req.raw);
                if (!session?.userId) {
                    return c.json({ success: false, error: { code: 'unauthenticated', message: 'Sign in to this environment to install apps.' } }, 401);
                }

                if (!cloudUrl || !credential()) {
                    return c.json({ success: false, error: { code: 'cloud_unconfigured', message: 'This runtime is not connected to a cloud account; install is unavailable.' } }, 503);
                }

                let body: any = {};
                try { body = await c.req.json(); } catch { body = {}; }
                const packageId = String(body?.package_id ?? body?.packageId ?? '').trim();
                if (!packageId) return c.json({ success: false, error: { code: 'invalid_request', message: 'package_id is required' } }, 400);
                const seedSampleData = body?.seed_sample_data === true || body?.seedSampleData === true;

                // Call the cloud install endpoint in service mode. We do NOT send
                // an active org → package-install treats this as platform/CI and
                // installs unrestricted (we already authorized the env admin above).
                try {
                    const resp = await fetch(`${cloudUrl}/api/v1/actions/sys_package/install_package`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...authHeaders(),
                        },
                        body: JSON.stringify({ recordId: packageId, params: { environment_id: environmentId, seed_sample_data: seedSampleData } }),
                    });
                    const json = await resp.json().catch(() => ({ success: false, error: 'install failed (no body)' }));
                    return c.json(json, resp.status as any);
                } catch (err: any) {
                    ctx.logger?.error?.('[CloudConnectionPlugin] install failed', err instanceof Error ? err : new Error(String(err)));
                    return c.json({ success: false, error: { code: 'install_failed', message: String(err?.message ?? err) } }, 502);
                }
            });

            // GET /installation?package_id=… — same-origin installed-state
            // probe. Always returns 200 with `{ installed: boolean, … }`;
            // failures to reach the control plane degrade to
            // `{ installed: false }` so the marketplace page renders (worst
            // case it offers an install the control plane upserts idempotently).
            rawApp.get(`${CLOUD_CONNECTION_PREFIX}/installation`, async (c: any) => {
                const environmentId = await resolveEnvironmentId(c);
                if (!environmentId) {
                    // Self-hosted v2: cloud-side installation records are
                    // env-scoped; a registration-only runtime tracks installs
                    // locally (LocalManifestSource). Report not-installed.
                    if (this.cfg.singleEnvironment) return c.json({ success: true, data: { installed: false } });
                    return c.json({ success: false, error: { code: 'environment_not_found' } }, 404);
                }

                const session = await resolveSession(environmentId, c.req.raw);
                if (!session?.userId) {
                    return c.json({ success: false, error: { code: 'unauthenticated', message: 'Sign in to this environment.' } }, 401);
                }

                let packageId = '';
                try {
                    const u = new URL(c.req.url);
                    packageId = String(u.searchParams.get('package_id') ?? u.searchParams.get('packageId') ?? '').trim();
                } catch { /* malformed URL → empty */ }
                if (!packageId) return c.json({ success: false, error: { code: 'invalid_request', message: 'package_id is required' } }, 400);

                // Not connected → can't know; report not-installed so the page
                // still renders (a read should never hard-fail the page).
                if (!cloudUrl || !credential()) return c.json({ success: true, data: { installed: false } });

                try {
                    // Read installed-state from the control plane's
                    // service-authenticated installations route — NOT the generic
                    // `/api/v1/data/sys_package_installation` API. That data API
                    // resolves identity via better-auth sessions / `sys_api_key`
                    // only and rejects the `OS_CLOUD_API_KEY` service bearer (401).
                    // This route shares the install route's service-key auth, so
                    // the same credential that performed the install can read its
                    // result back.
                    const resp = await fetch(
                        `${cloudUrl}/api/v1/cloud/environments/${encodeURIComponent(environmentId)}/installations/${encodeURIComponent(packageId)}`,
                        { headers: { Accept: 'application/json', ...authHeaders() } },
                    );
                    if (!resp.ok) return c.json({ success: true, data: { installed: false } });
                    const json: any = await resp.json().catch(() => ({}));
                    const data: any = json?.data ?? json ?? {};
                    if (!data.installed) return c.json({ success: true, data: { installed: false } });
                    return c.json({ success: true, data: {
                        installed: true,
                        installationId: String(data.installationId ?? ''),
                        version: String(data.version ?? 'installed'),
                        withSampleData: data.withSampleData === true,
                    } });
                } catch (err: any) {
                    ctx.logger?.warn?.(`[CloudConnectionPlugin] installation probe failed: ${String(err?.message ?? err)}`);
                    return c.json({ success: true, data: { installed: false } });
                }
            });

            // GET /installed — env's FULL installed set from the control
            // plane's `sys_package_installation`, so the Console "Installed"
            // view reflects packages installed via ANY path (CLI, marketplace,
            // REST) — ADR-0007 step ①. Degrades to an empty list when the
            // runtime is not cloud-connected or the control plane is
            // unreachable (never hard-fails the page).
            rawApp.get(`${CLOUD_CONNECTION_PREFIX}/installed`, async (c: any) => {
                const environmentId = await resolveEnvironmentId(c);
                if (!environmentId) {
                    // Self-hosted v2: no env-scoped cloud install ledger —
                    // the Installed view is fed by the local manifest ledger.
                    if (this.cfg.singleEnvironment) {
                        return c.json({ success: true, data: { packages: [], total: 0, connected: Boolean(credential()) } });
                    }
                    return c.json({ success: false, error: { code: 'environment_not_found' } }, 404);
                }

                const session = await resolveSession(environmentId, c.req.raw);
                if (!session?.userId) {
                    return c.json({ success: false, error: { code: 'unauthenticated', message: 'Sign in to this environment.' } }, 401);
                }

                if (!cloudUrl || !credential()) {
                    return c.json({ success: true, data: { packages: [], total: 0, connected: false } });
                }

                try {
                    const resp = await fetch(
                        `${cloudUrl}/api/v1/cloud/environments/${encodeURIComponent(environmentId)}/packages`,
                        { headers: { Accept: 'application/json', ...authHeaders() } },
                    );
                    if (!resp.ok) return c.json({ success: true, data: { packages: [], total: 0, connected: true } });
                    const json: any = await resp.json().catch(() => ({}));
                    const data: any = json?.data ?? json ?? {};
                    const packages = Array.isArray(data.packages) ? data.packages : [];
                    return c.json({ success: true, data: { packages, total: packages.length, connected: true } });
                } catch (err: any) {
                    ctx.logger?.warn?.(`[CloudConnectionPlugin] installed-list failed: ${String(err?.message ?? err)}`);
                    return c.json({ success: true, data: { packages: [], total: 0, connected: true } });
                }
            });

            // GET /org-packages — org-scoped catalog for the in-env
            // Marketplace's "Your organization" layer (ADR-0007 step ②): the
            // env's owning org's own packages (visibility org/private), so a
            // publisher can discover + install their private apps from inside
            // the environment. Forwards (service-key) to the control plane,
            // which derives the org from environment_id.
            rawApp.get(`${CLOUD_CONNECTION_PREFIX}/org-packages`, async (c: any) => {
                const environmentId = await resolveEnvironmentId(c);
                if (!environmentId && !this.cfg.singleEnvironment) {
                    return c.json({ success: false, error: { code: 'environment_not_found' } }, 404);
                }

                const session = await resolveSession(environmentId ?? '', c.req.raw);
                if (!session?.userId) {
                    return c.json({ success: false, error: { code: 'unauthenticated', message: 'Sign in to this environment.' } }, 401);
                }

                if (!cloudUrl || !credential()) {
                    return c.json({ success: true, data: { items: [], total: 0, connected: false } });
                }

                try {
                    // env-keyed callers pass environment_id; a registration-only
                    // runtime's oscc_ bearer carries the org by itself.
                    const qs = environmentId ? `?environment_id=${encodeURIComponent(environmentId)}` : '';
                    const resp = await fetch(
                        `${cloudUrl}/api/v1/cloud/org-packages${qs}`,
                        { headers: { Accept: 'application/json', ...authHeaders() } },
                    );
                    if (!resp.ok) return c.json({ success: true, data: { items: [], total: 0, connected: true } });
                    const json: any = await resp.json().catch(() => ({}));
                    const data: any = json?.data ?? json ?? {};
                    const items = Array.isArray(data.items) ? data.items : [];
                    return c.json({ success: true, data: { items, total: items.length, connected: true } });
                } catch (err: any) {
                    ctx.logger?.warn?.(`[CloudConnectionPlugin] org-packages failed: ${String(err?.message ?? err)}`);
                    return c.json({ success: true, data: { items: [], total: 0, connected: true } });
                }
            });

            ctx.logger?.info?.(`[CloudConnectionPlugin] mounted ${CLOUD_CONNECTION_PREFIX}/{status,bind/start,bind/poll,install,installation,installed,org-packages} → ${cloudUrl || '(cloud unconfigured)'}`);
        });
    };
}

/** Factory mirroring the package's other plugins' construction style. */
export function createCloudConnectionPlugin(config: CloudConnectionPluginConfig = {}): CloudConnectionPlugin {
    return new CloudConnectionPlugin(config);
}
