// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pending, SSO-only users on a cloud-managed environment — the add door, the
 * CSV / JSON import door, the pending marker and the host seam.
 *
 * ## Why this door exists
 *
 * On a cloud-managed environment (`isCloudManaged()`, `cloud-managed.ts`) the
 * people who use it sign in through the hosting organisation's identity
 * provider, and the environment keeps its own authorization: positions,
 * permission sets, the manager line. The password-capable doors
 * (`admin/create-user`, `admin/import-users`) answer `409` there, and on a Free
 * or Team kernel the better-auth admin plugin they build on is not even
 * mounted. Until a person had signed in once there was no row to point a seed,
 * an approval rule or a manager link at.
 *
 * This module adds a person BEFORE their first sign-in, as a **pending** row:
 *
 *  - `sys_user.source = 'idp_pending'` ({@link PENDING_SSO_SOURCE}) — its own
 *    value, never `env_native`, so no rule that admits a local account admits
 *    it; no `sys_account` (no password, no link); `email_verified: false`;
 *  - the positions, permission sets and manager the administrator chose,
 *    written under the administrator's own execution context, so the security
 *    service judges each grant exactly as Setup's grant forms are judged;
 *  - the organization membership the create-user door gives (ADR-0093 D3).
 *
 * The door does not depend on the better-auth admin plugin: the row is written
 * through the data engine, as the system, attributed to the administrator,
 * the way the AI service-account door writes its rows. That makes the row
 * born pending, in one insert: `source` is on the write that creates it, so
 * no moment exists where the row reads `env_native` (which
 * `set-user-password` admits). The engine's `sys_user` hooks judge the insert
 * as they judge any user row. better-auth's `internalAdapter.createUser`
 * would not do here: it needs the endpoint context a vendor route opens, and
 * these routes are the platform's own mounts.
 *
 * ## How a pending row becomes a person
 *
 * The first sign-in through the platform identity provider binds to it. The
 * bind needs no code here: `implicit-account-linking.ts` rule 2 lets the
 * platform provider link to an unverified local row, and the federated branch
 * of `stampIdentitySource` (`auth-manager-database-hooks.ts`) then stamps
 * `idp_provisioned` on a row that holds no local password, which clears the
 * marker in the same request, before the session is created. An enterprise
 * provider registered in the environment is refused by rule 1 (the row is not
 * verified), so only the platform provider binds a pending row.
 *
 * ## What a pending row is refused
 *
 * Every door that would give it a local password answers `409
 * RESOURCE_CONFLICT` ({@link pendingSsoPasswordRefusal}): `admin/set-user-password`,
 * `set-initial-password`, `/reset-password` and `/phone-number/reset-password`.
 * A session is refused to it on every path but the platform sign-in
 * (`user-session-admission.ts`): until the bind it holds no sign-in of its own.
 *
 * ## The host seam
 *
 * A host (the cloud, on a hosted environment) is told when a person is added,
 * deactivated and reactivated, so it can forward an invitation or a removal
 * ({@link EnvironmentUserHost}). An add calls it after the person's unit of
 * work has committed, never inside it. A host that fails does not undo the
 * operation: the answer carries `host: { notified: false, reason:
 * 'host_failed' }` and the plugin logs it once, so the caller is told (a
 * failure handed to the caller, AGENTS.md degradation rule). A host's typed
 * refusal (the developer member cap, `403
 * DEVELOPER_ORGANIZATION_MEMBER_LIMIT_REACHED`) is different: that person is
 * taken back out (grants, membership, row) and their add fails with the
 * host's answer, alone, on its own import row. Adding a person who is still
 * pending again re-fires the seam, which is the retry; a refusal of a re-add
 * fails that request and leaves the existing pending row as it was. The event
 * carries the administrator's cloud user id from their linked
 * `objectstack-cloud` account, never from the request. With no host wired
 * nothing is called.
 *
 * The sentences an administrator reads are collected in
 * {@link PENDING_SSO_MESSAGES} so the wording can move in one place.
 */

