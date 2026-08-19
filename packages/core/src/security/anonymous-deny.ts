// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #2567 — the single anonymous-deny decision, shared by every HTTP seam.
 *
 * ADR-0056 D2 made the platform deny anonymous callers by default. Phase 1 gated
 * each surface (REST `/data`, dispatcher `/graphql` + `/meta`, raw-hono `/data`)
 * but every seam hand-rolled the same `!userId && !isSystem → 401` check. This
 * centralises that DECISION into one pure, tested function — the exact pattern
 * {@link ./auth-gate.ts} established for the ADR-0069 auth-policy gate: keeping
 * the decision in one function means the seams can never drift on who is denied.
 *
 * ## The `requireAuth` opt-out is gone (#3963)
 *
 * This used to take a `requireAuth` posture and no-op when it was falsy, so a
 * deployment could open its ENTIRE data plane with one config key. That key is
 * retired: auth is a kernel concern, and every surface that legitimately serves
 * a caller with no session derives its own narrow authorization from a
 * DECLARATION instead of from the deployment posture —
 *
 *  - control plane (`/auth/*`, `/health`, `/ready`, `/discovery`, the ADR-0069
 *    remediation paths) → the {@link isAuthGateAllowlisted} allowlist, below;
 *  - public form submission → `publicFormGrant` (ADR-0056 Option A), derived
 *    from the form view's own declaration;
 *  - share links → the capability token, validated then read as SYSTEM;
 *  - a `book.audience: 'public'` read → the ADR-0046 §6.7 audience gate (#3963);
 *  - MCP → an OAuth token or API key, never anonymous.
 *
 * Those run UPSTREAM of this function and set the execution context (a `userId`,
 * or `isSystem`) or bypass the seam entirely, so this only ever inspects the
 * already-resolved context. Nothing else gets in.
 */

import { isAuthGateAllowlisted } from './auth-gate.js';

/** HTTP status every seam returns for an anonymous-denied request. */
export const ANONYMOUS_DENY_STATUS = 401 as const;
/** Stable machine code (mirrors the REST `enforceAuth` seam). ADR-0112: SCREAMING, a `StandardErrorCode` member. */
export const ANONYMOUS_DENY_CODE = 'UNAUTHENTICATED' as const;
/** Human-facing message. */
export const ANONYMOUS_DENY_MESSAGE = 'Authentication is required to access this endpoint.';
/**
 * The **REST seam's** 401 body — flat `{ error, code, message }`. NOT the
 * platform's only one; see the two-envelope table below before you reuse this
 * shape.
 *
 * Two consumers write it verbatim, both flat-family seams: `@objectstack/rest`'s
 * `enforceAuth` (`rest-server.ts` —
 * `res.status(ANONYMOUS_DENY_STATUS).json(ANONYMOUS_DENY_BODY)`), which owns the
 * `/data/*` and `/meta` surfaces, and `@objectstack/runtime`'s
 * `mountRouteOnServer` (`dispatcher-plugin.ts` — the endpoint-route 401 arm,
 * #9823), which answers declared routes mounted on the HTTP server.
 *
 * ## Two live envelopes, one denial (#5632)
 *
 * Every HTTP seam shares the DECISION ({@link shouldDenyAnonymous}) and the
 * semantics ({@link ANONYMOUS_DENY_STATUS} / {@link ANONYMOUS_DENY_CODE} /
 * {@link ANONYMOUS_DENY_MESSAGE}). What differs is the **wrapper**:
 *
 *  - **REST seam** — `@objectstack/rest` `enforceAuth`, this constant, verbatim:
 *    `{ error: 'UNAUTHENTICATED', code: 'UNAUTHENTICATED', message: '…' }`.
 *    The machine code lives in the top-level `code` key — the same documented
 *    key every other REST error family answers (#9487, maintainer-ruled
 *    ADDITIVE: `error` keeps carrying the code value it always has, so no
 *    existing reader breaks). There is no `success` key and no nesting.
 *  - **Dispatcher seams** — the five runtime domains `domains/ai.ts`,
 *    `domains/meta.ts`, `domains/security.ts`, `domains/actions.ts` and
 *    `domains/automation.ts` do NOT use this constant. Each calls
 *    `deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE })`,
 *    so the wire body is the dispatcher's standard wrapper:
 *    `{ success: false, error: { code, message, httpStatus } }`.
 *
 * Both shapes are **live and sanctioned** — ADR-0112's 2026-07-30 amendment
 * (#4007) records the flat and wrapped envelopes as the two live ones, and
 * assigns retiring one of them to the envelope-convergence line (#3843 family).
 * Converging them is a breaking wire change; it is not this module's to make,
 * and this constant must not be read as if it had already happened. The #9487
 * `code` key does NOT settle that question either way (ADR-0112 D5 stays
 * open): it aligns the flat family to the `{ error, code }` shape the other
 * flat REST error families already answer, without moving or removing a key.
 *
 * ## Reading this from a consumer (human or AI author)
 *
 * Read the envelope the seam you called DECLARES — flat from `/data` + `/meta`,
 * wrapped from a dispatcher-mounted surface. Do **not** write a tolerant
 * `body.error?.code ?? body.error` chain that swallows both: that fallback is
 * precisely where an envelope regression hides, and this docstring claiming to
 * be "the single shape every seam returns" is what used to invite it (#5632).
 *
 * Both shapes are pinned against a real booted showcase by
 * `packages/qa/dogfood/test/showcase-anonymous-deny-surfaces.dogfood.test.ts`,
 * which classifies every anonymous 401 into exactly one of the two families and
 * fails on a third dialect or on a seam that changes family.
 */
export const ANONYMOUS_DENY_BODY = {
  error: ANONYMOUS_DENY_CODE,
  code: ANONYMOUS_DENY_CODE,
  message: ANONYMOUS_DENY_MESSAGE,
} as const;

export interface AnonymousDenyInput {
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
