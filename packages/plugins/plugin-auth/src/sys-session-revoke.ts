// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /api/v1/auth/sys-session/revoke` — end ONE session, named by its
 * `sys_session.id`.
 *
 * ## The invariant this route holds
 *
 * A session row's Revoke Session action — Setup → Sessions for an
 * administrator, Account → Active Sessions for the session's owner — ends the
 * session it names, and that session's next request is refused. The action is
 * keyed on the row's `id`, which every list row carries; the server resolves
 * the session from the id, server-side, and the session token never leaves the
 * server in either direction. `sys_session.token` stays `internal: true`: no
 * read path serves it, and nothing here needs one to.
 *
 * ## Who may revoke what
 *
 * Two lanes, decided by the row the id resolves to:
 *
 *  1. **The session's owner** — re-dispatched to better-auth's own
 *     `POST /revoke-session` with the resolved token and the caller's own
 *     credentials (`in-process-redispatch.ts`). Everything that route enforces
 *     still applies, unchanged and not restated here: the vendor's ownership
 *     and freshness checks, the `revoke-session-match-guard.ts` admission gate,
 *     and the ADR-0069 D4 tombstone (`session-tombstone.ts`, reason
 *     `user_revoked`) with the session-delete hooks it keeps running.
 *  2. **A platform administrator, on another user's session** — admitted by
 *     the ADR-0068 D2 judge every ObjectStack `/admin/*` mount uses
 *     (`judgePlatformAdmin`, held sessions refused per ADR-0069 D3), then the
 *     session is tombstoned in place exactly as the platform's other
 *     server-side revocations write it (`membership-ended-session.ts`,
 *     `forced-reset-revocation.ts`): `expires_at` a second in the past plus
 *     `revoked_at` / `revoke_reason`. The reason is `admin`, the value the
 *     interactive-revoke ledger already records for an administrator's revoke
 *     ({@link ADMIN_SESSION_REVOKE_REASON}). better-auth's session read then
 *     answers `null` for that token, so its next request is unauthenticated.
 *     The vendor's own `/admin/revoke-user-session` is not the delegate: it
 *     authorizes on the legacy `role` scalar, which ADR-0068 D2 platform
 *     administrators do not carry (`admin-ban-endpoints.ts` records the
 *     measurement).
 *
 * Everyone else — a signed-in caller who neither owns the session nor holds
 * platform-admin standing — reads the SAME `404 RESOURCE_NOT_FOUND` as an id
 * that names no live session, byte for byte. The decision is made before
 * anything about the target is revealed, so the answer carries no more than
 * "no session you may revoke has this id".
 *
 * ## Why not the generic data path
 *
 * `sys_session` is `managedBy: 'better-auth'` and its writes are refused on the
 * data API (ADR-0092 D2, `apiMethods: ['get', 'list']`). This is an ObjectStack
 * mount on the raw app ahead of the auth catch-all, ledgered in
 * `auth-route-ledger.ts`, in the `sys-oauth-application/register` family: an
 * object-scoped door outside the `/admin/` namespace, because its first lane
 * admits the session's owner.
 *
 * ## Refusals (ADR-0112: code AND status)
 *
 *  - anonymous: `401 UNAUTHENTICATED`, before the body is read;
 *  - a body declared JSON that does not parse, or no `sessionId`:
 *    `400 INVALID_REQUEST`;
 *  - no live session the caller may revoke: `404 RESOURCE_NOT_FOUND`;
 *  - a held platform administrator on another user's session: `403` with the
 *    posture's own code (`judgePlatformAdmin`);
 *  - the owner lane: whatever better-auth's `/revoke-session` answers, status
 *    and body as it sent them.
 */

import { SystemObjectName } from '@objectstack/spec/system';
import type { AuthSessionApi } from '@objectstack/spec/contracts';
import { inProcessSessionReadInput } from '@objectstack/types';
import { FORWARDED_CLIENT_ADDRESS_HEADERS } from './client-address.js';
import { inProcessRedispatchUrl } from './in-process-redispatch.js';
import {
  PLATFORM_ADMIN_REFUSAL_MESSAGES,
  isPlatformAdminUser,
  judgePlatformAdmin,
} from './platform-admin-gate.js';
import { readJsonRequestBody } from './request-json-body.js';
import { INTERACTIVE_REVOKE_REASON } from './session-tombstone.js';