import { parseCsvToRows } from '@objectstack/rest';
import { resolveThrownHttpError, validationFailureDetails } from '@objectstack/types';
import {
  bindUserToSoleOrganization,
  CreationRefused,
  isLikelyEmail,
  joinCurrentOrganization,
  multiOrgCreationJoinsCurrentOrganization,
  writeAdminAudit,
  type AdminActor,
  type AdminCreateGrantSeam,
  type AdminUserEndpointDeps,
  type EndpointResult,
} from './admin-user-endpoints.js';
import { applyUserManagerLink, type SetUserManagerEngine } from './admin-set-user-manager.js';
import type { AddMemberCapableApi } from './organization-add-member.js';
import { readJsonRequestBody } from './request-json-body.js';
import { authSystemWriteContext } from './auth-actor-attribution.js';
import {
  isPendingSsoSource,
  PENDING_SSO_MESSAGES,
  PENDING_SSO_REFUSAL_CODE,
  PENDING_SSO_REFUSAL_STATUS,
  PENDING_SSO_SOURCE,
} from './pending-sso-marker.js';
import {
  notifyEnvironmentUserHost,
  readActorCloudUserId,
  type EnvironmentUserEvent,
  type EnvironmentUserHostAccessor,
  type EnvironmentUserHostOutcome,
  type EnvironmentUserHostRefused,
} from './environment-user-host.js';

/** The most rows one import request may carry, the identity import's own bound. */
export const IMPORT_SSO_USERS_MAX_ROWS = 500;

// ─────────────────────────────────────────────────────────────────────────────
// The doors
// ─────────────────────────────────────────────────────────────────────────────

/** The data engine slice the doors use. */
export interface PendingSsoUserEngine extends SetUserManagerEngine {
  insert(object: string, doc: Record<string, unknown>, opts?: unknown): Promise<unknown>;
  /** Takes a person back out when the host refuses them. */
  delete?(object: string, opts?: unknown): Promise<unknown>;
  getSchema?(objectName: string): unknown;
}

/** What the doors need from the plugin. */
export interface PendingSsoUserDeps
  extends Pick<AdminUserEndpointDeps, 'getTenancy' | 'getMembershipPolicy' | 'getCallerActiveOrganizationId'> {
  /** Whether this process is a cloud-managed environment (`isCloudManaged()`), read per call. */
  isCloudManaged(): boolean;
  getDataEngine(): PendingSsoUserEngine | undefined;
  /** The caller's execution context and one engine transaction (create-user's seam). */
  createGrant?: AdminCreateGrantSeam;
  /** better-auth's `addMember`, for the multi-organization join; absent when the organization plugin is off. */
  getAddMember?(): Promise<AddMemberCapableApi['addMember'] | undefined>;
  host?: EnvironmentUserHostAccessor;
  logger?: { warn(msg: string): void };
}

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

const fail = (status: number, code: string, message: string): EndpointResult => ({
  status,
  body: { success: false, error: { code, message } },
});

const badRequest = (message: string): EndpointResult => fail(400, 'INVALID_REQUEST', message);

/** One person, as either door reads them. */
interface PendingPersonInput {
  email: string;
  name: string;
  positions: string[];
  permissionSets: string[];
  /** The manager's email address, or undefined for none. */
  manager?: string;
}

/** The manager outcome a row reports: linked, not found, or the set-user-manager refusal reason. */
type ManagerOutcome = 'linked' | 'unresolved' | string;

/** One person's outcome. */
type AddOutcome =
  | {
      ok: true;
      userId: string;
      alreadyPending: boolean;
      organizationId?: string | null;
      manager?: ManagerOutcome;
      managerError?: string;
      host: EnvironmentUserHostOutcome;
    }
  | { ok: false; result: EndpointResult };

