// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Platform SSO — shared between the cloud control-plane and the per-project
 * runtime kernels created by {@link ArtifactKernelFactory}.
 *
 * The architecture is "Airtable-style unified login": a builder signs in
 * once on `cloud.<root>` and is JIT-provisioned as a `sys_user` on every
 * per-project deployment (`<project>.<root>`) via the OAuth2 / OIDC
 * authorization-code flow.
 *
 *   - cloud  = OIDC Identity Provider (better-auth's `oauth-provider` plugin
 *              — already wired in {@link AuthPlugin} when `oidcProvider:true`)
 *   - project = OIDC Relying Party  (better-auth's `genericOAuth` plugin —
 *              opted in via the `oidcProviders` array on AuthPluginOptions)
 *
 * For the two sides to trust each other without runtime DB calls during
 * the SSO handshake, we use deterministic, derived client credentials:
 *
 *   - `client_id`     = `'project_' + projectId`
 *   - `client_secret` = HMAC-SHA256(baseSecret, 'oauth-client:' + projectId)
 *   - `redirect_uri`  = `https://<hostname>/api/v1/auth/oauth2/callback/<PROVIDER_ID>`
 *
 * Both cloud and project containers share the same `OS_AUTH_SECRET` (or
 * `AUTH_SECRET`) — that's the only piece of state required for the
 * project-side runtime to derive the right secret without a control-plane
 * lookup. The cloud-side row in `sys_oauth_application` is a one-time
 * write per project and is upserted in two places:
 *
 *   1. {@link seedPlatformSsoClient} — called from the project-provisioning
 *      flow in `http-dispatcher.ts` right after the `sys_project` row is
 *      inserted, so brand-new projects can SSO from the very first request.
 *   2. {@link backfillPlatformSsoClients} — registered as a boot-time
 *      plugin in `control-plane-preset.ts` to retro-fit any pre-existing
 *      projects that were created before this code shipped.
 */

import { createHmac, createHash } from 'node:crypto';

/**
 * Provider id used in better-auth's `genericOAuth` and as part of the
 * callback URL: `/api/v1/auth/oauth2/callback/<PROVIDER_ID>`. Keep stable —
 * changing it invalidates every registered redirect_uri.
 */
export const PLATFORM_SSO_PROVIDER_ID = 'objectstack-cloud';

/**
 * Derive the per-project OAuth client_id used in `sys_oauth_application`
 * (cloud side) and {@link genericOAuth} config (project side).
 */
export function derivePlatformSsoClientId(projectId: string): string {
    return `project_${projectId}`;
}

/**
 * Derive the per-project OAuth client_secret deterministically from the
 * shared master secret. HMAC-SHA256(baseSecret, 'oauth-client:' + projectId)
 * yields a 64-char hex string that is:
 *   - stable across container cold-starts (no DB lookup needed)
 *   - independent per project (compromising one does not compromise others)
 *   - rotatable via OS_AUTH_SECRET rotation (invalidates all SSO clients)
 *
 * This is the **plaintext** value the RP must present at the token endpoint.
 * The cloud-side `sys_oauth_application.client_secret` column instead stores
 * {@link hashPlatformSsoClientSecret}(plaintext) — better-auth's oauth-provider
 * defaults to `storeClientSecret: 'hashed'` (SHA-256 + base64url) when the JWT
 * plugin is enabled, and looks up the row by hashing the presented secret.
 */
export function derivePlatformSsoClientSecret(baseSecret: string, projectId: string): string {
    return createHmac('sha256', baseSecret).update(`oauth-client:${projectId}`).digest('hex');
}

/**
 * Hash the plaintext client_secret the same way `@better-auth/oauth-provider`'s
 * `defaultHasher` does it: SHA-256 → base64url (no padding). This MUST match
 * exactly or the token endpoint returns `invalid_client / invalid client_secret`
 * even though the row is present.
 *
 * Reference: `node_modules/@better-auth/oauth-provider/dist/utils-*.mjs` →
 *   `const defaultHasher = async (value) => base64Url.encode(SHA-256(value))`
 */