/** The route, relative to the auth base path. */
export const SYS_SESSION_REVOKE_PATH = '/sys-session/revoke';

/** The body key that names the session — the console's `recordIdParam`. */
export const SYS_SESSION_REVOKE_ID_PARAM = 'sessionId';

/** The refusal's wire code — standard catalog (ADR-0112). */
export const SYS_SESSION_REVOKE_NOT_FOUND_CODE = 'RESOURCE_NOT_FOUND';

/**
 * The refusal's message. ONE string for every caller and every cause (no such
 * id, an already-ended session, a session the caller may not revoke) — the
 * byte-equality is load-bearing, see the header.
 */
export const SYS_SESSION_REVOKE_NOT_FOUND_MESSAGE = 'No session you may revoke matches the supplied id.';

/**
 * The `revoke_reason` the administrator lane records: the interactive-revoke
 * ledger's own value for an administrator's revoke, read rather than retyped
 * so the two cannot drift.
 */
export const ADMIN_SESSION_REVOKE_REASON: string = INTERACTIVE_REVOKE_REASON['/admin/revoke-user-session'];

/** What the in-process session read answers, as `AuthSessionApi` declares it. */
type SessionRead = Awaited<ReturnType<NonNullable<AuthSessionApi['getSession']>>>;

/** A live session row, as the server resolves it from an id. Never serialized. */
export interface LiveSessionRow {
  id: string;
  userId: string;
  token: string;
}

/** The route's answer: a status and an ADR-0112 envelope (or the vendor's body, owner lane). */
export interface SysSessionRevokeResult {
  status: number;
  body: unknown;
}

/** The seams this route reads. {@link sysSessionRevokeDepsFor} wires the real ones. */
export interface SysSessionRevokeDeps {
  /** The caller's session, `customSession`-decorated (`isPlatformAdmin`, `authGate`). */
  readCallerSession(headers: Headers): Promise<SessionRead | null>;
  /** The live (unrevoked) session `sessionId` names, read server-side, or `null`. */
  findLiveSession(sessionId: string): Promise<LiveSessionRow | null>;
  /** Tombstone the session in place with `reason`; `false` when no row was written. */
  tombstoneSession(sessionId: string, reason: string): Promise<boolean>;
  /** better-auth's universal handler — `AuthManager.handleRequest`. */
  handle(request: Request): Promise<Response>;
  /** The auth route base, e.g. `/api/v1/auth`. */
  basePath: string;
}

/** The slice of `AuthManager` the real seams are built from. */
export interface SysSessionRevokeManager {
  getApi(): Promise<unknown>;
  getAuthContext(): Promise<unknown>;
  getDataEngine(): unknown;
  handleRequest(request: Request): Promise<Response>;
}

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

const notFound = (): SysSessionRevokeResult => ({
  status: 404,
  body: {
    success: false,
    error: { code: SYS_SESSION_REVOKE_NOT_FOUND_CODE, message: SYS_SESSION_REVOKE_NOT_FOUND_MESSAGE },
  },
});

const invalid = (message: string): SysSessionRevokeResult => ({
  status: 400,
  body: { success: false, error: { code: 'INVALID_REQUEST', message } },
});

const revoked = (sessionId: string): SysSessionRevokeResult => ({
  status: 200,
  body: { success: true, data: { sessionId } },
});

/**
 * The real seams: the session read every mount here makes, better-auth's own
 * storage adapter for the lookup (which hides tombstoned rows and re-attaches
 * the `internal` token server-side), and the raw engine for the tombstone
 * write, under a system context as the platform's other revocations write it.
 */
