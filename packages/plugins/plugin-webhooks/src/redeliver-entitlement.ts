// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Who may press the webhook redeliver door (`POST /api/v1/webhooks/redeliver`,
 * both faces): a caller entitled to ADMINISTER WEBHOOKS, decided server-side
 * (ADR-0124 D1) by the security service, before the door reads the request
 * body or looks up any delivery row — and the organization the replay is
 * scoped to is the one that caller was admitted in.
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
 * ## The organization: vetted by the composition, and the replay's scope
 *
 * The composition is handed the door's own way to reach the `tenancy`
 * service ({@link redeliverTenancyResolver}), as the data API's doors hand it
 * theirs, so the session's organization claim is vetted exactly as it is
 * there (maintainer ruling 2026-09-05, option B: on a walled posture a claim
 * no current membership backs is dropped, per request, on every door). The
 * caller's grants and the context's `tenantId` are therefore resolved in the
 * organization the data API would resolve them in.
 *
 * The admission carries that vetted `tenantId`, and the door threads IT into
 * the replay — never the raw session claim — so the organization the replay
 * writes into is the one the caller was admitted in.
 *
 * A claim the composition did NOT keep is refused here, with the same answer
 * as every other caller-level refusal. The replay is scoped by one
 * organization (the tenant the driver writes under); a dropped claim leaves
 * none, and a replay with none is an unscoped write, wider than any write the
 * data API's gate gives that caller (with no active organization the tenant
 * layer denies every row under `isolated`, and admits only the caller's own
 * organizations under `group`, a set this door's single-tenant scope cannot
 * express). The PRINCIPAL is not refused: the session stays signed in, with
 * no active organization, free to switch to one it belongs to — option B's
 * consequence is unchanged; only this door's act, which needs an
 * organization, is declined.
 *
 * ## Fail direction — CLOSED, and each state says which it is (ADR-0124 D3)
 *
 *  - an `allowed: false` verdict (or a context the composition could not
 *    resolve for the caller, or a claim it did not keep) is
 *    `403 PERMISSION_DENIED`;
 *  - no security service (none registered, or one without `explain`) refuses
 *    with `503 SERVICE_UNAVAILABLE`: there is nothing to decide entitlement,
 *    and a loud refusal is preferred over a silent admit;
 *  - a resolution or decision that THROWS reached no verdict, so it does not
 *    answer as one: `503 SERVICE_UNAVAILABLE`, the cause in the server log.
 *    A `tenancy` service that is registered and cannot answer is one of
 *    these (`classifyAdmissionTenancyPosture` raises it as the outage).
 *
 * Every refusal here is about the CALLER, never about a row: the gate runs
 * before the body is read, so no answer it gives depends on the delivery id.
 */

import {
    resolveRequestExecutionContext,
    type PluginContext,
    type RequestAuthService,
    type TenancyPostureSource,
    type TenancyServiceResolver,
} from '@objectstack/core';
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

/**
 * The gate's answer: an admission carrying the organization the caller was
 * admitted in (the replay's scope), or a refusal the door answers as it is.
 */
export type RedeliverVerdict =
    | { readonly admitted: true; readonly tenantId: string | undefined }
    | { readonly admitted: false; readonly refusal: RedeliverRefusal };

