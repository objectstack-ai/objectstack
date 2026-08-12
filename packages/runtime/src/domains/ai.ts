// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/ai` domain — extracted dispatcher body (ADR-0076 D11 step ③, PR-7).
 * Dispatches to the AI service's registered route handlers (the
 * `__aiRoutes` table the AI plugin caches on the request kernel), enforcing
 * each route's declared `auth` contract and threading the resolved actor
 * into handlers. NOTE: receives the FULL cleanPath (no prefix strip) — the
 * legacy branch passed `cleanPath` whole and the matcher re-prefixes
 * `/api/v1` internally; preserved verbatim.
 */

import {
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
import { isServiceServeable } from '../service-serveable.js';
import { actorUserFromExecutionContext, resolveActorDisplayName } from '../security/actor-user.js';
import { capabilityUnavailable } from './unavailable.js';
import type { IAIService } from '@objectstack/spec/contracts';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

export function createAiDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/ai',
        handler: (req, context) =>
            handleAIRequest(deps, req.path, req.method, req.body, req.query, context),
    };
}

/**
 * Handle AI service routes (/ai/chat, /ai/models, /ai/conversations, etc.)
 * Resolves the AI service and its built-in route handlers, then dispatches.
 */
export async function handleAIRequest(deps: DomainHandlerDeps, subPath: string, method: string, body: any, query: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
    // [#7653] ANONYMOUS BASELINE — decided here, ahead of every capability
    // answer below.
    //
    // The gate itself was already in this handler, but only INSIDE the
    // per-route loop, which is reachable only once the AI service is
    // serveable. On an open-edition boot (no `service-ai` — a Cloud/Enterprise
    // package) the `!isServiceServeable` branch below answered first, so the
    // whole `/ai/**` family replied to unauthenticated callers: `GET
    // /ai/agents` → 200 with the empty-list courtesy, every other route → 501
    // carrying the Cloud/EE remedy sentence. Serveability decided whether the
    // gate ran at all, which inverts the contract: `/ai` stands on the same
    // anonymous-deny floor as `/data`, `/meta`, `/security`, `/actions` and
    // `/automation` (ADR-0056 D2 → #3963), and `domains/automation.ts`
    // already gates ahead of its own `capabilityUnavailable` for exactly this
    // reason — an anonymous caller must not learn from a 501-vs-401 whether
    // this deployment mounts AI at all.
    //
    // The decision is taken ONCE and consulted twice; there is no second copy
    // of the rule to drift. The route-level `auth: false` opt-out stays down
    // in the loop because that is the only place it can mean anything: it is a
    // property of a REGISTERED route, so it can only be honoured where a route
    // table exists. With no serveable service there is no route to declare it,
    // and the family default — auth required — stands.
    const gec: any = context.executionContext;
    const denyAnonymous = shouldDenyAnonymous({ userId: gec?.userId, isSystem: gec?.isSystem });
    const anonymousRefusal = (): HttpDispatcherResult => ({
        handled: true,
        response: deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE }),
    });

    let aiService: IAIService | undefined;
    try {
        aiService = await deps.resolveService(context, 'ai');
    } catch {
        // AI service not registered
    }

    // [#4058] A slot filled by a self-declared non-handler (`handlerReady:
    // false`, ADR-0076 D12) is no AI capability, so it takes the same exits an
    // empty slot takes. This is also strictly better than what such an occupant
    // used to get: being truthy, it fell through to the `!routes` 503 below —
    // which both reads as a fault and loses the `/ai/agents` empty-list
    // courtesy the console depends on.
    if (!isServiceServeable(aiService)) {
        // [#7653] The gate before the courtesy and the 501: both of them are
        // capability disclosures, and neither is owed to a caller who has not
        // authenticated. This is the exit the defect lived behind.
        if (denyAnonymous) return anonymousRefusal();
        // The console polls `GET /ai/agents` on every navigation to decide
        // whether to show AI affordances. Reporting that as a 404 turns the
        // normal "no AI service configured" state (the open-source default —
        // service-ai is a Cloud/Enterprise package) into console error-log
        // spam on every page. An empty list conveys the same information
        // without looking like a fault. Every other /ai/* route still 404s.
        //
        // The body is the declared envelope (#4053). `data` carries
        // `AiAgentsResponseSchema`'s `{ agents }` — a RELOCATION of the declared
        // payload under `data`, the way `SettingsNamespacePayload` moved in #3843,
        // not a flatten to the bare array. That distinction is load-bearing here:
        // `unwrapResponse` returns `data`, so `client.ai.agents.list()` reads
        // `.agents` off it. It is also what let this side convert first and cloud's
        // `service-ai` — the route's OTHER producer — follow independently rather
        // than in lockstep; both answer this shape now (cloud#929). Flattening to
        // `data: []` would have made `.agents` `undefined` — an empty catalog,
        // which `useAiSurfaceEnabled` turns into "hide the entire AI surface", and
        // which is indistinguishable from the legitimate seat-less/CE state.
        if (method === 'GET' && subPath === '/ai/agents') {
            return { handled: true, response: deps.success({ agents: [] }) };
        }
        // [#3842] Was a hand-rolled envelope with the status in `code`. It has
        // no header or shape of its own, so it is simply the shared exit now.
        // 501, not 404: `/ai/*` IS mounted, so the request reached a handler
        // with nothing behind it — see ./unavailable.ts. This used to pass a
        // local message because the shared sentence said "nothing ships",
        // which is false for a Cloud/Enterprise deployment. The shared table
        // says the accurate thing now (REMEDY_DETAIL), so the override is gone
        // and this answer matches what discovery reports for the slot.
        return capabilityUnavailable(deps, 'ai');
    }

    // The AI service exposes route definitions via buildAIRoutes.
    // We match the request path against known AI route patterns.
    const fullPath = `/api/v1${subPath}`;

    // Build a simple param-extracting matcher for route patterns like /api/v1/ai/conversations/:id
    const matchRoute = (pattern: string, path: string): Record<string, string> | null => {
        const patternParts = pattern.split('/');
        const pathParts = path.split('/');
        if (patternParts.length !== pathParts.length) return null;
        const params: Record<string, string> = {};
        for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i].startsWith(':')) {
                params[patternParts[i].substring(1)] = pathParts[i];
            } else if (patternParts[i] !== pathParts[i]) {
                return null;
            }
        }
        return params;
    };

    // Try to get route definitions from the AI service's cached routes
    const routes = deps.getRegisteredAiRoutes(context) as Array<{
        method: string; path: string; handler: (req: any) => Promise<any>; auth?: boolean;
    }> | undefined;

    if (!routes) {
        // [#7653] Same shape as the unserveable exit above: a route table that
        // has not been published yet offers no route to declare `auth: false`,
        // so the family default applies and the gate goes first. Otherwise a
        // boot-race window would answer anonymous callers "AI is mounted, come
        // back in a moment" — the very disclosure this ordering exists to stop.
        if (denyAnonymous) return anonymousRefusal();
        return { handled: true, response: deps.error('AI service routes not yet initialized', 503) };
    }

    for (const route of routes) {
        if (route.method !== method) continue;
        const params = matchRoute(route.path, fullPath);
        if (params === null) continue;

        // Enforce the route's declared `auth` contract. Nothing upstream
        // does: `enforceAuthGate` only covers ADR-0069 password/MFA gates
        // and `enforceProjectMembership` bails when the request is
        // anonymous or unscoped — so without this an anonymous caller
        // reached `auth: true` handlers (e.g. GET /ai/status) and got the
        // adapter/model config back. Gate when the deployment requires
        // auth; an authenticated user (or an internal system context)
        // passes, matching the REST `enforceAuth` seam. Off → unchanged.
        //
        // [#7653] `route.auth !== false` is the AI-route contract and the one
        // thing this site adds over the family-wide decision taken at the top
        // of the handler: a registered route may legitimately open itself to
        // anonymous callers, and only a registered route can. The decision
        // itself is the same one — `denyAnonymous`, computed once above —
        // so the two exits cannot answer differently.
        if (route.auth !== false && denyAnonymous) return anonymousRefusal();

        // Resolve `req.user` from the already-resolved ExecutionContext so
        // AI route handlers can attribute the call to the authenticated
        // actor (drives auto-titled conversations, permission-aware
        // tools, HITL conversation linkage, …). Falls back to undefined
        // for anonymous requests (only reachable when the deployment does
        // NOT require auth — the gate above rejects them otherwise).
        const ec: any = context.executionContext;
        // `ai_seat` is synthesized into ec.permissions by resolveExecutionContext
        // (the single, scope-correct source — security/resolve-execution-context.ts),
        // so it flows through here with no extra per-request lookup.
        //
        // [#4705] `permissions` and `systemPermissions` are TWO channels, and
        // both have to cross this seam — they are not interchangeable and must
        // never be flattened into one another:
        //
        //   - `ec.permissions`       → permission-SET NAMES (`admin_full_access`,
        //                              `organization_admin`, `member_default`) plus
        //                              the synthesized `ai_seat`.
        //                              (core/src/security/resolve-authz-context.ts,
        //                              `grants.permissions.push(ps.name)`)
        //   - `ec.systemPermissions` → CAPABILITIES (`manage_metadata`,
        //                              `studio.access`, `setup.access`, …), the
        //                              union of every resolved permission set's
        //                              `systemPermissions[]`. (same file, the
        //                              `grants.systemPermissions.push(p)` loop)
        //
        // Only the first used to be copied, which made `/ai/*` the one route
        // domain in the repo where a capability check was impossible: every
        // other surface reads `systemPermissions` (domains/meta.ts, the
        // `manage_metadata` gate; action-execution.ts; rest-server.ts), so a
        // capability test written against `req.user.permissions` is
        // permanently false — closing the route on platform admins too rather
        // than tightening it. Copying the channel through is transport only:
        // no route in THIS repo gates on it; the consumer decides.
        //
        // Fail-closed default, same as `roles`/`permissions`: a non-array (or
        // absent — `ExecutionContext.systemPermissions` is optional) becomes
        // `[]`, never `undefined`, so a consumer reads "holds nothing" instead
        // of having to tolerate a missing field.
        //
        // [#5372] The shape itself now comes from the ONE producer
        // (`security/actor-user.ts`) shared with the REST `/actions` and MCP
        // `run_action` dispatch paths, and it fixes two silent wrong values
        // this literal carried: `displayName` read a `??` chain over
        // `ec.userDisplayName` / `ec.userName`, neither of which
        // `ExecutionContextSchema` declares and neither of which anything ever
        // assigned (so it always served the raw id), and `email` read
        // `ec.userEmail` — the declared field is `ec.email`, so `user.email`
        // here was permanently `undefined`. `name` joins `displayName` (same
        // value) so all three paths answer to one key set.
        //
        // Anonymous stays `undefined` rather than the action paths' `system`
        // principal: an AI route handler distinguishes "no caller" by the
        // absence of `user`, and this route only reaches anonymous when the
        // deployment does not require auth.
        const user = ec?.userId
            ? actorUserFromExecutionContext(
                ec,
                await resolveActorDisplayName(
                    () => deps.getObjectQL(context, context?.environmentId),
                    ec,
                ),
            )
            : undefined;

        const result = await route.handler({
            body,
            params,
            query,
            headers: context.request?.headers,
            user,
        });

        if (result.stream && result.events) {
            // Return a streaming result for the adapter to handle
            return {
                handled: true,
                result: {
                    type: 'stream',
                    contentType: result.vercelDataStream
                        ? 'text/plain; charset=utf-8'
                        : 'text/event-stream',
                    events: result.events,
                    vercelDataStream: result.vercelDataStream,
                    headers: {
                        'Content-Type': result.vercelDataStream
                            ? 'text/plain; charset=utf-8'
                            : 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                    },
                },
            };
        }

        return {
            handled: true,
            response: {
                status: result.status,
                body: result.body,
            },
        };
    }

    return {
        handled: true,
        response: deps.routeNotFound(subPath),
    };
}
