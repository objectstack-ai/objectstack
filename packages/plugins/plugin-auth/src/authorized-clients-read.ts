// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30918] The AI assistants a person has authorized, and when each was last
 * used: one read for the person themself, one for a platform administrator.
 *
 *   GET /api/v1/auth/authorized-clients                   — the caller's own
 *   GET /api/v1/auth/admin/authorized-clients?userId=ID   — another person's
 *
 * "An AI assistant the person authorized" is an OAuth consent: a
 * `sys_oauth_consent` row the person's own decision on the consent page wrote
 * (Claude Desktop, an IDE agent, any MCP client). The consent page tells the
 * person they can withdraw it at any time; these reads are how they, and an
 * administrator responsible for them, see what can act as them. Before them
 * the only read was better-auth's own `GET /oauth2/get-consents`: unledgered,
 * capped at the adapter's default 100 rows without saying so, keyed to the
 * session and blind to a `userId` parameter (it answers the caller's own rows
 * whatever the parameter says), with no name and no last use.
 *
 * ## The own read: keyed by the session's subject, and by nothing else
 *
 * The rows are the session user's. The query set is CLOSED and EMPTY, so a
 * request that names anybody, `?userId=` or any other spelling, is refused
 * `400 VALIDATION_ERROR` naming the parameter rather than answered as if it
 * had not been sent: an ignored selector reads exactly like an honoured one,
 * which is the failure mode `get-consents` has. A GET carries no body.
 *
 * ## The admin read: a separate door, and never a wider one
 *
 * Gated by the ADR-0068 D2 platform-admin judge every ObjectStack `/admin/*`
 * mount calls (`gateAdmin` in `auth-plugin.ts`, the judge in
 * `platform-admin-gate.ts`), with a held session refused per ADR-0069 D3. That
 * is the platform's rule for one person acting on another's sessions:
 * `sys-session/revoke` admits a platform administrator on another user's
 * session and nobody else, and better-auth's `/admin/list-user-sessions` is
 * refused to every ObjectStack platform administrator by design until a
 * consumer re-mounts it on this same gate. An organization owner or admin
 * who is not a platform administrator is refused here, as they are at every
 * session door. The gate runs before the query is read, so a caller outside
 * that reach gets one refusal, whoever the `userId` names and whether or not
 * that person exists: `401` with no session, `403` otherwise.
 *
 * Per organization. A consent binds the organization the person had active
 * when they granted it (`reference_id`), so every row says which organization
 * it belongs to (`organizationId`, `null` for a grant made with none active).
 * A platform administrator's standing is not bounded to an organization: it
 * crosses the tenant wall on better-auth-managed objects (ADR-0095 D1), so
 * the admin read lists the person's grants in every organization.
 *
 * Read only. Withdrawing a grant is `authorized-clients-withdraw.ts`, keyed
 * by the row's `id`: `POST /authorized-clients/withdraw` for the person's own,
 * `POST /admin/authorized-clients/withdraw` behind this read's admin gate.
 *
 * ## The answer
 *
 * `200 { success: true, data: { clients, truncated } }`, `Cache-Control:
 * no-store`, newest grant first. Each row carries exactly:
 *
 *  - `id` — the consent's own id, the key the withdraw door takes;
 *  - `clientId`, `name` — the OAuth client and its display name (`null` when
 *    the client declares none);
 *  - `scopes` — what the person granted;
 *  - `organizationId` — the organization the grant is held in;
 *  - `authorizedAt` — when the grant was made (ISO 8601), `null` for a row
 *    that carries no readable grant time (a consent older than the provider
 *    that writes one);
 *  - `lastUsedAt` — the start of the most recent hour the client made a
 *    verified MCP call under this grant, or `null`: no call has been recorded
 *    (`mcp-client-last-use.ts`).
 *
 * Nothing that identifies or reconstructs a token: no access-token, refresh
 * token or authorization-code value or id, no client secret, no session. The
 * client row is read for its `client_id` and `name` columns only.
 *
 * At most {@link AUTHORIZED_CLIENTS_READ_CAP} rows. One more is read, so a
 * person holding more grants than that is answered `truncated: true` rather
 * than a list that silently stops.
 *
 * ## Refusals (ADR-0112: code AND status)
 *
 *  - no session: `401 UNAUTHENTICATED`, before anything else is read;
 *  - a held session: `403` with the posture's own code (both doors);
 *  - the admin door, a caller who is not a platform administrator:
 *    `403 PERMISSION_DENIED`;
 *  - an unknown query parameter (any, on the own read): `400 VALIDATION_ERROR`;
 *  - the admin door, `userId` missing, empty or repeated: `400 VALIDATION_ERROR`;
 *  - the admin door, a `userId` that names no user: `404 RESOURCE_NOT_FOUND`.
 */

