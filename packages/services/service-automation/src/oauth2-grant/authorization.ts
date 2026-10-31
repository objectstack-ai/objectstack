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
 * **What is held there is sealed** (AES-256-GCM), under a key derived from the
 * raw state by HKDF-SHA-256 — and the raw state is held nowhere on the server:
 * it lives in the administrator's browser, round-trip through the vendor, and
 * the server keeps only its digest. So the KV trust boundary is:
 *
 *   - a party that can READ the KV (a shared Redis, its backups, a replica's
 *     memory dump) learns no verifier, user, organization or redirect URI —
 *     only an opaque envelope under a digest it cannot invert;
 *   - a party that can WRITE the KV cannot alter or re-home an entry it did
 *     not seal: the envelope authenticates under its own state's key, and its
 *     AAD names the slot it was written to, so an edited, swapped or moved
 *     value opens as nothing ("no connect waiting") and its code is never
 *     exchanged;
 *   - what a KV writer CAN still do is delete an entry (a connect that has to
 *     be begun again) or plant one under a state it chose itself. Write access
 *     to the cluster KV is inside the platform's trust boundary — the same KV
 *     carries the cluster lock the refresh single-flight relies on — and the
 *     callback still answers only the signed-in user the planted entry names.
 *
 * Why not the host `ICryptoProvider`: its contexts are scoped by the closed
 * `CRYPTO_CONTEXT_SCOPES` vocabulary (ADR-0128 D1), which has no member for
 * this producer, and its handle is persisted as a `sys_secret` row — a
 * durable record for a value that lives ten minutes. The state-derived key
 * needs no shared server secret, so it also holds on a cluster whose replicas
 * share nothing but the KV.
 *
 * **What it is bound to.** The organization and the user that began it, and
 * the instance. A callback completed by anyone else — another user's browser
 * carrying a code an attacker obtained for their own vendor account — is
 * refused before the code is exchanged. The redirect URI is fixed per
 * deployment by the caller and never taken from the request.
 */

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
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

/**
 * A pending authorization as it is held: an AES-256-GCM envelope, never the
 * value. `v` names the sealing scheme, so a later one is told apart rather
 * than guessed at.
 */
export interface SealedPendingAuthorization {
    readonly v: 1;
    /** 96-bit nonce, base64url. */
    readonly iv: string;
    /** Ciphertext of the JSON-encoded {@link PendingAuthorization}, base64url. */
    readonly ct: string;
    /** GCM authentication tag, base64url. */
    readonly tag: string;
}

/** HKDF `info` for the sealing key — distinct from the digest that names the slot. */
const SEAL_KEY_INFO = 'objectstack:connector-oauth2:pending-authorization:seal:v1';

/** The sealing key of one state: HKDF-SHA-256 over the raw state, which the server never holds. */
function sealKey(state: string): Buffer {
    return Buffer.from(hkdfSync('sha256', Buffer.from(state, 'utf8'), Buffer.alloc(0), SEAL_KEY_INFO, 32));
}

/** Seal `pending` under `state`'s key, bound (AAD) to the slot `key` it is written to. */
export function sealPendingAuthorization(state: string, pending: PendingAuthorization): SealedPendingAuthorization {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', sealKey(state), iv);
    cipher.setAAD(Buffer.from(stateKey(state), 'utf8'));
    const ct = Buffer.concat([cipher.update(JSON.stringify(pending), 'utf8'), cipher.final()]);
    return { v: 1, iv: base64url(iv), ct: base64url(ct), tag: base64url(cipher.getAuthTag()) };
}

/**
 * Open what {@link sealPendingAuthorization} sealed under `state`, or
 * `undefined` — never a throw — when the value is not an envelope of this
 * scheme or does not authenticate under this state and slot. A callback reads
 * that the same as "no connect waiting": fail closed, nothing exchanged.
 */
export function openPendingAuthorization(state: string, sealed: unknown): PendingAuthorization | undefined {
    const envelope = sealed as Partial<SealedPendingAuthorization> | null | undefined;
    if (!envelope || envelope.v !== 1) return undefined;
    if (typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string' || typeof envelope.tag !== 'string') return undefined;
    try {
        const decipher = createDecipheriv('aes-256-gcm', sealKey(state), Buffer.from(envelope.iv, 'base64url'));
        decipher.setAAD(Buffer.from(stateKey(state), 'utf8'));
        decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
        const plain = Buffer.concat([decipher.update(Buffer.from(envelope.ct, 'base64url')), decipher.final()]).toString('utf8');
        return JSON.parse(plain) as PendingAuthorization;
    } catch {
        return undefined;
    }
}

/** The store over the cluster's ephemeral KV. It holds only sealed envelopes. */
export function kvPendingAuthorizationStore(kv: IKV): PendingAuthorizationStore {
    return {
        async put(state, pending) {
            await kv.set(stateKey(state), sealPendingAuthorization(state, pending), { ttl: PENDING_AUTHORIZATION_TTL_SECONDS });
        },
        async take(state) {
            const key = stateKey(state);
            const entry = await kv.get<unknown>(key);
            if (!entry) return undefined;
            // Only the caller whose delete lands holds it: a replayed callback,
            // or two racing on two replicas, finds nothing.
            const deleted = await kv.delete(key, { ifVersion: entry.version });
            return deleted ? openPendingAuthorization(state, entry.value) : undefined;
        },
    };
}

/** The in-process store, for a deployment with no cluster service. It holds the same sealed envelopes. */
export function memoryPendingAuthorizationStore(now: () => number = Date.now): PendingAuthorizationStore {
    const held = new Map<string, { expiresAt: number; sealed: SealedPendingAuthorization }>();
    return {
        async put(state, pending) {
            for (const [key, value] of held) if (value.expiresAt <= now()) held.delete(key);
            held.set(stateKey(state), { expiresAt: pending.expiresAt, sealed: sealPendingAuthorization(state, pending) });
        },
        async take(state) {
            const key = stateKey(state);
            const entry = held.get(key);
            held.delete(key);
            return entry ? openPendingAuthorization(state, entry.sealed) : undefined;
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
