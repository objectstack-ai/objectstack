// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # A borrowed connector credential — the D7 runtime seam
 *
 * ADR-0015 amendment D7 lets an API-backed datasource name a declared
 * connector instance in `external.connector` and borrow that instance's
 * credential, so one Connect per vendor serves both the connector's actions
 * and the datasource's records. This module is the contract the borrow runs
 * through, and the one rule a driver presents the credential by.
 *
 * ## Who sits on each side
 *
 * - The PRODUCER is `@objectstack/service-automation`, which owns connector
 *   instances and their credentials (ADR-0097, ADR-0143). It registers a
 *   {@link IConnectorCredentialSource} under
 *   {@link CONNECTOR_CREDENTIAL_SOURCE_SERVICE}.
 * - The CONSUMER is `@objectstack/service-datasource`'s connection path, which
 *   borrows a handle when a datasource names a connector and hands it to the
 *   driver factory beside the connection spec.
 * - The PRESENTER is the driver — a plugin-contributed one over a vendor API,
 *   such as OData — which runs every request through
 *   {@link callWithBorrowedCredential}.
 *
 * ## Why it lives in `@objectstack/types`
 *
 * The dependency direction the D7 ruling left open is answered here: no
 * package on the data path imports the automation service, and the
 * automation service imports no datasource package. Both services already
 * depend on this package, and so can an out-of-repository driver, so the
 * shared declaration adds no edge — the same home rule
 * `stranded-decision.ts` follows. `@objectstack/objectql` is not involved:
 * the engine sees a registered driver, never a credential.
 *
 * ## Per dispatch, from the first kind
 *
 * ADR-0143 D4 resolves a grant-bearing credential per dispatch: refreshed on
 * expiry (with a clock-skew margin) and once on an upstream `401`, the call
 * retried once. The handle has that shape now — {@link ConnectorCredentialHandle.get}
 * answers the credential to send, {@link ConnectorCredentialHandle.refresh}
 * answers a new one — so the static kinds (bearer, API key, basic) and the
 * grant-bearing kinds ADR-0143 adds later meet a driver through one
 * interface, and a driver written against it today needs no change then.
 *
 * ⛔ A value crosses this seam only as the return of `get` / `refresh`, into
 * the driver's request. Nothing here logs, stores or echoes it, and the
 * refusals below name the connector instance, never a value. An upstream's
 * own text, which may echo it, goes through {@link withoutBorrowedCredential}
 * before a driver throws it.
 */

/** The kernel service name the connector credential source is registered under. */
export const CONNECTOR_CREDENTIAL_SOURCE_SERVICE = 'connector-credential-source';

/**
 * The credential a driver presents on one request — the resolved form of a
 * connector instance's `auth`, never its reference.
 */
export type BorrowedConnectorAuth =
    | { type: 'bearer'; token: string }
    | { type: 'api-key'; key: string; headerName: string; paramName?: string }
    | { type: 'basic'; username: string; password: string };

/** One answer of a {@link ConnectorCredentialHandle}. */
export interface BorrowedConnectorCredential {
    /** What to send. */
    readonly auth: BorrowedConnectorAuth;
    /**
     * When the credential stops being valid, in epoch milliseconds. Absent for
     * a credential with no known lifetime (the static kinds). A credential at
     * or past `expiresAt` minus the skew margin is refreshed before it is sent.
     */
    readonly expiresAt?: number;
}

/** What a borrow is asked in the name of. */
export interface ConnectorCredentialRequest {
    /**
     * The organization of the request the credential is for (ADR-0143 Q1 = A,
     * an organization-shared connection). Absent for a read that carries none
     * — a boot-time drift check, a schedule — which ADR-0143 D4 answers from
     * the instance's connection only when exactly one exists. A static
     * credential is environment-level and answers the same either way.
     */
    readonly organizationId?: string;
}

/**
 * A borrowed credential, bound to one connector instance. Returned by
 * {@link IConnectorCredentialSource.borrow}; the driver keeps it for the life
 * of its connection and asks it on every request.
 */
