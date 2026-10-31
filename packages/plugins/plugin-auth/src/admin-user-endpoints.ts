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
      /**
       * `accountId` is the STABLE 1.7 spelling. `1.7.0-rc.2` briefly called it
       * `providerAccountId` and stable 1.7.0 renamed it back (#3002); the
       * rc.2 spelling here would have created accounts with no account id.
       *
       * With `providerId` it is the WHOLE account identity again since 1.7.3
       * (#17440): the `issuer` this signature used to require was deleted
       * upstream together with the model it keyed.
       */
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
  getTenancy?(): {
    defaultOrgId(): Promise<string | null>;
    /**
     * True iff an organization wall is in force — the same predicate
     * `features.multiOrgEnabled` is derived from. create-user's multi-org join
     * of the administrator's current organization reads it. Optional for lean
     * mocks: absent ⇒ not multi-org ⇒ no join.
     */
    readonly isolationActive?: boolean;
  } | undefined;
  /**
   * ADR-0093 D1 — the deployment's membership policy, read LIVE through
   * `AuthManager.getMembershipPolicy()` (never a captured option).
   *
   * This endpoint used to hand the reconciler a literal `'auto'`, which made
   * it the one membership-writing path that did not consult the policy: an
   * `invite-only` deployment's `user.create.after` reconciler correctly bound
   * nobody, and then this endpoint-side belt-and-suspenders call bound them
   * anyway. The failure direction was OPEN — it GRANTED the membership the
   * policy exists to withhold, and answered `membershipCreated: true` while
   * doing it. ADR-0093 D1 enumerates the `invite-only` flows as a closed set
   * and refuses "which endpoint created the user" as a determinant, so the
   * endpoint reads the policy like every other consumer.
   *
   * Optional, and absent ⇒ `'auto'`: that is the accessor's OWN default
   * (`this.config.membershipPolicy ?? 'auto'`), so a host that wires no
   * policy dep — lean embeddings, the package's own mock-deps tests — keeps
   * byte-identical behaviour. The real mount in `auth-plugin.ts` always
   * wires it.
   */
  getMembershipPolicy?(): MembershipPolicy;
  /**
   * [#25338] What create-user's optional `permissionSet` needs. Absent ⇒ a
   * request that names a set is refused 501 and no user is created; a request
   * that names none never reads it. See {@link AdminCreateGrantSeam}.
   *
   * Its unit of work also carries the multi-org join of the administrator's
   * current organization, so a refused join rolls the account back as a
   * refused grant does. Absent ⇒ a multi-org creation is refused 501.
   */
  createGrant?: AdminCreateGrantSeam;
  /**
   * The CALLING administrator's current (active) organization, read from their
   * session, or `null` when they have none. In multi-org mode the new user
   * joins it, and `null` refuses the creation (ADR-0093 D3 amendment).
   * Absent ⇒ no join: the creation behaves as before.
   */
  getCallerActiveOrganizationId?(): Promise<string | null>;
  logger?: { warn(msg: string): void };
}

/**
 * [#25338] The seam behind create-user's optional permission set.
 *
 * The grant is written the way Setup's "Permission Sets → New" writes it: a
 * `sys_user_permission_set` insert through the data engine under the CALLING
 * administrator's own execution context — never `SYSTEM_CTX`. So the security
 * middleware, the ADR-0090 D12 delegated-administration gate (which also
 * stamps `granted_by`) and the catalog name check judge it exactly as they
 * judge the form. ⛔ This route opens no assignment path of its own: the
 * platform-admin gate in front of it decides who may CREATE a user, never
 * what that user may be GRANTED.
 */
