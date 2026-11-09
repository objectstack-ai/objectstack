// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D1/D4] The doors that register an AI service account and mint
 * its API keys.
 *
 *   POST /api/v1/auth/service-account/register    — register an account
 *   POST /api/v1/auth/service-account/create-key  — mint a key for one
 *
 * An AI service account is a `sys_user` row of kind `agent`: a registered
 * principal of its own, acting only through its own API keys, under the agent
 * ceiling (`service-account-identity.ts` holds the row rules and the sign-in
 * refusal; the resolver and the security plugin hold its authority). These
 * two doors are how one comes to exist and how it gets a credential. Its
 * lifecycle doors (suspend, resume, change owner, retire) are their own.
 *
 * ## Who may call them (the mount resolves the caller)
 *
 * A person signed in: both routes read the caller from the better-auth
 * session, so an API key never reaches them, and an AI service account (which
 * never holds a session) never calls them. A held session is refused with its
 * posture before either handler runs. Then:
 *
 *  - **Register**: an administrator of the caller's current organization
 *    (a membership whose grade is admin or owner, `isOrgAdminGrade`, inside
 *    its validity window), or a platform administrator. An ordinary member may
 *    not: an identity minted by any member would sit outside the
 *    organization's administration and outside any count.
 *  - **Create a key**: the account's accountable owner, an administrator of
 *    the account's organization, or a platform administrator. The account
 *    never mints its own (`POST /keys` stays self-only and session-only).
 *
 * ## What register writes, in one act
 *
 * The `sys_user` row — kind `agent`, the accountable owner, an undeliverable
 * placeholder address (`placeholder-email.ts`, which every mail path refuses),
 * `source: env_native` — and the account's one `sys_member` row, grade
 * `member`, in the caller's current organization. One unit of work (the
 * engine's `transaction()`), as `create-user` joins its organization: a
 * membership the vendor refuses rolls the row back, so no account exists
 * without its organization. The row is written through the data engine, not
 * the vendor's `createUser`: the kind is not a better-auth field, and it must
 * be on the insert that creates the row (D1, "born with its kind"). The
 * engine's `sys_user` hooks therefore judge it — the row rules first (the
 * owner exists and is a person), then every other hook, a licence plugin's
 * included (D7). The membership goes through the vendor's server-only
 * `addMember`, so its checks (the organization exists, the membership limit,
 * its hooks) stay the vendor's.
 *
 * The owner defaults to the caller and must be a member of the organization
 * today. The name is the only description an account carries.
 *
 * ## What create-key writes
 *
 * One `sys_api_key` row: `user_id` the account, `active_organization_id` the
 * account's organization (never the caller's, never the body's), signed with
 * the same lifecycle rule `POST /keys` applies (`signApiKeyExpiry`, core): the
 * default life when no `expires_at` is asked for, the ceiling refusal past it.
 * The raw secret is returned once, to the person who asked; only its hash is
 * stored. An account with no membership (retired) gets no key.
 *
 * Every write is the system's, attributed to the person (the mount opens the
 * attribution seam), so the CRUD audit records who registered and who minted.
 * Refusals use the ADR-0112 envelope with codes already in the catalog.
 */

import {
  generateApiKey,
  isGrantActive,
  readRequestedApiKeyExpiry,
  signApiKeyExpiry,
  AuthzStoreUnavailableError,
} from '@objectstack/core';
import type { ApiKeyLifecyclePolicy } from '@objectstack/spec/contracts';
import { SystemObjectName } from '@objectstack/spec/system';
import { validationFailureDetails } from '@objectstack/types';
import type { EndpointResult } from './admin-user-endpoints.js';
import { authSystemWriteContext } from './auth-actor-attribution.js';
import { isOrgAdminGrade } from './invitation-role-cap.js';
import { generatePlaceholderEmail } from './placeholder-email.js';
import { readJsonRequestBody } from './request-json-body.js';
import { AGENT_PRINCIPAL_KIND, isAgentAccountRow } from './service-account-identity.js';

const USER_OBJECT = SystemObjectName.USER;
const MEMBER_OBJECT = 'sys_member';
const API_KEY_OBJECT = 'sys_api_key';
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The longest name a `sys_user` row holds (`sys_user.name` `maxLength`). */
const NAME_MAX_LENGTH = 255;

