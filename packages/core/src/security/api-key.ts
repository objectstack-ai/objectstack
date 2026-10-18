// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * api-key — hand-rolled API-key primitives + verifier for `sys_api_key`.
 *
 * better-auth 1.6.x ships no apiKey plugin, so ObjectStack owns the full
 * lifecycle: generation, at-rest hashing, header extraction, validation, and
 * the verify-time principal lookup. This is the SINGLE shared source of truth
 * used by BOTH inbound surfaces — the runtime dispatcher / MCP path
 * (`resolveExecutionContext`) and the REST data API (`@objectstack/rest`) — so
 * the two can never drift on how a key authenticates. It lives in
 * `@objectstack/core` (server-side; both `runtime` and `rest` depend on it,
 * and `core` depends on neither, so there is no cycle).
 *
 * SECURITY (zero-tolerance):
 *  - The raw key is returned EXACTLY ONCE, by {@link generateApiKey}. It is
 *    never persisted; only `sha256(raw)` (hex) is stored in `sys_api_key.key`.
 *  - The raw key and its hash must never enter logs, HTTP responses, error
 *    messages, commit messages or comments.
 *  - Validation is fail-closed: anything ambiguous (missing, revoked, expired,
 *    malformed) resolves to "no principal", never to an elevated one.
 */

import { createHash, randomBytes } from 'node:crypto';

import { postureEnforcesWall, postureUsesUnionScope, normalizeTenancyPosture } from '@objectstack/spec/security';
import type { TenancyPosture } from '@objectstack/spec/security';
import type { ApiKeyLifecyclePolicy } from '@objectstack/spec/contracts';

import { accountScopeAuthGate, type AuthGate, type UserAuthGateSource } from './auth-gate.js';
import { isMissingTableError } from '@objectstack/types';
import { AuthzStoreUnavailableError } from './authz-store-unavailable.js';

/** Default visible prefix for generated keys (helps users identify a key). */
export const API_KEY_PREFIX = 'osk_';

/** Bytes of entropy in the secret portion of a generated key (256 bits). */
const API_KEY_ENTROPY_BYTES = 32;

/** Length of the human-visible prefix stored in `sys_api_key.prefix`. */
const VISIBLE_PREFIX_LEN = 12;

/**
 * Derive the at-rest hash for an API key. Inbound keys are hashed the same way
 * before the DB lookup. Because the lookup matches an indexed, high-entropy
 * hash exactly, this doubles as a constant-effort comparison: an attacker
 * cannot recover the raw key by probing for partial matches.
 */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** Result of {@link generateApiKey}. `raw` is shown to the user only once. */
export interface GeneratedApiKey {
  /** The full secret to hand to the client. NEVER persist this. */
  raw: string;
  /** `sha256(raw)` hex — store this in `sys_api_key.key`. */
  hash: string;
  /** Short non-secret prefix for display/identification (`sys_api_key.prefix`). */
  prefix: string;
}

/**
 * Generate a fresh API key. Returns the raw secret (caller must surface it to
 * the user exactly once and then discard it), its at-rest hash, and a short
 * non-secret prefix for display.
 */
export function generateApiKey(prefix: string = API_KEY_PREFIX): GeneratedApiKey {
  // base64url so the token is URL/header-safe with no padding.
  const secret = randomBytes(API_KEY_ENTROPY_BYTES).toString('base64url');
  const raw = `${prefix}${secret}`;
  return {
    raw,
    hash: hashApiKey(raw),
    prefix: raw.slice(0, VISIBLE_PREFIX_LEN),
  };
}

/**
 * Extract an API key from request headers. Accepts, in order:
 *  - `X-API-Key: <token>`
 *  - `Authorization: ApiKey <token>` (case-insensitive scheme)
 *  - `Authorization: Bearer <token>` ONLY when `<token>` carries the ObjectStack
 *    api-key prefix (`osk_`). Remote MCP clients (Claude Desktop / Cursor /
 *    Claude Code) authenticate to `/api/v1/mcp` with the key as a Bearer per the
 *    MCP spec, so rejecting Bearer outright made every standard MCP client fail.
 *    A better-auth *session* token never starts with `osk_`, so a session Bearer
 *    still falls through to the session path — this can't shadow it.
 */
export function extractApiKey(headers: any): string | undefined {
  const x = readHeader(headers, 'x-api-key');
  if (x && x.trim()) return x.trim();
  const auth = readHeader(headers, 'authorization');
  if (!auth) return undefined;
  const apiKeyScheme = auth.match(/^ApiKey\s+(\S.*)$/i);
  if (apiKeyScheme?.[1]?.trim()) return apiKeyScheme[1].trim();
  // Bearer is accepted only for prefixed api-keys (never for session tokens).
  const bearer = auth.match(/^Bearer\s+(\S.*)$/i)?.[1]?.trim();
  if (bearer && bearer.startsWith(API_KEY_PREFIX)) return bearer;
  return undefined;
}

/** Parse a `scopes` value that may be a JSON-string textarea or a real array. */
export function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((s): s is string => typeof s === 'string' && s.length > 0);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = safeJsonParse<unknown>(value, []);
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === 'string' && s.length > 0);
    }
  }
  return [];
}

/** Return true when an expiry timestamp is in the past (i.e. the key is dead). */
export function isExpired(value: unknown, nowMs: number): boolean {
  const ms = instantMs(value);
  return ms !== undefined && ms <= nowMs;
}