export interface AdminCreateGrantSeam {
  /**
   * The caller's execution context, resolved from the request by the platform's
   * one composition (`resolveRequestExecutionContext`), or `undefined` when it
   * resolves no principal — refused, fail closed.
   */
  resolveActorContext(): Promise<Record<string, unknown> | undefined>;
  /**
   * Run `work` as one unit of work (the engine's `transaction()`, ADR-0034), so
   * a refused grant rolls the created user back with it: an account that
   * exists without the access the administrator asked for is never left behind.
   */
  runAtomically<T>(work: () => Promise<T>): Promise<T>;
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
  /**
   * [#12981] Optional registry probe — `ObjectQL.getSchema`, which answers
   * `undefined` for an object no package registered.
   *
   * It is here to separate two outcomes the audit `catch` below used to spell
   * identically: plugin-audit UNINSTALLED (no `sys_audit_log` object, so
   * nothing was ever claimed and silence is correct) from plugin-audit
   * INSTALLED AND THE WRITE REFUSED (the admin action landed, its audit row did
   * not, and the endpoint still answers 200). Reading the driver's error text
   * would decide the same question by guessing; this asks the registry that
   * owns the answer.
   *
   * Optional because lean mocks and hosts that wire no ObjectQL engine do not
   * carry it — additive, so nothing that type-checks today stops doing so. When
   * it is absent the site cannot tell the two apart and therefore REPORTS: an
   * unmeasurable write must never be a silent one.
   */
  getSchema?(objectName: string): unknown;
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
    /** `fields`: the per-field envelopes of a `VALIDATION_FAILED` refusal, passed through. */
    error?: { code: string; message: string; fields?: unknown[] };
  };
}

import { generatePlaceholderEmail } from './placeholder-email.js';
import { revokeSessionsAndApiKeys, type ForcedResetRevocationOutcome } from './forced-reset-revocation.js';
import { reconcileMembership, type MembershipPolicy } from './reconcile-membership.js';
import { resolveDefaultOrgId } from './tenancy-service.js';
import type { AddMemberCapableApi } from './organization-add-member.js';
import { readJsonRequestBody } from './request-json-body.js';
import { cloudManagedRefusal } from './cloud-managed.js';
import { temporaryPasswordLength } from './temporary-password-length.js';
import { isCloudManaged } from '@objectstack/core';
import { resolveThrownHttpError, validationFailureDetails } from '@objectstack/types';
import type { FieldErrorCode } from '@objectstack/spec/api';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

// ── Temporary password generation ────────────────────────────────────────
//
// Must satisfy the ADR-0069 class-mix policy (lower + upper + digit + symbol),
// so one guaranteed character per class + random fill. Never shorter than 12;
// a caller holding the deployment's length range sizes it to that range (see
// `temporaryPasswordLength` in temporary-password-length.ts). Ambiguous glyphs (O/0, l/1) are excluded — these
// passwords are read off a dialog and typed once.
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

/**
 * [#24032] The body, or the refusal message for a declared-JSON body that does
 * not parse: it was read as `{}`, which answered "userId is required" (or
 * "Email is required") for a body that carried the field
 * (see request-json-body.ts). A well-formed body that is not an object still
 * reads as no fields, as before.
 */
async function parseJson(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; message: string }> {
  const reading = await readJsonRequestBody(request);
  if (!reading.ok) return reading;
  const parsed = reading.body;
  return { ok: true, body: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {} };
}

function badRequest(message: string): EndpointResult {
  return { status: 400, body: { success: false, error: { code: 'INVALID_REQUEST', message } } };
}

/**
 * [#28289] A refusal for inputs left empty: `400 VALIDATION_FAILED` with one
 * `fields[]` entry per input, code `required` (the closed ADR-0114 catalog) —
 * the envelope the grant refusal passes through and the data doors answer, so
 * the console's field-error reader needs no case for this door.
 */
function requiredFieldsRefusal(message: string, fields: string[]): EndpointResult {
  return {
    status: 400,
    body: {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message,
        fields: fields.map((field) => ({ field, code: 'required' satisfies FieldErrorCode, message })),
      },
    },
  };
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
  // Reject anything outside printable ASCII up front so obviously-invalid
  // addresses (e.g. a Chinese domain like `x@柴仟.com`) fail this pre-filter —
  // and therefore the import dry-run — instead of passing here only to be
  // rejected later by better-auth's strict ASCII validator at real-import time
  // (framework#3566). A single linear char-class test; no backtracking (see the
  // ReDoS note above). The range is spelled with printable bounds (0x20–0x7e)
  // so the pattern itself carries no control character (eslint no-control-regex).
  if (/[^\x20-\x7e]/.test(value)) return false;
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) return false;
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

/**
 * [#25824] The deployment's password length range, as better-auth resolved it:
 * `emailAndPassword.minPasswordLength` / `maxPasswordLength`, which ADR-0069
 * maps the `auth.password_min_length` / `password_max_length` settings onto.
 */
type PasswordLengthPolicy = AuthContextLike['password']['config'];

