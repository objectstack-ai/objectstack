// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IShareLinkService,
  ShareLink,
  CreateShareLinkInput,
  ListShareLinksFilter,
  ResolveShareLinkResult,
  ShareLinkPermission,
  ShareLinkAudience,
} from '@objectstack/spec/contracts';
/**
 * [#6206 / #6430 — maintainer ruling A] Every method here that adjudicates
 * access takes the FULL envelope. The route-local `ShareLinkExecutionContext`
 * is the HTTP layer's 401 vocabulary and is deliberately not named in this
 * file: the contexts this file receives are forwarded into `engine.find`, where
 * `accessible_org_ids` (ADR-0105 D2), `posture` (ADR-0095 D2), `org_user_ids`,
 * `systemPermissions` and `tabPermissions` are all read.
 */
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { SharingEngine } from './sharing-service.js';
import {
  deleteRowsForDeletedRecords,
  sweepOrphanedRowsByRecordExistence,
  type OrphanShareSweepOptions,
  type OrphanShareSweepResult,
} from './record-orphan-cleanup.js';

/** Service-elevated context for the plugin's own queries / mutations. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * [#5190] The table whose orphans this service owns. `sys_share_link` is
 * `managedBy: 'engine-owned'` and its object doc states every write flows
 * through `IShareLinkService` — so the record-delete cascade reaches it through
 * this service, never by another module writing the table behind its back.
 */
const SHARE_LINK_SWEEP_SUBJECT = {
  table: 'sys_share_link',
  noun: 'share-link',
  issue: '#5190',
} as const;

/** URL-safe alphabet (RFC 4648 base64url minus padding). 64 symbols. */
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** ~144 bits of entropy at 24 chars — well above the OWASP recommendation. */
const TOKEN_LENGTH = 24;

/** Default value when no per-object cap is configured. */
const DEFAULT_MAX_EXPIRY_DAYS = 365;

/**
 * Generate a URL-safe token. Uses `crypto.getRandomValues` when present
 * (browsers, Node ≥ 19) and falls back to `Math.random` only for the
 * pathological case of a polyfill-less old runtime. The fallback is
 * still ≥ 100 bits of entropy because of TOKEN_LENGTH.
 */
function generateToken(length: number = TOKEN_LENGTH): string {
  const g: any = globalThis as any;
  const bytes = new Uint8Array(length);
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < length; i++) {
    out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return out;
}

/** Internal helper — extract publicSharing policy from an object schema. */
function getPolicy(schema: any): {
  enabled: boolean;
  allowedAudiences: ShareLinkAudience[];
  allowedPermissions: ShareLinkPermission[];
  maxExpiryDays?: number;
  redactFields: string[];
} {
  const raw = schema?.publicSharing;
  if (!raw || raw.enabled !== true) {
    return {
      enabled: false,
      allowedAudiences: [],
      allowedPermissions: [],
      redactFields: [],
    };
  }
  return {
    enabled: true,
    allowedAudiences: (raw.allowedAudiences as ShareLinkAudience[] | undefined) ?? ['link_only'],
    allowedPermissions: (raw.allowedPermissions as ShareLinkPermission[] | undefined) ?? ['view'],
    maxExpiryDays: typeof raw.maxExpiryDays === 'number' ? raw.maxExpiryDays : undefined,
    redactFields: Array.isArray(raw.redactFields) ? (raw.redactFields as string[]) : [],
  };
}

/** Parse `expiresAt` as either an ISO string or a relative duration like "7d", "24h", "30m". */
function normaliseExpiresAt(input: string | null | undefined, maxDays: number): string | null {
  if (!input) return null;
  const now = Date.now();
  const cap = now + maxDays * 86_400_000;

  // Relative duration shorthand.
  const m = /^([0-9]+)(s|m|h|d)$/i.exec(input);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const ms = unit === 's' ? n * 1000 : unit === 'm' ? n * 60_000 : unit === 'h' ? n * 3_600_000 : n * 86_400_000;
    const at = now + ms;
    if (at > cap) {
      throw makeError(422, 'EXPIRY_TOO_LONG', `expiresAt exceeds the object's max of ${maxDays} days`);
    }
    return new Date(at).toISOString();
  }

  // Otherwise expect an ISO timestamp.
  const t = Date.parse(input);
  if (Number.isNaN(t)) {
    throw makeError(422, 'INVALID_EXPIRY', `expiresAt is not a valid ISO timestamp or duration: ${input}`);
  }
  if (t > cap) {
    throw makeError(422, 'EXPIRY_TOO_LONG', `expiresAt exceeds the object's max of ${maxDays} days`);
  }
  if (t <= now) {
    throw makeError(422, 'EXPIRY_IN_PAST', 'expiresAt must be in the future');
  }
  return new Date(t).toISOString();
}