const ADD_KEYS = new Set(['email', 'name', 'positions', 'permissionSets', 'manager']);

/** A list cell: an array of names, or one `;`-separated string. Empty entries are dropped. */
function readNameList(raw: unknown, label: string): string[] | string {
  if (raw === undefined || raw === null || raw === '') return [];
  const parts = typeof raw === 'string' ? raw.split(';') : Array.isArray(raw) ? raw : undefined;
  if (!parts) return `${label} must be a list of machine names`;
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part !== 'string') return `${label} must be a list of machine names`;
    const name = part.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Read one person from the add body or an import row. A string answer is the refusal sentence. */
function readPerson(
  raw: Record<string, unknown>,
  keys: { positions: string; permissionSets: string; manager: string },
): PendingPersonInput | string {
  const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
  if (!email || !isLikelyEmail(email)) return 'email must be an email address';
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : email.split('@')[0]!;
  const positions = readNameList(raw[keys.positions], keys.positions);
  if (typeof positions === 'string') return positions;
  const permissionSets = readNameList(raw[keys.permissionSets], keys.permissionSets);
  if (typeof permissionSets === 'string') return permissionSets;
  const rawManager = raw[keys.manager];
  let manager: string | undefined;
  if (rawManager !== undefined && rawManager !== null && rawManager !== '') {
    if (typeof rawManager !== 'string' || !isLikelyEmail(rawManager.trim())) {
      return `${keys.manager} must be the manager's email address`;
    }
    manager = rawManager.trim().toLowerCase();
  }
  return { email, name, positions, permissionSets, ...(manager ? { manager } : {}) };
}

async function findUserByEmail(
  engine: PendingSsoUserEngine,
  email: string,
): Promise<{ id: string; name?: string; source?: string | null } | undefined> {
  const rows = await engine.find('sys_user', {
    where: { email },
    fields: ['id', 'name', 'source'],
    limit: 1,
    context: SYSTEM_CTX,
  });
  const row = Array.isArray(rows) ? (rows[0] as { id?: unknown; name?: unknown; source?: unknown } | undefined) : undefined;
  return row && typeof row.id === 'string'
    ? { id: row.id, name: typeof row.name === 'string' ? row.name : undefined, source: typeof row.source === 'string' ? row.source : null }
    : undefined;
}

/** The answer for a grant the security service refused: its own status and code, and that no one was added. */
function grantRefused(what: string, error: unknown): EndpointResult {
  const thrown = resolveThrownHttpError(error, 500);
  const validation = validationFailureDetails(error);
  return {
    status: thrown.status,
    body: {
      success: false,
      error: {
        code: thrown.code,
        message: `The ${what} was not assigned, so no one was added. ${thrown.message}`,
        ...(validation ? { fields: validation.fields } : {}),
      },
    },
  };
}

/**
 * What one request settles before any person is written: the caller's context
 * for the grants, and the organization a multi-organization deployment joins.
 */
interface RequestSettlement {
  /** The administrator's cloud user id, read once when a host is wired. */
  actorCloudUserId?: string;
  grant?: { seam: AdminCreateGrantSeam; engine: PendingSsoUserEngine; context: Record<string, unknown> };
  join?: { addMember: AddMemberCapableApi['addMember']; organizationId: string };
}

