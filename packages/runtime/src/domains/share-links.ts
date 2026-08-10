// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/share-links` domain — extracted dispatcher body (ADR-0076 D11 step ③,
 * PR-4). Share-link capability tokens — "anyone with the link" publication
 * of a single record (ADR-0047). The `shareLinks` service is resolved from
 * the request's environment kernel, so links live in (and resolve against)
 * the same per-environment database that owns the record. This domain owns
 * URL parsing and the auth/public split.
 *
 * NOTE (cross-repo, see #2462 step-① re-scope): for cloud's per-env kernels
 * this is the DESIGNED PRIMARY surface (`registerShareLinkRoutes: false`;
 * the host dispatcher serves it after kernel swap) — the handler must keep
 * working from the registry exactly as it did from the if-chain.
 *
 *   POST   /share-links                   → create a link (authenticated)
 *   GET    /share-links?object&recordId    → list the caller's links (authenticated)
 *   DELETE /share-links/:idOrToken         → revoke (authenticated)
 *   GET    /share-links/:token/resolve     → resolve token → record (PUBLIC)
 *   GET    /share-links/:token/messages    → ai_conversations messages (PUBLIC)
 *
 * The resolve / messages routes are intentionally public — the token IS
 * the authorisation. The underlying record is fetched with a SYSTEM
 * context (per-env RLS is bypassed because the token gates access), and
 * `redactFields` are stripped before the record leaves the server.
 *
 * Every route answers the declared `{ success: true, data }` envelope with `data`
 * carrying the payload directly. Create and list used to emit a duplicate
 * top-level `link` / `links` beside `data` — a producer-side shim for readers
 * predating the envelope, kept alive because the sharing plugin's routes (the
 * OTHER surface for these same paths) still answered bare. #3983 moved that
 * surface onto this shape, which left the duplicate with no reader in any repo —
 * framework, objectui, or cloud — so #4038 removed it. Both surfaces now emit one
 * shape, which is what lets `ObjectStackClient.unwrapResponse` return the same
 * value whichever one served the request.
 */

import { SHARE_LINK_SERVICE } from '@objectstack/spec/contracts';

import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

export function createShareLinksDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/share-links',
        match: 'segment',
        handler: (req, context) =>
            handleShareLinksRequest(deps, req.path.substring('/share-links'.length), req.method, req.body, req.query, context),
    };
}

