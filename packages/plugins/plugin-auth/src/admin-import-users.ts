// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Identity bulk import — `POST /api/v1/auth/admin/import-users` (#2766 V2,
 * re-scoped from #2758).
 *
 * Why a dedicated endpoint instead of opening sys_user's generic import
 * affordance: the generic `/data/:object/import` path writes rows straight
 * through ObjectQL, which would bypass better-auth's password hashing and
 * never create the `sys_account` credential row — every "imported user" would
 * be a dead row that can never sign in. This endpoint reuses the generic
 * import *framework* (payload parsing via `prepareImportRequest`, the row
 * engine via `runImport`) but swaps the write path for an identity-specific
 * `ImportProtocolLike` whose `createData` drives `auth.api.createUser`.
 *
 * Password policies (per-request `passwordPolicy`, default `auto`):
 *  - `auto`       — THE DEFAULT (#3236). Decides PER ROW, preferring the
 *                   invite path and falling back to a temporary password only
 *                   where a row genuinely can't be reached. A row with a
 *                   deliverable channel — a REAL email + a wired EmailService,
 *                   or a phone + a wired SMS-invite path — is invited, so no
 *                   shared secret ever leaves the server. A row with no
 *                   deliverable channel (placeholder email, phone-only without
 *                   SMS, or an email row when no email service is wired) falls
 *                   back to `temporary`. This shrinks the temporary-password
 *                   blast radius from "the whole batch" to "only the rows with
 *                   no channel", and — unlike `invite` — it never rejects the
 *                   request for missing infrastructure: undeliverable rows just
 *                   degrade to temporary. The per-row outcome is surfaced as
 *                   `rows[].delivery` (`email` | `sms` | `temporary`).
 *  - `invite`     — force the invite path for EVERY row: better-auth's
 *                   reset-password mints the credential account on first set, so
 *                   creation stays credential-less, and a "set your password"
 *                   invitation goes out — a reset-password email for rows with a
 *                   REAL email (requires a wired EmailService), or — #2780 — an
 *                   invitation SMS for phone-only rows (requires a wired,
 *                   deliverable SmsService + the phoneNumber plugin; the user
 *                   first signs in via phone OTP and then sets a password). Rows
 *                   that aren't reachable are FAILED per-row (never silently
 *                   downgraded) — pick this when a temporary-password fallback
 *                   is unacceptable.
 *  - `temporary`  — force the no-infrastructure path (no email, no SMS) for
 *                   every row: each created account gets a generated temporary
 *                   password, `must_change_password` is stamped (403
 *                   PASSWORD_EXPIRED until changed), and the passwords are
 *                   returned ONCE in the HTTP response, one per row. Never
 *                   persisted, never logged.
 *  - `none`       — identity only: no password, no invitation. better-auth
 *                   creates the account without a credential record, and the
 *                   user's first sign-in is channel-based (phone OTP, magic
 *                   link, or an email reset link). The Console detects
 *                   credential-less accounts (`hasLocalPassword()`) and offers
 *                   `set-initial-password`. Pick this to provision identity now
 *                   and defer all credential delivery.
 *
 * Deliberate limits:
 *  - Synchronous only, ≤ IMPORT_USERS_MAX_ROWS rows per request. scrypt
 *    hashing costs ~100ms/row, so bigger batches belong in an async job —
 *    which can't carry temporary passwords anyway (a job result is a
 *    persistence surface; red line). Callers split large files into batches.
 *  - No undo. Undoing an identity import would bulk-delete users and their
 *    credentials — the risk dwarfs the convenience.
 *  - Upsert updates only touch profile fields (UPDATE_ALLOWED_FIELDS);
 *    credentials and the email identity are never modified on update, so a
 *    re-imported CSV can never silently reset an existing user's password.
 *
 * ## `manager_id` — admitted, and resolved in a SECOND pass (#18028)
 *
 * Ruling `5651634638` row 7: the import tier admits `manager_id`, resolved in a
 * second pass keyed on the importer's identity key, with every row-level
 * refusal of the admin write surface applied and an unresolved key reported as
 * a PER-ROW error.
 *
 *  - **What the column holds is an identity key, not a user id.** A CSV author
 *    has the manager's email or phone, never their `usr_…` id, so the cell is
 *    read with the same key this importer already keys rows by — one key, ⛔ not
 *    a second one invented for this column.
 *  - **Why the pass is SECOND and not inline.** A manager named in row 40 may
 *    be created by row 90. Resolving inside `createData` would refuse valid
 *    input whenever the file is not topologically ordered, which no export
 *    guarantees. So the column is stripped from the row before the write
 *    (⛔ it never reaches `createData` / `updateData`, and ⛔ it is not added to
 *    UPDATE_ALLOWED_FIELDS) and the links are applied after `runImport` has
 *    returned, when every row in the batch exists.
 *  - **Where the refusals come from.** `applyUserManagerLink` — the same
 *    derivation `POST /admin/set-user-manager` runs, imported, ⛔ never copied.
 *    Self-assignment, cycle, depth cap, cross-organization and directory-owned
 *    identity are that function's to answer, and the refusal it returns is
 *    reported on the row rather than re-worded here.
 *  - **A manager problem never costs the row its identity.** The user is
 *    created either way and the failure rides `rows[].code` / `rows[].error`,
 *    exactly like the sibling post-write `INVITE_EMAIL_FAILED`; `rows[].manager`
 *    carries the machine-readable outcome in `rows[].delivery`'s shape. ⛔ Not a
 *    whole-import failure, and ⛔ not a silent skip.
 *  - **The pass does not run on `dryRun`.** It is a post-write pass like
 *    delivery: with nothing created there are no ids to link, and the five
 *    refusals cannot be evaluated against rows that do not exist. A dry run
 *    reports `manager: { linked: 0, unresolved: 0, refused: 0 }` and says
 *    nothing about the links — ⛔ rather than half-answering.
 */

