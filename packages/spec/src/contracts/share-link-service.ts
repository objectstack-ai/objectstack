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
 */

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

/** Minimal context interface — kept compatible with `SharingExecutionContext`. */
export interface ShareLinkExecutionContext {
  userId?: string;
  tenantId?: string;
  isSystem?: boolean;
}

/**
 * Default implementation lives in `@objectstack/plugin-sharing`.
 *
 * Implementations MUST treat `context.isSystem === true` as a bypass
 * (skip the per-object opt-in check) so platform bootstrappers can seed
 * demo links.
 */
export interface IShareLinkService {
  /** Mint a new link. Throws when the object is not opt-in or limits are exceeded. */
  createLink(input: CreateShareLinkInput, context: ShareLinkExecutionContext): Promise<ShareLink>;

  /** Mark a link as revoked. No-op when already revoked or not found. */
  revokeLink(idOrToken: string, context: ShareLinkExecutionContext): Promise<void>;

  /** List links for a record, an object, or a creator. */
  listLinks(filter: ListShareLinksFilter, context: ShareLinkExecutionContext): Promise<ShareLink[]>;

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
