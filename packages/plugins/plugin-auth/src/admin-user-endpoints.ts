// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Admin "direct user management" endpoints (#2766 V1).
 *
 * `sys_user` is `managedBy:'better-auth'` — generic CRUD is suppressed because
 * a plain ObjectQL insert would bypass better-auth's password hashing and never
 * create the `sys_account` credential row, producing a user that can never sign
 * in. Until now the only way to add a teammate was the `invite_user` action,
 * which hard-depends on a wired EmailService. These endpoints give platform
 * admins a first-class, email-independent path:
 *
 *   POST /api/v1/auth/admin/create-user        — create a login-capable account
 *   POST /api/v1/auth/admin/set-user-password  — (re)set a password + force change
 *
 * Both are wrapped as pure `runXxx(deps, request)` handlers (the
 * set-initial-password.ts pattern) so the HTTP mount in auth-plugin.ts stays a
 * thin shell and the logic is unit-testable with a mocked deps surface.
 *
 * Authorization: the HTTP route owns the ADR-0068 platform-admin gate
 * (isPlatformAdmin / positions / legacy role scalar). `createUser` is then
 * invoked WITHOUT request headers — better-auth treats a header-less server
 * call as trusted and skips its own `role === 'admin'` check, which under
 * ADR-0068 no longer matches every platform admin. set-user-password
 * re-implements the native handler's core (hash + credential-account upsert)
 * through `$context` for the same reason: the stock endpoint's adminMiddleware
 * would 403 a platform admin whose legacy `role` scalar was never synthesized.
 *
 * Security red line: a generated temporary password exists ONLY in the HTTP
 * response body (surfaced once via the action's resultDialog). It is never
 * logged, never written to the audit payload, never persisted.
 */

/** Minimal better-auth server-api surface used by create-user. */
export interface AdminCreateCapableApi {
  createUser(opts: {
    body: {
      email: string;
      name: string;
      password?: string;
      role?: string | string[];
      data?: Record<string, unknown>;
    };
  }): Promise<{ user?: { id?: string; email?: string; name?: string } } | null>;
}

/**
 * Minimal better-auth `$context` surface used by set-user-password. Mirrors
 * what the stock `/admin/set-user-password` handler touches, minus its
 * role check (our route gates instead).
 */
export interface AuthContextLike {
  password: {
    hash(pw: string): Promise<string>;
    config: { minPasswordLength: number; maxPasswordLength: number };
  };
  internalAdapter: {
    findUserById(id: string): Promise<unknown | null>;
    findAccounts(userId: string): Promise<Array<{ providerId?: string }>>;
    updatePassword(userId: string, hash: string): Promise<unknown>;
    createAccount(account: {
      userId: string;
      providerId: string;
      accountId: string;
      password: string;
    }): Promise<unknown>;
  };
}

export interface AdminUserEndpointDeps {
  getAuthApi(): Promise<AdminCreateCapableApi>;
  getAuthContext(): Promise<AuthContextLike>;
  /** ObjectQL engine (may be undefined when the data plugin isn't wired). */
  getDataEngine(): AdminUserDataEngine | undefined;
  /** ADR-0069 D1 class-mix validator; throws `{ code, message }` on violation. */
  assertPasswordComplexity(pw: string): Promise<void>;
  /**
   * Prime the process-local "someone must change their password" gate cache
   * so the authGate activates immediately on this node (other nodes catch up
   * on the cache TTL). Best-effort.
   */
  noteMustChangePasswordIssued(): void;
  /** Is the better-auth phoneNumber plugin wired (#2766 V1.5)? */
  phoneNumberEnabled?(): boolean;
  /**
   * ADR-0093 D3 — accessor for the `tenancy` service. When present, the
   * create-user membership bind resolves its target org through
   * `tenancy.defaultOrgId()` (single → default org; MULTI → null, never
   * guess). Without it the bind falls back to `resolveDefaultOrgId`, which
   * prefers the `slug='default'` org — correct single-org, but in multi-org
   * (where a bootstrap default org coexists with real tenants) it would
   * mis-bind new users into the default org. Wire this everywhere tenancy
   * is registered.
   */
  getTenancy?(): { defaultOrgId(): Promise<string | null> } | undefined;
  logger?: { warn(msg: string): void };
}

export interface AdminUserDataEngine {
  update(object: string, doc: Record<string, unknown>, opts?: unknown): Promise<unknown>;
  insert(object: string, doc: Record<string, unknown>, opts?: unknown): Promise<unknown>;
  /**
   * Optional read surface — used to resolve the sole organization and to keep
   * the membership bind idempotent. Absent on lean mocks / when the data plugin
   * isn't wired, in which case the org bind simply no-ops.
   */
  find?(object: string, query?: unknown, opts?: unknown): Promise<unknown>;
}

/** The gated caller, passed by the route after its ADR-0068 check. */
export interface AdminActor {
  id: string;
  email?: string;
}

export interface EndpointResult {
  status: number;
  body: {
    success: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string };
  };
}

