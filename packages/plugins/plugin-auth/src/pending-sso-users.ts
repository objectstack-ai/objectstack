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
 * marker in the same request, before the session is created. Only the
 * platform provider's link clears the marker: the stamp leaves `idp_pending`
 * on a link from any other provider, so such a row is still refused a
 * session. A platform link whose stamp did not land is healed at the next
 * session (`user-session-admission.ts`).
 *
 * Adding a person who is still pending again re-tells the host and changes
 * nothing else: positions, permission sets or a manager sent with the re-add
 * are named on the answer as `notApplied` (set them on the record instead).
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
import { INTERNAL_ERROR_MESSAGE, resolveThrownHttpError, validationFailureDetails } from '@objectstack/types';
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
import { readNameList } from './name-list-cell.js';
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
  environmentUserAttribution,
  type EnvironmentUserActor,
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
  /** `error` receives, once, a membership failure answered with the generic message (`mapAuthApiError`). */
  logger?: { warn(msg: string): void; error?(message: string, error?: Error): void };
}

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

const fail = (status: number, code: string, message: string): EndpointResult => ({
  status,
  body: { success: false, error: { code, message } },
});

const badRequest = (message: string): EndpointResult => fail(400, 'INVALID_REQUEST', message);

/**
 * The one body key every door admits beyond its own: `organizationId`.
 *
 * A `type: 'api'` action forwarded to the auth mount carries the caller's
 * active organization as `body.organizationId` (`buildApiActionRequest`,
 * `@objectstack/runtime` `action-execution.ts`), so the console's Import
 * Users, Add User and any other action that reaches these doors arrives with
 * it. A door that refused the key refused every console call.
 *
 * The key is admitted only as a statement the session already makes: it must
 * equal the organization the caller is working in, read from the caller's
 * own session (`getCallerActiveOrganizationId`). Any other value, a value of
 * any other type, or a value sent by a caller working in no organization is
 * refused before anything is read or written. The value never feeds scope:
 * no door reads `body.organizationId` past this check, and the organization a
 * person joins is the session's, as it was before (seat ruling A on the card
 * that admitted the key).
 */
const STAMPED_ORGANIZATION_KEY = 'organizationId';

/** Body keys a door does not take: its own set, plus the stamped organization. */
const unknownBodyKeys = (body: Record<string, unknown>, keys: ReadonlySet<string>): string[] =>
  Object.keys(body).filter((key) => key !== STAMPED_ORGANIZATION_KEY && !keys.has(key));

/**
 * Refuse a `body.organizationId` that is not the caller's session
 * organization. `undefined` when the key is absent or equal; the refusal
 * otherwise, naming what was sent and what the session holds. `outcome` ends
 * the sentence ("no one was added", "no one was removed").
 */
async function refuseForeignOrganization(
  deps: PendingSsoUserDeps,
  body: Record<string, unknown>,
  outcome: string,
): Promise<EndpointResult | undefined> {
  if (!Object.prototype.hasOwnProperty.call(body, STAMPED_ORGANIZATION_KEY)) return undefined;
  const sent = body[STAMPED_ORGANIZATION_KEY];
  if (typeof sent !== 'string' || sent.length === 0) {
    return badRequest(`organizationId must be the id of the organization you are working in, so ${outcome}.`);
  }
  const current = deps.getCallerActiveOrganizationId ? await deps.getCallerActiveOrganizationId() : null;
  if (typeof current !== 'string' || current.length === 0) {
    return fail(
      400,
      'NO_ACTIVE_ORGANIZATION',
      `The request names organization ${sent}, but you are not working in an organization, so ${outcome}. `
        + 'Switch to that organization, then try again.',
    );
  }
  if (sent !== current) {
    return badRequest(
      `The request names organization ${sent}, but you are working in organization ${current}, so ${outcome}. `
        + 'Switch to that organization, or send the request from the one you are in.',
    );
  }
  return undefined;
}

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
const ADD_FIELD_NAMES = { positions: 'positions', permissionSets: 'permissionSets', manager: 'manager' } as const;
const IMPORT_FIELD_NAMES = { positions: 'positions', permissionSets: 'permission_sets', manager: 'manager_id' } as const;

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
): Promise<{ id: string; name?: string; source?: string | null; deactivated: boolean } | undefined> {
  const rows = await engine.find('sys_user', {
    where: { email },
    fields: ['id', 'name', 'source', 'banned'],
    limit: 1,
    context: SYSTEM_CTX,
  });
  const row = Array.isArray(rows)
    ? (rows[0] as { id?: unknown; name?: unknown; source?: unknown; banned?: unknown } | undefined)
    : undefined;
  return row && typeof row.id === 'string'
    ? {
        id: row.id,
        name: typeof row.name === 'string' ? row.name : undefined,
        source: typeof row.source === 'string' ? row.source : null,
        deactivated: isDeactivated(row),
      }
    : undefined;
}

