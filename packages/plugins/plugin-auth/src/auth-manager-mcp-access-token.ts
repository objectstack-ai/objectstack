// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 9] The MCP access-token verifier of `AuthManager` — the local,
 * fail-closed check of an OAuth 2.1 Bearer access token this deployment's
 * authorization server minted, and the one forced keyring re-read a token
 * signed by an unknown key earns — moved out of `auth-manager.ts` whole, with
 * the one module-level declaration that only these bodies read: the reader of
 * the key set `/jwks` publishes.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `AuthManager` method of the same name as it stood, re-indented one level
 * and otherwise unedited, and `readPublishedJwks` is its text as it stood in
 * `auth-manager.ts`: the same signature, issuer and audience checks, the same
 * refusal of a token no human delegated, the same organization claim, the
 * same single-flight re-read and its floor.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), which `auth-manager-actor-guards.ts`,
 * `auth-manager-sign-in-lockout.ts`, `auth-manager-password-session-policy.ts`,
 * `auth-manager-database-hooks.ts`, `auth-manager-email-sms-delivery.ts`,
 * `auth-manager-plugin-assembly.ts`, `auth-manager-database-secret.ts` and
 * `auth-manager-membership-admission.ts` follow, applied per method. The class
 * keeps both methods — the published `dist/*.d.ts` lists each one — and each
 * body is one literal of exactly the {@link McpAccessTokenHost} members that
 * method reads, plus a `.call`. `verifyMcpAccessToken` is no longer `async`:
 * it returns the moved function's own promise, so a caller awaits the same
 * promise the body settles, with no extra wrapper.
 *
 * A method goes as a closure that calls it on the manager at call time, so a
 * test double or spy set on the manager is still the one a body reaches —
 * `getApi`, which the verifier suites replace with a key-set double, and
 * `rereadKeyringForUnknownKey` included, which `verifyMcpAccessToken` asks
 * through the manager rather than calling the function here directly.
 * `config` goes as a GETTER: the class reassigns it after construction
 * (`setRuntimeBaseUrl` and `applyConfigPatch`), so it is read off the manager
 * when the body reads it, as before. `unknownKeyReread` goes as a get/set
 * pair, because `rereadKeyringForUnknownKey` stores the re-read it starts on
 * the manager: the floor and the read in flight stay the ones the manager
 * holds, shared by every token it verifies.
 *
 * `readPublishedJwks` moves with the bodies, because only they read it.
 * `OAUTH_ORGANIZATION_CLAIM` stays: the plugin assembly that mints the claim
 * (`buildPluginList`, still in the class) reads it too, and it is one
 * spelling for both ends. So `auth-manager.ts` exports it and this module
 * imports it by VALUE, for one read inside `verifyMcpAccessToken`, when a
 * token is verified. `index.ts` lists `auth-manager.ts`'s published names one
 * by one, so that export is not published. The two modules import each
 * other, and that is safe because nothing reads the binding while they are
 * first evaluated: this module's top level is imports, an interface and
 * function declarations.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { JSONWebKeySet } from 'jose';
import { OAUTH_ORGANIZATION_CLAIM, type AuthManager } from './auth-manager.js';
import {
  retireHeldKeyrings,
  UNKNOWN_SIGNING_KEY_REREAD_FLOOR_MS,
} from './signing-key-read-cache.js';

/**
 * [#24186] The key set the MCP access-token verifier checks signatures
 * against: the document better-auth's `getJwks` endpoint answers, which is
 * what `/jwks` publishes — public members only, read through the signer's
 * keyring reader (`signing-key-read-cache.ts`). `undefined` when the instance
 * carries no jwt plugin or the answer is not a key set.
 */
async function readPublishedJwks(api: unknown): Promise<JSONWebKeySet | undefined> {
  const jwks = await (api as { getJwks?: () => Promise<unknown> } | null | undefined)?.getJwks?.();
  return jwks && Array.isArray((jwks as { keys?: unknown }).keys) ? (jwks as JSONWebKeySet) : undefined;
}

/**
 * The `AuthManager` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header for
 * why `config` is a getter and `unknownKeyReread` an accessor.
 */
export interface McpAccessTokenHost {
  readonly config: AuthManager['config'];
  unknownKeyReread: AuthManager['unknownKeyReread'];
  getApi: AuthManager['getApi'];
  getAuthIssuer: AuthManager['getAuthIssuer'];
  getMcpResourceUrl: AuthManager['getMcpResourceUrl'];
  isMcpOAuthEnabled: AuthManager['isMcpOAuthEnabled'];
  rereadKeyringForUnknownKey: AuthManager['rereadKeyringForUnknownKey'];
}