export interface ConnectorCredentialHandle {
    /** The connector instance this handle borrows from. */
    readonly connector: string;
    /**
     * The credential to send now. Throws a refusal carrying `code` and
     * `status` when none can be answered (the credential is not set, the
     * store cannot be read, the instance was disabled): `503
     * SERVICE_UNAVAILABLE`, since each clears without a change to the
     * datasource.
     */
    get(request?: ConnectorCredentialRequest): Promise<BorrowedConnectorCredential>;
    /**
     * A credential obtained again, for the request that was refused with the
     * one {@link get} answered (a `401`) or that would send an expired one.
     * Concurrent calls on one handle share one refresh, so a rotating grant is
     * never spent twice. Throws as {@link get} does.
     */
    refresh(request?: ConnectorCredentialRequest): Promise<BorrowedConnectorCredential>;
}

/** The provider side: answers a handle for a declared connector instance. */
export interface IConnectorCredentialSource {
    /**
     * A handle on `connector`'s credential. Resolves no value: a borrow checks
     * the declaration, so an instance whose credential is not set yet still
     * lends a handle whose {@link ConnectorCredentialHandle.get} refuses until
     * it is. Throws a refusal carrying `code` and `status` when the stack
     * declares no such instance, when the entry has no `provider` (a catalog
     * descriptor), when it declares no `auth` credential, or when it is
     * disabled — `422 VALIDATION_ERROR`, fixed by the declaration — and
     * `503 SERVICE_UNAVAILABLE` when the declaration cannot be read now.
     */
    borrow(connector: string): Promise<ConnectorCredentialHandle>;
}

/** A refusal of this seam: a standard-catalog `code` and its `status` on the error, the message naming the instance. */
export function connectorCredentialRefusal(message: string, code: 'VALIDATION_ERROR' | 'SERVICE_UNAVAILABLE', status: 422 | 503): Error {
    return Object.assign(new Error(message), { code, status, statusCode: status });
}

/** The shortest spelling a scrub withholds: a shorter one would blank ordinary words. */
const MIN_WITHHELD_LENGTH = 4;

function base64Unpadded(text: string): string {
    let binary = '';
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/=+$/, '');
}

/**
 * Every spelling of a borrowed credential an upstream may echo back in its
 * own text: the value; URL-encoded both ways (`encodeURIComponent`, and the
 * form encoding `URLSearchParams` writes), as an API key presented as a query
 * parameter travels in the request URL; base64; and, for `basic`,
 * base64(`username:password`), the `Authorization: Basic` header. A base64
 * form is kept without its `=` padding, so an echo that drops it is caught
 * too. Longest first, so a longer form is replaced before a shorter one
 * inside it. The same spellings `@objectstack/service-automation`'s
 * connector call path withholds.
 */
export function borrowedCredentialForms(auth: BorrowedConnectorAuth): string[] {
    const value = auth.type === 'bearer' ? auth.token : auth.type === 'api-key' ? auth.key : auth.password;
    const forms = new Set<string>([
        value,
        encodeURIComponent(value),
        new URLSearchParams({ v: value }).toString().slice(2),
        base64Unpadded(value),
    ]);
    if (auth.type === 'basic') forms.add(base64Unpadded(`${auth.username}:${auth.password}`));
    return [...forms].filter((f) => f.length >= MIN_WITHHELD_LENGTH).sort((a, b) => b.length - a.length);
}

/**
 * `text` with every spelling of the presented credential withheld
 * ({@link borrowedCredentialForms}). A driver runs an upstream's own text
 * through this before it reaches an error it throws: the engine's floor may
 * hand that message to the caller (a request-shaped refusal is answered `400`
 * with it), and an upstream that echoes the request URI carries a
 * query-parameter API key with it.
 */
export function withoutBorrowedCredential(text: string, auth: BorrowedConnectorAuth): string {
    let out = text;
    for (const form of borrowedCredentialForms(auth)) out = out.split(form).join('[credential withheld]');
    return out;
}