/**
 * Resolve the password for a create/set request: an explicit `password` /
 * `newPassword`, or a generated temporary one when `generatePassword` is true.
 * An explicit non-empty password always wins over `generatePassword` — the
 * console action dialog defaults `generatePassword: true` and labels the
 * password input "leave empty to generate", so typing a password is an
 * unambiguous override, not a conflict.
 *
 * [#25824] Every admin door that sets a credential resolves it here, so this
 * is where the length range is held, for an explicit and a generated password
 * alike: better-auth's own `createUser` checks only the maximum, and
 * create-user used to save a 1-character password that set-user-password and
 * change-password refuse.
 * Returns an EndpointResult on validation failure.
 */
async function resolvePassword(
  deps: Pick<AdminUserEndpointDeps, 'assertPasswordComplexity'>,
  body: Record<string, unknown>,
  explicitKey: 'password' | 'newPassword',
  lengthPolicy: PasswordLengthPolicy,
): Promise<{ password: string; generated: boolean } | EndpointResult> {
  const explicit = body[explicitKey];
  const generate = body.generatePassword === true;
  let resolved: { password: string; generated: boolean };
  if (typeof explicit !== 'string' || explicit.length === 0) {
    if (!generate) return badRequest(`${explicitKey} is required (or set generatePassword: true)`);
    resolved = { password: generateTemporaryPassword(temporaryPasswordLength(lengthPolicy)), generated: true };
  } else {
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
    resolved = { password: explicit, generated: false };
  }
  const { minPasswordLength, maxPasswordLength } = lengthPolicy;
  if (resolved.password.length < minPasswordLength) {
    return badRequest(`Password must be at least ${minPasswordLength} characters`);
  }
  if (resolved.password.length > maxPasswordLength) {
    return badRequest(`Password must be at most ${maxPasswordLength} characters`);
  }
  return resolved;
}

/**
 * Stamp `sys_user.must_change_password`. Best-effort — the flag drives a
 * fail-open gate, so a failed stamp must not fail the whole operation; we
 * surface the *actual* stamped state in the response instead.
 */
/**
 * [#25083] The target's `sys_user.source` (`idp_provisioned` | `env_native`),
 * read as the system. `ok: false` when it cannot be read at all (no engine,
 * no read surface, or the read throws), so the cloud-managed check above
 * fails closed instead of reading an outage as a local account.
 */
