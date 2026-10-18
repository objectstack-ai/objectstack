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
 *    The anonymous decision is the domain's FIRST statement (ADR-0138 D2),
 *    ahead of the method check, so every face answers an anonymous caller 401.
 *  - Body is whitelisted to `name` (+ optional `expires_at`); any
 *    `key` / `id` / `user_id` / `revoked` in the body is ignored, so a
 *    caller cannot forge a known-secret or escalate.
 *  - [#23367, ruling A] The API-key lifecycle policy (the auth service's
 *    `resolveApiKeyLifecyclePolicy`, the same source the key-admission seam
 *    reads): a signing that names no `expires_at` gets the default life (90
 *    days unless configured), and one that asks for a later date than the
 *    ceiling (one year unless configured) is refused `400
 *    API_KEY_EXPIRY_TOO_LONG`. Exactly the ceiling is accepted.
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

import {
    isGrantActive, effectiveTenancyPosture, AuthzStoreUnavailableError,
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
    apiKeyLifecyclePolicySourceOf,
} from '@objectstack/core';
import type { ApiKeyLifecyclePolicy } from '@objectstack/spec/contracts';
import { postureEnforcesWall } from '@objectstack/spec/security';

import { generateApiKey } from '../security/api-key.js';
import { buildApiError } from '../error-envelope.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';
import { readDispatchedBody } from '../deferred-request-body.js';

const DAY_MS = 86_400_000;

/**
 * [#23367] The clock skew the ceiling forgives. A client that computes "one
 * year from now" on its own clock and sends it is asking for exactly the
 * ceiling; a client clock a few seconds ahead of the server's must not turn
 * that into a refusal.
 */
const EXPIRY_CEILING_SKEW_MS = 60_000;

/** [#23367] The ceiling refusal, as its wire pair (ADR-0112 ledger, `@objectstack/runtime`). */
const API_KEY_EXPIRY_TOO_LONG = { code: 'API_KEY_EXPIRY_TOO_LONG', status: 400 } as const;

/**
 * The one method this domain serves, on every path it claims (the handler
 * never reads the path): the `Allow` value of its 405.
 */
const KEYS_ALLOWED_METHODS = 'POST';

/**
 * The legacy branch matched `=== '/keys' || startsWith('/keys/') ||
 * startsWith('/keys?')` — a segment match PLUS the query-string form some
 * adapters pass through in `path`. Two entries reproduce that exactly.
 *
 * [#16263] The second entry now says `match: 'prefix'` out loud. It always
 * relied on the bare-`startsWith` default, and that default is `'segment'`
 * now; a prefix ending in `'?'` has no `/` after it, so a segment match
 * cannot express the query-string form at all. Declaring it keeps this route
 * byte-identical to what it has always matched.
 */
export function createKeysDomains(deps: DomainHandlerDeps): DomainRoute[] {
    const handler: DomainRoute['handler'] = (req, context) =>
        handleKeysRequest(deps, req.method, req.body, context);
    return [
        { prefix: '/keys', match: 'segment', handler },
        { prefix: '/keys?', match: 'prefix', handler },
    ];
}