import type {
  PreparedImport,
  ImportProtocolLike,
  ImportRowResult,
} from '@objectstack/rest';
import { prepareImportRequest, runImport } from '@objectstack/rest';
import { generatePlaceholderEmail, isPlaceholderEmail } from './placeholder-email.js';
import { generateTemporaryPassword, normalizePhoneNumber, isLikelyEmail, type AdminActor, type EndpointResult } from './admin-user-endpoints.js';
import { SYS_USER_IMPORT_UPDATE_FIELDS } from './sys-user-writable-fields.js';
import {
  applyUserManagerLink,
  type SetUserManagerDeps,
  type SetUserManagerRefusalReason,
} from './admin-set-user-manager.js';

export const IMPORT_USERS_MAX_ROWS = 500;

/**
 * The column a row names its manager in. Its value is the MANAGER'S IDENTITY
 * KEY — an email or a phone number, the same two the importer keys rows by.
 *
 * One spelling, deliberately. The phone column's three historical aliases
 * (`phone_number` / `phoneNumber` / `phone`) are debt this key does not
 * inherit: Prime Directive #12 refuses a new dialect on an internal contract.
 */
const MANAGER_COLUMN = 'manager_id';

/**
 * Profile fields an upsert row may modify on an EXISTING user — shared with
 * the identity write guard's Tier-1 whitelist via sys-user-writable-fields.ts
 * (ADR-0092 D3: one file, one derivation; the import surface is a strict
 * superset that additionally allows `phone_number` / `role`).
 */
const UPDATE_ALLOWED_FIELDS = SYS_USER_IMPORT_UPDATE_FIELDS;

export interface IdentityImportEngine {
  find(objectName: string, query?: any): Promise<any[]>;
  update(objectName: string, data: any, options?: any): Promise<any>;
  insert(objectName: string, data: any, options?: any): Promise<any>;
  /**
   * [#12981] Optional registry probe — `ObjectQL.getSchema`, which answers
   * `undefined` for an object no package registered.
   *
   * Separates the two outcomes the run-level audit `catch` used to spell
   * identically: plugin-audit UNINSTALLED (no `sys_audit_log` object — nothing
   * was ever claimed, so silence is correct) from plugin-audit INSTALLED AND
   * THE WRITE REFUSED (the import ran, its only run-level record did not land,
   * and the endpoint still answers 200). Optional, therefore additive: a host
   * or mock without it keeps type-checking, and a site that cannot measure the
   * difference REPORTS rather than going quiet.
   */
  getSchema?(objectName: string): unknown;
}

export interface IdentityImportDeps {
  /** better-auth server api (createUser + requestPasswordReset). */
  getAuthApi(): Promise<any>;
  getDataEngine(): IdentityImportEngine | undefined;
  /** Optional metadata reader for field coercion (best-effort). */
  getMetaItem?(ref: { type: string; name: string }): Promise<any>;
  phoneNumberEnabled(): boolean;
  emailServiceAvailable(): boolean;
  /**
   * #2780 — can phone-only rows take the SMS-invite path? True when the
   * phoneNumber plugin is on AND a deliverable SMS service is wired (the
   * user must be able to complete phone-OTP first sign-in).
   */
  smsInviteAvailable(): boolean;
  /** #2780 — deliver the invitation SMS (no credential in the message). */
  sendInviteSms(phone: string): Promise<void>;
  noteMustChangePasswordIssued(): void;
  logger?: { warn(msg: string): void };
}

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

export type ImportPasswordPolicy = 'auto' | 'none' | 'invite' | 'temporary';

/**
 * The delivery decision for a single created row, resolved up front from the
 * request policy and the row's own reachability. `auto` picks per row; every
 * other policy resolves the same plan for every row. createData acts on
 * `kind`; the post-write pass acts on the recorded channel.
 */
type RowPlan =
  | { kind: 'none' }
  | { kind: 'temporary' }
  | { kind: 'invite'; channel: 'email' | 'sms' };

interface RowIdentity {
  email?: string;
  phone?: string;
  /** Set on valid rows — how this row's credential is delivered. */
  plan?: RowPlan;
  invalid?: { code: string; error: string };
}

/**
 * Resolve a raw row's identity columns. Accepts `email` plus any of
 * `phone_number` / `phoneNumber` / `phone` for the phone column (normalized
 * in place to `phone_number`).
 */
