// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
    ANONYMOUS_DENY_CODE,
    ANONYMOUS_DENY_MESSAGE,
    ANONYMOUS_DENY_STATUS,
    evaluateAuthGate,
    isApiKeyLifecycleRefusalError,
    isAuthzStoreUnavailableError,
    shouldDenyAnonymous,
} from '@objectstack/core';
import type { ErrorCode } from '@objectstack/spec/api';
import type { IHttpRequest, IHttpResponse, IHttpServer } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { sendError, sendOk, sendServerFault } from '@objectstack/types';
import { resolveMessagingCaller, type MessagingCallerSources } from './messaging-request-caller.js';
import { PREFERENCE_WILDCARD, readPreferenceOptions, type PreferenceOptionsSources } from './preference-options.js';
import type { EffectivePreferences, EffectiveTopic } from './preference-resolver.js';

/**
 * The caller's own notification preferences door:
 * `GET /api/v1/messaging/me/preferences` (rulings 6968686390 and 6969143776).
 * It answers the signed-in person's EFFECTIVE preferences — what `emit` would
 * do for them — so the Account app's Notification Settings page draws the
 * same rules, from the one implementation (`PreferenceResolver.effectiveFor`).
 * It reads and never writes: the page writes the person's own
 * `sys_notification_preference` rows through the data door, as them, where
 * `member_default`'s own-row policy decides which rows they may write.
 *
 * ## Who may ask — the posture of `GET /api/v1/messaging/preference-options`
 *
 * Any signed-in person, about themselves only: the route takes no user id, and
 * the person is the caller the platform's one request-to-context composition
 * resolves. In order, before anything is read:
 *
 *  1. **The caller** (`resolveRequestExecutionContext`, from the session or API
 *     key). A permission store that cannot be read, or an API key its
 *     lifecycle refuses, answers its own code and status, relayed as declared.
 *  2. **A held sign-in** (ADR-0069): `403` with the authentication policy's
 *     own code.
 *  3. **Anonymous** (ADR-0056 D2): `UNAUTHENTICATED` / `401`.
 *  4. **The request**: the closed query set is EMPTY (AGENTS.md, route rule
 *     5): a request carrying any parameter is refused `VALIDATION_ERROR` /
 *     `400` naming it, never ignored. ⛔ In particular there is no `user`
 *     parameter: nobody asks this door about another person.
 *
 * ## What the door answers
 *
 * `200` with {@link MyPreferences}:
 *
 *  - `topics`: `*` (all topics) first, then every topic the organization's
 *    preference options list names (`readPreferenceOptions`: the platform's
 *    fixed topics, the flows' notify topics, the organization's stored
 *    topics), then any other topic the person's own rows name. Each topic says
 *    whether it is mandatory and, per channel, whether it is on and where that
 *    comes from: `own` (their row), `default` (the organization's default for
 *    everyone), `builtin` (no row: on), or `mandatory`.
 *  - `channels`: the column order, each known channel and whether the
 *    deployment can send on it now (`configured`).
 *  - `general`: their general on/off, digest and quiet hours, each with its
 *    source, and the id of their own `(*, *)` row when they have one.
 *
 * What it never answers: another person's row, or any row's id but the
 * caller's own. The organization's defaults are read to compute the answer
 * and surface only as `source: 'default'` on the caller's own cells (ruled).
 *
 * A source that cannot be read (the event table, the flow list, the
 * preference rows) is a fault: `500` / `INTERNAL_ERROR` with this door's
 * sentence, never a partial or "everything on" answer. So is a preference
 * read that answers more rows than `EFFECTIVE_PREFERENCES_READ_CAP`.
 *
 * A caller with no organization is answered from no row at all (the
 * built-in defaults). There `emit`, which reads without the organization term
 * when it has none, can decide otherwise: this door never reads across
 * organizations (ADR-0131 D1).
 */