/** What the gate reads, every key required so a caller cannot drop one by omission. */
export interface RedeliverEntitlementInput {
    /** The request's headers (the composition's input; no credential is re-read from them). */
    readonly headers: Headers;
    /** The data engine, or `undefined` when the kernel has none. */
    readonly ql: unknown;
    /** The kernel's `auth` service, or `undefined`. */
    readonly authService: RequestAuthService | undefined;
    /**
     * How this door reaches the `tenancy` service ({@link redeliverTenancyResolver}),
     * handed to the composition so the session's organization claim is vetted
     * against the posture in force. `undefined` only for a host that cannot
     * reach a `tenancy` service at all.
     */
    readonly tenancy: TenancyServiceResolver | undefined;
    /** The kernel's `security` service, or `undefined` when none is registered. */
    readonly security: Pick<ISecurityService, 'explain'> | undefined;
    /** The signed-in caller, from the session the door already read. */
    readonly userId: string;
    /** That session's active organization claim, as the door read it (unvetted). */
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

const refuse = (refusal: RedeliverRefusal): RedeliverVerdict => ({ admitted: false, refusal });

/**
 * Whether a security service can answer the gate's question. The door asks it
 * per request; the plugin also asks it once at boot, to say that a door with
 * nothing to decide will answer `503` to every caller (absence must be loud).
 */
export function canDecideRedeliverEntitlement(security: unknown): boolean {
    return typeof (security as Pick<ISecurityService, 'explain'> | undefined)?.explain === 'function';
}

/**
 * How the redeliver door reaches the `tenancy` service, read PER REQUEST and
 * classified by the composition (`classifyAdmissionTenancyPosture`): never
 * registered is a kernel with no organization wall (quiet); registered and
 * unable to answer is the outage (the gate's `503`).
 *
 * Two legs, because only the ASYNC accessor carries that discriminator — the
 * branded "never registered" rejection is raised by `PluginLoader.getService`,
 * which the sync accessor never reaches, and on `ObjectKernel` the sync
 * accessor throws for a factory-backed service that is merely not built yet.
 *
 *  - A kernel with `getServiceAsync` (`ObjectKernel`, every shipped
 *    composition): the thunk is that accessor, so the classification sees the
 *    registry's own answer. ⛔ Never the plugin's swallowing `tryGetService`
 *    here: it would read a failed service as an absent one, the
 *    permissive-on-failure collapse the classification exists to prevent.
 *  - A kernel without it (a `KernelBase`-shaped host such as `LiteKernel`):
 *    such a host instantiates no service factories at all
 *    (`registerServiceFactory` throws there), so "nothing is registered under
 *    that name" is the only fault its sync accessor can report, and absorbing
 *    it inside the thunk is the SAME classification, not a second collapse.
 */
export function redeliverTenancyResolver(
    ctx: Pick<PluginContext, 'getKernel' | 'getService'>,
): TenancyServiceResolver | undefined {
    const kernel = typeof ctx.getKernel === 'function'
        ? (ctx.getKernel() as unknown as { getServiceAsync?: <T>(name: string) => Promise<T> } | undefined)
        : undefined;
    if (kernel && typeof kernel.getServiceAsync === 'function') {
        const getServiceAsync = kernel.getServiceAsync.bind(kernel);
        return () => getServiceAsync<TenancyPostureSource>('tenancy');
    }
    if (typeof ctx.getService !== 'function') return undefined;
    return () => {
        try {
            return ctx.getService<TenancyPostureSource>('tenancy') ?? undefined;
        } catch {
            // The one fault a factory-less host's sync accessor reports: not registered.
            return undefined;
        }
    };
}

/**
 * Decide whether the signed-in caller may redeliver, and in which
 * organization. Never throws.
 */
export async function judgeRedeliverEntitlement(
    input: RedeliverEntitlementInput,
): Promise<RedeliverVerdict> {
    const security = input.security;
    if (!security || !canDecideRedeliverEntitlement(security)) return refuse(NO_DECIDER);
    try {
        const context = await resolveRequestExecutionContext({
            headers: input.headers,
            ql: input.ql,
            authService: input.authService,
            // The door's own resolver, as the data API's doors pass theirs:
            // the session arm vets the organization claim against the posture.
            tenancy: input.tenancy,
            anonymous: 'fail-closed',
            // The door asks the ADR-0069 gate itself, on the same session read.
            authGate: 'withhold',
            // The door opens no API-key door: a key-only request reads no
            // session and is answered 401 before this gate.
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
        if (!context || context.userId !== input.userId) return refuse(NOT_ENTITLED);
        const tenantId = typeof context.tenantId === 'string' && context.tenantId.length > 0
            ? context.tenantId
            : undefined;
        // A claim the composition did not keep: the replay would have no
        // organization to be scoped to (see the module docblock).
        if (tenantId !== input.activeOrganizationId) return refuse(NOT_ENTITLED);
        const decision = await security.explain(
            { object: REDELIVER_ADMINISTERED_OBJECT, operation: REDELIVER_REQUIRED_OPERATION },
            context,
        );
        return decision?.allowed === true ? { admitted: true, tenantId } : refuse(NOT_ENTITLED);
    } catch (err) {
        input.logError('[webhook-outbox] redeliver entitlement could not be decided; the caller was refused 503', err);
        return refuse(UNDECIDED);
    }
}
