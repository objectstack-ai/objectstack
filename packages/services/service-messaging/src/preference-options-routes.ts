// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
    ANONYMOUS_DENY_CODE,
    ANONYMOUS_DENY_MESSAGE,
    ANONYMOUS_DENY_STATUS,
    evaluateAuthGate,
    isApiKeyLifecycleRefusalError,
    isAuthzStoreUnavailableError,
    resolveRequestExecutionContext,
    shouldDenyAnonymous,
    type RequestAuthService,
    type TenancyServiceResolver,
} from '@objectstack/core';
import type { ErrorCode } from '@objectstack/spec/api';
import type { IHttpRequest, IHttpResponse, IHttpServer } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { sendError, sendOk, sendServerFault } from '@objectstack/types';
import { readPreferenceOptions, type PreferenceOptionsSources } from './preference-options.js';

/**
 * The preference options door: `GET /api/v1/messaging/preference-options`,
 * the one HTTP route of `@objectstack/service-messaging`. It answers the
 * topics and channels an administrator can pick for a notification
 * preference's `topic` / `channel`, and a notification template's `topic`
 * (`preference-options.ts` says what is listed and from where). It reads and
 * never writes.
 *
 * ## Who may ask — the posture of the sibling `/api/v1/notifications` routes
 *
 * Any signed-in member, as on the inbox routes the runtime dispatcher serves
 * (`handleNotificationRequest`): the list is what a member needs to fill in
 * their own preference, and it is the same for every member of an
 * organization. In order, before anything is read:
 *
 *  1. **The caller**, resolved by the platform's one request-to-context
 *     composition (`resolveRequestExecutionContext`) from the request's session
 *     or API key. A permission store that cannot be read answers its own
 *     `SERVICE_UNAVAILABLE` / `503`, and an API key its lifecycle refuses its
 *     own `403` and code: both relayed as declared, never folded into a denial.
 *  2. **A held sign-in** (ADR-0069: an expired password, enforced MFA not yet
 *     enrolled): `403` with the authentication policy's own code.
 *  3. **Anonymous** — the platform's one anonymous floor (ADR-0056 D2):
 *     `UNAUTHENTICATED` / `401`. An anonymous caller learns nothing about the
 *     deployment's topics or channels.
 *  4. **The request**: the route takes no query parameter, and a request that
 *     carries one is refused `VALIDATION_ERROR` / `400` naming it (AGENTS.md,
 *     route rule 5: the closed set here is empty), never ignored.
 *
 * ## What the door answers
 *
 *  - **Success:** `200` with `{ topics, channels }` (`PreferenceOptions`),
 *    the caller's organization's stored topics among the topics.
 *  - **A source that cannot be read** (the event table, the flow list) is a
 *    fault: `500` / `INTERNAL_ERROR` with this door's sentence and the error
 *    in the fault log. A partial list is never served as if it were whole.
 */

/** The route the door is mounted at. */
export const PREFERENCE_OPTIONS_ROUTE = '/api/v1/messaging/preference-options';

/** What the door is composed over — every service read when a request arrives. */
export interface PreferenceOptionsRoutesDeps extends PreferenceOptionsSources {
    /** The data engine the caller's grants are read through; `undefined` when none is registered. */
    getEngine(): unknown;
    /** The auth service the caller's session is read through; `undefined` when none is registered. */
    getAuth(): RequestAuthService | undefined;
    /** How this door reaches the `tenancy` service; `undefined` on a host with no async service accessor. */
    tenancy: TenancyServiceResolver | undefined;
}

/** Mount the door on `http`. Nothing on `deps` is called until a request arrives. */
export function registerPreferenceOptionsRoutes(http: IHttpServer, deps: PreferenceOptionsRoutesDeps): void {
    http.get(PREFERENCE_OPTIONS_ROUTE, (req, res) => handlePreferenceOptions(req, res, deps));
}

async function handlePreferenceOptions(
    req: IHttpRequest,
    res: IHttpResponse,
    deps: PreferenceOptionsRoutesDeps,
): Promise<void> {
    // ① The caller.
    let context: ExecutionContext | undefined;
    try {
        context = await resolveCaller(req, deps);
    } catch (err) {
        if (isAuthzStoreUnavailableError(err) || isApiKeyLifecycleRefusalError(err)) {
            sendError(res, err.status, err.code, err.message);
            return;
        }
        sendServerFault(res, 500, 'INTERNAL_ERROR', 'The caller of this request could not be resolved.', err, {
            method: 'GET',
            path: PREFERENCE_OPTIONS_ROUTE,
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
    if (!context || shouldDenyAnonymous({ userId: context.userId, method: req.method })) {
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
            `The preference options list takes no query parameter, and this request carries ${query.map((q) => `'${q}'`).join(', ')}. ` +
                'Ask for the list with no parameters: it always answers every topic and channel.',
        );
        return;
    }

    try {
        sendOk(res, await readPreferenceOptions(deps, context.tenantId));
    } catch (err) {
        sendServerFault(res, 500, 'INTERNAL_ERROR', 'The notification topics and channels could not be read.', err, {
            method: 'GET',
            path: PREFERENCE_OPTIONS_ROUTE,
        });
    }
}

/**
 * Resolve the caller through the one composition. This door's differences, as
 * its named parameters: anonymous fails closed (the door answers its floor);
 * the held-sign-in posture is the one the resolver decided for the credential
 * that admitted the caller; an API key admits its owner with no session read;
 * no locale, bearer or OAuth token is carried — the list is the same in every
 * language, and nothing downstream acts as the caller.
 */
async function resolveCaller(req: IHttpRequest, deps: PreferenceOptionsRoutesDeps): Promise<ExecutionContext | undefined> {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers ?? {})) {
        if (value == null) continue;
        headers.set(name, Array.isArray(value) ? value.join(',') : String(value));
    }
    return await resolveRequestExecutionContext({
        headers,
        ql: deps.getEngine(),
        authService: deps.getAuth(),
        tenancy: deps.tenancy,
        anonymous: 'fail-closed',
        authGate: 'resolved',
        credentials: 'api-key-and-session',
        sessionApi: 'optional',
        session: 'request',
        localization: 'withhold',
        requestLocale: undefined,
        accessToken: 'withhold',
        oauth: undefined,
        onAdmission: undefined,
    });
}