/** The person calling, as the mount resolved them from their session. */
export interface ServiceAccountCaller {
  id: string;
  /** The administrator at the keyboard of an impersonation session: attribution only. */
  impersonatedBy?: string;
  /** Platform-administrator standing, as the session carries it (ADR-0068 D2). */
  isPlatformAdmin: boolean;
  /** The session's current organization, or `null`. */
  activeOrganizationId: string | null;
}

/** The engine surface these doors use. */
export interface ServiceAccountDataEngine {
  find(object: string, query?: unknown, options?: unknown): Promise<unknown>;
  insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

export interface ServiceAccountDoorDeps {
  getDataEngine(): ServiceAccountDataEngine | undefined;
  /** The vendor's server-only `addMember`, as a plain `member` of `organizationId`. */
  addMember(input: { userId: string; organizationId: string }): Promise<void>;
  /** Run `work` as one unit of work (the engine's `transaction()`). */
  runAtomically<T>(work: () => Promise<T>): Promise<T>;
  /** The API-key lifecycle policy (`AuthManager.resolveApiKeyLifecyclePolicy`); absent ⇒ none configured. */
  resolveApiKeyLifecyclePolicy?(): ApiKeyLifecyclePolicy | Promise<ApiKeyLifecyclePolicy>;
  now?(): number;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined);

function fail(status: number, code: string, message: string): EndpointResult {
  return { status, body: { success: false, error: { code, message } } };
}

async function parseJson(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; message: string }> {
  const reading = await readJsonRequestBody(request);
  if (!reading.ok) return reading;
  const parsed = reading.body;
  return { ok: true, body: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {} };
}

function rowsOf(found: unknown): Record<string, unknown>[] {
  const value = found && typeof found === 'object' && 'value' in (found as object) ? (found as { value: unknown }).value : found;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/**
 * A read these doors decide authority on. One that throws is an outage, never
 * a caller without standing: `503`, through the shared outage error.
 */
async function readRows(
  engine: ServiceAccountDataEngine,
  object: string,
  where: Record<string, unknown>,
  fields?: string[],
): Promise<Record<string, unknown>[]> {
  try {
    return rowsOf(await engine.find(object, { where, ...(fields ? { fields } : {}), context: SYSTEM_CTX }));
  } catch (cause) {
    throw new AuthzStoreUnavailableError(object, cause);
  }
}

/** The user's memberships that hold now, in `organizationId` or in every organization. */
async function activeMemberships(
  engine: ServiceAccountDataEngine,
  userId: string,
  nowMs: number,
  organizationId?: string,
): Promise<Record<string, unknown>[]> {
  const where: Record<string, unknown> = { user_id: userId };
  if (organizationId) where.organization_id = organizationId;
  // The whole row: its ADR-0091 validity window, where a deployment carries
  // one, is read off it by `isGrantActive`.
  const rows = await readRows(engine, MEMBER_OBJECT, where);
  return rows.filter((m) => isGrantActive(m as never, nowMs));
}

/** Is `userId` an administrator of `organizationId` now (grade admin or owner)? */
async function isOrganizationAdministrator(
  engine: ServiceAccountDataEngine,
  userId: string,
  organizationId: string,
  nowMs: number,
): Promise<boolean> {
  const rows = await activeMemberships(engine, userId, nowMs, organizationId);
  return rows.some((m) => isOrgAdminGrade(m.role));
}

/** A refusal a write hook threw as `VALIDATION_FAILED`, passed through with its fields; else `undefined`. */
function validationRefusal(error: unknown): EndpointResult | undefined {
  const details = validationFailureDetails(error);
  if (!details) return undefined;
  return {
    status: 400,
    body: {
      success: false,
      error: { code: 'VALIDATION_FAILED', message: (error as Error).message, fields: details.fields },
    },
  };
}

/** The vendor's own verdict on the membership, forwarded with its status and code. */
class MembershipRefused extends Error {
  constructor(readonly result: EndpointResult) {
    super(result.body.error?.message ?? 'membership refused');
    this.name = 'MembershipRefused';
  }
}

function vendorRefusal(error: unknown): EndpointResult {
  const e = error as { statusCode?: number; status?: number | string; body?: { code?: string; message?: string }; message?: string } | null;
  const status = typeof e?.statusCode === 'number' ? e.statusCode : typeof e?.status === 'number' ? e.status : 500;
  const code = e?.body?.code ?? 'INTERNAL_ERROR';
  const message = e?.body?.message ?? e?.message ?? 'organization/add-member failed';
  return fail(
    status,
    code,
    `The AI service account could not be added to the organization, so it was not registered: ${message}`,
  );
}

// ── POST /service-account/register ─────────────────────────────────────────

export async function runRegisterServiceAccount(
  deps: ServiceAccountDoorDeps,
  caller: ServiceAccountCaller,
  request: Request,
): Promise<EndpointResult> {
  const read = await parseJson(request);
  if (!read.ok) return fail(400, 'INVALID_REQUEST', read.message);
  const body = read.body;

  const name = str(body.name);
  if (!name) {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Name the AI service account: what it is and what it is for.',
          fields: [{ field: 'name', code: 'required', message: 'Name the AI service account: what it is and what it is for.' }],
        },
      },
    };
  }
  if (name.length > NAME_MAX_LENGTH) {
    const message = `The AI service account's name is at most ${NAME_MAX_LENGTH} characters.`;
    return {
      status: 400,
      body: { success: false, error: { code: 'VALIDATION_FAILED', message, fields: [{ field: 'name', code: 'max_length', message }] } },
    };
  }

  const organizationId = caller.activeOrganizationId;
  if (!organizationId) {
    return fail(
      400,
      'INVALID_REQUEST',
      'An AI service account is registered in your current organization, and you have none. Select an organization and try again.',
    );
  }

  const engine = deps.getDataEngine();
  if (!engine) return fail(503, 'SERVICE_UNAVAILABLE', 'The data service is not available.');
  const nowMs = deps.now?.() ?? Date.now();

  if (!caller.isPlatformAdmin && !(await isOrganizationAdministrator(engine, caller.id, organizationId, nowMs))) {
    return fail(
      403,
      'PERMISSION_DENIED',
      'Only an administrator of this organization, or a platform administrator, can register an AI service account.',
    );
  }

  // The accountable owner: a person who is a member of this organization
  // today. The row rules (`service-account-identity.ts`) refuse an owner who
  // does not exist or is not a person; membership is this door's to judge,
  // because the act knows the organization and the row does not.
  const ownerId = str(body.ownerId) ?? str(body.owner_id) ?? caller.id;
  if ((await activeMemberships(engine, ownerId, nowMs, organizationId)).length === 0) {
    const message = ownerId === caller.id
      ? 'You are not a member of this organization, so you cannot be the AI service account\'s accountable owner. '
        + 'Name a person who is (ownerId).'
      : `The accountable owner '${ownerId}' is not a member of this organization. Name a person who is.`;
    return {
      status: 400,
      body: { success: false, error: { code: 'VALIDATION_FAILED', message, fields: [{ field: 'ownerId', code: 'invalid_value', message }] } },
    };
  }

  let userId: string;
  try {
    userId = await deps.runAtomically(async () => {
      const inserted = await engine.insert(
        USER_OBJECT,
        {
          name,
          email: generatePlaceholderEmail(),
          email_verified: false,
          principal_kind: AGENT_PRINCIPAL_KIND,
          accountable_user_id: ownerId,
          source: 'env_native',
        },
        { context: await authSystemWriteContext() },
      );
      const id = str((Array.isArray(inserted) ? inserted[0] : inserted as Record<string, unknown> | undefined)?.id);
      if (!id) throw new Error('the user row was written without an id');
      try {
        await deps.addMember({ userId: id, organizationId });
      } catch (error) {
        throw new MembershipRefused(vendorRefusal(error));
      }
      return id;
    });
  } catch (error) {
    if (error instanceof MembershipRefused) return error.result;
    const refused = validationRefusal(error);
    if (refused) return refused;
    throw error;
  }

  return {
    status: 201,
    body: {
      success: true,
      data: { userId, name, principalKind: AGENT_PRINCIPAL_KIND, organizationId, ownerId },
    },
  };
}