/** Body kept signature-compatible with the legacy `HttpDispatcher.handleShareLinks`. */
export async function handleShareLinksRequest(
    deps: DomainHandlerDeps,
    subPath: string,
    method: string,
    body: any,
    query: any,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    // [#4127 batch 3] `plugin-sharing` registers `ShareLinkService`, which
    // declares `implements IShareLinkService`; the four methods called below
    // were all already on that contract. Only the ledger entry was missing.
    // The registry key comes from the contract that DEFINES it (#3786). This was
    // a second hand-written `'shareLinks'`, copied from a constant whose own
    // doc-comment says "keep in sync with the SharingPlugin registration" — and a
    // drifted copy here resolves nothing, so every share link 501s with "Sharing
    // is not configured for this environment" on an environment where it is.
    const svc = await deps.resolveService(context, SHARE_LINK_SERVICE, context.environmentId);
    if (!svc) {
        return { handled: true, response: deps.error('Sharing is not configured for this environment', 501) };
    }

    const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;
    const m = method.toUpperCase();
    const parts = subPath.replace(/^\/+/, '').split('/').filter(Boolean);
    // [#6551 / #6206 / #6430] The dispatcher's ALREADY-COMPLETE envelope,
    // passed through WHOLE to every adjudicating service call below.
    //
    // `createLink` / `listLinks` / `revokeLink` are ENFORCEMENT paths — the
    // `IShareLinkService` contract types their context parameter as the full
    // `ExecutionContext` and says callers MUST NOT rebuild a subset of it:
    // `accessible_org_ids` (the `group`-posture Layer 0 wall, ADR-0105 D2 —
    // absent set DENIES), `positions` / `permissions` / `org_user_ids`
    // (Layer 1 business RLS + the CRUD gate), `posture` (ADR-0095 D2:
    // resolved once, carried, never re-derived) and `tabPermissions` are all
    // read downstream, and this call site cannot know which of them the
    // deployment's posture makes load-bearing. This used to rebuild a
    // two-field `{ userId, tenantId }` — structural subtyping keeps that
    // compiling, so the narrowing was invisible to tsc and every
    // `group`-posture caller was refused links on records they read fine
    // elsewhere (the #6206 defect, on the dispatcher face). The routes' own
    // 401 gate below reads only `ec?.userId` — an authentication decision
    // needs no authorization envelope.
    const ec = context.executionContext;

    const headerOf = (name: string): string | undefined => {
        const h = context.request?.headers;
        if (!h) return undefined;
        const v = typeof h.get === 'function' ? h.get(name) : (h[name] ?? h[name.toLowerCase()]);
        return Array.isArray(v) ? v[0] : (v ?? undefined);
    };
    const sendErr = (status: number, code: string, msg: string): HttpDispatcherResult => ({
        handled: true,
        response: deps.error(msg, status, { code }),
    });
    // Engine for fetching the shared record + token probes — the same
    // per-env ObjectQL the shareLinks service is bound to. Read from the
    // request's RESOLVED (per-env) kernel first: `resolveService('objectql',
    // env)` can hand back a different (host/scoped) engine that lacks the
    // per-env rows.
    // [#4127 batch 4] The `Promise<any>` return annotation was a THIRD way the
    // slot type got erased, after `const x: any =` and `as any` in batches 2-3.
    // Both arms resolve the same `objectql` slot and both are typed now; the
    // wrapper's own annotation flattened them back to `any` on the way out.
    // Inferred instead, so `engine.find` below is checked against IDataEngine.
    const getEngine = async () => {
        try {
            const e = await deps.getRequestKernelService(context, 'objectql');
            if (e) return e;
        } catch { /* fall through to scoped resolution */ }
        return deps.resolveService(context, 'objectql', context.environmentId);
    };
    const asArray = (rows: any): any[] => (Array.isArray(rows) ? rows : Array.isArray(rows?.value) ? rows.value : []);
    const applyRedaction = (record: any, redactFields: string[]): any => {
        if (!record || typeof record !== 'object' || redactFields.length === 0) return record;
        const out: any = {};
        for (const [k, v] of Object.entries(record)) {
            if (redactFields.includes(k)) continue;
            out[k] = v;
        }
        return out;
    };

    try {
        // ── PUBLIC: resolve a token → record ──────────────────────────
        if (parts.length === 2 && parts[1] === 'resolve' && m === 'GET') {
            const token = decodeURIComponent(parts[0]);
            const signedInUserId = ec?.userId;
            const recipientEmail = typeof query?.email === 'string' ? query.email : undefined;
            const providedPassword =
                typeof query?.password === 'string' ? (query.password as string) : headerOf('x-share-password');

            const resolved = await svc.resolveToken(token, { signedInUserId, recipientEmail, providedPassword });
            if (!resolved) {
                // Probe the row to return a more useful status (401 vs 410 vs 404).
                const engine = await getEngine();
                const probe = engine
                    ? asArray(await engine.find('sys_share_link', { where: { token }, limit: 1, context: SYSTEM_CTX } as any))
                    : [];
                const row = probe[0] ?? null;
                const live = row && !row.revoked_at && (!row.expires_at || Date.parse(row.expires_at) > Date.now());
                if (live && row.password_hash) {
                    return sendErr(401, providedPassword ? 'WRONG_PASSWORD' : 'NEEDS_PASSWORD',
                        providedPassword ? 'Incorrect password' : 'This link requires a password');
                }
                if (live && row.audience === 'signed_in' && !signedInUserId) {
                    return sendErr(401, 'SIGN_IN_REQUIRED', 'Please sign in to view this link');
                }
                if (row && (row.revoked_at || (row.expires_at && Date.parse(row.expires_at) <= Date.now()))) {
                    return sendErr(410, 'EXPIRED_OR_REVOKED', 'Share link has expired or been revoked');
                }
                return sendErr(404, 'INVALID_OR_EXPIRED', 'Share link is invalid, expired, or revoked');
            }

            const engine = await getEngine();
            const rows = engine
                ? asArray(await engine.find(resolved.link.object_name, { where: { id: resolved.link.record_id }, limit: 1, context: SYSTEM_CTX } as any))
                : [];
            const record = rows[0] ?? null;
            if (!record) return sendErr(410, 'RECORD_GONE', 'The shared record no longer exists');

            return {
                handled: true,
                response: deps.success({
                    record: applyRedaction(record, resolved.redactFields),
                    link: {
                        id: resolved.link.id,
                        token: resolved.link.token,
                        object_name: resolved.link.object_name,
                        record_id: resolved.link.record_id,
                        permission: resolved.link.permission,
                        audience: resolved.link.audience,
                        expires_at: resolved.link.expires_at,
                        label: resolved.link.label,
                        created_at: resolved.link.created_at,
                    },
                    redactFields: resolved.redactFields,
                }),
            };
        }

        // ── PUBLIC: ai_conversations messages for a resolved token ────
        if (parts.length === 2 && parts[1] === 'messages' && m === 'GET') {
            const token = decodeURIComponent(parts[0]);
            const providedPassword =
                typeof query?.password === 'string' ? (query.password as string) : headerOf('x-share-password');
            const resolved = await svc.resolveToken(token, { signedInUserId: ec?.userId, providedPassword });
            if (!resolved) return sendErr(404, 'NOT_FOUND', 'Share link not found');
            if (resolved.link.object_name !== 'ai_conversations') {
                return sendErr(400, 'UNSUPPORTED', 'This share link does not expose messages');
            }
            const engine = await getEngine();
            const rows = engine
                ? asArray(await engine.find('ai_messages', {
                    where: { conversation_id: resolved.link.record_id },
                    orderBy: [{ field: 'created_at', order: 'asc' }],
                    limit: 500,
                    context: SYSTEM_CTX,
                } as any))
                : [];
            return { handled: true, response: deps.success(rows) };
        }

        // ── AUTHENTICATED: create / list / revoke ─────────────────────
        if (!ec?.userId) return sendErr(401, 'UNAUTHENTICATED', 'Sign in to manage share links');

        // POST /share-links → create
        if (parts.length === 0 && m === 'POST') {
            const b: any = body ?? {};
            if (!b.object || !b.recordId) return sendErr(400, 'VALIDATION_FAILED', 'object and recordId are required');
            const link = await svc.createLink(
                {
                    object: b.object,
                    recordId: b.recordId,
                    permission: b.permission,
                    audience: b.audience,
                    expiresAt: b.expiresAt ?? null,
                    emailAllowlist: b.emailAllowlist,
                    password: b.password,
                    redactFields: b.redactFields,
                    label: b.label,
                },
                ec,
            );
            // Hand-built rather than `deps.success(...)` for the 201 alone — that
            // helper hardcodes 200. Same shape the `/keys` domain builds for its
            // own 201, and nothing more: the duplicate top-level `link` this used
            // to carry beside `data` is gone (#4038).
            return { handled: true, response: { status: 201, body: { success: true, data: link } } };
        }

        // GET /share-links?object&recordId → list the caller's own links
        if (parts.length === 0 && m === 'GET') {
            const links = await svc.listLinks(
                {
                    object: typeof query?.object === 'string' ? query.object : undefined,
                    recordId: typeof query?.recordId === 'string' ? query.recordId : undefined,
                    // Constrain to links the caller created so a guessed
                    // recordId can never enumerate another user's tokens.
                    createdBy: ec.userId,
                    includeRevoked: query?.includeRevoked === 'true' || query?.includeRevoked === '1',
                },
                ec,
            );
            return { handled: true, response: deps.success(links) };
        }

        // DELETE /share-links/:idOrToken → revoke
        if (parts.length === 1 && m === 'DELETE') {
            await svc.revokeLink(decodeURIComponent(parts[0]), ec);
            return { handled: true, response: deps.success({ ok: true }) };
        }

        return { handled: true, response: deps.routeNotFound(`/share-links${subPath}`) };
    } catch (err: any) {
        // [#6649] The dispatcher's SHARED thrown-error mapper, not a hand-written
        // status read. This catch used to be
        // `sendErr(err?.status ?? 500, err?.code ?? 'INTERNAL', …)`, and the two
        // channels it collapsed are the whole defect:
        //
        //  1. **Status.** The refusals that actually fly out of the enforcement
        //     paths below carry `statusCode`, not `status`:
        //     `PermissionDeniedError { code = 'PERMISSION_DENIED'; statusCode = 403 }`
        //     (`plugin-security/src/errors.ts`, mirrored by runtime's own
        //     `security/resolve-execution-context.ts`) is thrown by the security
        //     middleware's CRUD gate when the caller's permission sets grant no
        //     `allowRead` on the object — so `svc.createLink`'s visibility read
        //     `engine.find(object, { context })` throws it, `ShareLinkService`
        //     does not catch it, and it lands here. `err?.status` was `undefined`
        //     on it, so a 403-class refusal left as a **500** while `code` read
        //     `PERMISSION_DENIED` — an envelope that contradicts itself, and a
        //     status many SDK/browser clients treat as retryable when the answer
        //     is permanent. `errorFromThrown` reads `status` OR `statusCode`.
        //  2. **Code.** The `'INTERNAL'` fallback is not registered for
        //     `@objectstack/runtime` in `ERROR_CODE_LEDGER` — only
        //     `service-storage` / `service-i18n` / `rest` / `plugin-sharing`
        //     register it, and the ledger's per-package rows are provenance, so
        //     the global union kept `ApiErrorSchema` green while this domain
        //     emitted a code it never registered. The shared mapper leaves the
        //     required field to `standardErrorCodeForHttpStatus` instead, which
        //     spells the catalogued `INTERNAL_ERROR` (ADR-0112) — the same
        //     derived code every other dispatcher exit already answers with.
        //
        // `ShareLinkService`'s own refusals are unaffected: its `makeError` sets
        // `err.status` + `err.code`, which the mapper reads on the same first
        // branch the old chain did (403 `FORBIDDEN`, 422 `SHARING_NOT_ENABLED`,
        // …). What it adds on top is the structured `issues` / `fields` detail
        // the `/meta` and `/actions` domains already carry through this exit —
        // which is the point: a hand-written catch is exactly how this domain
        // diverged from the shared mapper in the first place.
        return { handled: true, response: deps.errorFromThrown(err, 500) };
    }
}