async function settleRequest(
  deps: PendingSsoUserDeps,
  actor: AdminActor,
  needsGrant: boolean,
): Promise<RequestSettlement | EndpointResult> {
  const settlement: RequestSettlement = {};
  if (deps.host) {
    const actorCloudUserId = await readActorCloudUserId(deps.getDataEngine(), actor.id, deps.logger);
    if (actorCloudUserId) settlement.actorCloudUserId = actorCloudUserId;
  }
  if (multiOrgCreationJoinsCurrentOrganization(deps)) {
    const organizationId = await deps.getCallerActiveOrganizationId!();
    if (typeof organizationId !== 'string' || organizationId.length === 0) {
      return fail(
        400,
        'NO_ACTIVE_ORGANIZATION',
        'You are not working in an organization, so no one was added. Switch to the organization the person '
          + 'belongs to, then add them there.',
      );
    }
    const addMember = await deps.getAddMember?.();
    if (!deps.createGrant || typeof addMember !== 'function') {
      return fail(
        501,
        'NOT_IMPLEMENTED',
        'This server cannot add a person to your organization while adding them, so no one was added.',
      );
    }
    settlement.join = { addMember, organizationId };
  }
  if (needsGrant) {
    const seam = deps.createGrant;
    const engine = deps.getDataEngine();
    if (!seam || !engine) {
      return fail(
        501,
        'NOT_IMPLEMENTED',
        'This server cannot assign positions or permission sets while adding a person, so no one was added. '
          + 'Add the person without them, then grant them on their record.',
      );
    }
    const context = await seam.resolveActorContext();
    if (!context) {
      return fail(
        403,
        'PERMISSION_DENIED',
        'Your own access could not be resolved, so the positions and permission sets could not be judged and no '
          + 'one was added.',
      );
    }
    settlement.grant = { seam, engine, context };
  }
  return settlement;
}

/**
 * Add one person. Answers `alreadyPending` (and re-tells the host) for an
 * address that is still pending, and a `409` for any other existing address.
 * The account, its membership and its grants are one unit of work.
 */
async function addOnePendingPerson(
  deps: PendingSsoUserDeps,
  actor: AdminActor,
  person: PendingPersonInput,
  settlement: RequestSettlement,
): Promise<AddOutcome> {
  const engine = deps.getDataEngine();
  if (!engine) return { ok: false, result: fail(503, 'SERVICE_UNAVAILABLE', 'Data engine unavailable, so no one was added.') };

  const existing = await findUserByEmail(engine, person.email);
  if (existing) {
    if (!isPendingSsoSource(existing.source)) {
      return { ok: false, result: fail(PENDING_SSO_REFUSAL_STATUS, PENDING_SSO_REFUSAL_CODE, PENDING_SSO_MESSAGES.alreadyExists) };
    }
    const host = await notifyEnvironmentUserHost(
      deps.host,
      'added',
      eventFor(existing.id, person.email, existing.name ?? person.name, actor, settlement),
      deps.logger,
    );
    // A refused re-add leaves the existing pending row as it was: this request did not write it.
    if ('refused' in host) return { ok: false, result: hostRefusal(host) };
    return { ok: true, userId: existing.id, alreadyPending: true, host };
  }

  const work = async (): Promise<{ userId: string; organizationId: string | null }> => {
    const inserted: unknown = await engine.insert(
      'sys_user',
      { email: person.email, name: person.name, email_verified: false, source: PENDING_SSO_SOURCE },
      { context: await authSystemWriteContext() },
    );
    const insertedRow = (Array.isArray(inserted) ? inserted[0] : inserted) as { id?: unknown } | undefined;
    const userId = typeof insertedRow?.id === 'string' ? insertedRow.id : '';
    if (!userId) throw new CreationRefused(fail(500, 'INTERNAL_ERROR', 'The user row was written without an id, so no one was added.'));

    const membership = settlement.join
      ? await joinCurrentOrganization(deps, settlement.join.addMember, userId, settlement.join.organizationId)
      : await bindUserToSoleOrganization(deps, userId);

    if (settlement.grant) {
      const { engine: grantEngine, context } = settlement.grant;
      for (const position of person.positions) {
        try {
          await grantEngine.insert('sys_user_position', { user_id: userId, position }, { context });
        } catch (error) {
          throw new CreationRefused(grantRefused(`position ${position}`, error));
        }
      }
      for (const permissionSet of person.permissionSets) {
        try {
          await grantEngine.insert('sys_user_permission_set', { user_id: userId, permission_set: permissionSet }, { context });
        } catch (error) {
          throw new CreationRefused(grantRefused(`permission set ${permissionSet}`, error));
        }
      }
    }
    return { userId, organizationId: membership.organizationId };
  };

  let written: { userId: string; organizationId: string | null };
  try {
    const unit = settlement.grant?.seam ?? (settlement.join ? deps.createGrant : undefined);
    written = unit ? await unit.runAtomically(work) : await work();
  } catch (error) {
    if (error instanceof CreationRefused) return { ok: false, result: error.result };
    throw error;
  }

  // The host, outside the unit of work. A typed refusal takes this person back out.
  const host = await notifyEnvironmentUserHost(
    deps.host,
    'added',
    eventFor(written.userId, person.email, person.name, actor, settlement),
    deps.logger,
  );
  if ('refused' in host) {
    await takeBackPerson(deps, engine, written.userId, settlement);
    return { ok: false, result: hostRefusal(host) };
  }

  await writeAdminAudit(deps, {
    action: 'create',
    actor,
    recordId: written.userId,
    metadata: {
      event: 'user.admin_added_pending',
      membershipCreated: written.organizationId !== null,
      ...(written.organizationId ? { organizationId: written.organizationId } : {}),
    },
  });
  return { ok: true, userId: written.userId, alreadyPending: false, organizationId: written.organizationId, host };
}