// ── POST /service-account/create-key ───────────────────────────────────────

export async function runCreateServiceAccountKey(
  deps: ServiceAccountDoorDeps,
  caller: ServiceAccountCaller,
  request: Request,
): Promise<EndpointResult> {
  const read = await parseJson(request);
  if (!read.ok) return fail(400, 'INVALID_REQUEST', read.message);
  const body = read.body;

  const accountId = str(body.userId) ?? str(body.user_id);
  if (!accountId) return fail(400, 'INVALID_REQUEST', 'userId is required: the AI service account the key is for.');
  const keyName = str(body.name) ?? 'API Key';
  const nowMs = deps.now?.() ?? Date.now();
  const requested = readRequestedApiKeyExpiry(body.expires_at, nowMs);
  if (!requested.ok) return fail(requested.status, requested.code, requested.message);

  const engine = deps.getDataEngine();
  if (!engine) return fail(503, 'SERVICE_UNAVAILABLE', 'The data service is not available.');

  // The account. A person's id is answered as an unknown one: this door
  // mints only an account's key, and a person's key stays that person's own
  // to mint (D4).
  const [account] = await readRows(engine, USER_OBJECT, { id: accountId }, ['id', 'principal_kind', 'accountable_user_id']);
  if (!account || !isAgentAccountRow(account)) {
    return fail(404, 'RESOURCE_NOT_FOUND', `No AI service account '${accountId}' exists.`);
  }

  // Its organization: its one membership that holds now. None means it was
  // retired, and a retired account gets no key.
  const [membership] = await activeMemberships(engine, accountId, nowMs);
  const organizationId = str(membership?.organization_id);
  if (!organizationId) {
    return fail(
      409,
      'RESOURCE_CONFLICT',
      `The AI service account '${accountId}' belongs to no organization, so no key can be created for it.`,
    );
  }

  const isOwner = str(account.accountable_user_id) === caller.id
    && (await activeMemberships(engine, caller.id, nowMs, organizationId)).length > 0;
  if (!caller.isPlatformAdmin && !isOwner && !(await isOrganizationAdministrator(engine, caller.id, organizationId, nowMs))) {
    return fail(
      403,
      'PERMISSION_DENIED',
      'Only the AI service account\'s accountable owner, an administrator of its organization, or a platform '
        + 'administrator can create a key for it.',
    );
  }

  let policy: ApiKeyLifecyclePolicy | undefined;
  try {
    policy = deps.resolveApiKeyLifecyclePolicy ? await deps.resolveApiKeyLifecyclePolicy() : undefined;
  } catch (cause) {
    throw new AuthzStoreUnavailableError('api_key_policy', cause);
  }
  const signed = signApiKeyExpiry(policy, requested.requestedMs, nowMs);
  if (!signed.ok) {
    // The ceiling, answered as a refusal of the field (`POST /keys` answers it
    // with its own ledgered `API_KEY_EXPIRY_TOO_LONG`, which is the runtime's).
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: signed.message,
          fields: [{ field: 'expires_at', code: 'invalid_value', message: signed.message }],
        },
      },
    };
  }

  // Generated after every check, so a refused request never mints.
  const generated = generateApiKey();
  const row: Record<string, unknown> = {
    name: keyName,
    key: generated.hash,
    prefix: generated.prefix,
    user_id: accountId,
    revoked: false,
    active_organization_id: organizationId,
  };
  if (signed.expiresAt) row.expires_at = signed.expiresAt;

  let inserted: unknown;
  try {
    inserted = await engine.insert(API_KEY_OBJECT, row, { context: await authSystemWriteContext() });
  } catch {
    // Never surface the underlying error: it could echo the row, hash included.
    return fail(500, 'INTERNAL_ERROR', 'The API key could not be created.');
  }
  const id = str((Array.isArray(inserted) ? inserted[0] : inserted as Record<string, unknown> | undefined)?.id);

  // The raw key, once. Never logged.
  return {
    status: 201,
    body: {
      success: true,
      data: {
        id,
        name: keyName,
        prefix: generated.prefix,
        key: generated.raw,
        user_id: accountId,
        active_organization_id: organizationId,
        ...(signed.expiresAt ? { expires_at: signed.expiresAt } : {}),
      },
    },
  };
}