/**
 * Whether a `sys_user` row is deactivated. A boolean column reads back as
 * `true`, `1`, or a string form (`'1'`, `'true'`) depending on the driver.
 */
const isDeactivated = (user: { banned?: unknown }): boolean =>
  user.banned === true || user.banned === 1 || user.banned === '1' || user.banned === 'true';

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
  /** The event's attribution (cloud id, impersonator), read once when a host is wired. */
  attribution?: Pick<EnvironmentUserEvent, 'actorId' | 'actorCloudUserId' | 'impersonatedBy'>;
  grant?: { seam: AdminCreateGrantSeam; engine: PendingSsoUserEngine; context: Record<string, unknown> };
  join?: { addMember: AddMemberCapableApi['addMember']; organizationId: string };
}

async function settleRequest(
  deps: PendingSsoUserDeps,
  actor: AdminActor & EnvironmentUserActor,
  needsGrant: boolean,
): Promise<RequestSettlement | EndpointResult> {
  const settlement: RequestSettlement = {};
  if (deps.host) settlement.attribution = await environmentUserAttribution(deps.getDataEngine(), actor, deps.logger);
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
    // A deactivated person is never sent an invitation: reactivating them
    // (`admin/unban-user`) is what sends it again.
    if (existing.deactivated) {
      return { ok: true, userId: existing.id, alreadyPending: true, host: { notified: false, reason: 'deactivated' } };
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

/**
 * What a re-add of a still-pending person did not apply: the add never
 * changes an existing person's grants or manager (set those on the record),
 * so each one sent is named on the answer rather than silently dropped.
 */
function notAppliedOn(person: PendingPersonInput, names: { positions: string; permissionSets: string; manager: string }): string[] {
  return [
    ...(person.positions.length > 0 ? [names.positions] : []),
    ...(person.permissionSets.length > 0 ? [names.permissionSets] : []),
    ...(person.manager ? [names.manager] : []),
  ];
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
    ...settlement.attribution,
    occurredAt: new Date().toISOString(),
  };
}

/** The add's answer for a host's typed refusal: its status, code and sentence. */
const hostRefusal = ({ refused }: EnvironmentUserHostRefused): EndpointResult =>
  fail(refused.status, refused.code, refused.message);

/** The rows an add wrote for one person, children first, the person last. */
const TAKE_BACK_OBJECTS = ['sys_user_position', 'sys_user_permission_set', 'sys_member'] as const;

/**
 * Take a pending person back out: their grants, their membership and their
 * row, as the system, in one unit of work, through the engine's delete, so a
 * record that points at the person follows its lookup's `deleteBehavior`.
 * Two callers: an add the host refused (the person was just written and
 * never told anything), and `admin/remove-sso-user`, which passes
 * `pendingOnly`. Then the person is re-checked inside the unit of work
 * before anything is deleted, and the row's delete carries
 * `source: 'idp_pending'` in its `where`: when it removes no row,
 * {@link NoLongerPending} is thrown and the unit of work rolls the child
 * deletes back. One window stays open: `sys_user` has cascading lookups, so
 * the engine reads the matching ids, walks the cascade and then deletes by
 * id alone, with no row lock, and a first sign-in committing between that
 * read and that delete is not yet refused (#34373, an engine defect). A
 * failure here is thrown: the caller must hear it rather than a clean
 * answer.
 */
async function takeBackPerson(
  deps: PendingSsoUserDeps,
  engine: PendingSsoUserEngine,
  userId: string,
  settlement: RequestSettlement,
  opts: { pendingOnly?: boolean } = {},
): Promise<void> {
  if (typeof engine.delete !== 'function') {
    throw new Error(`This data engine cannot delete, so user ${userId} could not be taken back out`);
  }
  const remove = engine.delete.bind(engine);
  const work = async (): Promise<void> => {
    if (opts.pendingOnly) await assertStillPending(engine, userId);
    const context = await authSystemWriteContext();
    for (const object of TAKE_BACK_OBJECTS) {
      await remove(object, { where: { user_id: userId }, multi: true, context });
    }
    if (!opts.pendingOnly) {
      await remove('sys_user', { where: { id: userId }, context });
      return;
    }
    const removed = await remove('sys_user', { where: { id: userId, source: PENDING_SSO_SOURCE }, multi: true, context });
    if (removed === 0 || removed === false || removed == null) throw new NoLongerPending();
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
  const unknown = unknownBodyKeys(body, ADD_KEYS);
  if (unknown.length > 0) {
    return badRequest(`Unknown field(s): ${unknown.join(', ')}. This door takes email, name, positions, permissionSets and manager; it sets no password.`);
  }
  const foreign = await refuseForeignOrganization(deps, body, 'no one was added');
  if (foreign) return foreign;
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
        // Present only on a re-add of a person still pending, so a reader
        // (the `add_sso_user` result dialog, which skips a field whose path
        // resolves to nothing) shows the fact exactly when it is true and
        // draws no `false` row on a fresh add. `alreadyPending` stays on
        // every answer for API readers.
        ...(outcome.alreadyPending ? { pendingAgain: true } : {}),
        ...(outcome.alreadyPending ? {} : { positions: person.positions, permissionSets: person.permissionSets }),
        ...(outcome.alreadyPending && notAppliedOn(person, ADD_FIELD_NAMES).length > 0
          ? { notApplied: notAppliedOn(person, ADD_FIELD_NAMES) }
          : {}),
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
  /** On a re-add of a still-pending person: the columns sent that were not applied. */
  notApplied?: string[];
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
  const unknownKeys = unknownBodyKeys(body, IMPORT_BODY_KEYS);
  if (unknownKeys.length > 0) return badRequest(`Unknown field(s): ${unknownKeys.join(', ')}. Send { csv } or { rows }.`);
  const foreign = await refuseForeignOrganization(deps, body, 'no one was imported');
  if (foreign) return foreign;

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
      // A declared refusal keeps its own sentence; any other fault answers the
      // generic one, as the single-add door does, so no driver text leaks.
      const message = thrown.status >= 500 ? INTERNAL_ERROR_MESSAGE : thrown.message;
      results.push({ row, email: person.email, ok: false, error: { code: thrown.code, message: `This row was not added. ${message}` } });
      continue;
    }
    if (!outcome.ok) {
      const err = outcome.result.body.error;
      results.push({ row, email: person.email, ok: false, error: { code: err?.code ?? 'INTERNAL_ERROR', message: err?.message ?? 'not added' } });
      continue;
    }
    const notApplied = outcome.alreadyPending ? notAppliedOn(person, IMPORT_FIELD_NAMES) : [];
    results.push({
      row,
      email: person.email,
      ok: true,
      userId: outcome.userId,
      alreadyPending: outcome.alreadyPending,
      ...(notApplied.length > 0 ? { notApplied } : {}),
      host: outcome.host,
    });
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

const REMOVE_KEYS = new Set(['userId']);

/**
 * `POST /api/v1/auth/admin/remove-sso-user` — `{ userId }`. Removes a person
 * who is still pending (the email-typo case) and cancels their invitation:
 * the hosting rulings' "a pending row that never accepts … can be deleted,
 * which cancels the invitation". The caller already passed the platform-admin
 * gate.
 *
 * Refused for any row that is not pending (`409`): a person who has signed in
 * is deactivated instead. The host is asked first, outside any transaction
 * (`userRemoved`, or `userDeactivated` on a host without it), so its typed
 * refusal leaves the person where they are. Then the person's positions,
 * permission sets, membership and row are removed as the system, in one unit
 * of work, through the engine's delete, so a record that points at the person
 * follows its lookup's `deleteBehavior`: a `restrict` refuses the removal with
 * the engine's own answer and nothing is removed. "Pending only" is held at
 * the removal too: the person is re-checked inside the unit of work and the
 * row's delete carries `source: 'idp_pending'`, so a person who signs in
 * while the host is asked is answered `409` and kept (the narrow window the
 * engine's delete leaves is in {@link takeBackPerson}). A host that could not be reached refuses the
 * removal (`503`, nothing removed), as it refuses a deactivation: the door
 * calls the host once and keeps no record to ask again from, so removing the
 * person would leave an invitation nothing can cancel. With no host wired
 * nothing is called. A removal that commits writes one admin audit row
 * (`writeAdminAudit`, `user.admin_removed_pending`); a refused one writes none.
 */
export async function runRemoveSsoUser(
  deps: PendingSsoUserDeps,
  actor: AdminActor & EnvironmentUserActor,
  request: Request,
): Promise<EndpointResult> {
  if (!deps.isCloudManaged()) {
    return fail(PENDING_SSO_REFUSAL_STATUS, PENDING_SSO_REFUSAL_CODE, PENDING_SSO_MESSAGES.notManagedRemove);
  }
  const reading = await readJsonRequestBody(request);
  if (!reading.ok) return badRequest(reading.message);
  const body = (reading.body && typeof reading.body === 'object' ? reading.body : {}) as Record<string, unknown>;
  const unknownKeys = unknownBodyKeys(body, REMOVE_KEYS);
  if (unknownKeys.length > 0) return badRequest(`Unknown field(s): ${unknownKeys.join(', ')}. This door takes userId.`);
  const foreign = await refuseForeignOrganization(deps, body, 'no one was removed');
  if (foreign) return foreign;
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  if (!userId) return badRequest('userId is required');

  const engine = deps.getDataEngine();
  if (!engine) return fail(503, 'SERVICE_UNAVAILABLE', 'Data engine unavailable, so no one was removed.');
  const rows = await engine.find('sys_user', {
    where: { id: userId },
    fields: ['id', 'email', 'name', 'source'],
    limit: 1,
    context: SYSTEM_CTX,
  });
  const target = (Array.isArray(rows) ? rows[0] : undefined) as
    | { id?: unknown; email?: unknown; name?: unknown; source?: unknown }
    | undefined;
  if (!target) return fail(404, 'RESOURCE_NOT_FOUND', 'User not found');
  if (!isPendingSsoSource(target.source)) {
    return fail(PENDING_SSO_REFUSAL_STATUS, PENDING_SSO_REFUSAL_CODE, PENDING_SSO_MESSAGES.removeNotPending);
  }
  const email = typeof target.email === 'string' ? target.email : '';
  const name = typeof target.name === 'string' ? target.name : '';

  // The host first, outside any transaction: a refusal leaves the person as they are.
  let host: EnvironmentUserHostOutcome;
  let event: EnvironmentUserEvent | undefined;
  if (deps.host) {
    event = {
      userId,
      email,
      name,
      source: PENDING_SSO_SOURCE,
      ...(await environmentUserAttribution(engine, actor, deps.logger)),
      occurredAt: new Date().toISOString(),
    };
    const answer = await notifyEnvironmentUserHost(deps.host, 'removed', event, deps.logger);
    if ('refused' in answer) return hostRefusal(answer);
    if (!answer.notified && answer.reason === 'host_failed') {
      return fail(503, 'SERVICE_UNAVAILABLE', PENDING_SSO_MESSAGES.removeHostUnreachable);
    }
    host = answer;
  } else {
    host = { notified: false, reason: 'no_host' };
  }

  // Pending only, held at the write: the person may have signed in while the
  // host was asked, and then they are not removed.
  try {
    await takeBackPerson(deps, engine, userId, {}, { pendingOnly: true });
  } catch (error) {
    return removalNotDone(deps, engine, error, { userId, host, event });
  }

  // The admin audit row the add doors write, for the removal that committed:
  // never on a refusal (nothing was removed), never failing the answer.
  await writeAdminAudit(deps, {
    action: 'delete',
    actor,
    recordId: userId,
    metadata: { event: 'user.admin_removed_pending', hostNotified: host.notified },
  });
  return { status: 200, body: { success: true, data: { userId, email, removed: true, host } } };
}

/** Throws {@link NoLongerPending} unless the person is still pending, read now. */
async function assertStillPending(engine: PendingSsoUserEngine, userId: string): Promise<void> {
  const now = await engine.find('sys_user', { where: { id: userId }, fields: ['id', 'source'], limit: 1, context: SYSTEM_CTX });
  const row = (Array.isArray(now) ? now[0] : undefined) as { source?: unknown } | undefined;
  if (!row || !isPendingSsoSource(row.source)) throw new NoLongerPending();
}

/** Thrown inside the removal's unit of work when the person is no longer pending there. */
class NoLongerPending extends Error {
  constructor() {
    super('The person is no longer pending');
  }
}

/**
 * The answer when the removal's unit of work did not commit: no one was
 * removed. What the host was told is said as it happened. When the host had
 * taken the cancellation and the person is still pending and not
 * deactivated, their invitation is sent again here, once, through
 * `userAdded`, and the answer says whether that worked; nothing is retried
 * later.
 */
async function removalNotDone(
  deps: PendingSsoUserDeps,
  engine: PendingSsoUserEngine,
  error: unknown,
  call: { userId: string; host: EnvironmentUserHostOutcome; event: EnvironmentUserEvent | undefined },
): Promise<EndpointResult> {
  const { userId, host, event } = call;
  // A host that could not be reached refused the removal before this, so the
  // host was either told (and took the cancellation) or not called at all.
  const told = event !== undefined && host.notified;
  const hostSentence = told ? PENDING_SSO_MESSAGES.removeHostCancelled : '';

  if (error instanceof NoLongerPending) {
    return fail(
      PENDING_SSO_REFUSAL_STATUS,
      PENDING_SSO_REFUSAL_CODE,
      [PENDING_SSO_MESSAGES.removeNotPending, hostSentence].filter(Boolean).join(' '),
    );
  }

  const thrown = resolveThrownHttpError(error, 500);
  const cause = thrown.status >= 500 ? INTERNAL_ERROR_MESSAGE : thrown.message;
  if (thrown.status >= 500) {
    const line = `[AuthPlugin] removing pending user ${userId} failed, so no one was removed`;
    if (deps.logger?.error) deps.logger.error(line, error instanceof Error ? error : undefined);
    else deps.logger?.warn(`${line}. Cause: ${error instanceof Error ? error.message : String(error)}`);
  }
  let after = hostSentence;
  if (told) {
    const person = await readPersonState(engine, userId);
    if (person.pending && !person.deactivated) {
      after = (await reinvite(deps, event!))
        ? PENDING_SSO_MESSAGES.removeRefusedReinvited
        : PENDING_SSO_MESSAGES.removeRefusedNotReinvited;
    }
  }
  return fail(thrown.status, thrown.code, [PENDING_SSO_MESSAGES.removeRefused, cause, after].filter(Boolean).join(' '));
}

/** Whether the person is pending and whether they are deactivated, read now; unreadable reads as neither safe. */
async function readPersonState(
  engine: PendingSsoUserEngine,
  userId: string,
): Promise<{ pending: boolean; deactivated: boolean }> {
  try {
    const rows = await engine.find('sys_user', {
      where: { id: userId },
      fields: ['id', 'source', 'banned'],
      limit: 1,
      context: SYSTEM_CTX,
    });
    const row = (Array.isArray(rows) ? rows[0] : undefined) as { source?: unknown; banned?: unknown } | undefined;
    if (!row) return { pending: false, deactivated: false };
    return { pending: isPendingSsoSource(row.source), deactivated: isDeactivated(row) };
  } catch {
    return { pending: false, deactivated: true };
  }
}

/**
 * Send the invitation again, once, to a pending person whose removal failed
 * after the host took the cancellation of theirs (`userAdded`). Answers
 * whether the host took it; a refusal or failure is logged at `error`: the
 * person stays pending with no invitation until they are added again.
 */
async function reinvite(deps: PendingSsoUserDeps, event: EnvironmentUserEvent): Promise<boolean> {
  const answer = await notifyEnvironmentUserHost(
    deps.host,
    'added',
    { ...event, occurredAt: new Date().toISOString() },
    deps.logger,
  );
  if (!('refused' in answer) && answer.notified) return true;
  const cause = 'refused' in answer ? `${answer.refused.code}: ${answer.refused.message}` : answer.reason;
  const message =
    `[AuthPlugin] removing pending user ${event.userId} failed after the hosting organisation was told to cancel `
    + 'their invitation, and sending it again did not succeed, so they stay pending with no invitation. '
    + `Add them again to send one. Cause: ${cause}`;
  const logger = deps.logger as { warn(msg: string): void; error?(msg: string): void } | undefined;
  if (logger?.error) logger.error(message);
  else logger?.warn(message);
  return false;
}