/**
 * Weak password hash. Production deployments should swap in argon2 /
 * bcrypt via dependency injection (see `ShareLinkServiceOptions.hashPassword`).
 * The default uses SubtleCrypto SHA-256 with a per-row salt — strong
 * enough to keep the hash useless to a casual observer and to deflate
 * the cost of a database leak, but NOT a substitute for argon2 against
 * a determined attacker. The platform deliberately surfaces this in the
 * plugin docs so deployments can decide.
 */
async function defaultHashPassword(password: string): Promise<string> {
  const g: any = globalThis as any;
  const subtle = g.crypto?.subtle;
  const salt = generateToken(16);
  if (!subtle) {
    // Synthetic fallback — no SubtleCrypto means we're in a stripped
    // runtime; emit a clearly-marked placeholder so the deployment is
    // forced to wire in a real hasher rather than ship a weak one.
    return `weak$${salt}$${password}`;
  }
  const enc = new TextEncoder();
  const buf = await subtle.digest('SHA-256', enc.encode(salt + ':' + password));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256$${salt}$${hex}`;
}

async function defaultVerifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith('weak$')) {
    const [, , stored] = hash.split('$');
    return stored === password;
  }
  if (hash.startsWith('sha256$')) {
    const [, salt, expected] = hash.split('$');
    const g: any = globalThis as any;
    const subtle = g.crypto?.subtle;
    if (!subtle) return false;
    const enc = new TextEncoder();
    const buf = await subtle.digest('SHA-256', enc.encode(salt + ':' + password));
    const hex = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return hex === expected;
  }
  return false;
}

function makeError(status: number, code: string, message: string): Error {
  const err: any = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

export interface ShareLinkServiceOptions {
  engine: SharingEngine;
  /** Override the default SHA-256 hasher with argon2 / bcrypt for production. */
  hashPassword?: (plain: string) => Promise<string>;
  /** Companion verifier — must accept hashes produced by `hashPassword`. */
  verifyPassword?: (plain: string, hash: string) => Promise<boolean>;
  /**
   * Bypass the per-object opt-in check (useful when the schema scan is
   * happening after `start`). When omitted, calls against an object
   * without `publicSharing.enabled=true` are rejected with 422.
   */
  permissive?: boolean;
  /**
   * [ADR-0111 D8] Late-bound record-share management probe (the sharing
   * service's `canManageShares`). Lets a record's OWNER / Modify-All admin
   * revoke a link someone else minted on their record — not just the link's
   * creator. Absent → only the creator (and system) may revoke, the pre-D8
   * behaviour, so a deployment without the sharing service degrades safely.
   *
   * [#6206] An ENFORCEMENT probe — it decides a 403, and resolves ownership /
   * hierarchy scope under the context it is given — so it receives the caller's
   * COMPLETE envelope, exactly like the visibility read in `createLink`.
   */
  canManageShares?: (
    object: string,
    recordId: string,
    context: ExecutionContext,
  ) => Promise<boolean>;
  /** [#5190] Optional logger for the record-delete cascade / orphan sweep. */
  logger?: { info?: Function; warn?: Function; error?: Function; debug?: Function };
}

/**
 * Default `IShareLinkService` implementation.
 *
 * Persists every link in `sys_share_link`. The companion REST routes
 * (`registerShareLinkRoutes`) thin-wrap the service; the public
 * `/api/v1/share-links/:token` route resolves and re-injects the
 * "share-link principal" into the execution context so the standard
 * data middleware can authorise the downstream read.
 */
export class ShareLinkService implements IShareLinkService {
  private readonly engine: SharingEngine;
  private readonly permissive: boolean;
  private readonly hashPassword: (plain: string) => Promise<string>;
  private readonly verifyPassword: (plain: string, hash: string) => Promise<boolean>;
  private readonly canManageShares?: (
    object: string,
    recordId: string,
    context: ExecutionContext,
  ) => Promise<boolean>;
  private readonly logger?: ShareLinkServiceOptions['logger'];

  constructor(opts: ShareLinkServiceOptions) {
    this.engine = opts.engine;
    this.permissive = opts.permissive ?? false;
    this.hashPassword = opts.hashPassword ?? defaultHashPassword;
    this.verifyPassword = opts.verifyPassword ?? defaultVerifyPassword;
    this.canManageShares = opts.canManageShares;
    this.logger = opts.logger;
  }

  async createLink(
    input: CreateShareLinkInput,
    context: ExecutionContext,
  ): Promise<ShareLink> {
    if (!input.object) throw makeError(400, 'VALIDATION_FAILED', 'object is required');
    if (!input.recordId) throw makeError(400, 'VALIDATION_FAILED', 'recordId is required');

    const schema = this.engine.getSchema?.(input.object);
    const policy = getPolicy(schema);

    // [ADR-0111 D8] Mint authority = the object's `publicSharing` opt-in (this
    // check) AND the caller's visibility of the record (the RLS-scoped read
    // below). An object that opts into publicSharing deliberately delegates
    // re-share power to anyone who can SEE the record — a stated decision, not
    // an accident. Objects that do not opt in cannot be link-shared at all.
    if (!policy.enabled && !this.permissive && !context.isSystem) {
      throw makeError(
        422,
        'SHARING_NOT_ENABLED',
        `Object '${input.object}' has not enabled publicSharing in its schema`,
      );
    }

    const permission: ShareLinkPermission = input.permission ?? 'view';
    if (policy.enabled && policy.allowedPermissions.length > 0 && !policy.allowedPermissions.includes(permission)) {
      throw makeError(
        422,
        'PERMISSION_NOT_ALLOWED',
        `Object '${input.object}' does not allow share permission '${permission}'. Allowed: ${policy.allowedPermissions.join(', ')}`,
      );
    }

    const audience: ShareLinkAudience = input.audience ?? 'link_only';
    if (policy.enabled && policy.allowedAudiences.length > 0 && !policy.allowedAudiences.includes(audience)) {
      throw makeError(
        422,
        'AUDIENCE_NOT_ALLOWED',
        `Object '${input.object}' does not allow audience '${audience}'. Allowed: ${policy.allowedAudiences.join(', ')}`,
      );
    }

    if (audience === 'email' && (!input.emailAllowlist || input.emailAllowlist.length === 0)) {
      throw makeError(400, 'VALIDATION_FAILED', 'emailAllowlist is required when audience=email');
    }

    // Confirm the target record exists AND — for an HTTP caller — that the
    // caller may actually SEE it. [Finding-2] Reading under the caller's own
    // context (positions/permissions/RLS) means you can only mint a link for a
    // record you can access; a client can no longer share arbitrary rows of a
    // publicSharing-enabled object it cannot see. Internal (isSystem) callers
    // read under the system context as before.
    //
    // [#6206] `context` is passed through UNCHANGED — it is the caller's whole
    // resolved envelope and every dimension of it is an input to this read:
    // Layer 0 reads `accessible_org_ids` under the `group` posture (ADR-0105
    // D2, where an absent set denies), Layer 1 reads positions / permissions /
    // `org_user_ids`, and `posture` travels with the context rather than being
    // re-derived here (ADR-0095 D2). Rebuilding a subset at this seam is what
    // made this check answer 403 for every `group`-posture caller.
    const exists = await this.engine.find(input.object, {
      where: { id: input.recordId },
      fields: ['id'],
      limit: 1,
      context: context.isSystem ? SYSTEM_CTX : context,
    } as any);
    if (!Array.isArray(exists) || exists.length === 0) {
      // Don't distinguish "missing" from "not visible" for an untrusted caller.
      throw context.isSystem
        ? makeError(404, 'RECORD_NOT_FOUND', `${input.object}/${input.recordId} does not exist`)
        : makeError(403, 'FORBIDDEN', `Not permitted to share ${input.object}/${input.recordId}`);
    }

    const maxDays = policy.maxExpiryDays ?? DEFAULT_MAX_EXPIRY_DAYS;
    const expires_at = normaliseExpiresAt(input.expiresAt, maxDays);

    const passwordHash = input.password ? await this.hashPassword(input.password) : null;

    const row: ShareLink = {
      id: `shl_${generateToken(16)}`,
      token: generateToken(TOKEN_LENGTH),
      object_name: input.object,
      record_id: input.recordId,
      permission,
      audience,
      expires_at,
      email_allowlist:
        input.emailAllowlist && input.emailAllowlist.length > 0
          ? input.emailAllowlist.map((e) => e.trim().toLowerCase()).filter(Boolean)
          : null,
      password_hash: passwordHash,
      redact_fields: input.redactFields && input.redactFields.length > 0 ? input.redactFields : null,
      label: input.label ?? null,
      revoked_at: null,
      created_by: context.userId ?? null,
      created_at: new Date().toISOString(),
      last_used_at: null,
      use_count: 0,
    };

    await this.engine.insert('sys_share_link', row, { context: SYSTEM_CTX });
    return row;
  }

  async revokeLink(idOrToken: string, context: ExecutionContext): Promise<void> {
    if (!idOrToken) throw makeError(400, 'VALIDATION_FAILED', 'id or token is required');
    const filter = idOrToken.startsWith('shl_') ? { id: idOrToken } : { token: idOrToken };
    const rows = await this.engine.find('sys_share_link', {
      where: filter,
      // object_name / record_id are needed for the [ADR-0111 D8] record-manager
      // revoke path below.
      fields: ['id', 'revoked_at', 'created_by', 'object_name', 'record_id'],
      limit: 1,
      context: SYSTEM_CTX,
    } as any);
    const row = Array.isArray(rows) ? (rows[0] as any) : undefined;
    if (!row) return; // No-op when missing

    // Who may revoke this link:
    //   - system / internal callers (bypass),
    //   - the link's CREATOR ([Finding-2]: the caller context used to be
    //     ignored, so any client could revoke any user's link — a sharing DoS),
    //   - [ADR-0111 D8] a record SHARE-MANAGER (the record's owner or a
    //     Modify-All admin): a link someone else minted on your record is your
    //     record's exposure to kill, not only its creator's. Probed via the
    //     late-bound sharing service; absent → creator-only (pre-D8 behaviour).
    let permitted = context.isSystem === true || row.created_by === context.userId;
    if (!permitted && this.canManageShares && row.object_name && row.record_id) {
      permitted = await this.canManageShares(String(row.object_name), String(row.record_id), context)
        .catch(() => false);
    }
    if (!permitted) {
      throw makeError(403, 'FORBIDDEN', 'Not permitted to revoke this share link');
    }
    if (row.revoked_at) return; // Already revoked
    await this.engine.update(
      'sys_share_link',
      { id: row.id, revoked_at: new Date().toISOString() },
      { context: SYSTEM_CTX },
    );
  }

  async listLinks(
    filter: ListShareLinksFilter,
    context: ExecutionContext,
  ): Promise<ShareLink[]> {
    const where: Record<string, unknown> = {};
    if (filter.object) where.object_name = filter.object;
    if (filter.recordId) where.record_id = filter.recordId;
    if (filter.createdBy) where.created_by = filter.createdBy;
    if (!filter.includeRevoked) where.revoked_at = null;

    const rows = await this.engine.find('sys_share_link', {
      where,
      limit: 200,
      orderBy: [{ field: 'created_at', order: 'desc' }],
      context: context.isSystem ? SYSTEM_CTX : context,
    } as any);
    return Array.isArray(rows) ? (rows as ShareLink[]) : [];
  }

  async resolveToken(
    token: string,
    probe: { signedInUserId?: string; recipientEmail?: string; providedPassword?: string } = {},
  ): Promise<ResolveShareLinkResult | null> {
    if (!token || typeof token !== 'string' || token.length < 8) return null;

    const rows = await this.engine.find('sys_share_link', {
      where: { token },
      limit: 1,
      context: SYSTEM_CTX,
    } as any);
    const row = Array.isArray(rows) ? (rows[0] as ShareLink | undefined) : undefined;
    if (!row) return null;

    if (row.revoked_at) return null;
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return null;

    // Audience gating.
    if (row.audience === 'signed_in' && !probe.signedInUserId) return null;
    if (row.audience === 'email') {
      const allow = row.email_allowlist ?? [];
      const supplied = (probe.recipientEmail ?? '').trim().toLowerCase();
      if (!supplied || !allow.includes(supplied)) return null;
    }

    if (row.password_hash) {
      if (!probe.providedPassword) return null;
      const ok = await this.verifyPassword(probe.providedPassword, row.password_hash);
      if (!ok) return null;
    }

    // [#5190] Does the shared RECORD still exist? A share link is an
    // identity-less CAPABILITY token: whoever holds it has the access, no
    // principal required. So an orphaned link is worse than an orphaned
    // `sys_record_share` (#5103), whose recipients are at least a named set —
    // the moment a record id is reused (custom primary keys, an import that
    // preserves ids, any future id recycling) a link that morally died with its
    // record starts authorising a BRAND-NEW record, for whoever kept the URL.
    //
    // This is the fail-closed half of the fix and it is deliberately
    // independent of the delete cascade below: it holds for links that predate
    // the cascade, for a hook that never ran, and for the postures the cascade
    // skips. Same branch as revoked / expired — `null`, no distinct code, no
    // distinct error — because "that record is gone" is itself information an
    // unauthorised holder must not be able to read out of the endpoint.
    //
    // Placed AFTER the cheap in-memory gates (a revoked or expired token pays
    // no query) and BEFORE the usage stamp, so a dead record never bumps
    // `use_count` / `last_used_at` either.
    if (!(await this.recordStillExists(row.object_name, row.record_id))) return null;

    // Compute the effective redaction set (object default ∪ per-link).
    const schema = this.engine.getSchema?.(row.object_name);
    const policy = getPolicy(schema);
    const redactFields = Array.from(
      new Set<string>([...(policy.redactFields ?? []), ...((row.redact_fields as string[]) ?? [])]),
    );

    // Stamp usage. Errors here MUST NOT block the read — log-and-continue.
    try {
      await this.engine.update(
        'sys_share_link',
        {
          id: row.id,
          last_used_at: new Date().toISOString(),
          use_count: (row.use_count ?? 0) + 1,
        },
        { context: SYSTEM_CTX },
      );
    } catch {
      // best-effort — usage telemetry is a nice-to-have
    }

    return { link: row, redactFields };
  }

  /**
   * [#5190] Is `(object, recordId)` still there? Read under the SYSTEM context
   * on purpose: the question is EXISTENCE, not the holder's visibility — the
   * token is the authorisation, and an anonymous holder has no context to read
   * under in the first place.
   *
   * Fails CLOSED. A probe that throws (driver blip, unregistered object) is an
   * unanswered question, and an unanswered question must not authorise: the
   * caller treats `false` exactly like revoked. Note this is the OPPOSITE
   * direction from the orphan sweep, which leaves rows alone when its probe
   * fails — and for the same principle. Neither acts on an unanswered question;
   * for a grant the safe direction is "deny", for a deletion it is "keep".
   */
  private async recordStillExists(
    object: string | null | undefined,
    recordId: string | null | undefined,
  ): Promise<boolean> {
    if (!object || !recordId) return false;
    try {
      const rows = await this.engine.find(String(object), {
        where: { id: recordId },
        fields: ['id'],
        limit: 1,
        context: SYSTEM_CTX,
      } as any);
      return Array.isArray(rows) && rows.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * [#5190] Delete every `sys_share_link` row belonging to records that have
   * just been deleted — the cascade half, driven by `record-share-cascade.ts`.
   *
   * DELETE, not `revoked_at`: the row's whole subject is gone, so there is no
   * link left to keep a revocation record OF, and the issue names the growth
   * this table would otherwise show (`sys_share_link` only ever grows, and
   * Setup's link lists point at records that do not exist). It is also what
   * #5103 does to the sibling table for the same reason. A link the ADMIN
   * revoked still keeps its audit row — that path is untouched.
   */
  async revokeLinksForDeletedRecords(
    object: string,
    recordIds: readonly string[],
  ): Promise<void> {
    await deleteRowsForDeletedRecords(
      this.engine,
      SHARE_LINK_SWEEP_SUBJECT.table,
      object,
      recordIds,
    );
  }

  /**
   * [#5190] Remove every share link whose RECORD no longer exists.
   *
   * The `sys_share_link` twin of `SharingService.sweepOrphanedRecordShares`,
   * running the very same walk (`record-orphan-cleanup.ts`): keyset pages, a
   * scan cap that reports itself, one batched existence probe per object per
   * page, and rows left strictly alone when that probe fails.
   *
   * Called on `kernel:bootstrapped` (unscoped — every link that predates the
   * cascade, plus anything a crashed hook missed) and from the cascade's
   * unbounded-delete branch (scoped to one object).
   */
  async sweepOrphanedShareLinks(
    options?: OrphanShareSweepOptions,
  ): Promise<OrphanShareSweepResult> {
    return sweepOrphanedRowsByRecordExistence(
      this.engine,
      SHARE_LINK_SWEEP_SUBJECT,
      options,
      this.logger,
    );
  }
}