async function readUserSource(
  deps: AdminUserEndpointDeps,
  userId: string,
): Promise<{ ok: true; value: string | null } | { ok: false }> {
  const engine = deps.getDataEngine();
  if (!engine?.find) return { ok: false };
  try {
    const rows = await engine.find('sys_user', {
      where: { id: userId },
      fields: ['id', 'source'],
      limit: 1,
      context: SYSTEM_CTX,
    });
    const row = Array.isArray(rows) ? (rows[0] as { source?: unknown } | undefined) : undefined;
    return { ok: true, value: typeof row?.source === 'string' ? row.source : null };
  } catch {
    return { ok: false };
  }
}

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
 * Bind an admin-created user to the organization (single-org membership),
 * SUBJECT TO the deployment's membership policy.
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
 * ADR-0093 D1 — the policy comes from {@link AdminUserEndpointDeps.getMembershipPolicy},
 * the same live accessor the sign-up and backfill seams read. It used to be a
 * literal `'auto'`, which made double-coverage anything but harmless under
 * `invite-only`: the hook skipped by policy and this call bound regardless, so
 * the endpoint GRANTED the membership the policy was set to withhold. D1
 * enumerates the `invite-only` flows as a closed set and refuses "which
 * endpoint created the user" as a determinant — an admin-created account is
 * not an implicit invitation.
 *
 * Returns the shape the response/audit consumed pre-ADR-0093:
 * `membershipCreated` is true only when THIS call inserted the row (a `bound`
 * outcome); a `yielded` outcome (the hook or a race already bound it) reports
 * the org with `membershipCreated: false`. Under `invite-only` the reconciler
 * answers `policy-skip` before it looks at any org, so the caller reports no
 * organization and `membershipCreated: false` — the account is created, the
 * membership is not.
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
  // ADR-0093 D1 — read the live policy, never a literal. Absent dep ⇒ `auto`,
  // which is the accessor's own default, so unwired hosts are unchanged.
  const policy: MembershipPolicy = deps.getMembershipPolicy?.() ?? 'auto';
  const result = await reconcileMembership(engine, userId, {
    policy,
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
 * The admin's decisions, the WHOLE of what {@link writeAdminAudit} puts in a
 * ledger row's `metadata`. Closed on purpose: each member is either a decision
 * that no field of the user stores, or a reference to another record.
 *
 * - `event` — which administrative operation this is.
 * - `passwordGenerated` — the system minted the password rather than the admin
 *   typing one. No field stores it; the credential is on `sys_account`.
 * - `placeholderEmail` — the admin created a phone-only identity, so the
 *   address on the account is a generated placeholder. The decision, never
 *   the address.
 * - `membershipCreated` — this call bound the membership (ADR-0093 D2).
 * - `organizationId` — a reference to the organization bound to, a record of
 *   its own; present only when one was resolved.
 *
 * ⛔ Never add a member that copies a value this operation writes into a field
 * of the user (see {@link writeAdminAudit}): that value is already on the
 * mirror row for the same write, in the snapshot column the ledger's read
 * side narrows.
 */
type AdminAuditDecisions =
  | {
      event: 'user.admin_created';
      placeholderEmail: boolean;
      passwordGenerated: boolean;
      membershipCreated: boolean;
      organizationId?: string;
    }
  | {
      event: 'user.admin_password_set';
      passwordGenerated: boolean;
      /** [#23287] Whether the administrator asked for the forced reset's revocation. */
      revokeSessionsAndKeys: boolean;
      /** What the revocation landed (present only when it was asked for) — counts, never a credential. */
      revokedSessions?: number;
      revokedApiKeys?: number;
      revocationComplete?: boolean;
    };

/**
 * Best-effort explicit audit row for an admin identity operation. Never
 * throws; never includes password material (red line).
 *
 * **Corrected rationale (#4940).** This comment used to justify the row by
 * asserting that *"better-auth writes bypass the ObjectQL lifecycle hooks that
 * plugin-audit subscribes to, so admin identity operations would otherwise
 * leave no compliance trail"*. That is **false** — the same stale mechanism
 * claim #4802 refuted one layer up (see `AuthManagerOptions.databaseHooks`) —
 * and it is refuted here rather than quietly deleted, because it was copied
 * widely enough to keep producing wrong conclusions (cloud#1022). A reader
 * arriving from one of those copies needs to see the claim named. Verified:
 *
 * - `objectql-adapter.ts` writes with a plain `dataEngine.insert(...)`.
 * - `ObjectQL.insert()` runs `triggerHooks('beforeInsert'/'afterInsert')`
 *   INSIDE `executeWithMiddleware()`'s executor (`objectql/src/engine.ts`).
 * - `plugin-audit/src/audit-writers.ts` registers its writer as a bare
 *   `engine.registerHook('afterInsert', writeAudit, { packageId })` — no
 *   object filter — and `sys_user` is NOT in its `SKIP_OBJECTS`.
 *
 * So plugin-audit's generic writer **does** record the user this endpoint
 * creates. Measured on the real routes in
 * `packages/qa/dogfood/test/admin-identity-audit-trail.dogfood.test.ts`:
 * `POST /admin/create-user` leaves exactly TWO `action: 'create'` rows on the
 * new `sys_user` — this explicit one and plugin-audit's — plus an `update` row
 * for the must-change-password stamp.
 *
 * The row is kept anyway, for three reasons that are actually true:
 *
 * 1. **plugin-audit is optional.** Nothing in this package depends on it; with
 *    it uninstalled there is no `sys_audit_log` table at all and the `catch`
 *    below is the whole story. Minting a login-capable account is precisely
 *    the operation whose trail must not be contingent on an optional plugin.
 * 2. **`sys_account` IS in `SKIP_OBJECTS`.** `/admin/set-user-password` writes
 *    the credential on `sys_account`, so the generic writer emits nothing for
 *    it — measured ZERO rows. This explicit row is the only record that a
 *    password was administratively reset. "The hook covers it, drop the
 *    explicit insert" would silently delete that trail.
 * 3. **Disjoint payloads.** The generic row is a field diff / row snapshot;
 *    this one records the admin's DECISIONS ({@link AdminAuditDecisions}),
 *    none of which is stored in a field of the user.
 *
 * **No field value of the user rides `metadata`.** The row's reference to the
 * record is `object_name` + `record_id`; `metadata` carries only the
 * decisions. A value this operation writes into a field of the user — the
 * identity it was created with, its legacy role scalar, the must-change-password
 * flag — is recorded by plugin-audit's mirror row for that same write, whose
 * before/after snapshots the ledger's read side narrows to what each reader is
 * served. `metadata` is free text that no read-time narrowing can map back to
 * a field without deriving masking a second time, so a copy here would serve
 * the value to a ledger reader the data plane withholds it from. Two guards
 * hold that: the closed {@link AdminAuditDecisions} type refuses a field value
 * written as a literal key at compile time (a conditional spread passes
 * TypeScript's excess-property check, so it does not stop that spelling), and
 * the pins in `admin-user-endpoints.test.ts` fail on any key outside the
 * decision set and on any value this call wrote into the user.
 */
async function writeAdminAudit(
  deps: AdminUserEndpointDeps,
  entry: {
    action: 'create' | 'update';
    actor: AdminActor;
    recordId: string;
    metadata: AdminAuditDecisions;
  },
): Promise<void> {
  const engine = deps.getDataEngine();
  if (!engine) return;
  // plugin-audit is OPTIONAL, and with it uninstalled there is no
  // `sys_audit_log` object at all. That case is a DECLARED skip, not a
  // swallow: nothing ever claimed this action would be audited, so there is
  // nothing to report and the channel stays quiet — which is what keeps the
  // `warn` below meaningful instead of one more line nobody reads.
  if (engine.getSchema && !engine.getSchema('sys_audit_log')) return;
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
  } catch (error) {
    // [#12981] The operation itself must NOT fail over its own audit — control
    // flow is unchanged and the endpoint still answers 200. But it must not be
    // SILENT either, and this site is the sharpest case in the family: the
    // header above records that `sys_account` is in plugin-audit's
    // `SKIP_OBJECTS`, so for `/admin/set-user-password` the generic writer
    // emits ZERO rows and the row refused here is the ONLY record that a
    // password was administratively reset. Nothing retries it and no later
    // boot reconstructs it — the reset simply has no trail, while the admin
    // who performed it reads `success: true`. `sys_audit_log` is registered
    // (checked above), so this is a refused write, not an absent plugin.
    deps.logger?.warn(
      `[AuthPlugin] the sys_audit_log row for this administrative '${entry.action}' on sys_user `
        + `${entry.recordId} was NOT written — the operation itself SUCCEEDED and the endpoint `
        + 'answers 200, so nothing looks wrong. plugin-audit is installed (sys_audit_log is '
        + 'registered), so this is a REFUSED write, not an absent plugin. This row carries the '
        + "admin's decisions (event, passwordGenerated, placeholderEmail, membershipCreated), "
        + 'none of which is stored in a field of the user, and for '
        + '/admin/set-user-password it is the only audit record that exists at all because '
        + "sys_account is in plugin-audit's SKIP_OBJECTS. Nothing retries this write, so the "
        + 'action stays permanently untrailed. Remedy: restore write access to sys_audit_log '
        + `(permissions, driver connectivity), then treat this line as the audit record. Cause: ${
          (error as Error)?.message ?? error
        }`,
    );
  }
}

export function mapAuthApiError(error: unknown, fallback: string): EndpointResult {
  const e = error as {
    statusCode?: number;
    status?: number | string;
    body?: { code?: string; message?: string };
    message?: string;
  } | null;
  const code = e?.body?.code ?? 'INTERNAL_ERROR';
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
  const read = await parseJson(request);
  if (!read.ok) return badRequest(read.message);
  const body = read.body;

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
    // Named in the dialog's words, not the body's keys: an administrator sees
    // an Email field, and a Phone Number field only where phone sign-in is on.
    // [#28289] Field-level, as the grant refusal below is: one `fields[]`
    // entry per input that would satisfy it, so a client marks the input and
    // words it in its own language instead of showing this sentence.
    const phoneSignIn = deps.phoneNumberEnabled?.() === true;
    const message = phoneSignIn ? 'Email or phone number is required' : 'Email is required';
    return requiredFieldsRefusal(message, phoneSignIn ? ['email', 'phoneNumber'] : ['email']);
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

  // [#25338] The optional permission set, by name. Empty means none asked.
  const rawPermissionSet = body.permissionSet;
  if (rawPermissionSet !== undefined && rawPermissionSet !== null && typeof rawPermissionSet !== 'string') {
    return badRequest('permissionSet must be the machine name of a permission set');
  }
  const permissionSet =
    typeof rawPermissionSet === 'string' && rawPermissionSet.trim().length > 0 ? rawPermissionSet.trim() : undefined;

  // [#25824] The length range is judged here, before any account exists.
  let lengthPolicy: PasswordLengthPolicy;
  try {
    lengthPolicy = (await deps.getAuthContext()).password.config;
  } catch (error) {
    return mapAuthApiError(error, 'create-user failed');
  }
  const resolved = await resolvePassword(deps, body, 'password', lengthPolicy);
  if ('status' in resolved) return resolved;

  // ADR-0093 D3 amendment — in multi-org mode the new user joins the
  // administrator's CURRENT organization, settled BEFORE the account exists:
  // the join runs in the account's own unit of work, so an administrator with
  // no current organization, or a host that cannot run the join, is refused
  // with nothing created — never handed a member-less account.
  let join:
    | { seam: AdminCreateGrantSeam; addMember: AddMemberCapableApi['addMember']; organizationId: string }
    | undefined;
  if (multiOrgCreationJoinsCurrentOrganization(deps)) {
    const organizationId = await deps.getCallerActiveOrganizationId!();
    if (typeof organizationId !== 'string' || organizationId.length === 0) {
      return {
        status: 400,
        body: {
          success: false,
          error: {
            code: 'NO_ACTIVE_ORGANIZATION',
            message:
              'You are not working in an organization, so no user was created. '
              + 'Switch to the organization the new user belongs to, then create them there.',
          },
        },
      };
    }
    const seam = deps.createGrant;
    const authApi = (await deps.getAuthApi()) as Partial<AddMemberCapableApi>;
    if (!seam || typeof authApi.addMember !== 'function') {
      return {
        status: 501,
        body: {
          success: false,
          error: {
            code: 'NOT_IMPLEMENTED',
            message:
              'This server cannot add a new user to your organization while creating them, so no user was created.',
          },
        },
      };
    }
    join = { seam, addMember: authApi.addMember.bind(authApi), organizationId };
  }

  // [#25338] Everything the grant needs is settled BEFORE the account exists,
  // so a host that cannot judge the grant refuses with nothing created.
  let grant: { seam: AdminCreateGrantSeam; engine: AdminUserDataEngine; context: Record<string, unknown> } | undefined;
  if (permissionSet !== undefined) {
    const seam = deps.createGrant;
    const engine = deps.getDataEngine();
    if (!seam || !engine) {
      return {
        status: 501,
        body: {
          success: false,
          error: {
            code: 'NOT_IMPLEMENTED',
            message:
              'This server cannot assign a permission set while creating a user, so no user was created. '
              + 'Create the user without one, then add the grant on their Permission Sets list.',
          },
        },
      };
    }
    const context = await seam.resolveActorContext();
    if (!context) {
      return {
        status: 403,
        body: {
          success: false,
          error: {
            code: 'PERMISSION_DENIED',
            message:
              'Your own access could not be resolved, so the permission set could not be judged and no user was created.',
          },
        },
      };
    }
    grant = { seam, engine, context };
  }

  const createAccount = async (): Promise<CreatedAccount | EndpointResult> => {
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
        body: { success: false, error: { code: 'INTERNAL_ERROR', message: 'better-auth returned no user id' } },
      };
    }

    const stamped = mustChangePassword
      ? await stampMustChangePassword(deps, userId, true)
      : false;

    // In multi-org mode the administrator's current organization is joined
    // explicitly (the add-member act, ADR-0093 D1, D3 amendment). Otherwise match the invite / add-member
    // flows: give the new user a membership so a single-org deployment shows
    // them under the Default Organization instead of as a member-less account.
    // No-op in multi-org (≥2 orgs), and no-op under
    // `membershipPolicy: 'invite-only'` (ADR-0093 D1) — see the helper.
    const membership = join
      ? await joinCurrentOrganization(deps, join.addMember, userId, join.organizationId)
      : await bindUserToSoleOrganization(deps, userId);

    // [#25338] The grant, under the administrator's own context (see
    // `AdminCreateGrantSeam`). A refusal throws, and the unit of work around
    // this function rolls the account back with it.
    if (grant && permissionSet !== undefined) {
      try {
        await grant.engine.insert(
          'sys_user_permission_set',
          { user_id: userId, permission_set: permissionSet },
          { context: grant.context },
        );
      } catch (error) {
        throw new CreationRefused(grantRefusal(error));
      }
    }

    return { created, userId, stamped, membership };
  };

  let account: CreatedAccount | EndpointResult;
  const unitOfWork = grant?.seam ?? join?.seam;
  if (unitOfWork) {
    try {
      // A creation that fails answers without throwing: nothing landed, so
      // there is nothing to roll back.
      account = await unitOfWork.runAtomically(createAccount);
    } catch (error) {
      if (error instanceof CreationRefused) return error.result;
      throw error;
    }
  } else {
    account = await createAccount();
  }
  if ('status' in account) return account;
  const { created, userId, stamped, membership } = account;

  // The decisions only. The values this call wrote into the user's fields —
  // the identity, the role scalar, the must-change-password stamp — are on
  // plugin-audit's mirror rows for those same writes (see `writeAdminAudit`).
  await writeAdminAudit(deps, {
    action: 'create',
    actor,
    recordId: userId,
    metadata: {
      event: 'user.admin_created',
      placeholderEmail: !hasEmail,
      passwordGenerated: resolved.generated,
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
        ...(permissionSet !== undefined ? { permissionSet } : {}),
        ...(resolved.generated ? { temporaryPassword: resolved.password } : {}),
      },
    },
  };
}