/** The margin before `expiresAt` inside which a credential is refreshed rather than sent. */
export const BORROWED_CREDENTIAL_SKEW_MS = 30_000;

/** Options for {@link callWithBorrowedCredential}. */
export interface BorrowedCredentialCallOptions<T> extends ConnectorCredentialRequest {
    /**
     * Whether a call's RESULT is the upstream refusing the credential. Default:
     * a result whose `status` is `401` (a fetch `Response`, a `{ status }`
     * envelope). A call that THROWS an error whose `status` or `statusCode` is
     * `401` is read as the same refusal either way.
     */
    readonly isUnauthorized?: (result: T) => boolean;
    /** The clock, for tests. Default `Date.now`. */
    readonly now?: () => number;
    /** The skew margin. Default {@link BORROWED_CREDENTIAL_SKEW_MS}. */
    readonly skewMs?: number;
}

function hasStatus401(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as { status?: unknown; statusCode?: unknown };
    return v.status === 401 || v.statusCode === 401;
}

/**
 * The refusal {@link callWithBorrowedCredential} ends on when the upstream
 * refused a freshly obtained credential too. `503`, a condition of the
 * connection the caller cannot change — the floor over a plugin driver
 * answers it `ERR_DATASOURCE_UNAVAILABLE` with this message in the server log
 * only. It names the instance and the remedy; the upstream's own text, which
 * may echo the credential, is not carried.
 */
function credentialRejectedRefusal(connector: string): Error {
    return connectorCredentialRefusal(
        `the upstream refused the credential borrowed from connector instance '${connector}' (HTTP 401), and refused it `
            + 'again after it was obtained afresh. Set that instance\'s credential again (or reconnect it); the datasource '
            + 'reads with the new one on its next request, with no restart.',
        'SERVICE_UNAVAILABLE',
        503,
    );
}

/**
 * Run one upstream call with a borrowed credential — ADR-0143 D4's rule, the
 * one copy every driver presents through:
 *
 * 1. ask the handle; a credential at or past its expiry (less the skew
 *    margin) is refreshed before it is sent;
 * 2. send it; when the upstream answers `401` (a result
 *    {@link BorrowedCredentialCallOptions.isUnauthorized} recognises, or a
 *    throw declaring `status` / `statusCode` 401), refresh once and send
 *    again;
 * 3. a second `401` ends the call with a `503 SERVICE_UNAVAILABLE` refusal
 *    naming the instance, never with the upstream's text.
 *
 * Any other result is returned and any other throw propagates unchanged,
 * refusals of the handle included.
 */
export async function callWithBorrowedCredential<T>(
    handle: ConnectorCredentialHandle,
    call: (auth: BorrowedConnectorAuth) => Promise<T>,
    options: BorrowedCredentialCallOptions<T> = {},
): Promise<T> {
    const request: ConnectorCredentialRequest = options.organizationId === undefined ? {} : { organizationId: options.organizationId };
    const now = options.now ?? Date.now;
    const skew = options.skewMs ?? BORROWED_CREDENTIAL_SKEW_MS;
    const unauthorized = options.isUnauthorized ?? hasStatus401;

    let credential = await handle.get(request);
    if (credential.expiresAt !== undefined && credential.expiresAt - skew <= now()) {
        credential = await handle.refresh(request);
    }

    const attempt = async (): Promise<{ refused: true } | { refused: false; result: T }> => {
        let result: T;
        try {
            result = await call(credential.auth);
        } catch (err) {
            if (hasStatus401(err)) return { refused: true };
            throw err;
        }
        return unauthorized(result) ? { refused: true } : { refused: false, result };
    };

    const first = await attempt();
    if (!first.refused) return first.result;
    credential = await handle.refresh(request);
    const second = await attempt();
    if (!second.refused) return second.result;
    throw credentialRejectedRefusal(handle.connector);
}
