// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31821] Where a credential use came from: the client facts the
 * `credential_use` ledger row records beside the credential.
 *
 * ## The gap
 *
 * A credential's use is recorded where its throttled last-use stamp is
 * written: `stampAdmittedKey` (this package) for an API key, plugin-auth's
 * MCP last-use stamper for an OAuth access token. plugin-audit recognises the
 * stamp in an `afterUpdate` hook and writes the row (`credential-use-audit.ts`).
 * Neither stamp point held the client's address or user agent, so the row said
 * which credential acted, never from where.
 *
 * ## The facts, and who establishes them
 *
 *  - The address is the one the deployment establishes under its client-address
 *    trust rule: forwarded headers only under `server.trustProxy`, otherwise the
 *    transport's peer address. The door hands over the two facts it holds; the
 *    `auth` service applies the rule (`IAuthService.resolveClientAddress`). ⛔ No
 *    door and nothing here reads a forwarded header as an address.
 *  - The user agent is the request's `User-Agent` header, as presented. It is
 *    caller-reported by nature, and recorded as reported.
 *  - When there is no address, the row says why ({@link CredentialUseClientAbsence}),
 *    and never guesses one.
 *
 * ## How they reach the row: a scope around the stamp write
 *
 * The row is written from the stamp's own `afterUpdate`, and a hook context
 * carries no channel for request facts. So the stamp opens a scope
 * ({@link runWithCredentialUseClient}) around its own update, and the hook reads
 * it ({@link currentCredentialUseClient}). The scope is an `AsyncLocalStorage`
 * store, as the request grants memo's is (`request-grants-memo.ts`): two
 * requests interleaving across their awaits each see only their own, and the
 * scope ends when the stamp write settles, so no other write sees it.
 *
 * The throttle is the stamp's, untouched: a row is written only when a stamp is,
 * so the facts are those of the first use in the stamp's window.
 *
 * A host whose async context does not propagate finds no scope; so does a
 * stamp whose door handed no facts. Either way the row records the address as
 * absent with the reason `not_supplied`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Why a `credential_use` row has no address:
 *
 *  - `stdio`: the stdio transport has no network peer;
 *  - `undetermined`: the door handed its facts, and the trust rule established
 *    no address from them (no peer address, no trusted forwarded header);
 *  - `not_supplied`: the door that admitted the credential handed no facts.
 */
export type CredentialUseClientAbsence = 'stdio' | 'undetermined' | 'not_supplied';

/** The client facts of one credential use, as the ledger row records them. */
export interface CredentialUseClient {
  /** The address the deployment established for the request, or `null`. */
  ipAddress: string | null;
  /** The `User-Agent` the request presented, or `null`. */
  userAgent: string | null;
  /** Why {@link ipAddress} is `null`; absent when it is set. */
  ipAddressAbsent?: CredentialUseClientAbsence;
}

/**
 * What a door hands the key-admission seam about the request:
 *
 *  - `{ transport: 'http', address }`: the address the `auth` service
 *    established for the request (`IAuthService.resolveClientAddress`), or
 *    `undefined` when it established none;
 *  - `{ transport: 'stdio' }`: a stdio transport, which has no address.
 */
export type CredentialUseClientInput =
  | { transport: 'http'; address: string | undefined }
  | { transport: 'stdio' };

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** The `User-Agent` of `headers` (Web `Headers` or a plain record), or `undefined`. */
export function userAgentOf(headers: unknown): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const h = headers as { get?: (name: string) => unknown } & Record<string, unknown>;
  if (typeof h.get === 'function') return nonEmpty(h.get('user-agent'));
  for (const key of Object.keys(h)) {
    if (key.toLowerCase() !== 'user-agent') continue;
    const raw = h[key];
    return nonEmpty(Array.isArray(raw) ? raw[0] : raw);
  }
  return undefined;
}

/**
 * The client facts of a use: the door's `input` and the request `headers`.
 * A stdio transport presents no user agent (its headers are the seam's own).
 */
export function credentialUseClientOf(
  input: CredentialUseClientInput | undefined,
  headers: unknown,
): CredentialUseClient {
  if (input?.transport === 'stdio') return { ipAddress: null, userAgent: null, ipAddressAbsent: 'stdio' };
  const userAgent = userAgentOf(headers) ?? null;
  if (!input) return { ipAddress: null, userAgent, ipAddressAbsent: 'not_supplied' };
  const ipAddress = nonEmpty(input.address);
  return ipAddress ? { ipAddress, userAgent } : { ipAddress: null, userAgent, ipAddressAbsent: 'undetermined' };
}

/**
 * The scope's store, held process-wide under a registered symbol: the stamp
 * that opens the scope and the hook that reads it import this module from
 * different packages, and a second copy of the module (an ESM and a CJS load
 * of the same build) must not hand them two stores, or the hook would read
 * `not_supplied` for every use.
 */
const SCOPE_STORAGE_KEY: unique symbol = Symbol.for('objectstack.core.credentialUseClientScope');
const scopeStorage: AsyncLocalStorage<CredentialUseClient> = ((globalThis as Record<symbol, unknown>)[
  SCOPE_STORAGE_KEY
] ??= new AsyncLocalStorage<CredentialUseClient>()) as AsyncLocalStorage<CredentialUseClient>;

/**
 * Run `fn` (a credential's stamp write) with `client` as the facts of the use
 * it stamps. The scope ends when `fn` settles.
 */
export function runWithCredentialUseClient<T>(client: CredentialUseClient, fn: () => Promise<T>): Promise<T> {
  return scopeStorage.run(client, fn);
}

/** The facts of the stamp write in progress, or `undefined` outside one. */
export function currentCredentialUseClient(): CredentialUseClient | undefined {
  return scopeStorage.getStore();
}