/** What `runAdminCreateUser`'s unit of work hands back when the account exists. */
interface CreatedAccount {
  created: { user?: { id?: string; email?: string; name?: string } } | null;
  userId: string;
  stamped: boolean;
  membership: { organizationId: string | null; membershipCreated: boolean };
}

/** [#25338] Thrown out of the unit of work so it rolls back; carries the refusal the caller answers. */
class CreationRefused extends Error {
  constructor(readonly result: EndpointResult) {
    super(result.body.error?.message ?? 'user creation refused');
    this.name = 'CreationRefused';
  }
}

/**
 * Join the new user to the administrator's current organization, as a
 * `member` — the same act as the organization's Add Member action, folded into
 * the creation so the administrator does not have to perform it afterwards.
 *
 * It goes through better-auth's own server-only `addMember` (as the
 * `/organization/add-member` mount does), so the vendor's checks — the
 * organization exists, the membership limit, its hooks — all stay the
 * vendor's. A refusal throws, and the unit of work around the creation rolls
 * the account back with it.
 *
 * ADR-0093 D3 amendment: this is NOT the reconciler guessing a tenant (D3 —
 * it still binds nothing in multi mode); it is the organization the
 * administrator is working in, which makes it an explicit flow that
 * `membershipPolicy: 'invite-only'` admits (D1). The role is `member`, the D1
 * default: elevation stays the separate, audited `update-member-role`.
 *
 * A membership already there is respected and reported as
 * `membershipCreated: false`, exactly as the reconciler reports it.
 */
