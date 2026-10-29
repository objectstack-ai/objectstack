// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Who may press the webhook redeliver door (`POST /api/v1/webhooks/redeliver`,
 * both faces): a caller entitled to ADMINISTER WEBHOOKS, decided server-side
 * (ADR-0124 D1) by the security service, before the door reads the request
 * body or looks up any delivery row.
 *
 * ## The entitlement, and why this one
 *
 * A redelivery sends a finished delivery's signed payload to the
 * subscriber's endpoint again. That is a webhook-administration act — the
 * same power as editing or re-activating the subscription — so it is gated on
 * the access that governs webhook administration: an object-level `update`
 * admission on the webhook configuration object (`sys_webhook`), exactly as
 * the security service answers it for that caller on the data API.
 *
 * Two readings were weighed and refused:
 *
 *  - **Signed in is enough.** The door's original posture, written as a
 *    deferral ("finer RBAC is future work"), never as a decision. It left the
 *    door unaligned with webhook administration, and answered row-level
 *    refusals to callers who administer nothing.
 *  - **Read access to `sys_http_delivery`.** The object the button sits on,
 *    but READ is the wrong axis for an act that writes the row and sends a
 *    request: a read-only principal would gain a write-shaped action.
 *
 * ## The question is asked through the contract, never re-derived
 *
 * `ISecurityService.explain` is the contract's non-optional member that
 * answers "would enforcement allow this operation for this caller?", computed
 * by the same resolution the enforcement path uses. The caller's
 * `ExecutionContext` is resolved by `resolveRequestExecutionContext`, the one
 * composition every platform door uses, from the session the door ALREADY
 * read (`session: { established }`) — so the identity the gate judges and the
 * identity the rest of the door acts as come from one read and cannot
 * disagree.
 *
 * ## Fail direction — CLOSED, and each state says which it is
 *
 *  - an `allowed: false` verdict (or a context the composition could not
 *    resolve for the caller) is `403 PERMISSION_DENIED`;
 *  - no security service (none registered, or one without `explain`) refuses
 *    with `503 SERVICE_UNAVAILABLE`: there is nothing to decide entitlement,
 *    and a loud refusal is preferred over a silent admit;
 *  - a resolution or decision that THROWS reached no verdict, so it does not
 *    answer as one: `503 SERVICE_UNAVAILABLE`, the cause in the server log.
 *
 * Every refusal here is about the CALLER, never about a row: the gate runs
 * before the body is read, so no answer it gives depends on the delivery id.
 */

import { resolveRequestExecutionContext, type RequestAuthService } from '@objectstack/core';
import type { ISecurityService } from '@objectstack/spec/contracts';

/** The webhook configuration object whose administration governs redelivery. */
export const REDELIVER_ADMINISTERED_OBJECT = 'sys_webhook';

/** The operation on {@link REDELIVER_ADMINISTERED_OBJECT} the caller must be admitted to. */
export const REDELIVER_REQUIRED_OPERATION = 'update';

/** A refusal the door answers in its own envelope. */
export interface RedeliverRefusal {
    readonly status: 403 | 503;
    readonly code: 'PERMISSION_DENIED' | 'SERVICE_UNAVAILABLE';
    readonly message: string;
}

/** What the gate reads, every key required so a caller cannot drop one by omission. */
export interface RedeliverEntitlementInput {
    /** The request's headers (the composition's input; no credential is re-read from them). */
    readonly headers: Headers;
    /** The data engine, or `undefined` when the kernel has none. */
    readonly ql: unknown;
    /** The kernel's `auth` service, or `undefined`. */
    readonly authService: RequestAuthService | undefined;
    /** The kernel's `security` service, or `undefined` when none is registered. */
    readonly security: Pick<ISecurityService, 'explain'> | undefined;
    /** The signed-in caller, from the session the door already read. */
    readonly userId: string;
    /** That session's active organization, as the door read it. */
    readonly activeOrganizationId: string | undefined;
    /** Where a fault that reached no verdict is reported. */
    readonly logError: (message: string, err: unknown) => void;
}

const NOT_ENTITLED: RedeliverRefusal = {
    status: 403,
    code: 'PERMISSION_DENIED',
    message: 'Redelivering a webhook delivery requires permission to administer webhooks '
        + '(edit access to sys_webhook). Ask an administrator to grant it, or to redeliver for you.',
};

const NO_DECIDER: RedeliverRefusal = {
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'Webhook redelivery is unavailable: no security service is registered to decide who may '
        + 'administer webhooks. Compose the security plugin to enable redelivery.',
};

const UNDECIDED: RedeliverRefusal = {
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'Webhook redelivery is temporarily unavailable: permission to administer webhooks could not be '
        + 'checked. Retry shortly.',
};

/**
 * Decide whether the signed-in caller may redeliver: `undefined` admits, a
 * {@link RedeliverRefusal} refuses. Never throws.
 */
export async function judgeRedeliverEntitlement(
    input: RedeliverEntitlementInput,
): Promise<RedeliverRefusal | undefined> {
    const security = input.security;
    if (!security || typeof security.explain !== 'function') return NO_DECIDER;
    try {
        const context = await resolveRequestExecutionContext({
            headers: input.headers,
            ql: input.ql,
            authService: input.authService,
            // A session-only door, as the `/auth/me` endpoints are: it opens no
            // API-key door, so no posture-conditional key refusal applies.
            tenancy: undefined,
            anonymous: 'fail-closed',
            // The door asks the ADR-0069 gate itself, on the same session read.
            authGate: 'withhold',
            credentials: 'session-only',
            sessionApi: 'optional',
            session: {
                established: {
                    user: { id: input.userId },
                    session: {
                        userId: input.userId,
                        ...(input.activeOrganizationId ? { activeOrganizationId: input.activeOrganizationId } : {}),
                    },
                },
            },
            localization: 'withhold',
            requestLocale: undefined,
            accessToken: 'withhold',
            oauth: undefined,
            onAdmission: undefined,
        });
        if (!context || context.userId !== input.userId) return NOT_ENTITLED;
        const decision = await security.explain(
            { object: REDELIVER_ADMINISTERED_OBJECT, operation: REDELIVER_REQUIRED_OPERATION },
            context,
        );
        return decision?.allowed === true ? undefined : NOT_ENTITLED;
    } catch (err) {
        input.logError('[webhook-outbox] redeliver entitlement could not be decided; the caller was refused 503', err);
        return UNDECIDED;
    }
}
