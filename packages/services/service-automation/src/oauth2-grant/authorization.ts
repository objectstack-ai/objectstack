// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Connecting an `authorization_code` instance (ADR-0143 D5)
 *
 * The two halves of the connect flow the automation plugin runs behind
 * `POST /automation/connectors/:name/connection` and
 * `GET /automation/connectors/oauth/callback`:
 *
 *   1. **begin** — a fresh `state` and a PKCE pair (RFC 7636, `S256` always,
 *      D2.1), the pending authorization kept under the state's digest, and the
 *      authorization URL the administrator's browser is sent to;
 *   2. **complete** — the callback's `state` is taken (once: a second use
 *      finds nothing), checked against the caller who began it, and its code
 *      exchanged at the token endpoint with the verifier.
 *
 * **Where the pending authorization lives.** Not in the connection record:
 * D3 lists what is persisted, and a verifier is not on it. It is kept in the
 * cluster's ephemeral KV when the deployment has one — so the callback may
 * land on any replica — with a ten-minute TTL, and in process memory
 * otherwise (a single-node deployment). The KV key is the SHA-256 of the
 * state, so the raw state is never a key anyone can list.
 *
 * **What it is bound to.** The organization and the user that began it, and
 * the instance. A callback completed by anyone else — another user's browser
 * carrying a code an attacker obtained for their own vendor account — is
 * refused before the code is exchanged. The redirect URI is fixed per
 * deployment by the caller and never taken from the request.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { IKV } from '@objectstack/spec/contracts';

/** How long a begun connect may wait for its callback. */
export const PENDING_AUTHORIZATION_TTL_SECONDS = 600;

/** What a begun connect remembers until its callback. ⛔ Never leaves the server. */
export interface PendingAuthorization {
    readonly connector: string;
    readonly organizationId: string;
    readonly userId: string;
    /** The PKCE verifier (RFC 7636 §4.1) — sent only to the token endpoint, with the code. */
    readonly verifier: string;
    /** The redirect URI the authorization request named; the code exchange must repeat it (RFC 6749 §4.1.3). */
    readonly redirectUri: string;
    /** Epoch ms after which the callback is refused. */
    readonly expiresAt: number;
}

/** Where pending authorizations wait for their callback. `take` is single-use. */
export interface PendingAuthorizationStore {
    put(state: string, pending: PendingAuthorization): Promise<void>;
    /** The pending authorization `state` names, removed as it is read; `undefined` when there is none (or it was taken). */
    take(state: string): Promise<PendingAuthorization | undefined>;
}

const base64url = (bytes: Buffer): string => bytes.toString('base64url');

/** A PKCE pair (RFC 7636 §4.1–4.2): a 256-bit verifier and its `S256` challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(verifier, 'ascii').digest());
    return { verifier, challenge };
}

/** A fresh, unguessable `state` (RFC 6749 §10.12). */
export function createAuthorizationState(): string {
    return base64url(randomBytes(32));
}

const stateKey = (state: string): string =>
    `connector-oauth2:pending:${createHash('sha256').update(state, 'utf8').digest('hex')}`;

/** The store over the cluster's ephemeral KV. */
export function kvPendingAuthorizationStore(kv: IKV): PendingAuthorizationStore {
    return {
        async put(state, pending) {
            await kv.set(stateKey(state), pending, { ttl: PENDING_AUTHORIZATION_TTL_SECONDS });
        },
        async take(state) {
            const key = stateKey(state);
            const entry = await kv.get<PendingAuthorization>(key);
            if (!entry) return undefined;
            // Only the caller whose delete lands holds it: a replayed callback,
            // or two racing on two replicas, finds nothing.
            const deleted = await kv.delete(key, { ifVersion: entry.version });
            return deleted ? entry.value : undefined;
        },
    };
}

/** The in-process store, for a deployment with no cluster service. */
export function memoryPendingAuthorizationStore(now: () => number = Date.now): PendingAuthorizationStore {
    const held = new Map<string, PendingAuthorization>();
    return {
        async put(state, pending) {
            for (const [key, value] of held) if (value.expiresAt <= now()) held.delete(key);
            held.set(stateKey(state), pending);
        },
        async take(state) {
            const key = stateKey(state);
            const pending = held.get(key);
            held.delete(key);
            return pending;
        },
    };
}

/** The authorization request URL (RFC 6749 §4.1.1, RFC 7636 §4.3, RFC 8707). */
export function buildAuthorizationUrl(args: {
    authorizationUrl: string;
    clientId: string;
    redirectUri: string;
    state: string;
    challenge: string;
    scopes?: readonly string[];
    resource?: string;
}): string {
    const url = new URL(args.authorizationUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', args.clientId);
    url.searchParams.set('redirect_uri', args.redirectUri);
    url.searchParams.set('state', args.state);
    url.searchParams.set('code_challenge', args.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (args.scopes && args.scopes.length > 0) url.searchParams.set('scope', args.scopes.join(' '));
    if (args.resource) url.searchParams.set('resource', args.resource);
    return url.toString();
}