async function joinCurrentOrganization(
  deps: AdminUserEndpointDeps,
  addMember: AddMemberCapableApi['addMember'],
  userId: string,
  organizationId: string,
): Promise<{ organizationId: string; membershipCreated: boolean }> {
  const engine = deps.getDataEngine();
  if (engine?.find) {
    const existing = await engine.find(
      'sys_member',
      { where: { organization_id: organizationId, user_id: userId }, limit: 1 },
      { context: SYSTEM_CTX },
    );
    if (Array.isArray(existing) && existing.length > 0) return { organizationId, membershipCreated: false };
  }
  try {
    await addMember({ body: { userId, role: 'member', organizationId } });
  } catch (error) {
    const refused = mapAuthApiError(error, 'organization/add-member failed');
    throw new CreationRefused({
      status: refused.status,
      body: {
        success: false,
        error: {
          code: refused.body.error?.code ?? 'INTERNAL_ERROR',
          message: `The user could not be added to the organization, so no user was created: ${
            refused.body.error?.message ?? 'organization/add-member failed'
          }`,
        },
      },
    });
  }
  return { organizationId, membershipCreated: true };
}

/**
 * Whether this creation joins the administrator's current organization: multi-org
 * mode only (ADR-0093 D3 amendment), judged by `tenancy.isolationActive` — the
 * predicate behind `features.multiOrgEnabled`, so a single-org deployment and a
 * degraded walled request (which serves single-org-like) keep the reconciler's
 * default-organization bind, unchanged. A host that wires no way to read the
 * caller's current organization does not join either.
 */