/** The route the door is mounted at. */
export const MY_PREFERENCES_ROUTE = '/api/v1/messaging/me/preferences';

/** A channel column of the effective matrix. */
export interface MyPreferencesChannel {
    channel: string;
    /** Whether the deployment can send on this channel right now. A channel only the caller's own rows name is `false`. */
    configured: boolean;
}

/** The door's success payload. */
export interface MyPreferences {
    topics: EffectiveTopic[];
    channels: MyPreferencesChannel[];
    general: EffectivePreferences['general'];
}

/** What the door is composed over — every member read when a request arrives. */
export interface MyPreferencesRoutesDeps extends PreferenceOptionsSources, MessagingCallerSources {
    /** The messaging service's effective read (`MessagingService.effectivePreferencesFor`). */
    effectivePreferences(
        userId: string,
        organizationId: string | undefined,
        topics: readonly string[],
        channels: readonly string[],
    ): Promise<EffectivePreferences>;
}

/** Mount the door on `http`. Nothing on `deps` is called until a request arrives. */
export function registerMyPreferencesRoutes(http: IHttpServer, deps: MyPreferencesRoutesDeps): void {
    http.get(MY_PREFERENCES_ROUTE, (req, res) => handleMyPreferences(req, res, deps));
}

/** Read the caller's effective preferences over the organization's options list. */
export async function readMyPreferences(
    deps: Pick<MyPreferencesRoutesDeps, 'effectivePreferences'> & PreferenceOptionsSources,
    userId: string,
    organizationId: string | undefined,
): Promise<MyPreferences> {
    const options = await readPreferenceOptions(deps, organizationId);
    const topics = [PREFERENCE_WILDCARD, ...options.topics.filter((t) => !t.wildcard).map((t) => t.value)];
    const known = new Map(options.channels.filter((c) => !c.wildcard).map((c) => [c.value, c.configured]));
    const effective = await deps.effectivePreferences(userId, organizationId, topics, [...known.keys()]);
    return {
        topics: effective.topics,
        channels: effective.channels.map((channel) => ({ channel, configured: known.get(channel) ?? false })),
        general: effective.general,
    };
}

async function handleMyPreferences(req: IHttpRequest, res: IHttpResponse, deps: MyPreferencesRoutesDeps): Promise<void> {
    // ① The caller.
    let context: ExecutionContext | undefined;
    try {
        context = await resolveMessagingCaller(req, deps);
    } catch (err) {
        if (isAuthzStoreUnavailableError(err) || isApiKeyLifecycleRefusalError(err)) {
            sendError(res, err.status, err.code, err.message);
            return;
        }
        sendServerFault(res, 500, 'INTERNAL_ERROR', 'The caller of this request could not be resolved.', err, {
            method: 'GET',
            path: MY_PREFERENCES_ROUTE,
        });
        return;
    }

    // ② A held sign-in.
    const gate = evaluateAuthGate(context, '');
    if (gate) {
        sendError(res, 403, gate.code as ErrorCode, gate.message);
        return;
    }

    // ③ Anonymous.
    if (!context || !context.userId || shouldDenyAnonymous({ userId: context.userId, method: req.method })) {
        sendError(res, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE);
        return;
    }

    // ④ The request: the closed query set is empty.
    const query = Object.keys(req.query ?? {});
    if (query.length > 0) {
        sendError(
            res,
            400,
            'VALIDATION_ERROR',
            `Your notification preferences take no query parameter, and this request carries ${query.map((q) => `'${q}'`).join(', ')}. ` +
                'Ask with no parameters: the answer is always every topic and channel, for the signed-in person only.',
        );
        return;
    }

    try {
        sendOk(res, await readMyPreferences(deps, context.userId, context.tenantId));
    } catch (err) {
        sendServerFault(res, 500, 'INTERNAL_ERROR', 'Your notification preferences could not be read.', err, {
            method: 'GET',
            path: MY_PREFERENCES_ROUTE,
        });
    }
}