function resolveRowIdentity(
  row: Record<string, any>,
  opts: {
    policy: ImportPasswordPolicy;
    phoneEnabled: boolean;
    emailInviteOk: boolean;
    smsInviteOk: boolean;
  },
): RowIdentity {
  const rawEmail = typeof row.email === 'string' ? row.email.trim() : '';
  const hasEmail = rawEmail.length > 0;
  if (hasEmail && !isLikelyEmail(rawEmail)) {
    return { invalid: { code: 'INVALID_EMAIL', error: `"${rawEmail}" is not a valid email` } };
  }
  if (hasEmail && isPlaceholderEmail(rawEmail)) {
    return { invalid: { code: 'INVALID_EMAIL', error: 'Placeholder addresses cannot be imported as emails' } };
  }

  const rawPhone = row.phone_number ?? row.phoneNumber ?? row.phone;
  const hasPhone = typeof rawPhone === 'string' && rawPhone.trim().length > 0;
  let phone: string | undefined;
  if (hasPhone) {
    if (!opts.phoneEnabled) {
      return { invalid: { code: 'PHONE_NOT_ENABLED', error: 'Phone columns require the phoneNumber auth plugin (auth.plugins.phoneNumber)' } };
    }
    phone = normalizePhoneNumber(String(rawPhone));
    if (!phone) {
      return { invalid: { code: 'INVALID_PHONE', error: `"${rawPhone}" is not a valid phone number (E.164 recommended)` } };
    }
  }

  if (!hasEmail && !phone) {
    return { invalid: { code: 'NO_IDENTITY', error: 'Row needs an email or a phone_number' } };
  }

  const email = hasEmail ? rawEmail.toLowerCase() : undefined;
  const emailDeliverable = hasEmail && opts.emailInviteOk;
  const smsDeliverable = !!phone && opts.smsInviteOk;

  // `invite` FAILS rows it can't reach (never a silent downgrade); `auto`
  // prefers the invite path but falls back to `temporary` for the same
  // unreachable rows instead of failing them (#3236). Validated per row so a
  // mixed file only fails / downgrades the rows it must.
  if (opts.policy === 'invite') {
    if (hasEmail && !opts.emailInviteOk) {
      return {
        invalid: {
          code: 'EMAIL_SERVICE_REQUIRED',
          error: 'This row\'s invitation needs a configured email service — wire an EmailService, or use the "auto" (fallback) or "temporary" policy',
        },
      };
    }
    if (!hasEmail && !opts.smsInviteOk) {
      return {
        invalid: {
          code: 'INVITE_REQUIRES_EMAIL',
          error: 'The invite policy needs a real email for this row — configure SMS delivery (phone OTP) for SMS invitations, or use the "auto" (fallback) or "temporary" policy',
        },
      };
    }
  }

  let plan: RowPlan;
  switch (opts.policy) {
    case 'none':
      plan = { kind: 'none' };
      break;
    case 'temporary':
      plan = { kind: 'temporary' };
      break;
    case 'invite':
      // Reachability validated just above — email rows go email, the rest SMS.
      plan = { kind: 'invite', channel: hasEmail ? 'email' : 'sms' };
      break;
    default: // 'auto' — invite where deliverable, temporary fallback otherwise.
      plan = emailDeliverable
        ? { kind: 'invite', channel: 'email' }
        : smsDeliverable
          ? { kind: 'invite', channel: 'sms' }
          : { kind: 'temporary' };
      break;
  }

  return { email, phone, plan };
}

/**
 * Stable per-row lookup key for {@link RowPlan}. A phone-only row's final email
 * is a placeholder minted inside createData, so it can't be the key — key email
 * rows by their (real, lowercased) email and phone-only rows by phone.
 */
function identityKey(email?: string, phone?: string): string {
  if (email) return `e:${email.toLowerCase()}`;
  if (phone) return `p:${phone}`;
  return '';
}

/**
 * A row's manager outcome — the machine-readable half, carried in
 * `rows[].delivery`'s shape rather than dug out of a message.
 *
 * `'linked'` and `'unresolved'` are this importer's two answers; every other
 * member is a {@link SetUserManagerRefusalReason} produced by the shared
 * derivation and passed through verbatim, so the importer and
 * `POST /admin/set-user-manager` discriminate refusals identically.
 */
export type ImportManagerOutcome = 'linked' | 'unresolved' | SetUserManagerRefusalReason;

/**
 * One row of the endpoint's `data.rows[]` — the generic import row plus the
 * three things this identity surface adds to it. Named because callers read
 * `manager` and `delivery` to decide what to show an operator, and an inline
 * type on one `const` is not something a Console can import.
 */
export interface IdentityImportRowResult extends ImportRowResult {
  /** Returned ONCE, never persisted — `temporary` rows only. */
  temporaryPassword?: string;
  /** How this created row's credential was delivered. */
  delivery?: 'email' | 'sms' | 'temporary';
  /**
   * Present only on rows that named a manager. Absent means the row's
   * {@link MANAGER_COLUMN} cell was empty — ⛔ never "the link silently failed".
   */
  manager?: ImportManagerOutcome;
}

