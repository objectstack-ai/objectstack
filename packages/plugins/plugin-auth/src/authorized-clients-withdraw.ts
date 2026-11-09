// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31048] Withdraw an AI assistant a person authorized: one door for the
 * person themself, one for a platform administrator, beside the two reads
 * that list them (`authorized-clients-read.ts`).
 *
 *   POST /api/v1/auth/authorized-clients/withdraw         { id }          — the caller's own
 *   POST /api/v1/auth/admin/authorized-clients/withdraw   { userId, id }  — another person's
 *
 * `id` is the consent id the reads answer on every row. The consent page tells
 * the person they can withdraw access at any time; these doors are how they,
 * and an administrator responsible for them, turn an assistant off.
 *
 * ## What a withdraw does (cloud#3606, ruling A)
 *
 * > 撤销或撤回时删掉这条记录 … 控制台的撤回也随之真正生效
 *
 * It revokes the grant exactly as `/oauth2/revoke` does (`revokeMcpGrant` in
 * `mcp-token-revocation.ts`, one owner for both): the consent row is deleted,
 * then the client's refresh family for that person. The MCP door reads the
 * consent on every request (`mcpConsentAdmits`), so the assistant's token is
 * refused on its very next call; deleting the refresh family keeps a token the
 * client still holds from coming back if the person later authorizes the same
 * assistant again. Every write goes through better-auth's own storage adapter,
 * so the model names and field mapping are the provider's, and is attributed
 * to the person who withdrew it, with the impersonating administrator beside
 * them when the session is an impersonation (`runAttributedToUser`;
 * attribution only).
 *
 * ## Why not better-auth's `POST /oauth2/delete-consent`
 *
 * It does check that the consent belongs to the session user, but it answers
 * an id that names no consent `404` and another person's id `401`, so a caller
 * can tell the two apart; and it leaves the refresh family in place. This
 * door answers both the same, byte for byte, and revokes the whole grant.
 *
 * ## The own door: keyed by the session's subject
 *
 * Only a consent of the session user is withdrawn. An id that names no
 * consent, and an id that names somebody else's, read the SAME
 * `404 RESOURCE_NOT_FOUND`, and the other person's row stays in place: the
 * answer carries no more than "no assistant you may withdraw has this id".
 *
 * ## The admin door: the admin read's gate, never a wider one
 *
 * `auth-plugin.ts` runs the same `gateAdmin` as `GET /admin/authorized-clients`
 * (the ADR-0068 D2 judge, a held session refused per ADR-0069 D3) before the
 * body is read, so a caller outside a platform administrator's reach gets one
 * refusal whoever the body names and whether or not the person or the consent
 * exists: `401` with no session, `403` otherwise. Admitted, the administrator
 * names the person (`userId`) and the consent; a consent that is not that
 * person's is the same `404` as one that does not exist.
 *
 * ## Refusals (ADR-0112: code AND status)
 *
 *  - no session (own door): `401 UNAUTHENTICATED`, before the body is read;
 *  - a held session (own door): `403` with the posture's own code;
 *  - a query parameter (either door; the query set is closed and empty):
 *    `400 VALIDATION_ERROR`;
 *  - a body declared JSON that does not parse: `400 INVALID_REQUEST`;
 *  - a body that is not an object, carries a key the door does not take, or
 *    lacks a non-empty string `id` (and `userId`, admin door):
 *    `400 VALIDATION_ERROR`;
 *  - the admin door, a `userId` that names no user: `404 RESOURCE_NOT_FOUND`,
 *    the admin read's own message;
 *  - no consent of that person has this id: `404 RESOURCE_NOT_FOUND`.
 *
 * The answer: `200 { success: true, data: { id } }`, `Cache-Control: no-store`.
 */

import { unknownQueryParamRefusalMessage } from '@objectstack/rest';
import type { AuthSessionApi } from '@objectstack/spec/contracts';
import { inProcessSessionReadInput } from '@objectstack/types';
import { runAttributedToUser } from './auth-actor-attribution.js';
import { ADMIN_AUTHORIZED_CLIENTS_USER_NOT_FOUND_MESSAGE } from './authorized-clients-read.js';
import { revokeMcpGrant, type McpGrantKey, type OAuthGrantStore } from './mcp-token-revocation.js';
import type { PlatformAdminActor } from './platform-admin-gate.js';
import { judgeHeldSession, PLATFORM_ADMIN_REFUSAL_MESSAGES } from './platform-admin-gate.js';
import { readJsonRequestBody } from './request-json-body.js';

/** The own door, relative to the auth base path. */
export const AUTHORIZED_CLIENT_WITHDRAW_PATH = '/authorized-clients/withdraw';

/** The admin door, relative to the auth base path. */
export const ADMIN_AUTHORIZED_CLIENT_WITHDRAW_PATH = '/admin/authorized-clients/withdraw';