export function hashPlatformSsoClientSecret(plaintext: string): string {
    return createHash('sha256').update(plaintext)
        .digest('base64')
        .replace(/=+$/, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

/**
 * Build the redirect_uri better-auth's `genericOAuth` plugin will use
 * when the project kernel mounts the provider with id
 * {@link PLATFORM_SSO_PROVIDER_ID}. MUST be one of the URIs registered
 * on the cloud-side oauth client or the authorization server will reject
 * the callback with `invalid_request`.
 */
export function buildPlatformSsoRedirectUri(hostname: string, basePath: string = '/api/v1/auth'): string {
    let host: string;
    if (hostname.startsWith('http://') || hostname.startsWith('https://')) {
        host = hostname;
    } else if (/(\.|^)localhost(:\d+)?$/i.test(hostname)) {
        // Local dev: localhost subdomains run on plain http with a custom
        // port. When the caller passes only a hostname (no scheme/port),
        // append the configured runtime port so the OAuth redirect_uri
        // matches what the browser can actually reach. We read
        // OS_RUNTIME_PORT (NOT PORT) because both the cloud control plane
        // and the runtime container call this function — only the runtime
        // port is meaningful for the callback.
        const port = (process.env.OS_RUNTIME_PORT ?? '').trim();
        const hostWithPort = /:\d+$/.test(hostname) || !port ? hostname : `${hostname}:${port}`;
        host = `http://${hostWithPort}`;
    } else {
        host = `https://${hostname}`;
    }
    const trimmed = host.replace(/\/+$/, '');
    const path = basePath.replace(/\/+$/, '');
    return `${trimmed}${path}/oauth2/callback/${PLATFORM_SSO_PROVIDER_ID}`;
}

export interface SeedPlatformSsoClientOptions {
    /**
     * Cloud control-plane ObjectQL engine. Must expose `find(object, query)`,
     * `insert(object, data)`, and `update(object, data, {where})`. Both the
     * `apps/cloud` boot kernel (via `kernel.getService('objectql')`) and the
     * dispatcher's local `ql` reference satisfy this shape.
     */
    ql: {
        find: (object: string, query: any, opts?: any) => Promise<any>;
        insert: (object: string, data: any, opts?: any) => Promise<any>;
        update: (object: string, data: any, where: any, opts?: any) => Promise<any>;
    };
    /** Project id (also used to derive client_id + client_secret). */
    projectId: string;
    /**
     * Project hostname (e.g. `acme-crm.objectos.app`). Optional — projects
     * may be created before a hostname is assigned, in which case no
     * redirect_uri is registered yet and the row is upserted with an
     * empty `redirect_uris` array. Calling this function again once the
     * hostname is known will merge the new URI in.
     */
    hostname?: string | null;
    /** Master secret shared between cloud and project containers. */
    baseSecret: string;
    /** Optional logger for diagnostics. */
    logger?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void; error?: (...a: any[]) => void };
    /** When true, rethrow insert/update errors instead of swallowing them.
     * Backfill uses this to surface real failures via the admin endpoint. */
    throwOnError?: boolean;
}

/**
 * Idempotently upsert a `sys_oauth_application` row for the given project.
 * Re-running with the same `projectId` is a no-op (the deterministic
 * `client_id` is uniquely indexed and the secret derivation is stable).
 * Re-running with a new `hostname` adds the new redirect_uri to the
 * existing row's JSON array.
 */
export async function seedPlatformSsoClient(opts: SeedPlatformSsoClientOptions): Promise<void> {
    const { ql, projectId, hostname, baseSecret, logger, throwOnError } = opts;
    if (!baseSecret) {
        logger?.warn?.('[platform-sso] OS_AUTH_SECRET not set — skipping client seed', { projectId });
        return;
    }
    const clientId = derivePlatformSsoClientId(projectId);
    const clientSecretPlaintext = derivePlatformSsoClientSecret(baseSecret, projectId);
    const clientSecretStored = hashPlatformSsoClientSecret(clientSecretPlaintext);
    const desiredRedirect = hostname ? buildPlatformSsoRedirectUri(hostname) : null;

    let existing: any = null;
    try {
        const rows = await ql.find('sys_oauth_application', {
            where: { client_id: clientId },
            limit: 1,
        }, { context: { isSystem: true } });
        const list = Array.isArray(rows) ? rows : Array.isArray((rows as any)?.records) ? (rows as any).records : [];
        existing = list[0] ?? null;
    } catch (err) {
        // Table may not exist yet (control-plane not yet migrated). Treat
        // as a no-op rather than crashing the project-create flow.
        logger?.warn?.('[platform-sso] sys_oauth_application read failed — skipping seed', {
            projectId,
            error: (err as Error)?.message,
        });
        return;
    }

    const nowIso = new Date().toISOString();
    if (!existing) {
        const redirects = desiredRedirect ? [desiredRedirect] : [];
        try {
            await ql.insert('sys_oauth_application', {
                id: `oauthc_${projectId}`,
                name: `Project ${projectId}`,
                client_id: clientId,
                client_secret: clientSecretStored,
                type: 'web',
                redirect_uris: JSON.stringify(redirects),
                grant_types: JSON.stringify(['authorization_code', 'refresh_token']),
                response_types: JSON.stringify(['code']),
                scopes: JSON.stringify(['openid', 'email', 'profile']),
                token_endpoint_auth_method: 'client_secret_basic',
                require_pkce: false,
                skip_consent: true,
                disabled: false,
                subject_type: 'public',
                created_at: nowIso,
                updated_at: nowIso,
            }, { context: { isSystem: true } });
            logger?.info?.('[platform-sso] sys_oauth_application row created', { projectId, clientId });
        } catch (err) {
            // Unique-index conflict implies a parallel writer raced us; treat
            // as success. Other errors are logged but non-fatal so they
            // don't poison the project-create response.
            logger?.warn?.('[platform-sso] sys_oauth_application create failed', {
                projectId,
                error: (err as Error)?.message,
            });
            if (throwOnError) throw err;
        }
        return;
    }

    // Row exists — repair it. We always overwrite the canonical fields
    // (client_secret, grant_types, response_types, scopes, token_endpoint_auth_method,
    // require_pkce, skip_consent, subject_type, type, disabled) because older code
    // paths may have written rows with missing or wrong-shape values, and
    // re-running the seed should converge to the known-good shape.
    // For redirect_uris we MERGE — re-provisioning a project under an
    // additional hostname should add the new URI without dropping the old one.
    let currentRedirects: string[] = [];
    try {
        const raw = existing.redirect_uris;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) currentRedirects = parsed.filter((s): s is string => typeof s === 'string');
    } catch { /* malformed JSON — treat as empty */ }
    const mergedRedirects = desiredRedirect && !currentRedirects.includes(desiredRedirect)
        ? [...currentRedirects, desiredRedirect]
        : currentRedirects;

    const repairPatch: Record<string, any> = {
        name: existing.name || `Project ${projectId}`,
        client_secret: clientSecretStored,
        type: existing.type || 'web',
        redirect_uris: JSON.stringify(mergedRedirects),
        grant_types: JSON.stringify(['authorization_code', 'refresh_token']),
        response_types: JSON.stringify(['code']),
        scopes: JSON.stringify(['openid', 'email', 'profile']),
        token_endpoint_auth_method: 'client_secret_basic',
        require_pkce: false,
        skip_consent: true,
        disabled: false,
        subject_type: 'public',
        updated_at: nowIso,
    };
    try {
        await ql.update(
            'sys_oauth_application',
            repairPatch,
            { where: { id: existing.id } },
            { context: { isSystem: true } },
        );
        logger?.info?.('[platform-sso] sys_oauth_application repaired', {
            projectId,
            clientId,
            redirect_uris: mergedRedirects,
        });
    } catch (err) {
        logger?.warn?.('[platform-sso] sys_oauth_application repair failed', {
            projectId,
            error: (err as Error)?.message,
        });
        if (throwOnError) throw err;
    }
}