function multiOrgCreationJoinsCurrentOrganization(deps: AdminUserEndpointDeps): boolean {
  return deps.getTenancy?.()?.isolationActive === true && typeof deps.getCallerActiveOrganizationId === 'function';
}

/**
 * [#25338] The answer for a refused grant: the status and code the refusal
 * itself declared (403 `PERMISSION_DENIED` from the D12 gate, 400
 * `VALIDATION_FAILED` with its `fields` for a name the catalog does not hold),
 * read as the data doors read a thrown error, and a sentence saying the user
 * was not created either.
 */
function grantRefusal(error: unknown): EndpointResult {
  const thrown = resolveThrownHttpError(error, 500);
  const validation = validationFailureDetails(error);
  return {
    status: thrown.status,
    body: {
      success: false,
      error: {
        code: thrown.code,
        message: `The permission set was not assigned, so no user was created: ${thrown.message}`,
        ...(validation ? { fields: validation.fields } : {}),
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
  const read = await parseJson(request);
  if (!read.ok) return badRequest(read.message);
  const body = read.body;

  const userId = body.userId ?? body.user_id;
  if (typeof userId !== 'string' || userId.length === 0) {
    return badRequest('userId is required');
  }
  const mustChangePassword = body.mustChangePassword !== false; // default true
  // [#23287 — ruling C′ item 2] The forced reset's explicit revocation switch:
  // revoke the user's sessions and API keys. ON by default, because the act
  // records no reason and the ruling sets the default for a suspected
  // compromise — the case where a surviving key is the hole the reset was meant
  // to close. An administrator doing a routine reset turns it off explicitly
  // (`revokeSessionsAndKeys: false`). Only a literal boolean switches it off; a
  // malformed value keeps the safe default.
  const revokeSessionsAndKeys = body.revokeSessionsAndKeys !== false;

  let authCtx: AuthContextLike;
  try {
    authCtx = await deps.getAuthContext();
  } catch (error) {
    return mapAuthApiError(error, 'set-user-password failed');
  }
  const resolved = await resolvePassword(deps, body, 'newPassword', authCtx.password.config);
  if ('status' in resolved) return resolved;

  try {
    if (!(await authCtx.internalAdapter.findUserById(userId))) {
      return { status: 404, body: { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'User not found' } } };
    }

    // [#25083] On a cloud-managed environment a password is set here only on
    // a local account. An `idp_provisioned` user signs in through the hosting
    // organisation's identity provider, which owns their password; an
    // `env_native` row (the break-glass administrator among them) still
    // answers, because ADR-0135 D5.2 narrows by population, never wholesale.
    if (isCloudManaged()) {
      const source = await readUserSource(deps, userId);
      if (!source.ok) {
        return {
          status: 503,
          body: {
            success: false,
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message:
                "The user's identity source could not be read, so whether this cloud-managed environment may set "
                + 'their password here cannot be judged. No password was changed.',
            },
          },
        };
      }
      if (source.value === 'idp_provisioned') return cloudManagedRefusal('setUserPassword');
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

  // Revoked AFTER the new password is set, so a session the old password
  // opened cannot outlive the reset, and never before it: a revocation that
  // ran and then a failed password write would sign the user out with their
  // old password still the valid one.
  const revocation: ForcedResetRevocationOutcome | undefined = revokeSessionsAndKeys
    ? await revokeSessionsAndApiKeys(deps.getDataEngine(), userId, { logger: deps.logger })
    : undefined;

  await writeAdminAudit(deps, {
    action: 'update',
    actor,
    recordId: userId,
    // The must-change-password stamp is a field write on the user, recorded by
    // plugin-audit's mirror row for it — not copied here (see `writeAdminAudit`).
    metadata: {
      event: 'user.admin_password_set',
      passwordGenerated: resolved.generated,
      // [#23287] Whether the administrator asked for the revocation, and what
      // landed — counts only, never a session token or a key.
      revokeSessionsAndKeys,
      ...(revocation
        ? {
            revokedSessions: revocation.sessions,
            revokedApiKeys: revocation.apiKeys,
            revocationComplete: revocation.complete,
          }
        : {}),
    },
  });

  return {
    status: 200,
    body: {
      success: true,
      data: {
        userId,
        mustChangePassword: mustChangePassword && stamped,
        // [#23287] The administrator is TOLD what the switch did: an
        // incomplete revocation is a fact on the response, never a silent one.
        revokeSessionsAndKeys,
        ...(revocation ? { revoked: revocation } : {}),
        ...(resolved.generated ? { temporaryPassword: resolved.password } : {}),
      },
    },
  };
}
