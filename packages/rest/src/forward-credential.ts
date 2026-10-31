// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D10 rule 5] The agent forward credential: what an `api` action's
 * in-process forward carries when the caller is an AI agent principal.
 *
 * ## The problem it closes
 *
 * A same-origin `type: 'api'` action runs by forwarding a request to its
 * `target` inside the process (`@objectstack/runtime` `forwardApiAction`). For
 * a person the forward carries their own session, and the target authorizes
 * the same principal the action door admitted. An agent is admitted on an
 * OAuth access token, which is honoured on the MCP endpoint alone, so the same
 * forward reached its target as nobody. This module is the credential the
 * server mints instead, so the target reads the agent with its ceiling intact.
 *
 * ## The four properties (ADR-0090 D10 rule 5), and where each is enforced
 *
 * 1. **Server-minted.** {@link withForwardCredential} is the only producer, and
 *    the action door calls it only after its own gates passed. The handle is
 *    256 random bits; it names nothing and encodes nothing.
 * 2. **Bound to one forward.** A credential carries the method and the route
 *    the forward requests; {@link redeemForwardCredential} refuses any other.
 * 3. **Single-use, short-lived, non-replayable.** The first presentation spends
 *    it, whether it is accepted or refused. It is revoked when the forward
 *    answers ({@link withForwardCredential}'s `finally`) and expires after
 *    {@link FORWARD_CREDENTIAL_TTL_MS} in any case.
 * 4. **Unreachable out of process.** The credential lives in an
 *    `AsyncLocalStorage` slot that only the forward's own async chain can see.
 *    The header carries a handle into that slot, never the credential itself:
 *    a request that arrives over the network runs in another async chain, so
 *    its slot is empty and a handle it presents redeems to nothing, whatever
 *    it guessed. Nothing here is stored, logged or returned.
 *
 * ## What a door does with it
 *
 * A door that serves forward targets (the runtime HTTP dispatcher, the REST
 * face, the identity mount) reads {@link FORWARD_CREDENTIAL_HEADER} and asks
 * {@link redeemForwardCredential}. A redeemed credential answers the agent's
 * provenance, which the door hands to the shared assembler exactly as the MCP
 * door hands a verified OAuth token's, so the target builds the SAME agent
 * principal: scope-derived ceiling, `onBehalfOf`, `performedBy`. An
 * unredeemable one is ignored: the request resolves as if the header were not
 * there. ⛔ No door accepts this as a human: it never establishes anything but
 * an agent principal.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** The request header a forward carries the credential's handle in. */
export const FORWARD_CREDENTIAL_HEADER = 'x-objectstack-forward-credential';

/**
 * How long a credential lives if its forward never answers. A forward is one
 * in-process request, so this is generous for any real target and short
 * against any replay: the credential is revoked the moment its forward
 * answers, and this bound only covers a forward that hangs.
 */
export const FORWARD_CREDENTIAL_TTL_MS = 30_000;

/**
 * The agent the forward carries: the same provenance the MCP door verified
 * from the agent's OAuth access token, handed over by the action door, never
 * re-derived from a token.
 */
export interface ForwardAgentProvenance {
    /** The delegating human (`onBehalfOf`), the token's `sub`. */
    userId: string;
    /** The authorized client (`azp`), recorded as `performedBy`. */
    clientId: string;
    /** The scopes the user consented to; the target derives the ceiling from them. */
    scopes: string[];
    /** The one organization the consent bound (absent when it bound none). */
    organizationId?: string;
}

/** What one forward is bound to (ADR-0090 D10 rule 5, property 2). */
export interface ForwardCredentialBinding {
    /** The forward's HTTP method, upper-case. */
    method: string;
    /** The path the forward requests; its route (the pathname) is what binds. */
    path: string;
    /** The action run this forward belongs to. */
    run: { objectName: string; actionName: string; recordId?: string };
    agent: ForwardAgentProvenance;
}

interface ForwardCredentialSlot extends ForwardCredentialBinding {
    handle: Buffer;
    expiresAt: number;
    spent: boolean;
}

/**
 * ONE store per process, kept on a registered global symbol: a workspace
 * package can be loaded twice (its ESM and CJS builds), and two module copies
 * holding two stores would make a credential minted through one copy
 * unredeemable through the other. That direction fails closed, but it fails.
 * The symbol is process-local; nothing outside the process can reach it.
 */
const STORE_KEY = Symbol.for('@objectstack/rest.forward-credential.store');
const store: AsyncLocalStorage<ForwardCredentialSlot> =
    ((globalThis as Record<symbol, unknown>)[STORE_KEY] as AsyncLocalStorage<ForwardCredentialSlot> | undefined) ??
    ((globalThis as Record<symbol, unknown>)[STORE_KEY] = new AsyncLocalStorage<ForwardCredentialSlot>()) as AsyncLocalStorage<ForwardCredentialSlot>;

/**
 * Mint a credential bound to one forward and run `send` with its handle. The
 * handle is valid only inside `send`'s own async chain and only until `send`
 * settles: it is revoked in `finally`, whatever the target answered.
 */
export async function withForwardCredential<T>(
    binding: ForwardCredentialBinding,
    send: (handle: string) => Promise<T>,
): Promise<T> {
    const handle = randomBytes(32);
    const slot: ForwardCredentialSlot = {
        method: binding.method.toUpperCase(),
        path: binding.path,
        run: { ...binding.run },
        agent: { ...binding.agent, scopes: [...binding.agent.scopes] },
        handle,
        expiresAt: Date.now() + FORWARD_CREDENTIAL_TTL_MS,
        spent: false,
    };
    try {
        return await store.run(slot, () => send(handle.toString('base64url')));
    } finally {
        slot.spent = true;
    }
}

/**
 * The route of a URL or path: its pathname, percent-decoded, without the
 * query. The binding is to a route, and two doors spell one route the same way
 * only once both are decoded.
 */
function routeOf(url: string): string | undefined {
    try {
        return decodeURI(new URL(url, 'http://localhost').pathname);
    } catch {
        return undefined;
    }
}

/**
 * Redeem the handle a request presented. Answers the agent's provenance when
 * the handle names the credential of the forward this request IS — same
 * async chain, not spent, not expired, same method, same path — and
 * `undefined` otherwise. Any presentation in the forward's chain spends the
 * credential, accepted or not, so a second one is always refused.
 *
 * `url` is the request URL the door saw (absolute or a path); only its route
 * (the decoded pathname) is compared.
 */
export function redeemForwardCredential(
    presented: unknown,
    method: string,
    url: string,
): ForwardAgentProvenance | undefined {
    if (typeof presented !== 'string' || presented.length === 0) return undefined;
    const slot = store.getStore();
    if (!slot || slot.spent) return undefined;
    let given: Buffer;
    try {
        given = Buffer.from(presented, 'base64url');
    } catch {
        return undefined;
    }
    if (given.length !== slot.handle.length || !timingSafeEqual(given, slot.handle)) return undefined;
    // From here the handle is this forward's own, so this presentation spends it.
    slot.spent = true;
    if (Date.now() > slot.expiresAt) return undefined;
    if (String(method).toUpperCase() !== slot.method) return undefined;
    const route = routeOf(url);
    if (route === undefined || route !== routeOf(slot.path)) return undefined;
    return { ...slot.agent, scopes: [...slot.agent.scopes] };
}

/**
 * Read the presented handle off a request's headers (a `Headers`, or a plain
 * record of either case). `undefined` when absent.
 */
export function presentedForwardCredential(headers: unknown): string | undefined {
    if (!headers || typeof headers !== 'object') return undefined;
    if (typeof (headers as Headers).get === 'function') {
        const v = (headers as Headers).get(FORWARD_CREDENTIAL_HEADER);
        return v ?? undefined;
    }
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
        if (k.toLowerCase() !== FORWARD_CREDENTIAL_HEADER) continue;
        if (typeof v === 'string') return v;
        if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
    }
    return undefined;
}
