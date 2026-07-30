// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #2567 — the single anonymous-deny decision, shared by every HTTP seam.
 *
 * ADR-0056 D2 made the platform deny anonymous callers by default
 * (`requireAuth`). Phase 1 gated each surface (REST `/data`, dispatcher
 * `/graphql` + `/meta`, raw-hono `/data`) but every seam hand-rolled the same
 * `!userId && !isSystem → 401` check. This centralises that DECISION into one
 * pure, tested function — the exact pattern {@link ./auth-gate.ts} established
 * for the ADR-0069 auth-policy gate: keeping the decision in one function means
 * the seams can never drift on who is denied.
 *
 * It deliberately does NOT own identity resolution or the dynamic exemptions
 * (public-form submission, share-link tokens): those run UPSTREAM and set the
 * execution context (a `userId`, or `isSystem`) before a seam calls this, so
 * this function only ever inspects the already-resolved context.
 */

import { isAuthGateAllowlisted } from './auth-gate.js';

/** HTTP status every seam returns for an anonymous-denied request. */
export const ANONYMOUS_DENY_STATUS = 401 as const;
/** Stable machine code (mirrors the REST `enforceAuth` seam). ADR-0112: SCREAMING, a `StandardErrorCode` member. */
export const ANONYMOUS_DENY_CODE = 'UNAUTHENTICATED' as const;
/** Human-facing message. */
export const ANONYMOUS_DENY_MESSAGE = 'Authentication is required to access this endpoint.';
/** The single 401 body shape every seam returns: `{ error, message }`. */
export const ANONYMOUS_DENY_BODY = {
  error: ANONYMOUS_DENY_CODE,
  message: ANONYMOUS_DENY_MESSAGE,
} as const;

export interface AnonymousDenyInput {
  /** The `requireAuth` posture. Falsy ⇒ no-op (demo / single-tenant). */
  requireAuth: boolean | undefined;
  /** Resolved caller id, if any. */
  userId?: string | null;
  /** Internal system context (never set on inbound HTTP; cannot be forged). */
  isSystem?: boolean;
  /** HTTP method — `OPTIONS` (CORS preflight) always passes. */
  method?: string | null;
  /**
   * OPTIONAL request path. When a NON-EMPTY string, a control-plane path
   * (auth / health / ready / discovery — see {@link isAuthGateAllowlisted}) is
   * exempt. Body-routed seams (GraphQL) have no meaningful path and pass
   * `undefined`; see the guard below for why that is load-bearing.
   */
  path?: string | null;
}

/**
 * True when the request MUST be rejected with 401. The one decision every HTTP
 * seam shares.
 */
export function shouldDenyAnonymous(input: AnonymousDenyInput): boolean {
  if (!input.requireAuth) return false;                       // posture off
  if (typeof input.method === 'string' && input.method.toUpperCase() === 'OPTIONS') {
    return false;                                             // CORS preflight
  }
  if (input.userId || input.isSystem) return false;          // authenticated / system
  // Control-plane exemption — ONLY for a real, non-empty path.
  //
  // ⚠️ `isAuthGateAllowlisted(undefined)` returns `true` (it treats "no path"
  // as allow-listed for the auth-gate's purposes). A body-routed seam such as
  // GraphQL has no meaningful request path; if it passed `undefined` straight
  // through, the allowlist would exempt EVERY anonymous query and silently
  // reopen exactly the hole #2567 closes. The non-empty guard is mandatory.
  if (typeof input.path === 'string' && input.path.length > 0 && isAuthGateAllowlisted(input.path)) {
    return false;
  }
  return true;
}