export function sysSessionRevokeDepsFor(manager: SysSessionRevokeManager, basePath: string): SysSessionRevokeDeps {
  return {
    async readCallerSession(headers) {
      const api = (await manager.getApi()) as { getSession(input: unknown): Promise<SessionRead | null> };
      return api.getSession(inProcessSessionReadInput(headers));
    },
    async findLiveSession(sessionId) {
      const ctx = (await manager.getAuthContext()) as {
        adapter: { findOne(q: { model: string; where: Array<{ field: string; value: unknown }> }): Promise<unknown> };
      };
      const row = (await ctx.adapter.findOne({
        model: 'session',
        where: [{ field: 'id', value: sessionId }],
      })) as { id?: unknown; userId?: unknown; token?: unknown } | null;
      if (!row?.id || row.userId == null || typeof row.token !== 'string' || row.token.length === 0) return null;
      return { id: String(row.id), userId: String(row.userId), token: row.token };
    },
    async tombstoneSession(sessionId, reason) {
      const engine = manager.getDataEngine() as {
        update(object: string, doc: Record<string, unknown>, opts?: unknown): Promise<unknown>;
      } | undefined;
      if (!engine) throw new Error('The data engine is not available, so the session could not be revoked.');
      const now = Date.now();
      const written = await engine.update(
        SystemObjectName.SESSION,
        {
          id: sessionId,
          // A second in the past, matching `enforceSessionControls`, so every
          // `expiresAt < now` liveness check is strictly true.
          expires_at: new Date(now - 1000),
          revoked_at: new Date(now),
          revoke_reason: reason,
        },
        { context: SYSTEM_CTX },
      );
      return written != null && written !== 0;
    },
    handle: (request) => manager.handleRequest(request),
    basePath,
  };
}

/**
 * [#24877] Carry the forwarding facts the client-address trust rule reads
 * (`FORWARDED_CLIENT_ADDRESS_HEADERS`) from the request this route serves onto
 * the request the owner lane re-dispatches, as the incoming request had them,
 * so `AuthManager.handleRequest` judges both on the same facts: the forwarded
 * client address behind a declared `server.trustProxy`, the connection peer
 * otherwise.
 */
function carryForwardedClientAddress(from: Headers, to: Headers): void {
  for (const name of FORWARDED_CLIENT_ADDRESS_HEADERS) {
    const value = from.get(name);
    if (value !== null) to.set(name, value);
  }
}

/**
 * Owner lane: better-auth's `/revoke-session`, with the resolved token and the
 * caller's own credentials and forwarding facts. Only status and body come
 * back from here, so the re-dispatch carries `disableRefresh` for a cookie
 * request (`inProcessRedispatchUrl`).
 */
async function revokeAsOwner(
  deps: SysSessionRevokeDeps,
  request: Request,
  target: LiveSessionRow,
): Promise<SysSessionRevokeResult> {
  const incoming = new URL(request.url);
  const headers = new Headers({ 'content-type': 'application/json' });
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const authorization = request.headers.get('authorization');
  if (authorization) headers.set('authorization', authorization);
  headers.set('origin', request.headers.get('origin') || incoming.origin);
  carryForwardedClientAddress(request.headers, headers);

  const url = new URL(`${deps.basePath}/revoke-session`, incoming.origin).href;
  const response = await deps.handle(
    new Request(inProcessRedispatchUrl(url, headers), {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: target.token }),
    }),
  );
  if (response.ok) return revoked(target.id);

  let body: unknown;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : { success: false };
  } catch {
    body = { success: false };
  }
  return { status: response.status, body };
}

/** `POST /api/v1/auth/sys-session/revoke` — see the module header. */
export async function runSysSessionRevoke(
  deps: SysSessionRevokeDeps,
  request: Request,
): Promise<SysSessionRevokeResult> {
  // Identity first: an anonymous caller learns nothing about any id.
  const session = await deps.readCallerSession(request.headers);
  const user = session?.user;
  const callerId = user?.id == null ? '' : String(user.id);
  if (!callerId) {
    return {
      status: 401,
      body: { success: false, error: { code: 'UNAUTHENTICATED', message: PLATFORM_ADMIN_REFUSAL_MESSAGES[401] } },
    };
  }

  const reading = await readJsonRequestBody(request);
  if (!reading.ok) return invalid(reading.message);
  const raw = (reading.body as Record<string, unknown> | null | undefined)?.[SYS_SESSION_REVOKE_ID_PARAM];
  if (typeof raw !== 'string' || raw.length === 0) return invalid(`${SYS_SESSION_REVOKE_ID_PARAM} is required`);

  const target = await deps.findLiveSession(raw);
  if (!target) return notFound();

  if (target.userId === callerId) return revokeAsOwner(deps, request, target);

  // Another user's session: platform administrators only. Every other caller
  // reads the not-found answer above, whatever the id names.
  if (!isPlatformAdminUser(user)) return notFound();
  const verdict = judgePlatformAdmin(session);
  if (!verdict.ok) return { status: verdict.refusal.status, body: verdict.refusal.body };

  if (!(await deps.tombstoneSession(target.id, ADMIN_SESSION_REVOKE_REASON))) return notFound();
  return revoked(target.id);
}