function eventFor(
  userId: string,
  email: string,
  name: string,
  actor: AdminActor,
  settlement: RequestSettlement,
): EnvironmentUserEvent {
  return {
    userId,
    email,
    name,
    source: PENDING_SSO_SOURCE,
    actorId: actor.id,
    ...(settlement.actorCloudUserId ? { actorCloudUserId: settlement.actorCloudUserId } : {}),
    occurredAt: new Date().toISOString(),
  };
}

/** The add's answer for a host's typed refusal: its status, code and sentence. */
const hostRefusal = ({ refused }: EnvironmentUserHostRefused): EndpointResult =>
  fail(refused.status, refused.code, refused.message);

/** The rows an add wrote for one person, children first, the person last. */
const TAKE_BACK_OBJECTS = ['sys_user_position', 'sys_user_permission_set', 'sys_member'] as const;

/**
 * Take a person the host refused back out: their grants, their membership
 * and their row, as the system, in one unit of work. The person was never
 * told anything and never signed in, so nothing else points at them. A
 * failure here is thrown: the person would stay without the host's consent,
 * and the caller must hear that rather than a clean refusal.
 */
async function takeBackPerson(
  deps: PendingSsoUserDeps,
  engine: PendingSsoUserEngine,
  userId: string,
  settlement: RequestSettlement,
): Promise<void> {
  if (typeof engine.delete !== 'function') {
    throw new Error(`The host refused user ${userId}, and this data engine cannot take the row back out`);
  }
  const remove = engine.delete.bind(engine);
  const work = async (): Promise<void> => {
    const context = await authSystemWriteContext();
    for (const object of TAKE_BACK_OBJECTS) {
      await remove(object, { where: { user_id: userId }, multi: true, context });
    }
    await remove('sys_user', { where: { id: userId }, context });
  };
  const unit = settlement.grant?.seam ?? deps.createGrant;
  await (unit ? unit.runAtomically(work) : work());
}

/**
 * Link `userId` to the manager named by email, by the set-user-manager
 * derivation (imported, never copied). Never undoes the person.
 */
async function linkManager(
  deps: PendingSsoUserDeps,
  userId: string,
  managerEmail: string,
): Promise<{ manager: ManagerOutcome; managerError?: string }> {
  const engine = deps.getDataEngine();
  const managerRow = engine ? await findUserByEmail(engine, managerEmail) : undefined;
  if (!managerRow) {
    return {
      manager: 'unresolved',
      managerError: 'No user in this environment has the manager email address, so no manager was set.',
    };
  }
  const refusal = await applyUserManagerLink({ getDataEngine: () => engine, logger: deps.logger as never }, userId, managerRow.id);
  if (refusal) return { manager: refusal.reason, managerError: refusal.message };
  return { manager: 'linked' };
}

