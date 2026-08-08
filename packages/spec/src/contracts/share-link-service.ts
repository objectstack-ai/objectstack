// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec/contracts/share-link-service
 *
 * Capability-token sharing — "anyone with the link" publication of a
 * single record. Complementary to `ISharingService`, which models
 * principal-based grants (share with specific users / teams / roles).
 *
 * Design notes:
 *
 *   1. **Opaque tokens.** A share link is a single random `token`
 *      (>=22 chars from a URL-safe alphabet). Anyone holding the
 *      token can fetch the record subject to `audience` and
 *      `expires_at`. Tokens are *not* derived from the record id;
 *      enumerating record ids reveals nothing.
 *
 *   2. **Per-object opt-in.** `createLink` refuses to mint a token
 *      for an object whose schema does not set `publicSharing.enabled`.
 *      The audience / permission requested must also lie within the
 *      object's `allowedAudiences` / `allowedPermissions` whitelist.
 *
 *   3. **Field-level redaction.** Each resolved link returns a
 *      `redactFields` set (object-default ∪ per-link). The REST gateway
 *      strips these before serialising to the response — the engine
 *      itself sees the raw row so existing hooks fire normally.
 *
 *   4. **No principal expansion.** Holders of a share token are NOT
 *      treated as principals in `sys_record_share`; the token authorises
 *      access only to its single `(object, recordId)` tuple at the
 *      declared `permission` level. This keeps audit trails clean and
 *      prevents lateral movement.
 *
 *   5. **Enforcement runs on the FULL envelope.** Every method that
 *      adjudicates access takes a complete {@link ExecutionContext} — the
 *      whole `resolveAuthzContext` envelope, not a per-site subset. See
 *      {@link ShareLinkExecutionContext} for the boundary this draws and
 *      why (#6206 / #6430).
 */

import type { ExecutionContext } from '../kernel/execution-context.zod.js';

/** Levels selectable when issuing a link. */
export type ShareLinkPermission = 'view' | 'comment' | 'edit';

/** Audience gating. */
export type ShareLinkAudience = 'public' | 'link_only' | 'signed_in' | 'email';

/** Persisted shape — mirrors `sys_share_link` columns 1:1. */
export interface ShareLink {
  id: string;
  /** Opaque URL-safe token. Always present; the only secret. */
  token: string;
  object_name: string;
  record_id: string;
  permission: ShareLinkPermission;
  audience: ShareLinkAudience;
  /** ISO timestamp; null means no expiry. */
  expires_at?: string | null;
  /** When `audience='email'`, the allow-listed addresses (lowercased). */
  email_allowlist?: string[] | null;
  /** Optional argon2/bcrypt hash; UI prompts for a password when set. */
  password_hash?: string | null;
  /** Per-link extra redactions, layered on top of the object-default set. */
  redact_fields?: string[] | null;
  /** Free-text shown in the share dialog (e.g. "Q3 contract for ACME"). */
  label?: string | null;
  /** When set, the link is revoked and `resolveToken` returns null. */
  revoked_at?: string | null;
  created_by?: string | null;
  created_at?: string;
  last_used_at?: string | null;
  use_count?: number;
}

/** Input for {@link IShareLinkService.createLink}. */
export interface CreateShareLinkInput {
  object: string;
  recordId: string;
  permission?: ShareLinkPermission;
  audience?: ShareLinkAudience;
  /** ISO timestamp or relative duration string ("7d", "24h") — service normalises. */
  expiresAt?: string | null;
  emailAllowlist?: string[];
  /** Plain-text password; service hashes before persisting. */
  password?: string;
  /** Per-link redactions in addition to the object default. */
  redactFields?: string[];
  label?: string;
}

/** Filter for {@link IShareLinkService.listLinks}. */
export interface ListShareLinksFilter {
  object?: string;
  recordId?: string;
  createdBy?: string;
  includeRevoked?: boolean;
}

/** Outcome of resolving a token via the public endpoint. */
export interface ResolveShareLinkResult {
  link: ShareLink;
  /** Effective fields removed from the response (object default ∪ per-link). */
  redactFields: string[];
}

/**
 * ROUTE-LOCAL identity shape — what the share-link HTTP routes need to answer
 * **"is this request authenticated at all?"** (their own 401), and nothing
 * more.
 *
 * ## ⛔ Never an enforcement context (#6206, maintainer ruling 2026-08-07)
 *
 * This type must never reach a path that ADJUDICATES access — no
 * `engine.find` / `engine.update` `context`, no visibility probe, no
 * capability gate. Those take a full {@link ExecutionContext}; see
 * {@link IShareLinkService}, whose every context parameter is now that type.
 *
 * The reason is a measured failure, not a style preference. The share-link
 * route used to assemble exactly these five fields out of the
 * `resolveAuthzContext` envelope and hand the result straight to `engine.find`
 * as the [Finding-2] visibility check's context. Dropped on the floor:
 * `accessible_org_ids`, `org_user_ids`, `systemPermissions`, `posture`,
 * `tabPermissions`. Under the `group` tenancy posture `accessible_org_ids` IS
 * the Layer 0 wall (ADR-0105 D2) and an absent set denies — so the check
 * failed closed for every caller and share-link creation returned a blanket
 * 403 on a posture that ships. A trimmed envelope feeding enforcement is a
 * bypass-SHAPED pattern even when today's instance happens to fail closed;
 * ADR-0095 D2 already rules that posture is resolved once and flows with the
 * context, never re-derived (or re-assembled) at the enforcement site. This
 * was the third assembly site of that family (#5997, #6071), which is why the
 * governance default converged on the whole envelope instead of yet another
 * per-site subset.
 *
 * ## What it is still legitimately for
 *
 * A route handler that only has to decide *authenticated vs anonymous* before
 * dispatching — `userId` present ⇒ proceed, absent ⇒ 401. That decision reads
 * no authorization dimension, so it needs no authorization envelope. Anything
 * past that gate hands the request's **complete** resolved context down.
 *
 * ## A note for implementors and reviewers
 *
 * TypeScript cannot police this boundary for you. Structural subtyping makes a
 * value of this type assignable to {@link ExecutionContext} — every field here
 * exists there with a compatible type, and the ones that matter are optional —
 * so a narrowed context passed to an enforcement path still COMPILES. What the
 * contract can do, and now does, is state the enforcement parameter type as
 * the full envelope so the narrowing is visible at the call site instead of
 * hidden behind a type that looked like it was designed for the job. Producing
 * that envelope is the caller's obligation: pass the `resolveAuthzContext`
 * result through whole.
 */
export interface ShareLinkExecutionContext {
  userId?: string;
  tenantId?: string;
  isSystem?: boolean;
  /**
   * [Finding-2] The caller's resolved positions / permissions. Populated by the
   * verified route wiring so the route's own principal checks read the real
   * identity rather than a spoofable header.
   *
   * These are NOT sufficient for an RLS-aware visibility check — that check
   * lives on {@link IShareLinkService} and takes the full
   * {@link ExecutionContext}.
   */
  positions?: string[];
  permissions?: string[];
}

/**
 * Default implementation lives in `@objectstack/plugin-sharing`.
 *
 * Implementations MUST treat `context.isSystem === true` as a bypass
 * (skip the per-object opt-in check) so platform bootstrappers can seed
 * demo links.
 *
 * ## The context every method takes (#6206 ruling, #6430)
 *
 * `createLink` / `revokeLink` / `listLinks` all ADJUDICATE access, so each
 * takes a full {@link ExecutionContext} — the complete `resolveAuthzContext`
 * envelope, threaded through unchanged. Callers MUST NOT rebuild a subset of
 * it: `accessible_org_ids` (the `group`-posture Layer 0 wall, ADR-0105 D2),
 * `org_user_ids`, `systemPermissions`, `posture` (ADR-0095 D2: resolved once,
 * carried, never re-derived at enforcement) and `tabPermissions` are all read
 * downstream of these calls, and a caller cannot know which of them the
 * deployment's posture makes load-bearing.
 *
 * {@link ShareLinkExecutionContext} is the route's own 401 shape and is
 * deliberately NOT accepted here — its doc comment carries the full rationale.
 */
export interface IShareLinkService {
  /**
   * Mint a new link. Throws when the object is not opt-in or limits are exceeded.
   *
   * ENFORCEMENT PATH: implementations re-read the target record under
   * `context` ([Finding-2] — you may only link-share a record you can
   * yourself see), so `context` must be the caller's complete resolved
   * envelope. A trimmed one silently changes the verdict of that read.
   */
  createLink(input: CreateShareLinkInput, context: ExecutionContext): Promise<ShareLink>;

  /**
   * Mark a link as revoked. No-op when already revoked or not found.
   *
   * ENFORCEMENT PATH: revoke authority is creator ∪ record share-manager
   * (ADR-0111 D8), and the share-manager probe evaluates `context`.
   */
  revokeLink(idOrToken: string, context: ExecutionContext): Promise<void>;

  /**
   * List links for a record, an object, or a creator.
   *
   * ENFORCEMENT PATH: the listing is read under `context`, so row visibility
   * is decided by it.
   */
  listLinks(filter: ListShareLinksFilter, context: ExecutionContext): Promise<ShareLink[]>;

  /**
   * Resolve a token at request-handling time. Returns null when the
   * token does not exist, is revoked, expired, or fails the audience
   * check. Increments `use_count` / `last_used_at` as a side effect.
   *
   * @param token  raw token from the URL / cookie
   * @param probe  contextual gates the caller has already evaluated
   *               (e.g. signed-in user, recipient email, supplied
   *               password)
   */
  resolveToken(
    token: string,
    probe?: {
      signedInUserId?: string;
      recipientEmail?: string;
      providedPassword?: string;
    },
  ): Promise<ResolveShareLinkResult | null>;
}

/** Service-registry key — keep in sync with the SharingPlugin registration. */
export const SHARE_LINK_SERVICE = 'shareLinks' as const;
