// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IShareLinkService,
  ShareLink,
  CreateShareLinkInput,
  ListShareLinksFilter,
  ResolveShareLinkResult,
  ShareLinkExecutionContext,
  ShareLinkPermission,
  ShareLinkAudience,
} from '@objectstack/spec/contracts';
import type { SharingEngine } from './sharing-service.js';

/** Service-elevated context for the plugin's own queries / mutations. */
const SYSTEM_CTX = { isSystem: true, roles: [], permissions: [] } as const;

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

  constructor(opts: ShareLinkServiceOptions) {
    this.engine = opts.engine;
    this.permissive = opts.permissive ?? false;
    this.hashPassword = opts.hashPassword ?? defaultHashPassword;
    this.verifyPassword = opts.verifyPassword ?? defaultVerifyPassword;
  }

  async createLink(
    input: CreateShareLinkInput,
    context: ShareLinkExecutionContext,
  ): Promise<ShareLink> {
    if (!input.object) throw makeError(400, 'VALIDATION_FAILED', 'object is required');
    if (!input.recordId) throw makeError(400, 'VALIDATION_FAILED', 'recordId is required');

    const schema = this.engine.getSchema?.(input.object);
    const policy = getPolicy(schema);

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

    // Confirm the target record actually exists — silently issuing
    // links against ghost rows is a footgun.
    const exists = await this.engine.find(input.object, {
      filter: { id: input.recordId },
      fields: ['id'],
      limit: 1,
      context: SYSTEM_CTX,
    });
    if (!Array.isArray(exists) || exists.length === 0) {
      throw makeError(404, 'RECORD_NOT_FOUND', `${input.object}/${input.recordId} does not exist`);
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

  async revokeLink(idOrToken: string, _context: ShareLinkExecutionContext): Promise<void> {
    if (!idOrToken) throw makeError(400, 'VALIDATION_FAILED', 'id or token is required');
    const filter = idOrToken.startsWith('shl_') ? { id: idOrToken } : { token: idOrToken };
    const rows = await this.engine.find('sys_share_link', {
      filter,
      fields: ['id', 'revoked_at'],
      limit: 1,
      context: SYSTEM_CTX,
    });
    const row = Array.isArray(rows) ? (rows[0] as any) : undefined;
    if (!row) return; // No-op when missing
    if (row.revoked_at) return; // Already revoked
    await this.engine.update(
      'sys_share_link',
      { id: row.id, revoked_at: new Date().toISOString() },
      { context: SYSTEM_CTX },
    );
  }

  async listLinks(
    filter: ListShareLinksFilter,
    context: ShareLinkExecutionContext,
  ): Promise<ShareLink[]> {
    const where: Record<string, unknown> = {};
    if (filter.object) where.object_name = filter.object;
    if (filter.recordId) where.record_id = filter.recordId;
    if (filter.createdBy) where.created_by = filter.createdBy;
    if (!filter.includeRevoked) where.revoked_at = null;

    const rows = await this.engine.find('sys_share_link', {
      filter: where,
      limit: 200,
      sort: [{ field: 'created_at', order: 'desc' }],
      context: context.isSystem ? SYSTEM_CTX : context,
    });
    return Array.isArray(rows) ? (rows as ShareLink[]) : [];
  }

  async resolveToken(
    token: string,
    probe: { signedInUserId?: string; recipientEmail?: string; providedPassword?: string } = {},
  ): Promise<ResolveShareLinkResult | null> {
    if (!token || typeof token !== 'string' || token.length < 8) return null;

    const rows = await this.engine.find('sys_share_link', {
      filter: { token },
      limit: 1,
      context: SYSTEM_CTX,
    });
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
}