/**
 * Stamp a row's manager failure.
 *
 * `manager` is ALWAYS set — that is this outcome's own channel. `code`/`error`
 * is the SHARED row error channel the sibling `INVITE_EMAIL_FAILED` also writes
 * to, so it is claimed only when free: a row whose invitation already failed
 * keeps that report and still carries its manager verdict on `manager`,
 * ⛔ rather than one of the two failures overwriting the other into silence.
 */
function noteManagerFailure(
  row: IdentityImportRowResult,
  outcome: ImportManagerOutcome,
  code: string,
  message: string,
): void {
  row.manager = outcome;
  if (row.code === undefined) {
    row.code = code;
    row.error = message;
  }
}

/**
 * A manager cell, read as an identity key.
 *
 * `'absent'` = the cell was empty, which is not a problem and is not reported.
 * `'unreadable'` = it held something that is neither an email nor (where the
 * phoneNumber plugin is wired) a phone number — reported per row, because a
 * typo in a manager cell must never pass for "this user has no manager".
 */
interface ManagerKeyRef {
  /** The `identityKey()` spelling — `e:<email>` or `p:<phone>`. */
  key: string;
  email?: string;
  phone?: string;
}

function resolveManagerKey(
  raw: unknown,
  phoneEnabled: boolean,
): ManagerKeyRef | 'absent' | 'unreadable' {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length === 0) return 'absent';
  if (isLikelyEmail(value)) {
    const email = value.toLowerCase();
    return { key: identityKey(email, undefined), email };
  }
  if (!phoneEnabled) return 'unreadable';
  const phone = normalizePhoneNumber(value);
  if (!phone) return 'unreadable';
  return { key: identityKey(undefined, phone), phone };
}