/** The body of `AuthManager#verifyMcpAccessToken`; the method's docblock there is its contract. */
export async function verifyMcpAccessToken(
  this: Pick<McpAccessTokenHost, 'getApi' | 'getAuthIssuer' | 'getMcpResourceUrl' | 'isMcpOAuthEnabled' | 'rereadKeyringForUnknownKey'>,
  token: string,
): Promise<{ userId: string; scopes: string[]; clientId?: string; organizationId?: string } | null> {
  try {
    if (!token || token.split('.').length !== 3) return null; // not a JWS compact token
    if (!this.isMcpOAuthEnabled()) return null;

    const { createLocalJWKSet, jwtVerify, errors } = await import('jose');

    const api = await this.getApi();
    const jwks = await readPublishedJwks(api);
    if (!jwks) return null;
    const expected = { issuer: this.getAuthIssuer(), audience: this.getMcpResourceUrl() };
    const verifyAgainst = async (keys: JSONWebKeySet) =>
      (await jwtVerify(token, createLocalJWKSet(keys), expected)).payload;

    let payload: Awaited<ReturnType<typeof verifyAgainst>>;
    try {
      payload = await verifyAgainst(jwks);
    } catch (error) {
      // Only "no key in the set matches this token" earns the fresh read: a
      // key minted where this process could not see it. Every other failure
      // is the token's own, and a re-read could not change it.
      if (!(error instanceof errors.JWKSNoMatchingKey)) throw error;
      const fresh = await this.rereadKeyringForUnknownKey(api);
      if (!fresh) return null;
      payload = await verifyAgainst(fresh);
    }

    const subject = typeof payload.sub === 'string' && payload.sub ? payload.sub : undefined;
    if (!subject) return null;

    // The two spellings of "which client is presenting this", read
    // independently rather than through a `??` chain: a token that carries
    // both and disagrees with itself must be refused on EITHER match, and
    // collapsing them first would let the losing spelling smuggle the
    // client id past the comparison below.
    const clientIdClaim =
      typeof (payload as any).client_id === 'string' && (payload as any).client_id
        ? ((payload as any).client_id as string)
        : undefined;
    const azp =
      typeof (payload as any).azp === 'string' && (payload as any).azp
        ? ((payload as any).azp as string)
        : undefined;
    // No client identity at all → the human/machine discriminator has no
    // input. Fail closed rather than admit an unclassifiable token.
    if (!clientIdClaim && !azp) return null;
    // `sub` IS the client → RFC 9068 §2.2.3.1's "no resource owner was
    // involved" shape, i.e. a client_credentials grant. No principal.
    if (subject === clientIdClaim || subject === azp) return null;

    const scopes =
      typeof payload.scope === 'string'
        ? payload.scope.split(' ').filter(Boolean)
        : [];
    // The bound organization, when the token carries one. A claim that is
    // PRESENT but is not a non-empty string is no organization this
    // authorization server mints, so the token is refused rather than read
    // as "no organization": the check that cannot run must not pass.
    const organizationClaim = (payload as Record<string, unknown>)[OAUTH_ORGANIZATION_CLAIM];
    if (
      organizationClaim !== undefined
      && (typeof organizationClaim !== 'string' || !organizationClaim)
    ) return null;
    const organizationId = organizationClaim as string | undefined;
    return {
      userId: subject,
      scopes,
      ...(azp ? { clientId: azp } : {}),
      ...(organizationId ? { organizationId } : {}),
    };
  } catch {
    return null; // unknown/expired/wrong-audience/garbage → no principal
  }
}

/** The body of `AuthManager#rereadKeyringForUnknownKey`; the method's docblock there is its contract. */
export function rereadKeyringForUnknownKey(this: Pick<McpAccessTokenHost, 'config' | 'unknownKeyReread'>, api: unknown): Promise<JSONWebKeySet | undefined> {
  const last = this.unknownKeyReread;
  if (last?.pending) return last.pending;
  const now = Date.now();
  if (last && now - last.startedAtMs < UNKNOWN_SIGNING_KEY_REREAD_FLOOR_MS) {
    return Promise.resolve(undefined);
  }
  retireHeldKeyrings(this.config.dataEngine);
  const pending = readPublishedJwks(api);
  const reread: { readonly startedAtMs: number; pending?: Promise<JSONWebKeySet | undefined> } = {
    startedAtMs: now,
    pending,
  };
  this.unknownKeyReread = reread;
  const settle = () => {
    reread.pending = undefined;
  };
  pending.then(settle, settle);
  return pending;
}
