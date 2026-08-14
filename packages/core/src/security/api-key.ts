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
  if (value == null) return false;
  let ms: number;
  if (typeof value === 'number') {
    // Heuristic: seconds vs milliseconds epoch.
    ms = value < 1e12 ? value * 1000 : value;
  } else if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === 'string') {
    ms = Date.parse(value);
  } else {
    return false;
  }
  if (Number.isNaN(ms)) return false;
  return ms <= nowMs;
}

/** The principal resolved from a valid `sys_api_key`. */
export interface ApiKeyPrincipal {
  userId: string;
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
 * The verdict on an inbound API key. Three outcomes, deliberately distinct:
 *
 *  - `none` — no key header, or a key that is unknown / revoked / expired /
 *    owner-less. Indistinguishable by design (never tell a prober which), and
 *    the caller MAY fall through to the session path exactly as before.
 *  - `admitted` — a usable principal.
 *  - `refused` — a real, intact key the posture cannot admit. The caller must
 *    NOT fall through to the session path: falling through would be more
 *    permissive than today's behaviour (an API key already outranks a session),
 *    and the whole point of the refusal is that it is LOUD at call time.
 */
export type ApiKeyAdmission =
  | { outcome: 'none' }
  | { outcome: 'admitted'; principal: ApiKeyPrincipal }
  | { outcome: 'refused'; reason: ApiKeyRefusalReason; message: string };

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
 * `isolated` without the enterprise `@objectstack/organizations` runtime
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
 * Verify an inbound API key against `sys_api_key` and resolve its principal.
 * This is the ONE verify path shared by the dispatcher/MCP and REST surfaces.
 *
 * Fail-closed: returns `undefined` for a missing key, an unusable data engine,
 * a lookup error, or a key that is unknown / revoked / expired / owner-less.
 *
 * @param ql      A data engine with `find(object, { where, limit, context })`.
 * @param headers Request headers (Web `Headers` or a plain object).
 * @param nowMs   Clock for expiry checks (injectable for tests).
 */
export async function resolveApiKeyPrincipal(
  ql: any,
  headers: any,
  nowMs: number = Date.now(),
  tenancyPosture?: TenancyPosture,
): Promise<ApiKeyPrincipal | undefined> {
  const admission = await resolveApiKeyAdmission(ql, headers, nowMs, tenancyPosture);
  return admission.outcome === 'admitted' ? admission.principal : undefined;
}

/**
 * [#8287] The full verdict behind {@link resolveApiKeyPrincipal} — same lookup,
 * but it distinguishes a POSTURE REFUSAL from "no principal".
 *
 * `resolveApiKeyPrincipal` collapses `refused` into `undefined` so every
 * existing caller keeps working and keeps failing closed; a caller that can
 * report WHY (the shared `resolveAuthzContext`) uses this instead.
 *
 * The only refusal decided here is the org-less one, because it needs nothing
 * but the row and the posture. The ex-member refusal needs the caller's
 * membership set and is decided in `resolveAuthzContext`, where that set is
 * already resolved.
 */
export async function resolveApiKeyAdmission(
  ql: any,
  headers: any,
  nowMs: number = Date.now(),
  tenancyPosture?: TenancyPosture,
): Promise<ApiKeyAdmission> {
  const apiKey = extractApiKey(headers);
  if (!apiKey) return { outcome: 'none' };
  if (!ql || typeof ql.find !== 'function') return { outcome: 'none' };

  // Match by the indexed at-rest hash only — never query by the raw key.
  let rows: any;
  try {
    rows = await ql.find('sys_api_key', {
      where: { key: hashApiKey(apiKey), revoked: false },
      limit: 1,
      context: { isSystem: true },
    });
  } catch {
    return { outcome: 'none' };
  }
  if (rows && (rows as any).value) rows = (rows as any).value;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row || row.revoked === true) return { outcome: 'none' };

  const expiresAt = row.expires_at ?? row.expiresAt;
  if (isExpired(expiresAt, nowMs)) return { outcome: 'none' };

  const userId = row.user_id ?? row.userId;
  if (!userId || typeof userId !== 'string') return { outcome: 'none' };

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
  // that is the right call: refusing on an unknown posture would break every
  // org-less key on every `single` deployment whose transport has not been
  // wired, to enforce a wall that may not exist. Fail-closed belongs on
  // questions about THIS credential; this is a question about the deployment.
  if (!tenantId && tenancyPosture) {
    const posture = tenancyPosture;
    if (postureEnforcesWall(posture) && !postureUsesUnionScope(posture)) {
      return {
        outcome: 'refused',
        reason: 'organization_required',
        message:
          'This API key carries no organization and cannot be used under the `isolated` tenancy '
          + 'posture, where every organization-scoped read is walled to an active organization. '
          + 'Mint a replacement key — new keys inherit the minter’s active organization.',
      };
    }
  }

  return {
    outcome: 'admitted',
    principal: { userId, tenantId, scopes: parseScopes(row.scopes) },
  };
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
