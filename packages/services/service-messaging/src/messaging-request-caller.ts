// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
    resolveRequestExecutionContext,
    type RequestAuthService,
    type TenancyServiceResolver,
} from '@objectstack/core';
import type { IHttpRequest } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

/**
 * How the messaging doors reach the services the platform's one
 * request-to-context composition reads. Every member is read when a request
 * arrives, never at mount.
 */
export interface MessagingCallerSources {
    /** The data engine the caller's grants are read through; `undefined` when none is registered. */
    getEngine(): unknown;
    /** The auth service the caller's session is read through; `undefined` when none is registered. */
    getAuth(): RequestAuthService | undefined;
    /** How the door reaches the `tenancy` service; `undefined` on a host with no async service accessor. */
    tenancy: TenancyServiceResolver | undefined;
}

/**
 * Resolve the caller of a messaging door through the one composition
 * (`resolveRequestExecutionContext`). The doors' shared differences, as its
 * named parameters: anonymous fails closed (each door answers its floor); the
 * held-sign-in posture is the one the resolver decided for the credential
 * that admitted the caller; an API key admits its owner with no session read;
 * no locale, bearer or OAuth token is carried — no door here renders text in
 * the caller's language or calls anything as the caller (a send names the
 * caller as its actor, and the fan-out reads under the system opt-in).
 *
 * The permission store that cannot be read, and an API key its lifecycle
 * refuses, throw their own errors; each door relays them as declared.
 */
export async function resolveMessagingCaller(
    req: IHttpRequest,
    sources: MessagingCallerSources,
): Promise<ExecutionContext | undefined> {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers ?? {})) {
        if (value == null) continue;
        headers.set(name, Array.isArray(value) ? value.join(',') : String(value));
    }
    return await resolveRequestExecutionContext({
        headers,
        ql: sources.getEngine(),
        authService: sources.getAuth(),
        tenancy: sources.tenancy,
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
        // [#31898] The transport's own peer address, for the `credential_use` row
        // an admitted API key writes; the auth service applies the trust rule.
        transport: { remoteAddress: req.remoteAddress || undefined },
    });
}
