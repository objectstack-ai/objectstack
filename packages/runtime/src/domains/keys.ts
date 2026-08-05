// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/keys` domain — extracted dispatcher body (ADR-0076 D11 step ③, PR-3).
 *
 * Generates a `sys_api_key` and returns the raw secret EXACTLY ONCE
 * (`POST /keys`). This is the only mint path — the raw key is never stored
 * (only its sha256 hash) and never re-displayable.
 *
 * Security (zero-tolerance):
 *  - Requires an authenticated principal; `user_id` is PINNED to that
 *    caller and is NEVER read from the request body (no impersonation).
 *  - Body is whitelisted to `name` (+ optional `expires_at`); any
 *    `key` / `id` / `user_id` / `revoked` in the body is ignored, so a
 *    caller cannot forge a known-secret or escalate.
 *  - `scopes` are intentionally NOT accepted from the body in v1: the
 *    verify path ADDS scopes to the principal's permissions, so honouring
 *    arbitrary body scopes would be an escalation vector. A generated key
 *    therefore acts exactly AS the caller (via `user_id` resolution).
 *    Narrowing/scoped keys need subset-enforcement — deferred.
 *  - The raw key and its hash never enter logs or error messages.
 *  - The row is written with an elevated `{ isSystem: true }` context
 *    because `sys_api_key` is protection-locked; safe because the row's
 *    contents are fully server-controlled (user_id pinned to caller).
 */

import { generateApiKey } from '../security/api-key.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

/**
 * The legacy branch matched `=== '/keys' || startsWith('/keys/') ||
 * startsWith('/keys?')` — a segment match PLUS the query-string form some
 * adapters pass through in `path`. Two entries reproduce that exactly.
 */
export function createKeysDomains(deps: DomainHandlerDeps): DomainRoute[] {
    const handler: DomainRoute['handler'] = (req, context) =>
        handleKeysRequest(deps, req.method, req.body, context);
    return [
        { prefix: '/keys', match: 'segment', handler },
        { prefix: '/keys?', handler },
    ];
}

/** Body kept signature-compatible with the legacy `HttpDispatcher.handleKeys`. */
export async function handleKeysRequest(
    deps: DomainHandlerDeps,
    method: string,
    body: any,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    if (method !== 'POST') {
        return { handled: true, response: deps.error('Method not allowed', 405) };
    }

    const ec = context.executionContext;
    if (!ec || !ec.userId) {
        return { handled: true, response: deps.error('Unauthorized: sign in to generate an API key', 401) };
    }

    // ── Whitelist the body. Only `name` and optional `expires_at`. ──
    const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
    const name = rawName || 'API Key';

    let expiresAt: string | undefined;
    if (body?.expires_at != null && body.expires_at !== '') {
        const ms = typeof body.expires_at === 'number'
            ? (body.expires_at < 1e12 ? body.expires_at * 1000 : body.expires_at)
            : Date.parse(String(body.expires_at));
        if (Number.isNaN(ms)) {
            return { handled: true, response: deps.error('Invalid expires_at: must be a parseable date', 400) };
        }
        if (ms <= Date.now()) {
            return { handled: true, response: deps.error('Invalid expires_at: must be in the future', 400) };
        }
        expiresAt = new Date(ms).toISOString();
    }

    const ql = (await deps.getObjectQL(context, context.environmentId))
        ?? (await deps.resolveService(context, 'objectql', context.environmentId));
    if (!ql || typeof ql.insert !== 'function') {
        return { handled: true, response: deps.error('Data service not available', 503) };
    }

    // Generate AFTER validation so we never mint on a rejected request.
    const generated = generateApiKey();

    // Server-controlled row. user_id is pinned to the caller; only the hash
    // is persisted. NOTHING from the body can set key/id/user_id/revoked.
    const row: Record<string, unknown> = {
        name,
        key: generated.hash,
        prefix: generated.prefix,
        user_id: ec.userId,
        revoked: false,
    };
    if (expiresAt) row.expires_at = expiresAt;

    let inserted: any;
    try {
        inserted = await ql.insert('sys_api_key', row, { context: { isSystem: true } });
    } catch {
        // Never surface the underlying error (could echo row contents).
        return { handled: true, response: deps.error('Failed to create API key', 500) };
    }
    const id = inserted?.id ?? (Array.isArray(inserted) ? inserted[0]?.id : undefined);

    // Raw key returned ONCE. Do not log it.
    return {
        handled: true,
        response: {
            status: 201,
            body: {
                success: true,
                data: {
                    id,
                    name,
                    prefix: generated.prefix,
                    key: generated.raw,
                    ...(expiresAt ? { expires_at: expiresAt } : {}),
                },
            },
        },
    };
}