import { generatePlaceholderEmail } from './placeholder-email.js';
import { reconcileMembership } from './reconcile-membership.js';
import { resolveDefaultOrgId } from './tenancy-service.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

// ── Temporary password generation ────────────────────────────────────────
//
// Must satisfy the ADR-0069 class-mix policy (lower + upper + digit + symbol)
// and the better-auth min length regardless of deployment config, so one
// guaranteed character per class + random fill. Ambiguous glyphs (O/0, l/1)
// are excluded — these passwords are read off a dialog and typed once.
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SYMBOL = '!@#$%^&*-_=+';
const ALL = LOWER + UPPER + DIGIT + SYMBOL;

export function generateTemporaryPassword(length = 16): string {
  const size = Math.max(length, 12);
  const bytes = new Uint32Array(size);
  globalThis.crypto.getRandomValues(bytes);
  const pick = (set: string, rnd: number) => set[rnd % set.length];
  const chars: string[] = [
    pick(LOWER, bytes[0]),
    pick(UPPER, bytes[1]),
    pick(DIGIT, bytes[2]),
    pick(SYMBOL, bytes[3]),
  ];
  for (let i = 4; i < size; i++) chars.push(pick(ALL, bytes[i]));
  // Fisher–Yates with fresh randomness so the guaranteed classes aren't
  // always in the first four positions.
  const shuffle = new Uint32Array(size);
  globalThis.crypto.getRandomValues(shuffle);
  for (let i = size - 1; i > 0; i--) {
    const j = shuffle[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ── Shared helpers ───────────────────────────────────────────────────────

async function parseJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function badRequest(message: string): EndpointResult {
  return { status: 400, body: { success: false, error: { code: 'invalid_request', message } } };
}

/**
 * Linear-time email plausibility check (local@domain with a dotted domain).
 * Deliberately not a regex: the obvious `\S+@\S+\.\S+` is polynomially
 * backtrackable on adversarial input (CodeQL js/polynomial-redos) since `\S`
 * overlaps with `@` and `.`. better-auth revalidates on its own side; this
 * only gates obviously-broken rows early.
 */
export function isLikelyEmail(value: string): boolean {
  if (value.length === 0 || value.length > 254 || /\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) return false;
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

/**
 * Resolve the password for a create/set request: an explicit `password` /
 * `newPassword`, or a generated temporary one when `generatePassword` is true.
 * An explicit non-empty password always wins over `generatePassword` — the
 * console action dialog defaults `generatePassword: true` and labels the
 * password input "leave empty to generate", so typing a password is an
 * unambiguous override, not a conflict.
 * Returns an EndpointResult on validation failure.
 */
async function resolvePassword(
  deps: Pick<AdminUserEndpointDeps, 'assertPasswordComplexity'>,
  body: Record<string, unknown>,
  explicitKey: 'password' | 'newPassword',
): Promise<{ password: string; generated: boolean } | EndpointResult> {
  const explicit = body[explicitKey];
  const generate = body.generatePassword === true;
  if (typeof explicit !== 'string' || explicit.length === 0) {
    if (generate) return { password: generateTemporaryPassword(), generated: true };
    return badRequest(`${explicitKey} is required (or set generatePassword: true)`);
  }
  try {
    await deps.assertPasswordComplexity(explicit);
  } catch (error) {
    const e = error as { code?: string; message?: string } | null;
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: e?.code ?? 'PASSWORD_POLICY_VIOLATION',
          message: e?.message ?? 'Password does not meet the complexity policy',
        },
      },
    };
  }
  return { password: explicit, generated: false };
}

/**
 * Stamp `sys_user.must_change_password`. Best-effort — the flag drives a
 * fail-open gate, so a failed stamp must not fail the whole operation; we
 * surface the *actual* stamped state in the response instead.
 */
async function stampMustChangePassword(
  deps: AdminUserEndpointDeps,
  userId: string,
  value: boolean,
): Promise<boolean> {
  const engine = deps.getDataEngine();
  if (!engine) return false;
  try {
    await engine.update('sys_user', { id: userId, must_change_password: value }, {
      context: SYSTEM_CTX,
    });
    if (value) deps.noteMustChangePasswordIssued();
    return true;
  } catch (error) {
    deps.logger?.warn(
      `[AuthPlugin] failed to stamp must_change_password for user ${userId}: ${
        (error as Error)?.message ?? error
      }`,
    );
    return false;
  }
}

/**
 * Bind an admin-created user to the organization (single-org membership).
 *
 * ADR-0093 D2 — this now delegates to the shared membership reconciler, the
 * single owner of the "every new user gets a membership" invariant. The
 * reconciler ALSO runs as a `user.create.after` hook (covering signup / import /
 * SSO JIT); this endpoint-side call is retained as belt-and-suspenders for the
 * admin create path until the hook's coverage is verified in integration — both
 * are idempotent and yield to any existing membership, so double-coverage never
 * double-binds (ADR-0093 D2 "interim double-coverage is harmless"). The target
 * org is the single-org default (resolveDefaultOrgId); multi-org resolves to
 * none, so this no-ops there just as before.
 *
 * Returns the shape the response/audit consumed pre-ADR-0093:
 * `membershipCreated` is true only when THIS call inserted the row (a `bound`
 * outcome); a `yielded` outcome (the hook or a race already bound it) reports
 * the org with `membershipCreated: false`.
 */
async function bindUserToSoleOrganization(
  deps: AdminUserEndpointDeps,
  userId: string,
): Promise<{ organizationId: string | null; membershipCreated: boolean }> {
  const engine = deps.getDataEngine();
  // ADR-0093 D3 — mode-aware target resolution. The tenancy service returns
  // null in multi mode (the framework never guesses a tenant), which also
  // keeps this endpoint bind from grabbing the bootstrap `slug='default'` org
  // in a multi-org deployment. Fallback (no tenancy wired: lean embeddings,
  // legacy mocks) keeps the single-org resolution.
  const tenancy = deps.getTenancy?.();
  const result = await reconcileMembership(engine, userId, {
    policy: 'auto',
    resolveTargetOrg: () => (tenancy ? tenancy.defaultOrgId() : resolveDefaultOrgId(engine)),
    logger: deps.logger
      ? { warn: (msg, meta) => deps.logger?.warn(`${msg} ${meta ? JSON.stringify(meta) : ''}`.trim()) }
      : undefined,
  });
  return {
    organizationId: result.organizationId ?? null,
    membershipCreated: result.outcome === 'bound',
  };
}

/**
 * Best-effort explicit audit row. better-auth writes bypass the ObjectQL
 * lifecycle hooks that plugin-audit subscribes to, so admin identity
 * operations would otherwise leave no compliance trail. Never throws; never
 * includes password material (red line).
 */
async function writeAdminAudit(
  deps: AdminUserEndpointDeps,
  entry: {
    action: 'create' | 'update';
    actor: AdminActor;
    recordId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const engine = deps.getDataEngine();
  if (!engine) return;
  try {
    await engine.insert(
      'sys_audit_log',
      {
        action: entry.action,
        user_id: entry.actor.id,
        actor: entry.actor.id,
        object_name: 'sys_user',
        record_id: entry.recordId,
        metadata: JSON.stringify(entry.metadata),
      },
      { context: SYSTEM_CTX },
    );
  } catch {
    // plugin-audit may not be installed (no sys_audit_log table) — audit is
    // best-effort by design here; the operation itself must not fail.
  }
}

function mapAuthApiError(error: unknown, fallback: string): EndpointResult {
  const e = error as {
    statusCode?: number;
    status?: number | string;
    body?: { code?: string; message?: string };
    message?: string;
  } | null;
  const code = e?.body?.code ?? 'internal';
  const message = e?.body?.message ?? e?.message ?? fallback;
  const rawStatus =
    typeof e?.statusCode === 'number' ? e.statusCode : typeof e?.status === 'number' ? e.status : 500;
  const status = code === 'USER_ALREADY_EXISTS' ? 409 : rawStatus;
  return { status, body: { success: false, error: { code, message } } };
}

// ── POST /admin/create-user ──────────────────────────────────────────────

export async function runAdminCreateUser(
  deps: AdminUserEndpointDeps,
  request: Request,
  actor: AdminActor,
): Promise<EndpointResult> {
  const body = await parseJson(request);

  // #2766 V1.5 — identity: a real email, a phone number, or both. Phone-only
  // users get a generated placeholder address (better-auth requires a unique
  // email) that every mail callback refuses to send to.
  const rawEmail = body.email;
  const hasEmail = typeof rawEmail === 'string' && rawEmail.trim().length > 0;
  if (hasEmail && !isLikelyEmail((rawEmail as string).trim())) {
    return badRequest('A valid email is required');
  }
  const rawPhone = body.phoneNumber ?? body.phone_number;
  const hasPhone = typeof rawPhone === 'string' && rawPhone.trim().length > 0;
  let phoneNumber: string | undefined;
  if (hasPhone) {
    if (!deps.phoneNumberEnabled?.()) {
      return badRequest('Phone numbers require the phoneNumber auth plugin (auth.plugins.phoneNumber)');
    }
    phoneNumber = normalizePhoneNumber(String(rawPhone));
    if (!phoneNumber) {
      return badRequest('phoneNumber must be a valid phone number (E.164 recommended, e.g. +8613800000000)');
    }
  }
  if (!hasEmail && !phoneNumber) {
    return badRequest('Either email or phoneNumber is required');
  }
  const email = hasEmail ? (rawEmail as string).trim() : generatePlaceholderEmail();
  const name =
    typeof body.name === 'string' && body.name.trim().length > 0
      ? body.name.trim()
      : hasEmail
        ? email.split('@')[0]
        : (phoneNumber as string);
  const role = typeof body.role === 'string' && body.role.length > 0 ? body.role : undefined;
  const mustChangePassword = body.mustChangePassword !== false; // default true

  const resolved = await resolvePassword(deps, body, 'password');
  if ('status' in resolved) return resolved;

  let created: { user?: { id?: string; email?: string; name?: string } } | null;
  try {
    const authApi = await deps.getAuthApi();
    // Header-less server call: trusted, skips better-auth's role check — the
    // HTTP route already ran the ADR-0068 platform-admin gate.
    created = await authApi.createUser({
      body: {
        email: email.toLowerCase(),
        name,
        password: resolved.password,
        ...(role ? { role } : {}),
        // phoneNumber is a user-model field contributed by the phoneNumber
        // plugin's schema; `data` is better-auth's carrier for such fields.
        ...(phoneNumber ? { data: { phoneNumber } } : {}),
      },
    });
  } catch (error) {
    return mapAuthApiError(error, 'create-user failed');
  }

  const userId = created?.user?.id;
  if (typeof userId !== 'string' || userId.length === 0) {
    return {
      status: 500,
      body: { success: false, error: { code: 'internal', message: 'better-auth returned no user id' } },
    };
  }

  const stamped = mustChangePassword
    ? await stampMustChangePassword(deps, userId, true)
    : false;

  // Match the invite / add-member flows: give the new user a membership so a
  // single-org deployment shows them under the Default Organization instead of
  // as a member-less account. No-op in multi-org (≥2 orgs) — see the helper.
  const membership = await bindUserToSoleOrganization(deps, userId);

  await writeAdminAudit(deps, {
    action: 'create',
    actor,
    recordId: userId,
    metadata: {
      event: 'user.admin_created',
      email: email.toLowerCase(),
      ...(phoneNumber ? { phoneNumber } : {}),
      ...(role ? { role } : {}),
      placeholderEmail: !hasEmail,
      passwordGenerated: resolved.generated,
      mustChangePassword: stamped,
      ...(membership.organizationId ? { organizationId: membership.organizationId } : {}),
      membershipCreated: membership.membershipCreated,
    },
  });

  return {
    status: 200,
    body: {
      success: true,
      data: {
        user: {
          id: userId,
          email: created?.user?.email ?? email.toLowerCase(),
          name,
          ...(phoneNumber ? { phoneNumber } : {}),
        },
        placeholderEmail: !hasEmail,
        mustChangePassword: stamped,
        ...(membership.organizationId ? { organizationId: membership.organizationId } : {}),
        membershipCreated: membership.membershipCreated,
        ...(resolved.generated ? { temporaryPassword: resolved.password } : {}),
      },
    },
  };
}

/**
 * Light phone normalization: strip separators, require 6–15 digits with an
 * optional leading `+` (E.164 recommended). Returns undefined when invalid.
 */
export function normalizePhoneNumber(raw: string): string | undefined {
  const stripped = raw.replace(/[\s\-().]/g, '');
  return /^\+?[0-9]{6,15}$/.test(stripped) ? stripped : undefined;
}

// ── POST /admin/set-user-password ────────────────────────────────────────

export async function runAdminSetUserPassword(
  deps: AdminUserEndpointDeps,
  request: Request,
  actor: AdminActor,
): Promise<EndpointResult> {
  const body = await parseJson(request);

  const userId = body.userId ?? body.user_id;
  if (typeof userId !== 'string' || userId.length === 0) {
    return badRequest('userId is required');
  }
  const mustChangePassword = body.mustChangePassword !== false; // default true

  const resolved = await resolvePassword(deps, body, 'newPassword');
  if ('status' in resolved) return resolved;

  try {
    const authCtx = await deps.getAuthContext();

    const { minPasswordLength, maxPasswordLength } = authCtx.password.config;
    if (resolved.password.length < minPasswordLength) {
      return badRequest(`Password must be at least ${minPasswordLength} characters`);
    }
    if (resolved.password.length > maxPasswordLength) {
      return badRequest(`Password must be at most ${maxPasswordLength} characters`);
    }

    if (!(await authCtx.internalAdapter.findUserById(userId))) {
      return { status: 404, body: { success: false, error: { code: 'not_found', message: 'User not found' } } };
    }

    // Mirrors the stock /admin/set-user-password core: hash, then update the
    // credential account or create one for SSO/invite-onboarded users.
    const hashed = await authCtx.password.hash(resolved.password);
    const accounts = await authCtx.internalAdapter.findAccounts(userId);
    if (accounts.find((a) => a?.providerId === 'credential')) {
      await authCtx.internalAdapter.updatePassword(userId, hashed);
    } else {
      await authCtx.internalAdapter.createAccount({
        userId,
        providerId: 'credential',
        accountId: userId,
        password: hashed,
      });
    }
  } catch (error) {
    return mapAuthApiError(error, 'set-user-password failed');
  }

  const stamped = mustChangePassword
    ? await stampMustChangePassword(deps, userId, true)
    : await stampMustChangePassword(deps, userId, false);

  await writeAdminAudit(deps, {
    action: 'update',
    actor,
    recordId: userId,
    metadata: {
      event: 'user.admin_password_set',
      passwordGenerated: resolved.generated,
      mustChangePassword: mustChangePassword && stamped,
    },
  });

  return {
    status: 200,
    body: {
      success: true,
      data: {
        userId,
        mustChangePassword: mustChangePassword && stamped,
        ...(resolved.generated ? { temporaryPassword: resolved.password } : {}),
      },
    },
  };
}