/**
 * Read a stored instant (`expires_at`, `last_used_at`, `created_at`) as epoch
 * milliseconds, or `undefined` when the column is empty or unreadable.
 */
function instantMs(value: unknown): number | undefined {
  if (value == null) return undefined;
  let ms: number;
  if (typeof value === 'number') {
    // Heuristic: seconds vs milliseconds epoch.
    ms = value < 1e12 ? value * 1000 : value;
  } else if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === 'string') {
    ms = Date.parse(value);
  } else {
    return undefined;
  }
  return Number.isNaN(ms) ? undefined : ms;
}

// ── [#23367, ruling A] The API-key lifecycle policy ──────────────────────────
//
// Ruling `6159880505` (letter A, maintainer 「同意」): a key signed with no
// expiry lives 90 days; no signing may ask for more than a year; a key unused
// for 90 days is refused (not revoked: a new key is the remedy); keys signed
// before the policy with no expiry get a one-year grace from its landing; and
// expired, inactive and revoked are three distinct, located refusals. The
// numbers are auth configuration (`IAuthService.resolveApiKeyLifecyclePolicy`),
// and these constants are the defaults the auth service falls back to.

const DAY_MS = 86_400_000;

/** [#23367] Default life of a key signed with no `expires_at`, in days. */
export const API_KEY_DEFAULT_EXPIRY_DAYS = 90;

/** [#23367] Default ceiling on a signed key's life, in days from the signing. */
export const API_KEY_MAX_EXPIRY_DAYS = 365;

/** [#23367] Default inactivity window, in days without a recorded use. */
export const API_KEY_INACTIVITY_DAYS = 90;

/**
 * [#23367] The grace a key signed with NO expiry gets, in days from the
 * policy's landing (`ApiKeyLifecyclePolicy.startedAt`). A one-time transition,
 * not a standing knob: the end is stamped onto the key's own `expires_at` the
 * first time the key is admitted, so the keys page names the date, and a
 * setting could not move a date already stamped.
 */
export const API_KEY_LEGACY_GRACE_DAYS = 365;

/**
 * [#23367] How stale `sys_api_key.last_used_at` may get before an admitted
 * call stamps it again: at most one write per key per hour. The inactivity
 * window is counted in days, so an hour of staleness never moves a verdict,
 * and the field's promise ("updated on each API call") costs one write per
 * key per hour instead of one per request.
 */