/** `POST /api/v1/auth/admin/add-sso-user` — the caller already passed the platform-admin gate. */
export async function runAddSsoUser(
  deps: PendingSsoUserDeps,
  actor: AdminActor,
  request: Request,
): Promise<EndpointResult> {
  if (!deps.isCloudManaged()) return fail(PENDING_SSO_REFUSAL_STATUS, PENDING_SSO_REFUSAL_CODE, PENDING_SSO_MESSAGES.notManaged);
  const reading = await readJsonRequestBody(request);
  if (!reading.ok) return badRequest(reading.message);
  const body = (reading.body && typeof reading.body === 'object' ? reading.body : {}) as Record<string, unknown>;
  const unknown = Object.keys(body).filter((key) => !ADD_KEYS.has(key));
  if (unknown.length > 0) {
    return badRequest(`Unknown field(s): ${unknown.join(', ')}. This door takes email, name, positions, permissionSets and manager; it sets no password.`);
  }
  const person = readPerson(body, { positions: 'positions', permissionSets: 'permissionSets', manager: 'manager' });
  if (typeof person === 'string') return badRequest(person);

  const settlement = await settleRequest(deps, actor, person.positions.length + person.permissionSets.length > 0);
  if ('status' in settlement) return settlement;
  const outcome = await addOnePendingPerson(deps, actor, person, settlement);
  if (!outcome.ok) return outcome.result;
  const manager = person.manager && !outcome.alreadyPending ? await linkManager(deps, outcome.userId, person.manager) : undefined;

  return {
    status: outcome.alreadyPending ? 200 : 201,
    body: {
      success: true,
      data: {
        userId: outcome.userId,
        email: person.email,
        source: PENDING_SSO_SOURCE,
        alreadyPending: outcome.alreadyPending,
        ...(outcome.alreadyPending ? {} : { positions: person.positions, permissionSets: person.permissionSets }),
        ...(outcome.organizationId ? { organizationId: outcome.organizationId } : {}),
        ...(manager ? manager : {}),
        host: outcome.host,
      },
    },
  };
}

const IMPORT_BODY_KEYS = new Set(['csv', 'rows']);
const IMPORT_COLUMNS = new Set(['email', 'name', 'positions', 'permission_sets', 'manager_id']);

/** One row's answer in the import report. */
export interface ImportSsoUserRowResult {
  /** 1-based data row number (the CSV header is row 0). */
  row: number;
  email?: string;
  ok: boolean;
  userId?: string;
  alreadyPending?: boolean;
  error?: { code: string; message: string };
  manager?: ManagerOutcome;
  managerError?: string;
  host?: EnvironmentUserHostOutcome;
}

/**
 * `POST /api/v1/auth/admin/import-sso-users` — `{ csv }` (a header row, then
 * one person per line) or `{ rows }` (JSON objects), columns `email`, `name`,
 * `positions` and `permission_sets` (`;`-separated machine names) and
 * `manager_id` (the manager's email address). Every row is judged and written
 * on its own: a bad row fails alone with its sentence and the good rows land.
 * Manager links run in a second pass, so a manager added later in the same
 * file is found.
 */