import { repeatedQueryParamMessage, unknownQueryParamRefusalMessage } from '@objectstack/rest';
import type { AuthSessionApi } from '@objectstack/spec/contracts';
import { inProcessSessionReadInput } from '@objectstack/types';
import type { PlatformAdminActor } from './platform-admin-gate.js';
import { judgeHeldSession, PLATFORM_ADMIN_REFUSAL_MESSAGES } from './platform-admin-gate.js';

/** The own read, relative to the auth base path. */
export const AUTHORIZED_CLIENTS_PATH = '/authorized-clients';

/** The admin read, relative to the auth base path. */
export const ADMIN_AUTHORIZED_CLIENTS_PATH = '/admin/authorized-clients';

/** The own read's CLOSED query set: empty — the rows are the session's. */
export const AUTHORIZED_CLIENTS_QUERY_PARAMS: readonly string[] = Object.freeze([]);

/** The admin read's one parameter: the person whose grants are read. */
export const ADMIN_AUTHORIZED_CLIENTS_USER_PARAM = 'userId';

/** The admin read's CLOSED query set. */
export const ADMIN_AUTHORIZED_CLIENTS_QUERY_PARAMS: readonly string[] = Object.freeze([
  ADMIN_AUTHORIZED_CLIENTS_USER_PARAM,
]);

/** The most rows either read answers. */
export const AUTHORIZED_CLIENTS_READ_CAP = 200;

/** The admin read's not-found message, for a `userId` that names no user. */
export const ADMIN_AUTHORIZED_CLIENTS_USER_NOT_FOUND_MESSAGE = 'No user matches the supplied userId.';

/** One authorized client, as both reads answer it. */
export interface AuthorizedClient {
  /** The consent's id: the key `POST /authorized-clients/withdraw` takes. */
  id: string;
  clientId: string;
  /** The client's display name, `null` when it declares none. */
  name: string | null;
  scopes: string[];
  /** The organization the grant is held in, `null` when none was active at the grant. */
  organizationId: string | null;
  /** When the grant was made, ISO 8601; `null` when the row carries no readable time. */
  authorizedAt: string | null;
  /** Start of the most recent hour with a verified MCP call, ISO 8601; `null` = none recorded. */
  lastUsedAt: string | null;
}

export interface AuthorizedClientsData {
  clients: AuthorizedClient[];
  /** `true` when the person holds more than {@link AUTHORIZED_CLIENTS_READ_CAP} grants. */
  truncated: boolean;
}

export interface AuthorizedClientsResult {
  status: 200 | 400 | 401 | 403 | 404;
  body:
    | { success: true; data: AuthorizedClientsData }
    | { success: false; error: { code: string; message: string } };
  headers: Record<string, string>;
}

/** What the in-process session read answers, as `AuthSessionApi` declares it. */
type SessionRead = Awaited<ReturnType<NonNullable<AuthSessionApi['getSession']>>>;

/** A consent row, as the read decodes it. */
export interface ConsentRecord {
  id: string;
  clientId: string;
  referenceId: string | null;
  scopes: string[];
  createdAt: Date | null;
  /** The stored last-use stamp, `null` when none has been written. */
  lastUsedAt: Date | null;
}

