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
 *  - [#8287] `active_organization_id` is INHERITED from the caller's active
 *    organization and is likewise never read from the body. There is
 *    deliberately no org parameter and no cross-org key in v1: a caller cannot
 *    mint a credential for an organization other than the one they are
 *    currently working in, so minting can never be a lateral-movement step.
 *    Inheritance alone is not trusted — the caller's membership in that
 *    organization is re-checked here, against `sys_member`, at mint time.
 */

import { isGrantActive, effectiveTenancyPosture } from '@objectstack/core';
import { postureEnforcesWall } from '@objectstack/spec/security';

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

    // ── [#8287] Resolve the organization this key will authenticate into. ──
    //
    // INHERITED from the caller's active organization (`ExecutionContext
    // .tenantId`, which the one shared resolver fills from the session's
    // `activeOrganizationId` or from the minting key's own stamp). Never a
    // body parameter: see the header.
    const activeOrganizationId = typeof ec.tenantId === 'string' && ec.tenantId.trim()
        ? ec.tenantId.trim()
        : undefined;

    // The EFFECTIVE posture, from the kernel's `tenancy` service — what is
    // ENFORCED, not what `OS_TENANCY_POSTURE` requested (ADR-0093 D4/D5: a
    // requested-but-unenforceable wall resolves to `single`). An absent service
    // means we cannot tell, and the honest answer to that at MINT time is to
    // mint: refusing would block key creation on a deployment that may have no
    // wall at all.
    let tenancyPosture;
    try {
        tenancyPosture = effectiveTenancyPosture(
            await deps.resolveService(context, 'tenancy' as any, context.environmentId),
        );
    } catch {
        tenancyPosture = undefined;
    }
    const walled = tenancyPosture ? postureEnforcesWall(tenancyPosture) : false;

    if (walled && !activeOrganizationId) {
        // Refuse rather than mint. Under a walled posture an org-less key
        // reads nothing (`isolated`) or reads by a rule that has nothing to do
        // with what the caller asked for (`group`) — and handing back a
        // valid-looking secret that cannot do its job is the exact defect this
        // change removes. Fail at mint time, where the caller is a human at a
        // console who can act on it.
        return {
            handled: true,
            response: deps.error(
                'Cannot create an API key without an active organization: this deployment runs a walled '
                + `tenancy posture ('${String(tenancyPosture)}') in which every organization-scoped read requires one. `
                + 'Select an organization and try again.',
                400,
            ),
        };
    }

    if (activeOrganizationId) {
        // Membership check at mint time (the ruling's second clause). The
        // inherited value comes from the caller's own context, so this is not
        // guarding against a forged parameter — it guards against minting a
        // long-lived credential off a STALE context: a session whose active
        // organization outlived the membership that justified it. ADR-0091
        // validity windows are honoured, so a lapsed membership does not mint
        // either.
        let memberRows: any;
        try {
            memberRows = await ql.find('sys_member', {
                where: { user_id: ec.userId, organization_id: activeOrganizationId },
                limit: 1,
                context: { isSystem: true },
            });
        } catch {
            // Fail closed: an unreadable membership table is not evidence of
            // membership.
            return { handled: true, response: deps.error('Failed to create API key', 500) };
        }
        if (memberRows && (memberRows as any).value) memberRows = (memberRows as any).value;
        const member = Array.isArray(memberRows) ? memberRows[0] : undefined;
        if (!member || !isGrantActive(member, Date.now())) {
            return {
                handled: true,
                response: deps.error(
                    'Cannot create an API key for an organization you are not a member of.',
                    403,
                ),
            };
        }
    }

    // Generate AFTER validation so we never mint on a rejected request.
    const generated = generateApiKey();

    // Server-controlled row. user_id is pinned to the caller; only the hash
    // is persisted. NOTHING from the body can set key/id/user_id/revoked/
    // active_organization_id.
    const row: Record<string, unknown> = {
        name,
        key: generated.hash,
        prefix: generated.prefix,
        user_id: ec.userId,
        revoked: false,
    };
    if (expiresAt) row.expires_at = expiresAt;
    if (activeOrganizationId) row.active_organization_id = activeOrganizationId;

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
                    // [#8287] Echo the organization the key is pinned to. The
                    // card's complaint was a credential whose reach the caller
                    // could not see; the mint response is the first and best
                    // place to state it, and it is the only moment the caller
                    // is definitely looking.
                    ...(activeOrganizationId ? { active_organization_id: activeOrganizationId } : {}),
                    ...(expiresAt ? { expires_at: expiresAt } : {}),
                },
            },
        },
    };
}