export async function runAdminImportUsers(
  deps: IdentityImportDeps,
  request: Request,
  actor: AdminActor,
): Promise<EndpointResult> {
  let body: any = {};
  try { body = await request.json(); } catch { body = {}; }
  const fail = (status: number, code: string, message: string): EndpointResult => ({
    status, body: { success: false, error: { code, message } },
  });

  // ── Request-level validation ─────────────────────────────────────────
  // Default policy: `auto` (#3236) — prefer the invite path (no shared secret
  // leaves the server) and fall back to a temporary password only for rows
  // with no deliverable channel. Robust to whatever infra is (or isn't) wired:
  // it never rejects for missing email/SMS, it just degrades those rows to
  // temporary. `none` is still available for identity-only imports.
  const policy: ImportPasswordPolicy = body?.passwordPolicy === undefined ? 'auto' : body.passwordPolicy;
  if (policy !== 'auto' && policy !== 'none' && policy !== 'invite' && policy !== 'temporary') {
    return fail(400, 'INVALID_REQUEST', 'passwordPolicy must be "auto" (default), "none", "invite", or "temporary"');
  }
  const mode = body?.mode === 'upsert' ? 'upsert' : body?.mode === 'insert' || body?.mode === undefined ? 'insert' : undefined;
  if (!mode) return fail(400, 'INVALID_REQUEST', 'mode must be "insert" or "upsert"');
  const matchBy = body?.matchBy === 'phone' ? 'phone' : body?.matchBy === 'email' || body?.matchBy === undefined ? 'email' : undefined;
  if (!matchBy) return fail(400, 'INVALID_REQUEST', 'matchBy must be "email" or "phone"');
  if (matchBy === 'phone' && !deps.phoneNumberEnabled()) {
    return fail(400, 'PHONE_NOT_ENABLED', 'matchBy "phone" requires the phoneNumber auth plugin (auth.plugins.phoneNumber)');
  }
  const emailInviteOk = deps.emailServiceAvailable();
  const smsInviteOk = deps.smsInviteAvailable();
  if (policy === 'invite' && !emailInviteOk && !smsInviteOk) {
    // Reject up front — otherwise N accounts get created whose invitations
    // all fail (and outside dev we refuse to log the reset links). With at
    // least one channel wired, per-row validation covers the rest.
    return fail(400, 'EMAIL_SERVICE_REQUIRED', 'The invite policy requires a configured email service (or SMS delivery for phone-only rows). Use the temporary policy or wire an EmailService / SmsService.');
  }
  if (body?.async === true) {
    // Async jobs are a persistence surface — they can't carry temporary
    // passwords (red line), and the invite flow at job scale needs the shared
    // job worker. Tracked as a follow-up; batches of ≤500 cover the V2 need.
    return fail(400, 'ASYNC_NOT_SUPPORTED', `Async identity import is not supported yet — split the file into batches of at most ${IMPORT_USERS_MAX_ROWS} rows.`);
  }

  const engine = deps.getDataEngine();
  if (!engine) return fail(503, 'SERVICE_UNAVAILABLE', 'Data engine unavailable');

  // ── Payload parsing (shared generic-import parser) ───────────────────
  const prep = await prepareImportRequest(
    {
      ...body,
      writeMode: mode,
      matchFields: [matchBy === 'phone' ? 'phone_number' : 'email'],
      runAutomations: false,
      // Identity semantics: a row whose match key is blank must never
      // fall through to "create a second account" on upsert.
      skipBlankMatchKey: true,
    },
    {
      p: { ...(deps.getMetaItem ? { getMetaItem: deps.getMetaItem } : {}) },
      objectName: 'sys_user',
      maxRows: IMPORT_USERS_MAX_ROWS,
    },
  );
  if (!prep.ok) return fail(prep.status, prep.code, prep.error);
  const prepared: PreparedImport = prep.prepared;

  // ── Identity pre-validation (runs for dryRun too) ────────────────────
  const phoneEnabled = deps.phoneNumberEnabled();
  const results: IdentityImportRowResult[] = new Array(prepared.rows.length);
  const validRows: Array<Record<string, any>> = [];
  const validIndex: number[] = [];
  // Per-row delivery plan, keyed by identity so createData (which sees a
  // coerced COPY of the row, not the original object) can look it up. `auto`
  // decides each row here; every other policy resolves the same plan for all.
  const planByKey = new Map<string, RowPlan>();
  // [#18028] The manager cell each row named, and that row's own identity —
  // both indexed by ORIGINAL row number, which is what the second pass walks.
  // `undefined` in `managerWanted` means the row named nobody.
  const managerWanted: Array<ManagerKeyRef | 'unreadable' | undefined> = new Array(prepared.rows.length);
  const rowIdentities: Array<RowIdentity | undefined> = new Array(prepared.rows.length);
  for (let i = 0; i < prepared.rows.length; i++) {
    const row = { ...prepared.rows[i] };
    // [#18028] Read the manager cell and STRIP it before anything else sees the
    // row: it holds an identity key, so leaving it in place would hand a lookup
    // column an email address. The second pass owns it from here.
    const wanted = resolveManagerKey(row[MANAGER_COLUMN], phoneEnabled);
    delete row[MANAGER_COLUMN];
    const identity = resolveRowIdentity(row, { policy, phoneEnabled, emailInviteOk, smsInviteOk });
    if (identity.invalid) {
      results[i] = { row: i + 1, ok: false, action: 'failed', code: identity.invalid.code, error: identity.invalid.error };
      continue;
    }
    // Canonicalize the identity columns for coercion + match lookups.
    delete row.phoneNumber; delete row.phone;
    if (identity.email) row.email = identity.email; else delete row.email;
    if (identity.phone) row.phone_number = identity.phone; else delete row.phone_number;
    if (identity.plan) planByKey.set(identityKey(identity.email, identity.phone), identity.plan);
    if (wanted !== 'absent') managerWanted[i] = wanted;
    rowIdentities[i] = identity;
    validRows.push(row);
    validIndex.push(i);
  }

  // ── Identity write protocol (the part generic import must NOT do) ────
  const temporaryPasswords = new Map<string, string>(); // record id → temp password
  const inviteTargets = new Map<string, { channel: 'email' | 'sms'; email: string; phone?: string }>();
  const authApi = await deps.getAuthApi();
  if (typeof authApi.createUser !== 'function') {
    return fail(501, 'NOT_IMPLEMENTED', 'The better-auth admin plugin is not enabled (auth.plugins.admin)');
  }

  const protocol: ImportProtocolLike = {
    // [#16638] findExisting path: the CANONICAL QueryAST against sys_user.
    // `runImport` hands this handle a `FindDataRequest`, and the `QuerySchema`
    // that request declares carries `where` / `limit` — it declares neither
    // `$filter` nor `$top`. Those two are wire-only spellings the protocol
    // normalizer folds for a caller off the HTTP door; this protocol is
    // hand-written and never passes through that normalizer, so it must read
    // the canonical keys itself.
    //
    // Two dialects would be the lenient `??` alias Prime Directive #12 forbids,
    // and the default is not a harmless belt either: a `where` that falls back
    // to `{}` stops constraining anything, so the duplicate probe matches rows
    // it was given no key for and the upsert updates the WRONG user. One
    // dialect, read straight — a request that arrives without a `query` is a
    // caller defect and is refused loudly, not softened into match-everything.
    //
    // [#17422] The parameter is deliberately UNANNOTATED: `ImportProtocolLike`
    // types it, and an explicit annotation here would win over that contextual
    // type and opt this implementor back out of the contract (the runner's own
    // docblock says so). `FindDataRequest` declares `query` OPTIONAL, so the
    // contract makes this file write its refusal down instead of leaving it as
    // an incidental TypeError from a property read on `undefined`.
    // ⛔ Not `args.query ?? {}` and ⛔ not `args.query?.where`: both spell
    // match-everything, which is the exact regression this protocol's history
    // is about.
    async findData(args) {
      const query = args.query;
      if (!query) {
        throw Object.assign(
          new Error('import-users: findData was called without a query — refusing to match every user'),
          { code: 'INVALID_REQUEST' },
        );
      }
      const where = query.where;
      const limit = query.limit;
      return engine.find(args.object, { where, limit, context: SYSTEM_CTX } as any);
    },

    // One better-auth create per row — hashing + credential sys_account.
    // Deliberately NO createManyData: there is no safe bulk primitive for
    // identities, and scrypt dominates the cost anyway.
    async createData(args) {
      const data: Record<string, any> = args?.data ?? {};
      const email: string = typeof data.email === 'string' && data.email.length > 0
        ? data.email
        : generatePlaceholderEmail(); // phone-only rows (none/temporary, or invite via SMS)
      const placeholder = !(typeof data.email === 'string' && data.email.length > 0);
      const phone: string | undefined = typeof data.phone_number === 'string' && data.phone_number.length > 0 ? data.phone_number : undefined;
      const name: string = typeof data.name === 'string' && data.name.trim().length > 0
        ? data.name.trim()
        : placeholder ? (phone as string) : email.split('@')[0];
      const role: string | undefined = typeof data.role === 'string' && data.role.length > 0 ? data.role : undefined;

      // The per-row plan was resolved in pre-validation (`auto` decides per
      // row; other policies resolve the same plan for all). Key by the row's
      // REAL email (placeholder is only minted here) or its phone.
      const plan: RowPlan =
        planByKey.get(identityKey(placeholder ? undefined : email, phone))
        // Defensive: valid rows always seed a plan. Mirror the request policy.
        ?? (policy === 'none'
          ? { kind: 'none' }
          : policy === 'invite'
            ? { kind: 'invite', channel: placeholder ? 'sms' : 'email' }
            : { kind: 'temporary' });

      // Only the temporary path sets a password. Invite / none create
      // credential-less accounts (better-auth: omitted password → no
      // credential record); the credential is minted later by the user via
      // set-initial-password / the reset flow, which creates it on demand.
      const password = plan.kind === 'temporary' ? generateTemporaryPassword() : undefined;

      const created = await authApi.createUser({
        body: {
          email,
          name,
          ...(password ? { password } : {}),
          ...(role ? { role } : {}),
          ...(phone ? { data: { phoneNumber: phone } } : {}),
        },
      });
      const id = created?.user?.id != null ? String(created.user.id) : undefined;
      if (!id) throw Object.assign(new Error('better-auth returned no user id'), { code: 'CREATE_FAILED' });

      if (plan.kind === 'temporary') {
        temporaryPasswords.set(id, password as string);
        try {
          await engine.update('sys_user', { id, must_change_password: true }, { context: SYSTEM_CTX } as any);
          deps.noteMustChangePasswordIssued();
        } catch (e) {
          deps.logger?.warn(`[AuthPlugin] import-users: failed to stamp must_change_password for ${id}: ${(e as Error)?.message ?? e}`);
        }
      } else if (plan.kind === 'invite') {
        inviteTargets.set(id, { channel: plan.channel, email, ...(phone ? { phone } : {}) });
      }
      // `none`: nothing else to do — identity only.
      return { id };
    },

    // Upsert updates touch PROFILE fields only — never email, never anything
    // credential- or system-managed. An empty filtered patch is a no-op.
    async updateData(args) {
      const patch: Record<string, any> = {};
      for (const [k, v] of Object.entries(args?.data ?? {})) {
        if (UPDATE_ALLOWED_FIELDS.has(k) && v !== undefined && v !== null && v !== '') patch[k] = v;
      }
      if (Object.keys(patch).length === 0) return { id: args.id };
      await engine.update('sys_user', { id: args.id, ...patch }, { context: SYSTEM_CTX } as any);
      return { id: args.id };
    },
  };

  // ── Run the shared row engine over the valid rows ─────────────────────
  const summary = await runImport({
    p: protocol,
    objectName: 'sys_user',
    rows: validRows,
    metaMap: prepared.metaMap,
    writeMode: prepared.writeMode,
    matchFields: prepared.matchFields,
    dryRun: prepared.dryRun,
    runAutomations: false,
    trimWhitespace: prepared.trimWhitespace,
    nullValues: prepared.nullValues,
    createMissingOptions: false,
    skipBlankMatchKey: true,
    captureUndo: false, // undo = bulk-deleting users; deliberately unsupported
  });

  // Re-map engine results onto the original row numbering.
  let preErrors = 0;
  for (const r of results) if (r) preErrors++;
  for (let j = 0; j < summary.results.length; j++) {
    const original = validIndex[j];
    const r = summary.results[j];
    results[original] = { ...r, row: original + 1 };
  }

  // ── Post-write phases (skipped on dryRun) ─────────────────────────────
  const delivery = { emailInvite: 0, smsInvite: 0, temporary: 0 };
  // [#18028] How the second pass went. Declared out here so the summary
  // reports the same three keys on a dry run — where the pass does not run —
  // as it does on a real one.
  const managerLinks = { linked: 0, unresolved: 0, refused: 0 };
  if (!prepared.dryRun) {
    // One pass over every created row — each is in exactly one of the two
    // maps (or neither, for `none` and updated rows). This single loop serves
    // every policy AND `auto`, where invite and temporary rows interleave in
    // one batch (#3236). Invited rows get a set-your-password message — a
    // reset-password email for real-email rows, an invitation SMS for
    // phone-only rows (#2780; the SMS carries no credential — the user
    // requests their own OTP at first sign-in). Temporary rows get the
    // generated password attached to the response body ONLY.
    for (const r of results) {
      if (!r || r.action !== 'created' || !r.id) continue;
      const invite = inviteTargets.get(r.id);
      if (invite) {
        if (invite.channel === 'sms') {
          r.delivery = 'sms';
          delivery.smsInvite++;
          if (!invite.phone) continue; // defensive — SMS rows carry a phone
          try {
            await deps.sendInviteSms(invite.phone);
          } catch (e) {
            // The account exists; only the SMS failed. Not a rollback —
            // remediation is re-sending or an admin set-user-password.
            r.code = 'INVITE_SMS_FAILED';
            r.error = `User created, but the invitation SMS failed: ${((e as Error)?.message ?? String(e)).slice(0, 200)}`;
          }
        } else {
          r.delivery = 'email';
          delivery.emailInvite++;
          try {
            await authApi.requestPasswordReset({ body: { email: invite.email } });
          } catch (e) {
            // The account exists; only the email failed. Not a rollback —
            // remediation is re-sending or an admin set-user-password.
            r.code = 'INVITE_EMAIL_FAILED';
            r.error = `User created, but the invitation email failed: ${((e as Error)?.message ?? String(e)).slice(0, 200)}`;
          }
        }
        continue;
      }
      const tempPassword = temporaryPasswords.get(r.id);
      if (tempPassword !== undefined) {
        r.temporaryPassword = tempPassword;
        r.delivery = 'temporary';
        delivery.temporary++;
      }
    }

    // ── Second pass — the manager links (#18028, ruling row 7) ──────────
    // It runs HERE, after `runImport` has returned, and that is the whole
    // point: a manager named in row 40 may be created by row 90, so every row
    // in the batch has to exist before any key is resolved. A resolve inside
    // `createData` would refuse exactly that input, and would happen to work
    // only on a file whose rows were already topologically ordered.
    if (managerWanted.some((w) => w !== undefined)) {
      // This batch's landed rows, indexed under BOTH spellings a manager cell
      // may name them by — a row carrying an email AND a phone is reachable
      // through either. `identityKey`'s `e:` / `p:` prefixes keep the two
      // namespaces from colliding.
      const idByKey = new Map<string, string>();
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const ident = rowIdentities[i];
        if (!r || !r.id || !ident) continue;
        if (r.action !== 'created' && r.action !== 'updated') continue;
        if (ident.email) idByKey.set(identityKey(ident.email, undefined), r.id);
        if (ident.phone) idByKey.set(identityKey(undefined, ident.phone), r.id);
      }

      // A manager who is NOT in this file is still a valid manager — an org
      // chart is grown one batch at a time. Memoized per key: a file where 200
      // rows report to the same person is the ordinary case, not the exotic one.
      const fromTree = new Map<string, string | null>();
      const managerDeps: SetUserManagerDeps = {
        getDataEngine: () => engine,
        ...(deps.logger ? { logger: deps.logger } : {}),
      };

      for (let i = 0; i < results.length; i++) {
        const wanted = managerWanted[i];
        if (wanted === undefined) continue;
        const r = results[i];
        // A row that failed its own write has no id to hang a link on. Its
        // failure is already reported; the manager cell adds nothing.
        if (!r || !r.id || (r.action !== 'created' && r.action !== 'updated')) continue;

        if (wanted === 'unreadable') {
          noteManagerFailure(
            r,
            'unresolved',
            'MANAGER_UNRESOLVED',
            `The ${MANAGER_COLUMN} cell is neither an email address nor a phone number this deployment `
              + 'can read, so it names no identity. This row landed; only its manager link did not.',
          );
          managerLinks.unresolved++;
          continue;
        }

        let managerId = idByKey.get(wanted.key) ?? null;
        if (!managerId) {
          if (!fromTree.has(wanted.key)) {
            try {
              const where = wanted.email ? { email: wanted.email } : { phone_number: wanted.phone };
              const found = await engine.find('sys_user', {
                where, fields: ['id'], limit: 1, context: SYSTEM_CTX,
              });
              const hit = Array.isArray(found) ? found[0] : undefined;
              fromTree.set(wanted.key, hit?.id != null ? String(hit.id) : null);
            } catch (e) {
              // A read that FAILED is not the fact "no such user", and it must
              // not be spelled like one silently. The row is reported as
              // unresolved either way — the link genuinely was not written —
              // and the reason it could not be answered is said once, here.
              fromTree.set(wanted.key, null);
              deps.logger?.warn(
                `[AuthPlugin] import-users: the sys_user lookup for manager key '${wanted.key}' FAILED, so `
                  + 'that row is reported as an unresolved manager rather than a refused one. The user '
                  + 'itself was created. Remedy: restore read access to sys_user and re-run the manager '
                  + `link for the affected rows. Cause: ${(e as Error)?.message ?? e}`,
              );
            }
          }
          managerId = fromTree.get(wanted.key) ?? null;
        }

        if (!managerId) {
          noteManagerFailure(
            r,
            'unresolved',
            'MANAGER_UNRESOLVED',
            `No user matches this row's ${MANAGER_COLUMN} key, in this import or already in the `
              + 'directory, so the manager link was not written. The rest of this row landed.',
          );
          managerLinks.unresolved++;
          continue;
        }

        // ⛔ The five refusals are NOT re-derived here. `applyUserManagerLink`
        // is the same derivation `POST /admin/set-user-manager` runs, and its
        // refusal — status, code and the `reason` discriminator — is reported
        // as it came back.
        const refusal = await applyUserManagerLink(managerDeps, r.id, managerId);
        if (refusal) {
          noteManagerFailure(r, refusal.reason, 'MANAGER_REFUSED', refusal.message);
          managerLinks.refused++;
          continue;
        }
        r.manager = 'linked';
        managerLinks.linked++;
      }
    }

    // Run-level audit. Best-effort; NO password material.
    //
    // Corrected rationale (#4940): this used to read "better-auth writes
    // bypass the ObjectQL hooks that plugin-audit subscribes to" — the stale
    // claim #4802 refuted (`AuthManagerOptions.databaseHooks` carries the
    // hop-by-hop correction). The hooks DO fire for the adapter's writes, and
    // each imported `sys_user` gets plugin-audit's own per-row `create` row;
    // this loop writes no explicit per-row row at all.
    //
    // What survives is a complement, not a duplicate. plugin-audit's
    // `actionFor` maps afterInsert/Update/Delete → create/update/delete and
    // nothing else, so `action: 'import'` with `record_id: null` is a shape
    // its writer structurally cannot emit — and it answers what no per-row
    // ledger can: who ran which import, and what the run did overall (totals,
    // policy, and the per-channel delivery split). It is still best-effort
    // because plugin-audit is OPTIONAL: with it uninstalled there is no
    // `sys_audit_log` table, and an import must not fail over its own audit.
    // Both facts are pinned in
    // `packages/qa/dogfood/test/admin-identity-audit-trail.dogfood.test.ts`.
    //
    // [#12981] "Best-effort" was doing two jobs and only one of them was
    // right. plugin-audit UNINSTALLED means no `sys_audit_log` object, so
    // nothing ever claimed the run would be audited — a declared skip, taken
    // silently by the probe below. A REFUSED write is the other thing
    // entirely, and it was wearing the same `catch`.
    const auditRegistered = !engine.getSchema || Boolean(engine.getSchema('sys_audit_log'));
    if (auditRegistered) {
      try {
        await engine.insert('sys_audit_log', {
          action: 'import',
          user_id: actor.id,
          actor: actor.id,
          object_name: 'sys_user',
          metadata: JSON.stringify({
            event: 'user.import_run',
            mode, matchBy, passwordPolicy: policy,
            total: prepared.rows.length,
            created: summary.created, updated: summary.updated,
            skipped: summary.skipped, errors: summary.errors + preErrors,
            // How `auto` (and the fixed policies) split the batch across channels.
            delivery,
            // [#18028] And how the second pass's manager links went — a run
            // that linked nobody because every key was unresolved is the shape
            // an operator most needs to find later.
            manager: managerLinks,
          }),
        }, { context: SYSTEM_CTX } as any);
      } catch (e) {
        // [#12981] An import must not fail over its own audit — control flow is
        // unchanged and the run still answers 200 with its summary. It must not
        // be SILENT either. `sys_audit_log` is registered (checked above), so
        // this is a refused write, and the run-level row is the ONLY record of
        // it: plugin-audit's `actionFor` maps afterInsert/Update/Delete to
        // create/update/delete and nothing else, so `action: 'import'` with a
        // null `record_id` is a shape its writer structurally cannot emit. The
        // per-row `create` rows survive, which is what makes this dangerous —
        // the trail looks populated while WHO ran the import, under WHICH
        // policy, and WHAT the run did overall is simply gone.
        deps.logger?.warn(
          `[AuthPlugin] the run-level sys_audit_log row for this user import was NOT written — `
            + `the import itself SUCCEEDED (created ${summary.created}, updated ${summary.updated}, `
            + `skipped ${summary.skipped}) and the endpoint answers 200, so nothing looks wrong. `
            + 'plugin-audit is installed (sys_audit_log is registered), so this is a REFUSED '
            + "write, not an absent plugin. plugin-audit's per-row create rows still landed, so "
            + 'the audit trail LOOKS complete while the only record of who ran this import, under '
            + 'which password policy, and what it did in aggregate is absent. Nothing retries it '
            + 'and no later boot reconstructs it. Remedy: restore write access to sys_audit_log '
            + `(permissions, driver connectivity) before the next import. Cause: ${
              (e as Error)?.message ?? e
            }`,
        );
      }
    }
  }

  const errors = summary.errors + preErrors;
  return {
    status: 200,
    body: {
      success: true,
      data: {
        summary: {
          total: prepared.rows.length,
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped,
          errors,
          dryRun: prepared.dryRun,
          passwordPolicy: policy,
          // Per-channel split of the created rows — the value of `auto`: how
          // many rows were invited vs. fell back to a temporary password.
          delivery,
          // [#18028] The second pass's split. `unresolved` and `refused` are
          // both per-row failures on rows that otherwise LANDED, so they are
          // reported here rather than folded into `errors`, which would make
          // `created` and `errors` disagree about the same row.
          manager: managerLinks,
          mode,
          matchBy,
        },
        rows: results,
      },
    },
  };
}