/** The seams the reads use. {@link authorizedClientsDepsFor} wires the real ones. */
export interface AuthorizedClientsDeps {
  /** The caller's session, `customSession`-decorated (`authGate`). */
  readCallerSession(headers: Headers): Promise<SessionRead | null>;
  /** `userId`'s consents, newest first, at most `limit`. */
  listConsents(userId: string, limit: number): Promise<ConsentRecord[]>;
  /** `client_id` → display name, for the ids given. */
  clientNames(clientIds: readonly string[]): Promise<Map<string, string | null>>;
  /** Does a user with this id exist? */
  userExists(userId: string): Promise<boolean>;
}

/** The slice of `AuthManager` the real seams are built from. */
export interface AuthorizedClientsManager {
  getApi(): Promise<unknown>;
  getDataEngine(): unknown;
}

const SYSTEM_READ = { context: { isSystem: true, positions: [], permissions: [] } } as const;

const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

interface ReadEngine {
  find(object: string, query: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

const asRows = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];

const toDate = (value: unknown): Date | null => {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * A consent's granted scopes. The provider's storage adapter writes the list
 * as JSON text (`supportsArrays: false` in `objectql-adapter.ts`, so
 * better-auth's adapter factory serializes a `string[]` field), and a driver
 * that keeps arrays hands the array back as is. The provider writes every
 * consent with a scope list, so a row whose list does not decode is refused
 * loudly rather than answered as a grant of nothing.
 */
function scopesOf(row: Record<string, unknown>): string[] {
  let value: unknown = row.scopes;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      value = undefined;
    }
  }
  if (Array.isArray(value) && value.every((scope) => typeof scope === 'string')) return value as string[];
  throw new Error(`The scopes of consent ${String(row.id)} could not be read.`);
}

/**
 * The real seams: narrow engine reads under a system context, named columns
 * only, so no secret column is ever loaded. The consent read takes an
 * explicit limit (better-auth's own `get-consents` takes its adapter's
 * default of 100 and says nothing past it) and its own last-use column in the
 * same read. `sys_oauth_consent` is registered by plugin-auth's manifest
 * whether or not the provider is enabled, so the read never depends on the
 * provider's model being loaded.
 */
export function authorizedClientsDepsFor(manager: AuthorizedClientsManager): AuthorizedClientsDeps {
  const engine = (): ReadEngine => {
    const found = manager.getDataEngine() as ReadEngine | undefined;
    if (!found) throw new Error('The data engine is not available.');
    return found;
  };
  return {
    async readCallerSession(headers) {
      const api = (await manager.getApi()) as { getSession(input: unknown): Promise<SessionRead | null> };
      return api.getSession(inProcessSessionReadInput(headers));
    },
    async listConsents(userId, limit) {
      const rows = asRows(
        await engine().find(
          'sys_oauth_consent',
          {
            where: { user_id: userId },
            fields: ['id', 'client_id', 'reference_id', 'scopes', 'created_at', 'last_used_at'],
            orderBy: [
              { field: 'created_at', order: 'desc' },
              { field: 'id', order: 'asc' },
            ],
            limit,
          },
          SYSTEM_READ,
        ),
      );
      return rows.map((row) => ({
        id: String(row.id),
        clientId: String(row.client_id),
        referenceId: typeof row.reference_id === 'string' && row.reference_id ? row.reference_id : null,
        scopes: scopesOf(row),
        createdAt: toDate(row.created_at),
        lastUsedAt: toDate(row.last_used_at),
      }));
    },
    async clientNames(clientIds) {
      if (clientIds.length === 0) return new Map();
      const rows = asRows(
        await engine().find(
          'sys_oauth_application',
          { where: { client_id: { $in: [...clientIds] } }, fields: ['client_id', 'name'], limit: clientIds.length },
          SYSTEM_READ,
        ),
      );
      return new Map(
        rows.map((row) => [
          String(row.client_id),
          typeof row.name === 'string' && row.name.trim() ? row.name : null,
        ]),
      );
    },
    async userExists(userId) {
      const rows = asRows(
        await engine().find('sys_user', { where: { id: userId }, fields: ['id'], limit: 1 }, SYSTEM_READ),
      );
      return rows.length > 0;
    },
  };
}

const refusal = (
  status: 400 | 401 | 403 | 404,
  code: string,
  message: string,
): AuthorizedClientsResult => ({
  status,
  body: { success: false, error: { code, message } },
  headers: { ...NO_STORE },
});

/** Read `userId`'s grants into the answer both doors serve. */
async function readAuthorizedClients(
  deps: AuthorizedClientsDeps,
  userId: string,
): Promise<AuthorizedClientsResult> {
  const consents = await deps.listConsents(userId, AUTHORIZED_CLIENTS_READ_CAP + 1);
  const truncated = consents.length > AUTHORIZED_CLIENTS_READ_CAP;
  const shown = consents.slice(0, AUTHORIZED_CLIENTS_READ_CAP);
  const names = await deps.clientNames([...new Set(shown.map((row) => row.clientId))]);
  const clients: AuthorizedClient[] = shown.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    name: names.get(row.clientId) ?? null,
    scopes: row.scopes,
    organizationId: row.referenceId,
    authorizedAt: row.createdAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }));
  return { status: 200, body: { success: true, data: { clients, truncated } }, headers: { ...NO_STORE } };
}