export const API_KEY_LAST_USED_STAMP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * [#23367] The policy source the key-admission seam reads — the auth service's
 * {@link ApiKeyLifecyclePolicy}, bound by {@link apiKeyLifecyclePolicySourceOf}.
 * A function, not a value, so a request that carries no key never asks.
 */
export type ApiKeyLifecyclePolicySource = () => ApiKeyLifecyclePolicy | Promise<ApiKeyLifecyclePolicy>;

/**
 * [#23367] Bind an auth service's lifecycle policy into the
 * {@link ApiKeyLifecyclePolicySource} a transport hands `resolveAuthzContext`,
 * or `undefined` when the service implements none (a kernel composed without
 * `plugin-auth` has no auth configuration, so only the row's own facts —
 * revoked, `expires_at` — are judged). Structural on purpose, like
 * `userAuthGateSourceOf`: `@objectstack/core` does not depend on the plugin
 * that provides it.
 */
export function apiKeyLifecyclePolicySourceOf(
  authService: {
    resolveApiKeyLifecyclePolicy?(): ApiKeyLifecyclePolicy | Promise<ApiKeyLifecyclePolicy>;
  } | null | undefined,
): ApiKeyLifecyclePolicySource | undefined {
  if (!authService || typeof authService.resolveApiKeyLifecyclePolicy !== 'function') return undefined;
  const service = authService;
  return () => service.resolveApiKeyLifecyclePolicy!();
}

/**
 * [#23367] The three lifecycle refusals, each declared as its wire pair — the
 * ADR-0112 code (registered under `@objectstack/core`) beside the status it
 * answers. `403` for all three, as the ruling words it ("the key's own 403 body
 * names the date") and as a held key's posture refusal answers: the credential
 * was recognised, and its state is what refuses it. Unknown keys keep the
 * generic 401.
 */
const API_KEY_EXPIRED_REFUSAL = { code: 'API_KEY_EXPIRED', status: 403 } as const;
const API_KEY_INACTIVE_REFUSAL = { code: 'API_KEY_INACTIVE', status: 403 } as const;
const API_KEY_REVOKED_REFUSAL = { code: 'API_KEY_REVOKED', status: 403 } as const;

export const API_KEY_EXPIRED_CODE = API_KEY_EXPIRED_REFUSAL.code;
export const API_KEY_INACTIVE_CODE = API_KEY_INACTIVE_REFUSAL.code;
export const API_KEY_REVOKED_CODE = API_KEY_REVOKED_REFUSAL.code;
export type ApiKeyLifecycleCode =
  | typeof API_KEY_EXPIRED_CODE
  | typeof API_KEY_INACTIVE_CODE
  | typeof API_KEY_REVOKED_CODE;

/** [#23367] The status every lifecycle refusal answers with (see the pairs above). */
export const API_KEY_LIFECYCLE_REFUSAL_STATUS = API_KEY_REVOKED_REFUSAL.status;

/** [#23367] One lifecycle refusal, as the seam decides it. */
export interface ApiKeyLifecycleRefusal {
  code: ApiKeyLifecycleCode;
  /** The located message: which key, which date, and the remedy. Never the raw key or its hash. */
  message: string;
  /** The date the refusal names (ISO 8601): the expiry, or the start of the idle window. Absent for a revocation. */
  at?: string;
  /** The `sys_api_key` row id, for the operator; ⛔ never the key or its hash. */
  keyId?: string;
  /** The key's owner. */
  userId?: string;
}

/** The own-property brand {@link isApiKeyLifecycleRefusalError} tests (see `authz-store-unavailable.ts` on why not `instanceof`). */
const API_KEY_LIFECYCLE_REFUSAL_BRAND = '__objectstackApiKeyLifecycleRefusal' as const;

/**
 * [#23367] The branded refusal `resolveAuthzContext` raises for a key that is
 * revoked, expired or inactive. Thrown rather than returned as an envelope
 * field, for the reason `AuthzStoreUnavailableError` is: a throw is loud by
 * default. A face whose door relays the brand answers `status`, `code` and
 * the located `message` in its own envelope; a face that does not catches it
 * as any other identity fault and answers its generic 401 — it never admits.
 */
export class ApiKeyLifecycleRefusalError extends Error {
  /** Brand — tested by {@link isApiKeyLifecycleRefusalError}. */
  readonly [API_KEY_LIFECYCLE_REFUSAL_BRAND] = true as const;
  /** ADR-0112 wire code (registered in the ledger under `@objectstack/core`). */
  readonly code: ApiKeyLifecycleCode;
  /** HTTP status a relaying face answers. */
  readonly status = API_KEY_LIFECYCLE_REFUSAL_STATUS;
  /** The date the refusal names, when it names one. */
  readonly at?: string;
  /** The refused key's row id — for logs; never sent by a door. */
  readonly keyId?: string;
  /** The refused key's owner — for logs; never sent by a door. */
  readonly userId?: string;

  constructor(refusal: ApiKeyLifecycleRefusal) {
    super(refusal.message);
    this.name = 'ApiKeyLifecycleRefusalError';
    this.code = refusal.code;
    if (refusal.at !== undefined) this.at = refusal.at;
    if (refusal.keyId !== undefined) this.keyId = refusal.keyId;
    if (refusal.userId !== undefined) this.userId = refusal.userId;
  }
}

/** [#23367] True when `err` is the branded API-key lifecycle refusal. */
export function isApiKeyLifecycleRefusalError(err: unknown): err is ApiKeyLifecycleRefusalError {
  return typeof err === 'object' && err !== null
    && (err as Record<string, unknown>)[API_KEY_LIFECYCLE_REFUSAL_BRAND] === true;
}

/** How a refusal names the key: its stored, non-secret display prefix. */
function keyLabel(row: any): string {
  const prefix = typeof row?.prefix === 'string' && row.prefix ? row.prefix : undefined;
  return prefix ? `This API key (${prefix}…)` : 'This API key';
}

const API_KEY_REMEDY =
  'Create a new key (POST /api/v1/keys, or the API Keys page) and replace this one wherever it is configured.';

/**
 * The lifecycle verdict on a recognised row, or `undefined` when its own state
 * admits it. Order: revoked, then expired (its own `expires_at`, else the
 * legacy grace), then inactive. Reads the row as found — the PRE-stamp
 * `last_used_at` — so a key's own call can never revive it.
 */
function lifecycleRefusalOf(
  row: any,
  nowMs: number,
  policy: ApiKeyLifecyclePolicy | undefined,
  ids: { keyId?: string; userId: string },
): ApiKeyLifecycleRefusal | undefined {
  const label = keyLabel(row);
  if (row.revoked === true || row.revoked === 1) {
    return {
      code: API_KEY_REVOKED_REFUSAL.code,
      // Revocation is the `revoked` flag, and `restore_api_key` clears it again
      // (`sys_api_key`'s own row action): the key works at once, no re-issue.
      // Who may clear it depends on why it was set, read off the row's
      // `revoked_reason`: a key an administrator's forced password reset
      // revoked (`admin_password_reset`) is restored by a platform
      // administrator only (plugin-auth `api-key-restore-guard.ts` refuses its
      // owner); any other revoked key by its owner or a platform administrator.
      // The text names exactly those restorers and never claims the key is
      // gone for good. Rotation stays the other road, for a key that should
      // not come back.
      message: row.revoked_reason === 'admin_password_reset'
        ? `${label} was revoked by an administrator's forced password reset. Only a platform administrator can `
          + 'restore it (the Restore API Key action on the API Keys list); otherwise create a new key '
          + '(POST /api/v1/keys, or the API Keys page) and replace this one wherever it is configured.'
        : `${label} was revoked. Its owner or a platform administrator can restore it (the Restore API Key action `
          + 'on the API Keys list); otherwise create a new key (POST /api/v1/keys, or the API Keys page) and replace '
          + 'this one wherever it is configured.',
      ...ids,
    };
  }

  const expiresMs = instantMs(row.expires_at ?? row.expiresAt);
  if (expiresMs !== undefined) {
    if (expiresMs <= nowMs) {
      const at = new Date(expiresMs).toISOString();
      return {
        code: API_KEY_EXPIRED_REFUSAL.code,
        message: `${label} expired on ${at}. Keys do not renew. ${API_KEY_REMEDY}`,
        at,
        ...ids,
      };
    }
  } else {
    const graceEndMs = legacyGraceEndMs(policy);
    if (graceEndMs !== undefined && graceEndMs <= nowMs) {
      const at = new Date(graceEndMs).toISOString();
      return {
        code: API_KEY_EXPIRED_REFUSAL.code,
        message:
          `${label} was signed with no expiry, and its one-year grace under the API-key lifecycle policy `
          + `ended on ${at}. ${API_KEY_REMEDY}`,
        at,
        ...ids,
      };
    }
  }

  const idle = idleWindowStartMs(row, policy);
  if (idle && policy && nowMs - idle.ms > policy.inactivityDays * DAY_MS) {
    const at = new Date(idle.ms).toISOString();
    const since = idle.from === 'use'
      ? `has not been used since ${at}`
      : idle.from === 'signing'
        ? `has not been used since it was signed on ${at}`
        : `has no recorded use since the API-key lifecycle policy took effect on ${at}`;
    return {
      code: API_KEY_INACTIVE_REFUSAL.code,
      message:
        `${label} ${since}, longer than the ${policy.inactivityDays} days the inactivity policy allows, so it `
        + `is refused. It is not revoked. ${API_KEY_REMEDY}`,
      at,
      ...ids,
    };
  }
  return undefined;
}

/** The end of a no-expiry key's grace: the policy's landing plus a year. */
function legacyGraceEndMs(policy: ApiKeyLifecyclePolicy | undefined): number | undefined {
  const startedMs = instantMs(policy?.startedAt);
  return startedMs === undefined ? undefined : startedMs + API_KEY_LEGACY_GRACE_DAYS * DAY_MS;
}

/**
 * Where a key's idle window starts, or `undefined` when no inactivity policy
 * applies or nothing anchors it.
 *
 *  - a recorded use (`last_used_at`) anchors it;
 *  - a key with NO recorded use counts from the policy's landing — never from
 *    its own `created_at` when that is earlier (no row was ever stamped before
 *    the policy, so an early signing date says nothing about use) — or from
 *    its signing when that is later (a key signed after the landing has been
 *    unused only since then).
 */
function idleWindowStartMs(
  row: any,
  policy: ApiKeyLifecyclePolicy | undefined,
): { ms: number; from: 'use' | 'landing' | 'signing' } | undefined {
  if (!policy || !(policy.inactivityDays > 0)) return undefined;
  const lastUsedMs = instantMs(row.last_used_at ?? row.lastUsedAt);
  if (lastUsedMs !== undefined) return { ms: lastUsedMs, from: 'use' };
  const startedMs = instantMs(policy.startedAt);
  if (startedMs === undefined) return undefined;
  const createdMs = instantMs(row.created_at ?? row.createdAt);
  return createdMs !== undefined && createdMs > startedMs
    ? { ms: createdMs, from: 'signing' }
    : { ms: startedMs, from: 'landing' };
}

/**
 * Engines whose stamp failure has already been reported — so the line is said
 * once per engine, at the first failure (AGENTS.md, degradation log levels),
 * not once per request of a key whose stamp keeps failing.
 */
const STAMP_FAILURE_REPORTED = new WeakSet<object>();

/**
 * [#23367] Stamp an admitted key's row: `last_used_at` when it is older than
 * {@link API_KEY_LAST_USED_STAMP_INTERVAL_MS} (or empty), and, for a key
 * signed with no expiry, the end of its grace as `expires_at` (the MFA-grace
 * precedent: the clock is stamped on the row, so the keys page names it).
 *
 * ⛔ A stamp failure never fails the request: the key was judged on the row as
 * found. It is a durability degradation all the same — the field claims each
 * use, and an unstamped use lets a key in daily use read as idle — so it is
 * said at `error`, once per engine, with the consequence and the remedy.
 */
async function stampAdmittedKey(
  ql: any,
  row: any,
  keyId: string | undefined,
  nowMs: number,
  policy: ApiKeyLifecyclePolicy | undefined,
): Promise<void> {
  if (!keyId || !ql || typeof ql.update !== 'function') return;
  const patch: Record<string, string> = {};
  const lastUsedMs = instantMs(row.last_used_at ?? row.lastUsedAt);
  if (lastUsedMs === undefined || nowMs - lastUsedMs >= API_KEY_LAST_USED_STAMP_INTERVAL_MS) {
    patch.last_used_at = new Date(nowMs).toISOString();
  }
  if (instantMs(row.expires_at ?? row.expiresAt) === undefined) {
    const graceEndMs = legacyGraceEndMs(policy);
    if (graceEndMs !== undefined) patch.expires_at = new Date(graceEndMs).toISOString();
  }
  if (Object.keys(patch).length === 0) return;
  try {
    await ql.update('sys_api_key', { id: keyId, ...patch }, { context: { isSystem: true } });
  } catch (err) {
    if (typeof ql === 'object' && STAMP_FAILURE_REPORTED.has(ql)) return;
    if (typeof ql === 'object') STAMP_FAILURE_REPORTED.add(ql);
    console.error(
      `[security] API key use NOT recorded: the sys_api_key stamp (${Object.keys(patch).join(', ')}) failed `
      + `for key=${keyId}. The request was served, and every later one will be too, but a key in daily `
      + 'use whose uses are not recorded reads as unused and will be refused API_KEY_INACTIVE once the '
      + 'inactivity window passes. Fix: restore write access to sys_api_key for the system context. '
      + `Said once for this data engine. Cause: ${String((err as any)?.message ?? err)}`,
    );
  }
}

/** The principal resolved from a valid `sys_api_key`. */
export interface ApiKeyPrincipal {
  userId: string;
  /**
   * [#15256 / 2A] The `sys_api_key` ROW id — a non-secret handle an operator
   * can look the credential up by. Carried so the posture-conditional refusal
   * log in `resolve-authz-context.ts` can name WHICH key was refused without
   * naming the credential.
   *
   * ⛔ Never the raw key and never its hash: the raw key is returned exactly
   * once by {@link generateApiKey} and only `sha256(raw)` is ever stored, and
   * neither may enter a log line (see this module's SECURITY header). The row
   * id is not derived from either.
   *
   * Optional because a row is only required to identify its owner; a store
   * that answers without an `id` still yields a usable principal.
   */
  keyId?: string;
  /**
   * The organization this key authenticates INTO — read from the row's
   * `active_organization_id` and adopted by `resolveAuthzContext` as the
   * request's active organization (`ExecutionContext.tenantId`), which is what
   * lets the ADR-0105 Layer 0 wall match. `undefined` for a key minted before
   * #8287, or one minted under the `single` posture where there is no
   * organization to inherit.
   */
  tenantId?: string;
  scopes: string[];
}

/**
 * [#8287] Why a key was refused. Distinct from "no key present" and from "this
 * key is unknown/revoked/expired": a refusal means the credential is real and
 * intact but cannot be admitted under this deployment's tenancy posture.
 */
export type ApiKeyRefusalReason = 'organization_required' | 'organization_membership_ended';

/**
 * The verdict on an inbound API key. Five outcomes, deliberately distinct:
 *
 *  - `none` — no key header, or a key that is unknown / owner-less.
 *    Indistinguishable by design (never tell a prober which), and the caller
 *    MAY fall through to the session path exactly as before.
 *  - `lifecycle` — [#23367, ruling A] a REAL key whose own state refuses it:
 *    revoked, expired (its `expires_at`, or the grace of a key signed with
 *    none), or inactive. Distinct and located by ruling: the holder of a key
 *    that once worked is told which state and which date, with the remedy (a
 *    new key). A prober holding no real key still learns nothing — an unknown
 *    hash stays `none`. The caller must NOT fall through to the session path,
 *    for the `refused` arm's reason; `resolveAuthzContext` raises it as the
 *    branded {@link ApiKeyLifecycleRefusalError}.
 *  - `admitted` — a usable principal.
 *  - `held` — [#23287, ruling C′ item 3] a real, intact key whose OWNER holds
 *    an `account`-scope ADR-0069 posture (`AUTH_GATE_SCOPES`): the account's
 *    standing holds every credential, so the key answers as the session does —
 *    the door refuses it with the posture's `403` (`gate.code`,
 *    `gate.message`). The principal is carried because the answer is a held
 *    PRINCIPAL, exactly like a held session, and not an anonymous caller. The
 *    caller must NOT fall through to the session path, for the reason the
 *    `refused` arm gives. ⛔ Not a revocation: nothing is written, and the same
 *    key is admitted again the moment the owner remediates.
 *  - `refused` — a real, intact key the posture cannot admit. The caller must
 *    NOT fall through to the session path: falling through would be more
 *    permissive than today's behaviour (an API key already outranks a session),
 *    and the whole point of the refusal is that it is LOUD at call time.
 */
export type ApiKeyAdmission =
  | { outcome: 'none' }
  | { outcome: 'lifecycle'; refusal: ApiKeyLifecycleRefusal }
  | { outcome: 'admitted'; principal: ApiKeyPrincipal }
  | { outcome: 'held'; principal: ApiKeyPrincipal; gate: AuthGate }
  | {
      outcome: 'refused';
      reason: ApiKeyRefusalReason;
      message: string;
      /**
       * [#15256 / 2A] The refused key's `sys_api_key` row id — same non-secret
       * handle as {@link ApiKeyPrincipal.keyId}, carried on this arm too so the
       * refusal log can name the credential the operator must go look at. ⛔
       * Never the raw key or its hash. The WIRE answer is unchanged (a generic
       * `401 UNAUTHENTICATED`, no reason and no id), so nothing here reaches a
       * caller holding someone else's key.
       */
      keyId?: string;
      /** The owner this refused key authenticates as — for the same log line. */
      userId?: string;
      /** The organization the refusal is about, when the key names one. */
      organizationId?: string;
    };

/**
 * The shape of the kernel's `tenancy` service this module reads a posture from.
 * Structural on purpose: `@objectstack/core` must not depend on the plugin that
 * provides it, and an embedding without that plugin simply supplies nothing.
 */
export interface TenancyPostureSource {
  posture?: string;
  isolationActive?: boolean;
}

/**
 * [#8287] Resolve the EFFECTIVE tenancy posture from the kernel's `tenancy`
 * service — the same reconciliation `plugin-security` performs before handing a
 * posture to `computeTenantLayer0Filter`, so the wall and the API-key admission
 * can never disagree about which posture is in force.
 *
 * ⚠️ Deliberately NOT `resolveTenancyPosture()` from `@objectstack/types`, which
 * reads `OS_TENANCY_POSTURE` directly. That answers what the operator ASKED
 * for, not what is ENFORCED: under ADR-0093 D4/D5 a deployment that requests
 * `isolated` without the `@objectstack/organizations` runtime
 * resolves to `single` and runs with NO organization wall. Reading the env
 * there would refuse org-less API keys on a deployment whose wall is not even
 * active — breaking working automation to enforce a boundary that does not
 * exist. The `tenancy` service is the one place that already knows the
 * difference.
 *
 * Returns `undefined` when no service is available, which callers must treat as
 * "no posture-conditional refusal" — see {@link resolveApiKeyAdmission}.
 */
export function effectiveTenancyPosture(
  tenancy: TenancyPostureSource | undefined | null,
): TenancyPosture | undefined {
  if (!tenancy) return undefined;
  return normalizeTenancyPosture(tenancy.posture) ?? (tenancy.isolationActive ? 'isolated' : 'single');
}

/**
 * Verify an inbound API key against `sys_api_key` and resolve its principal —
 * the verdict of {@link resolveApiKeyAdmission}, collapsed to a principal.
 *
 * Fail-closed: returns `undefined` for a missing key, an unusable data engine,
 * a key that is unknown / owner-less, a key its own lifecycle
 * refuses (revoked / expired / inactive — `lifecycle`), a key the tenancy
 * posture refuses, and a key whose OWNER holds an `account`-scope ADR-0069
 * posture (`held`). A `sys_api_key` read that THROWS is no answer at all: it
 * raises the branded `AuthzStoreUnavailableError` (#24299), as an unreadable
 * lifecycle-policy or posture source already does.
 *
 * ⚠️ The collapse is lossy by construction: a principal-or-nothing answer cannot
 * carry the posture's code, so a host that admits keys through this function
 * answers a held owner's key as it answers no key at all, never with the `403`
 * and code ruling C′ item 1 gives every other seam. A transport that answers
 * requests reads {@link resolveApiKeyAdmission} (or `resolveAuthzContext`) and
 * refuses `held` with `gate.code`.
 *
 * [#23455] `userAuthGates` is REQUIRED, for the reason it is on
 * {@link resolveApiKeyAdmission}: while this function took no posture source
 * at all, any host admitting keys through it admitted a held owner's key.
 * `tenancyPosture` is required with it, because a required parameter cannot
 * follow an optional one; `undefined` is a legitimate value for both and is
 * passed on purpose.
 *
 * @param ql             A data engine with `find(object, { where, limit, context })`.
 * @param headers        Request headers (Web `Headers` or a plain object).
 * @param nowMs          Clock for expiry checks (injectable for tests).
 * [#23367] `apiKeyLifecycle` is REQUIRED for the same reason, and with the
 * same meaning of `undefined`.
 *
 * @param tenancyPosture  The deployment's effective tenancy posture, or `undefined` when no `tenancy` service is registered.
 * @param userAuthGates   `userAuthGateSourceOf(authService)`, or `undefined` when the kernel has no auth service.
 * @param apiKeyLifecycle `apiKeyLifecyclePolicySourceOf(authService)`, or `undefined` when the kernel has no auth service.
 */
export async function resolveApiKeyPrincipal(
  ql: any,
  headers: any,
  nowMs: number = Date.now(),
  tenancyPosture: TenancyPosture | undefined,
  userAuthGates: UserAuthGateSource | undefined,
  apiKeyLifecycle: ApiKeyLifecyclePolicySource | undefined,
): Promise<ApiKeyPrincipal | undefined> {
  const admission = await resolveApiKeyAdmission(ql, headers, nowMs, tenancyPosture, userAuthGates, apiKeyLifecycle);
  return admission.outcome === 'admitted' ? admission.principal : undefined;
}

/**
 * [#8287] The full verdict behind {@link resolveApiKeyPrincipal} — same lookup,
 * but it distinguishes a POSTURE REFUSAL from "no principal".
 *
 * `resolveApiKeyPrincipal` collapses `refused` and `held` into `undefined`, so
 * a caller of it fails closed; a caller that can report WHY (the shared
 * `resolveAuthzContext`) uses this instead.
 *
 * The only refusal decided here is the org-less one, because it needs nothing
 * but the row and the posture. The ex-member refusal needs the caller's
 * membership set and is decided in `resolveAuthzContext`, where that set is
 * already resolved.
 *
 * [#23455] Every parameter after `nowMs` is REQUIRED, and `undefined` is a
 * value passed on purpose — see `userAuthGates` below.
 */
export async function resolveApiKeyAdmission(
  ql: any,
  headers: any,
  nowMs: number = Date.now(),
  /**
   * The deployment's effective tenancy posture (`effectiveTenancyPosture`),
   * or `undefined` when no `tenancy` service is registered. Required because
   * `userAuthGates` after it is: a required parameter cannot follow an
   * optional one.
   */
  tenancyPosture: TenancyPosture | undefined,
  /**
   * [#23287, ruling C′ item 3] The auth service's per-user posture
   * computation (`userAuthGateSourceOf(authService)`).
   *
   * [#23455] REQUIRED. While it was optional, a caller that never named a
   * source compiled and admitted a held owner's key — the fail-open three
   * seams carried after the ruling. `undefined` is the value a kernel
   * without `plugin-auth` passes (no policy can hold anyone there); ⛔ never
   * the value a caller that can reach the `auth` service passes to quiet the
   * compiler.
   */
  userAuthGates: UserAuthGateSource | undefined,
  /**
   * [#23367, ruling A] The auth service's API-key lifecycle policy
   * (`apiKeyLifecyclePolicySourceOf(authService)`): the inactivity window and
   * the landing that anchors keys with no recorded use or no expiry.
   *
   * REQUIRED, for the #23455 reason `userAuthGates` is: an optional source is
   * how a new seam compiles while skipping the policy. `undefined` is the
   * value a kernel without `plugin-auth` passes — there is no auth
   * configuration there, so only the row's own facts (revoked, `expires_at`)
   * are judged — ⛔ never the value a caller that can reach the `auth`
   * service passes to quiet the compiler.
   */
  apiKeyLifecycle: ApiKeyLifecyclePolicySource | undefined,
): Promise<ApiKeyAdmission> {
  const apiKey = extractApiKey(headers);
  if (!apiKey) return { outcome: 'none' };
  if (!ql || typeof ql.find !== 'function') return { outcome: 'none' };

  // Match by the indexed at-rest hash only — never query by the raw key.
  //
  // [#23367] By the hash alone: a REVOKED row is found too, so it can be
  // refused with its own code instead of reading as an unknown key.
  let rows: any;
  try {
    rows = await ql.find('sys_api_key', {
      where: { key: hashApiKey(apiKey) },
      limit: 1,
      context: { isSystem: true },
    });
  } catch (err) {
    // [#24299] A read that was ISSUED and THREW is the branded store outage,
    // never "no key". `none` here sent a key holder the anonymous floor's
    // `401` where a session caller got `503`, and let the request fall on to
    // the session arm, so a cookie sent beside the key answered for a
    // credential the caller did not lead with (measured: served as the
    // cookie's user on the REST data door and the runtime dispatcher).
    //
    // The one read failure that IS a true "no key" is a `sys_api_key` table
    // that was never provisioned: no key can exist there, so nothing was
    // withheld. That is the boundary the 2026-08-30 ruling (option A) draws
    // for `resolveAuthzContext`'s `tryFind`, asked through the same
    // `isMissingTableError` predicate — ⛔ never a second classifier here;
    // its signed-off false-positive risk is written beside `tryFind`.
    if (isMissingTableError(err, 'sys_api_key')) return { outcome: 'none' };
    throw new AuthzStoreUnavailableError('sys_api_key', err);
  }
  if (rows && (rows as any).value) rows = (rows as any).value;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row) return { outcome: 'none' };

  const userId = row.user_id ?? row.userId;
  if (!userId || typeof userId !== 'string') return { outcome: 'none' };

  // [#15256 / 2A] The row's own id — a non-secret handle for the refusal log.
  // ⛔ Never `row.key` (the at-rest hash) and never the inbound `apiKey`.
  const keyId = typeof row.id === 'string' && row.id ? row.id : undefined;

  // [#23367, ruling A] The key's own lifecycle, judged FIRST: a revoked,
  // expired or inactive key is no credential at all, so its state is what the
  // holder is told — before any posture question is asked of its owner. Read
  // off the row AS FOUND, i.e. the pre-stamp `last_used_at`: the stamp below
  // runs only for a key this verdict admits, so a key's own call can never
  // revive it.
  //
  // The policy is asked only once a real, unrevoked key is in hand. A source
  // that REJECTS leaves the policy unknown, and an unknown policy is not an
  // admission: the branded store outage, as for the owner-posture source.
  let policy: ApiKeyLifecyclePolicy | undefined;
  if (apiKeyLifecycle && !(row.revoked === true || row.revoked === 1)) {
    try {
      policy = await apiKeyLifecycle();
    } catch (err) {
      throw new AuthzStoreUnavailableError('api_key_policy', err);
    }
  }
  const lifecycle = lifecycleRefusalOf(row, nowMs, policy, { keyId, userId });
  if (lifecycle) return { outcome: 'lifecycle', refusal: lifecycle };

  // [#8287 / PD #12] ONE spelling. The producer (`runtime` `/keys`) writes
  // `active_organization_id` and nothing else, so this reads that column and
  // nothing else. The `row.organization_id ?? row.organizationId` chain that
  // stood here was a consumer-side tolerance for a producer that did not exist
  // yet — it read a column no mint path ever wrote, which is why the ruling's
  // "key auth establishes that organization" clause was already implemented
  // and still measured as inert.
  const tenantId = typeof row.active_organization_id === 'string' && row.active_organization_id
    ? row.active_organization_id
    : undefined;

  // [#8287] Posture-conditional refusal for a key that carries no organization.
  //
  // ⛔ Never backfilled — inferring the org from the owner's CURRENT membership
  // would silently upgrade a credential minted under a different promise.
  // Refusal is scoped to the one posture where such a key is provably dead:
  //
  //  - `single`   — no wall exists; an org-less key works, and always did.
  //  - `group`    — the wall is `organization_id IN accessible_org_ids`, and
  //                 that set derives from the owner's `sys_member` rows
  //                 INDEPENDENTLY of the active organization, so an org-less
  //                 key already reads the union of its owner's orgs. Refusing
  //                 would break working deployments for no security gain.
  //  - `isolated` — the wall is `organization_id = activeOrganizationId`; with
  //                 no active organization NOTHING can match, which is exactly
  //                 the `200 + total 0` this card was filed for. Refuse, so the
  //                 failure is loud at call time instead of silently empty.
  //
  // ⚠️ An ABSENT posture means "the caller could not tell us which posture is in
  // force", and the answer to that is to admit — i.e. today's behaviour. Not
  // fail-closed, deliberately, and this is the one place in this module where
  // that is the right call. Fail-closed belongs on questions about THIS
  // credential; this is a question about the DEPLOYMENT, and refusing on an
  // unknown one would break working automation to enforce a wall that may not
  // exist at all.
  //
  // [#15256 — maintainer ruling 2026-09-04, decision 3A] ⭐ The behaviour is
  // unchanged and its justification is rewritten, because the premise the
  // justification rested on was measured FALSE. It read:
  //
  //     "refusing on an unknown posture would break every org-less key on
  //      every `single` deployment whose transport has not been wired"
  //
  // The transport it called not-yet-wired was `@objectstack/rest`'s
  // single-kernel branch — i.e. every deployment the open core builds, not a
  // residual case. So the sentence described the shipped wiring as an
  // exception, and the exception was the rule: on that wiring an org-less key
  // answered `200 + total 0` and an ex-member's stamped key read AND wrote
  // another organization's rows (objectstack#15163; cloud#1982 with the real
  // `@objectstack/organizations`). That branch now derives the posture
  // (`rest-server.ts`, wired by `rest-api-plugin.ts`), and a REST-level pin
  // holds it derived.
  //
  // The only legitimate case left — the one this admission now exists for — is
  // a HOST THAT REGISTERS NO `tenancy` SERVICE: an embedder composing the
  // kernel without `plugin-auth`, or any host that never asks for tenancy at
  // all. There is no wall on such a deployment, so there is nothing for an
  // org-less key to be walled out of. ⛔ Note what is NOT in that set: a
  // `tenancy` service that was registered and FAILED to build. That is an
  // outage, it is classified apart at every transport seam
  // (`isServiceNotRegisteredError`, #13906 decision 1 option A), and it never
  // reaches here as an absent posture.
  if (!tenantId && tenancyPosture) {
    const posture = tenancyPosture;
    if (postureEnforcesWall(posture) && !postureUsesUnionScope(posture)) {
      return {
        outcome: 'refused',
        reason: 'organization_required',
        keyId,
        userId,
        message:
          'This API key carries no organization and cannot be used under the `isolated` tenancy '
          + 'posture, where every organization-scoped read is walled to an active organization. '
          + 'Mint a replacement key — new keys inherit the minter’s active organization.',
      };
    }
  }

  const principal: ApiKeyPrincipal = { userId, keyId, tenantId, scopes: parseScopes(row.scopes) };

  // [#23287 — ruling C′ item 3, maintainer 「同意」 2026-10-14] ONE judgment, at
  // this seam: the account's standing holds every credential of the user, so a
  // key whose OWNER holds an `account`-scope ADR-0069 posture (enforced MFA not
  // yet enrolled) answers as that owner's session does. A `credential`-scope
  // posture (password expiry, an administrator's forced reset) holds password
  // sign-in alone, and the key keeps working.
  //
  // Asked AFTER the org-less refusal: a key the tenancy posture refuses is no
  // credential at all, and its answer stays the generic 401.
  //
  // The organization is the KEY's own (`active_organization_id`), so a
  // per-organization MFA requirement holds the key exactly as it holds a
  // session whose active organization it is.
  //
  // ⛔ Not a revocation (ruling item 4): nothing is written here. The same key
  // is admitted again the moment the owner enrols, with nothing reissued.
  //
  // A posture computation that REJECTS leaves the owner's standing unknown,
  // and an unknown answer is not an admission: the branded store outage, which
  // every transport answers `503` (#13906 decision 2 option B, the answer an
  // active gate whose session re-read fails gets). The computation itself fails
  // open on a lookup error, exactly as the session gate does, so this arm is a
  // fault in the service, not in its store.
  let gate: AuthGate | null = null;
  if (userAuthGates) {
    let gates: readonly AuthGate[];
    try {
      gates = await userAuthGates(userId, { organizationId: tenantId });
    } catch (err) {
      throw new AuthzStoreUnavailableError('auth_gate', err);
    }
    gate = accountScopeAuthGate(gates);
  }

  // [#23367] The key is live: record the use (throttled), and stamp the grace
  // of a key signed with no expiry. A HELD key is stamped too — its
  // integration is using it, and ruling C′ item 4 serves it again the moment
  // the owner remediates, which an idle clock run out during the hold would
  // defeat. A key the tenancy posture refused (above) is not.
  await stampAdmittedKey(ql, row, keyId, nowMs, policy);

  if (gate) return { outcome: 'held', principal, gate };
  return { outcome: 'admitted', principal };
}

function readHeader(headers: any, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  if (typeof headers.get === 'function') {
    const v = headers.get(name) ?? headers.get(lower);
    return v == null ? undefined : String(v);
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const v = headers[key];
      return Array.isArray(v) ? v[0] : v == null ? undefined : String(v);
    }
  }
  return undefined;
}

function safeJsonParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