export async function runImportSsoUsers(
  deps: PendingSsoUserDeps,
  actor: AdminActor,
  request: Request,
): Promise<EndpointResult> {
  if (!deps.isCloudManaged()) return fail(PENDING_SSO_REFUSAL_STATUS, PENDING_SSO_REFUSAL_CODE, PENDING_SSO_MESSAGES.notManaged);
  const reading = await readJsonRequestBody(request);
  if (!reading.ok) return badRequest(reading.message);
  const body = (reading.body && typeof reading.body === 'object' ? reading.body : {}) as Record<string, unknown>;
  const unknownKeys = Object.keys(body).filter((key) => !IMPORT_BODY_KEYS.has(key));
  if (unknownKeys.length > 0) return badRequest(`Unknown field(s): ${unknownKeys.join(', ')}. Send { csv } or { rows }.`);

  let rows: Array<Record<string, unknown>>;
  if (typeof body.csv === 'string' && body.rows === undefined) {
    rows = parseCsvToRows(body.csv);
  } else if (Array.isArray(body.rows) && body.csv === undefined) {
    if (!body.rows.every((r) => r && typeof r === 'object' && !Array.isArray(r))) return badRequest('rows must be objects');
    rows = body.rows as Array<Record<string, unknown>>;
  } else {
    return badRequest('Send exactly one of csv (text with a header row) or rows (an array of objects).');
  }
  if (rows.length === 0) return badRequest('The import holds no rows.');
  if (rows.length > IMPORT_SSO_USERS_MAX_ROWS) {
    return badRequest(`The import holds ${rows.length} rows; split it into batches of at most ${IMPORT_SSO_USERS_MAX_ROWS}.`);
  }
  const unknownColumns = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((key) => !IMPORT_COLUMNS.has(key));
  if (unknownColumns.length > 0) {
    return badRequest(
      `Unknown column(s): ${unknownColumns.join(', ')}. The columns are email, name, positions, permission_sets and `
        + 'manager_id; this import sets no password.',
    );
  }

  const people = rows.map((r) => readPerson(r, { positions: 'positions', permissionSets: 'permission_sets', manager: 'manager_id' }));
  const needsGrant = people.some((p) => typeof p !== 'string' && p.positions.length + p.permissionSets.length > 0);
  const settlement = await settleRequest(deps, actor, needsGrant);
  if ('status' in settlement) return settlement;

  const results: ImportSsoUserRowResult[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < people.length; i++) {
    const person = people[i]!;
    const row = i + 1;
    if (typeof person === 'string') {
      results.push({ row, ok: false, error: { code: 'INVALID_REQUEST', message: person } });
      continue;
    }
    if (seen.has(person.email)) {
      results.push({
        row,
        email: person.email,
        ok: false,
        error: { code: PENDING_SSO_REFUSAL_CODE, message: 'This email address appears on an earlier row of the same import; this row was not added.' },
      });
      continue;
    }
    seen.add(person.email);
    let outcome: AddOutcome;
    try {
      outcome = await addOnePendingPerson(deps, actor, person, settlement);
    } catch (error) {
      const thrown = resolveThrownHttpError(error, 500);
      results.push({ row, email: person.email, ok: false, error: { code: thrown.code, message: `This row was not added. ${thrown.message}` } });
      continue;
    }
    if (!outcome.ok) {
      const err = outcome.result.body.error;
      results.push({ row, email: person.email, ok: false, error: { code: err?.code ?? 'INTERNAL_ERROR', message: err?.message ?? 'not added' } });
      continue;
    }
    results.push({ row, email: person.email, ok: true, userId: outcome.userId, alreadyPending: outcome.alreadyPending, host: outcome.host });
  }

  // Second pass: the manager links, now that every row of the file exists.
  for (let i = 0; i < people.length; i++) {
    const person = people[i]!;
    const result = results[i]!;
    if (typeof person === 'string' || !result.ok || result.alreadyPending || !person.manager || !result.userId) continue;
    Object.assign(result, await linkManager(deps, result.userId, person.manager));
  }

  const added = results.filter((r) => r.ok && !r.alreadyPending).length;
  const alreadyPending = results.filter((r) => r.ok && r.alreadyPending).length;
  return {
    status: 200,
    body: {
      success: true,
      data: {
        summary: { total: results.length, added, alreadyPending, failed: results.filter((r) => !r.ok).length },
        rows: results as unknown as Record<string, unknown>[],
      } as Record<string, unknown>,
    },
  };
}