/** `GET /authorized-clients` — the caller's own grants. See the module header. */
export async function runOwnAuthorizedClientsRead(
  deps: AuthorizedClientsDeps,
  request: { headers: Headers; queries: Record<string, readonly string[]> },
): Promise<AuthorizedClientsResult> {
  const session = await deps.readCallerSession(request.headers);
  const user = session?.user;
  const subject = user?.id == null ? '' : String(user.id);
  if (!subject) return refusal(401, 'UNAUTHENTICATED', PLATFORM_ADMIN_REFUSAL_MESSAGES[401]);

  const held = judgeHeldSession(user);
  if (held) return { status: held.status, body: held.body, headers: { ...NO_STORE } };

  const unknown = unknownQueryParamRefusalMessage(request.queries, AUTHORIZED_CLIENTS_QUERY_PARAMS);
  if (unknown !== undefined) return refusal(400, 'VALIDATION_ERROR', unknown);

  return readAuthorizedClients(deps, subject);
}

/**
 * `GET /admin/authorized-clients?userId=ID` — another person's grants, for a
 * caller the mount's platform-admin gate has already admitted (`actor`). See
 * the module header.
 */
export async function runAdminAuthorizedClientsRead(
  deps: AuthorizedClientsDeps,
  _actor: PlatformAdminActor,
  request: { queries: Record<string, readonly string[]> },
): Promise<AuthorizedClientsResult> {
  const unknown = unknownQueryParamRefusalMessage(request.queries, ADMIN_AUTHORIZED_CLIENTS_QUERY_PARAMS);
  if (unknown !== undefined) return refusal(400, 'VALIDATION_ERROR', unknown);
  const values = request.queries[ADMIN_AUTHORIZED_CLIENTS_USER_PARAM] ?? [];
  if (values.length > 1) {
    return refusal(400, 'VALIDATION_ERROR', repeatedQueryParamMessage(ADMIN_AUTHORIZED_CLIENTS_USER_PARAM, values.length));
  }
  const userId = (values[0] ?? '').trim();
  if (!userId) {
    return refusal(
      400,
      'VALIDATION_ERROR',
      `The "${ADMIN_AUTHORIZED_CLIENTS_USER_PARAM}" query parameter is required: the id of the person whose authorized clients are read.`,
    );
  }
  if (!(await deps.userExists(userId))) {
    return refusal(404, 'RESOURCE_NOT_FOUND', ADMIN_AUTHORIZED_CLIENTS_USER_NOT_FOUND_MESSAGE);
  }
  return readAuthorizedClients(deps, userId);
}