/** Body kept signature-compatible with the legacy `HttpDispatcher.handleKeys`. */
export async function handleKeysRequest(
    deps: DomainHandlerDeps,
    method: string,
    body: any,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    // ANONYMOUS BASELINE — the domain's FIRST statement (ADR-0138 D2: the
    // decision is taken once per domain, never face by face). It used to sit
    // below the method check, so an anonymous caller using any verb but POST
    // was answered the 405 describing the route's shape instead of the 401
    // every domain off the closed list of doors answers. A key is minted FOR a
    // user, so the decision is asked about the user id alone: this domain has
    // no system-context arm (an internal system context was refused here before
    // as it is now), and the `!ec` / `!ec.userId` arms only narrow the type for
    // the compiler.
    const ec = context.executionContext;
    if (shouldDenyAnonymous({ userId: ec?.userId }) || !ec || !ec.userId) {
        return {
            handled: true,
            response: deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE }),
        };
    }
    // [#24151] The body is read once the baseline above has admitted the
    // caller, never ahead of it (`../deferred-request-body.ts`).
    body = readDispatchedBody(body);

    if (method !== 'POST') {
        // RFC 9110 §15.5.6: a 405 MUST carry an `Allow` header naming the
        // target resource's supported methods. Hand-rolled rather than
        // `deps.error(...)` only for that header, which `deps.error` cannot
        // carry — the shape `domains/mcp.ts`, `domains/meta.ts` and
        // `domains/ai.ts` already answer with. The BODY still goes through the
        // one builder, so its code stays DERIVED from the status
        // (`METHOD_NOT_ALLOWED`) and is not spelled here. Below the anonymous
        // baseline above, so an anonymous caller never reaches this answer.
        return {
            handled: true,
            response: {
                status: 405,
                headers: { Allow: KEYS_ALLOWED_METHODS },
                body: {
                    success: false,
                    error: buildApiError({ message: 'Method not allowed', httpStatus: 405 }),
                },
            },
        };
    }

    // ── Whitelist the body. Only `name` and optional `expires_at`. ──
    const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
    const name = rawName || 'API Key';

    let requestedMs: number | undefined;
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
        requestedMs = ms;
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
    // requested-but-unenforceable wall resolves to `single`).
    //
    // [#15900, ruled 2026-09-06 — option A] "No service" and "the service could
    // not be built" are TWO facts, and only one of them licenses a mint:
    //
    //  - **never registered** ⇒ no posture, and the honest answer at MINT time
    //    is to mint. That is the deliberate choice this comment has always
    //    recorded, and it is unchanged: refusing would block key creation on a
    //    deployment that may have no wall at all, and a no-tenancy composition
    //    is supported. ⚠️ It applies to THIS class only — it is not a statement
    //    about a posture that could not be read.
    //  - **registered and unable to answer** ⇒ the posture is an authorization
    //    INPUT that was never READ, so whether this key needs an organization
    //    was never DECIDED. Minting there hands back a long-lived credential on
    //    a question nobody answered — the permissive direction #13906 decision 1
    //    option A ruled against at the identity seam, whose words govern here
    //    too: 「A posture that could not be READ is not a posture that is
    //    ABSENT.」 Answered as an outage (503), never as a mint.
    //
    // The split is taken from the REGISTRY's own brand (#13905), never from
    // message text, and the two classes arrive here already told apart —
    // `resolveServiceOrLoud` absorbs the branded "never registered" and answers
    // `undefined`, so anything that REJECTS is a `tenancy` that is wired and
    // broken. ⛔ Hence no `isServiceNotRegisteredError` re-test below: a second
    // copy of the classification is a second thing to drift.
    let tenancyPosture;
    try {
        tenancyPosture = effectiveTenancyPosture(
            await deps.resolveServiceOrLoud(context, 'tenancy', context.environmentId),
        );
    } catch (err) {
        throw new AuthzStoreUnavailableError('tenancy', err);
    }
    const walled = tenancyPosture ? postureEnforcesWall(tenancyPosture) : false;

    // ── [#23367, ruling A] The lifecycle policy, from the auth service. ──
    //
    // The same source the key-admission seam judges with, so the life a key
    // is signed with and the life it is admitted under cannot disagree. A
    // kernel with no `auth` service has no auth configuration: the signing
    // then keeps its pre-policy behaviour (no default, no ceiling). An `auth`
    // service that is registered and FAILED to build is the outage it is —
    // the #15900 reasoning above, for the same kind of input: the policy
    // decides the life of the credential being minted, and an input never
    // read decides nothing.
    let policy: ApiKeyLifecyclePolicy | undefined;
    try {
        const source = apiKeyLifecyclePolicySourceOf(
            await deps.resolveServiceOrLoud(context, 'auth', context.environmentId),
        );
        policy = source ? await source() : undefined;
    } catch (err) {
        throw new AuthzStoreUnavailableError('api_key_policy', err);
    }

    const nowMs = Date.now();
    let expiresAt: string | undefined;
    if (requestedMs !== undefined) {
        if (policy && requestedMs > nowMs + policy.maxExpiryDays * DAY_MS + EXPIRY_CEILING_SKEW_MS) {
            const latest = new Date(nowMs + policy.maxExpiryDays * DAY_MS).toISOString();
            return {
                handled: true,
                response: deps.error(
                    `expires_at ${new Date(requestedMs).toISOString()} is further away than this deployment allows: an `
                    + `API key lives at most ${policy.maxExpiryDays} days, so the latest expiry a key signed now may `
                    + `have is ${latest}. Ask for that date or an earlier one, and rotate the key before it expires.`,
                    API_KEY_EXPIRY_TOO_LONG.status,
                    { code: API_KEY_EXPIRY_TOO_LONG.code },
                ),
            };
        }
        expiresAt = new Date(requestedMs).toISOString();
    } else if (policy) {
        // No expiry asked for: the policy's default life, never a permanent key.
        expiresAt = new Date(nowMs + policy.defaultExpiryDays * DAY_MS).toISOString();
    }

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
        //
        // [#12981] This catch is silent BY DESIGN and it is NOT a durability
        // swallow. `scripts/measure-durability-swallow-family.mjs` reports this
        // site as tier-1 DARK because membership is decided on three mechanical
        // conjuncts -- silent catch, no rethrow, an awaited write in the `try`
        // -- and the census deliberately leaves the fourth, "and the caller
        // still reports success", to a person. Here the answer is NO: every
        // path out of this catch hands the failure to the caller as a 500
        // envelope and no key material is returned, so nothing claims to have
        // persisted and the request does not look normal from the outside.
        //
        // AGENTS.md "Degradation log levels" names that the third legal answer
        // and forbids bolting a `logger.error` onto it: this branch's common
        // case is a rejected request, and one durability `error` per rejected
        // request is the mirror-image failure that made the founding incident's
        // `warn` unreadable in the first place.
        //
        // Do NOT "repair" this site by adding a log, and do NOT declare it in
        // check-durability-degradation-log-level.mjs's
        // FAILURE_PROPAGATION_SITES either: no gate entry is owed here. An
        // earlier revision of this note promised one "in the step that widens
        // DURABILITY_CRITICAL_CALLEES"; that promise is FALSIFIED by the
        // widening the programme actually sanctioned -- the seeder wrappers
        // `tryInsert`/`tryUpdate`, which match no seam in this function. The
        // only name that would match is bare `insert`, which the census refuses
        // by design, so an entry keyed `keys.ts::handleKeysRequest` would not
        // be early, it would be STALE on arrival -- and the gate deletes
        // entries that excuse nothing (#12981 comment 5543738972, Q1 = A).
        //
        // What stands in its place is already mechanical, and it cross-checks
        // MORE than a gate entry would. The delivery stated above was measured
        // with the gate's own `catchDeliversFailure()`: with a matching
        // vocabulary name present, every path out of this catch reaches
        // `deps.error`. The determination itself is carried by the DETERMINED
        // register row for
        // `packages/runtime/src/domains/keys.ts::handleKeysRequest` in
        // scripts/measure-durability-swallow-family.mjs, which re-verifies on
        // EVERY census run that this file exists, that the determination
        // sentence above is still written at this site, and that the census
        // still reports the site as a tier-1 DARK member -- going STALE, and
        // loudly, the moment any of the three stops holding. A gate entry would
        // have proved the delivery alone.
        //
        // The delivery this ruling rests on is pinned in
        // `http-dispatcher.keys.test.ts`; if you change what this catch
        // returns, that pin is what will stop you.
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