export interface BackfillPlatformSsoClientsOptions {
    ql: SeedPlatformSsoClientOptions['ql'];
    baseSecret: string;
    logger?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void; error?: (...a: any[]) => void };
    /** Hard cap on rows scanned (default: 1000). */
    limit?: number;
}

/**
 * Scan `sys_project` and ensure every active project has a corresponding
 * `sys_oauth_application` row. Intended to run once at cloud boot — the
 * happy path is dominated by the project-create hook
 * ({@link seedPlatformSsoClient}); the backfill exists so projects
 * created before this feature shipped also get SSO support without an
 * out-of-band migration.
 */
export async function backfillPlatformSsoClients(opts: BackfillPlatformSsoClientsOptions): Promise<{
    scanned: number;
    seeded: number;
    alreadyExisted: number;
    failures: Array<{ projectId: string; error: string }>;
}> {
    const { ql, baseSecret, logger, limit = 1000 } = opts;
    if (!baseSecret) {
        logger?.warn?.('[platform-sso] backfill skipped — OS_AUTH_SECRET not set');
        return { scanned: 0, seeded: 0, alreadyExisted: 0, failures: [] };
    }
    let projects: any[] = [];
    try {
        const rows = await ql.find('sys_environment', {
            limit,
            fields: ['id', 'hostname', 'status'],
        }, { context: { isSystem: true } });
        projects = Array.isArray(rows) ? rows : Array.isArray((rows as any)?.records) ? (rows as any).records : [];
    } catch (err) {
        logger?.warn?.('[platform-sso] backfill: sys_project read failed', {
            error: (err as Error)?.message,
        });
        return { scanned: 0, seeded: 0, alreadyExisted: 0, failures: [{ projectId: '<scan>', error: (err as Error)?.message ?? String(err) }] };
    }
    let seeded = 0;
    let alreadyExisted = 0;
    const failures: Array<{ projectId: string; error: string }> = [];
    for (const p of projects) {
        if (!p?.id) continue;
        const before = await (async () => {
            try {
                const r = await ql.find('sys_oauth_application', {
                    where: { client_id: derivePlatformSsoClientId(p.id) },
                    limit: 1,
                }, { context: { isSystem: true } });
                const list = Array.isArray(r) ? r : Array.isArray((r as any)?.records) ? (r as any).records : [];
                return list[0] ?? null;
            } catch { return null; }
        })();
        try {
            await seedPlatformSsoClient({ ql, projectId: p.id, hostname: p.hostname, baseSecret, logger, throwOnError: true });
            if (before) alreadyExisted++;
            else {
                // Verify the row is actually readable post-insert.
                const after = await (async () => {
                    try {
                        const r = await ql.find('sys_oauth_application', {
                            where: { client_id: derivePlatformSsoClientId(p.id) },
                            limit: 1,
                        }, { context: { isSystem: true } });
                        const list = Array.isArray(r) ? r : Array.isArray((r as any)?.records) ? (r as any).records : [];
                        return list[0] ?? null;
                    } catch (err) { return { _readErr: (err as Error)?.message }; }
                })();
                if (after && !(after as any)._readErr) seeded++;
                else failures.push({ projectId: p.id, error: `post-insert read returned ${after ? JSON.stringify(after) : 'null'}` });
            }
        } catch (err: any) {
            failures.push({ projectId: p.id, error: err?.message ?? String(err) });
        }
    }
    logger?.info?.('[platform-sso] backfill complete', { scanned: projects.length, seeded, alreadyExisted, failures: failures.length });
    return { scanned: projects.length, seeded, alreadyExisted, failures };
}