/** The own door's CLOSED body keys. */
export const AUTHORIZED_CLIENT_WITHDRAW_BODY_KEYS: readonly string[] = Object.freeze(['id']);

/** The admin door's CLOSED body keys. */
export const ADMIN_AUTHORIZED_CLIENT_WITHDRAW_BODY_KEYS: readonly string[] = Object.freeze(['id', 'userId']);

/**
 * The not-found message. ONE string for every cause (no such consent, another
 * person's consent, one already withdrawn): the byte-equality is load-bearing,
 * see the module header.
 */
export const AUTHORIZED_CLIENT_WITHDRAW_NOT_FOUND_MESSAGE =
  'No authorized assistant you may withdraw matches the supplied id.';

export interface AuthorizedClientWithdrawResult {
  status: 200 | 400 | 401 | 403 | 404;
  body:
    | { success: true; data: { id: string } }
    | { success: false; error: { code: string; message: string } };
  headers: Record<string, string>;
}

/** What the in-process session read answers, as `AuthSessionApi` declares it. */
type SessionRead = Awaited<ReturnType<NonNullable<AuthSessionApi['getSession']>>>;

/** A consent row as the provider's adapter answers it (camelCase field names). */
interface ConsentRow {
  id?: unknown;
  userId?: unknown;
  clientId?: unknown;
  referenceId?: unknown;
}

/** The seams the doors use. {@link authorizedClientWithdrawDepsFor} wires the real ones. */
export interface AuthorizedClientWithdrawDeps {
  /** The caller's session, `customSession`-decorated (`authGate`). */
  readCallerSession(headers: Headers): Promise<SessionRead | null>;
  /** The consent `id` names, when it is `userId`'s; `null` otherwise. */
  findConsentOf(userId: string, id: string): Promise<McpGrantKey | null>;
  /** Revoke the grant: the consent, then the client's refresh family. */
  revokeGrant(grant: McpGrantKey): Promise<void>;
  /** Does a user with this id exist? */
  userExists(userId: string): Promise<boolean>;
}

/** The slice of `AuthManager` the real seams are built from. */
export interface AuthorizedClientWithdrawManager {
  getApi(): Promise<unknown>;
  getAuthContext(): Promise<unknown>;
  getDataEngine(): unknown;
}

const SYSTEM_READ = { context: { isSystem: true, positions: [], permissions: [] } } as const;

const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

const nonEmpty = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * The real seams. The consent is read and the grant revoked through
 * better-auth's own storage adapter (`$context.adapter`), the store the
 * provider writes these rows through and the MCP door reads them from.
 */
export function authorizedClientWithdrawDepsFor(manager: AuthorizedClientWithdrawManager): AuthorizedClientWithdrawDeps {
  const store = async (): Promise<OAuthGrantStore> => {
    const found = ((await manager.getAuthContext()) as { adapter?: OAuthGrantStore } | null | undefined)?.adapter;
    if (!found) throw new Error('The authorization store is not available.');
    return found;
  };
  return {
    async readCallerSession(headers) {
      const api = (await manager.getApi()) as { getSession(input: unknown): Promise<SessionRead | null> };
      return api.getSession(inProcessSessionReadInput(headers));
    },
    async findConsentOf(userId, id) {
      const row = (await (await store()).findOne({
        model: 'oauthConsent',
        where: [
          { field: 'id', value: id },
          { field: 'userId', value: userId },
        ],
      })) as ConsentRow | null;
      // Both conditions read again here: a store that ignored one would
      // otherwise hand back a row the person may not withdraw.
      if (!row || String(row.id) !== id || String(row.userId) !== userId || !nonEmpty(row.clientId)) return null;
      const referenceId = nonEmpty(row.referenceId);
      return { clientId: String(row.clientId), userId, ...(referenceId ? { organizationId: referenceId } : {}) };
    },
    async revokeGrant(grant) {
      await revokeMcpGrant(await store(), grant);
    },
    async userExists(userId) {
      const engine = manager.getDataEngine() as
        | { find(object: string, query: Record<string, unknown>, options?: unknown): Promise<unknown> }
        | undefined;
      if (!engine) throw new Error('The data engine is not available.');
      const rows = await engine.find('sys_user', { where: { id: userId }, fields: ['id'], limit: 1 }, SYSTEM_READ);
      return Array.isArray(rows) && rows.length > 0;
    },
  };
}

const refusal = (status: 400 | 401 | 404, code: string, message: string): AuthorizedClientWithdrawResult => ({
  status,
  body: { success: false, error: { code, message } },
  headers: { ...NO_STORE },
});

const notFound = (): AuthorizedClientWithdrawResult =>
  refusal(404, 'RESOURCE_NOT_FOUND', AUTHORIZED_CLIENT_WITHDRAW_NOT_FOUND_MESSAGE);

/**
 * The request's shape: no query parameter, a JSON object body carrying exactly
 * the door's keys, each a non-empty string. Answers the named values, or the
 * refusal to hand back.
 */
async function readWithdrawRequest(
  request: { raw: Request; queries: Record<string, readonly string[]> },
  keys: readonly string[],
): Promise<{ values: Record<string, string> } | AuthorizedClientWithdrawResult> {
  const unknownQuery = unknownQueryParamRefusalMessage(request.queries, []);
  if (unknownQuery !== undefined) return refusal(400, 'VALIDATION_ERROR', unknownQuery);

  const reading = await readJsonRequestBody(request.raw);
  if (!reading.ok) return refusal(400, 'INVALID_REQUEST', reading.message);
  const body = reading.body as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return refusal(400, 'VALIDATION_ERROR', `The request body must be a JSON object carrying ${keys.map((k) => `"${k}"`).join(' and ')}.`);
  }
  const unknownKeys = Object.keys(body).filter((key) => !keys.includes(key)).sort();
  if (unknownKeys.length) {
    return refusal(
      400,
      'VALIDATION_ERROR',
      `Unrecognized body key${unknownKeys.length > 1 ? 's' : ''} ${unknownKeys.map((k) => `"${k}"`).join(', ')}: `
        + `this route takes ${keys.map((k) => `"${k}"`).join(' and ')} only.`,
    );
  }
  const values: Record<string, string> = {};
  for (const key of keys) {
    const value = nonEmpty((body as Record<string, unknown>)[key]);
    if (!value) return refusal(400, 'VALIDATION_ERROR', `The "${key}" body key is required and must be a non-empty string.`);
    values[key] = value;
  }
  return { values };
}

/** Withdraw `userId`'s consent `id`, credited to `actor`. */
async function withdrawConsentOf(
  deps: AuthorizedClientWithdrawDeps,
  actor: { id: string; impersonatedBy?: string },
  userId: string,
  id: string,
): Promise<AuthorizedClientWithdrawResult> {
  const grant = await deps.findConsentOf(userId, id);
  if (!grant) return notFound();
  await runAttributedToUser(actor, () => deps.revokeGrant(grant));
  return { status: 200, body: { success: true, data: { id } }, headers: { ...NO_STORE } };
}

/** `POST /authorized-clients/withdraw` — one of the caller's own grants. See the module header. */
export async function runOwnAuthorizedClientWithdraw(
  deps: AuthorizedClientWithdrawDeps,
  request: { raw: Request; queries: Record<string, readonly string[]> },
): Promise<AuthorizedClientWithdrawResult> {
  const session = await deps.readCallerSession(request.raw.headers);
  const user = session?.user;
  const subject = user?.id == null ? '' : String(user.id);
  if (!subject) return refusal(401, 'UNAUTHENTICATED', PLATFORM_ADMIN_REFUSAL_MESSAGES[401]);

  const held = judgeHeldSession(user);
  if (held) return { status: held.status as 403, body: held.body, headers: { ...NO_STORE } };

  const read = await readWithdrawRequest(request, AUTHORIZED_CLIENT_WITHDRAW_BODY_KEYS);
  if (!('values' in read)) return read;
  // An impersonation session names the administrator at the keyboard: it is
  // credited beside the person as the attribution-only `impersonatedBy`, read
  // off this session and never off the body, as `gateAdmin` and the auth
  // before-hook carry it.
  const impersonatedBy = nonEmpty((session?.session as { impersonatedBy?: unknown } | undefined)?.impersonatedBy);
  const actor = impersonatedBy ? { id: subject, impersonatedBy } : { id: subject };
  return withdrawConsentOf(deps, actor, subject, read.values.id);
}

/**
 * `POST /admin/authorized-clients/withdraw` — another person's grant, for a
 * caller the mount's platform-admin gate has already admitted (`actor`). See
 * the module header.
 */
export async function runAdminAuthorizedClientWithdraw(
  deps: AuthorizedClientWithdrawDeps,
  actor: PlatformAdminActor,
  request: { raw: Request; queries: Record<string, readonly string[]> },
): Promise<AuthorizedClientWithdrawResult> {
  const read = await readWithdrawRequest(request, ADMIN_AUTHORIZED_CLIENT_WITHDRAW_BODY_KEYS);
  if (!('values' in read)) return read;
  const { userId, id } = read.values;
  if (!(await deps.userExists(userId))) {
    return refusal(404, 'RESOURCE_NOT_FOUND', ADMIN_AUTHORIZED_CLIENTS_USER_NOT_FOUND_MESSAGE);
  }
  return withdrawConsentOf(deps, actor, userId, id);
}
