// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13279] The LOUD failure an unreachable permission store raises.
 *
 * ## The defect this exists to end
 *
 * `resolveAuthzContext`'s per-read helper `tryFind` used to answer a THROWN
 * read the same way it answers an EMPTY one: `[]`. So a permission-store
 * outage resolved as a well-formed context for an AUTHENTICATED principal
 * holding ZERO capabilities, and the package-management door answered
 * `403 FORBIDDEN` — "Reading packages requires the `studio.access` or
 * `setup.access` capability." That answer was measured BYTE-IDENTICAL
 * (`JSON.stringify` equal, against a positive control that separates two
 * answers which differ) to the answer a caller who genuinely holds nothing
 * gets. An administrator was told they lack a capability, during an outage of
 * the store that holds the capability.
 *
 * The resolver was asserting a fact it did not have. "No rows came back"
 * and "the read failed" are different facts, and only one of them licenses
 * the sentence "this user holds nothing".
 *
 * ## Maintainer ruling, 2026-08-30, verbatim 「第一批其余同意」
 *
 * > `tryFind` 区分「无行」与「读失败」,读失败 fail-loud —— 权限库不可达时
 * > 不再解析为「已认证零能力」,而是响亮拒绝(与真实能力拒绝的 403 可区分),
 * > 让宕机不再伪装成一次逐字节相同的能力否决。
 *
 * The ruling fixes the DIRECTION and leaves the spelling to the implementation.
 *
 * ## Why a THROW, and not a field on the envelope
 *
 * The alternative was a discriminator field on `ResolvedAuthzContext` — the
 * shape `authRefusal` already has. That was rejected on a MEASUREMENT, not a
 * preference: `authRefusal` has existed since #8287 and, outside this module
 * and its own unit test, has **zero** consumers anywhere in the repo. A
 * diagnostic field on this envelope is demonstrably not read by any door. Every
 * transport reads `userId` and `systemPermissions`; a new sibling field would
 * have to be taught to eight separate call sites before it made a single door
 * louder, and would answer the old quiet 403 at every site that was missed.
 *
 * A field is quiet by default and must be deliberately made loud. A throw is
 * loud by default and must be deliberately silenced. On a security surface
 * whose whole defect is a silence, the default is the entire decision.
 *
 * It is also the idiom this platform already uses for unresolvable authority:
 * `packages/mcp`'s stdio entry throws and refuses to start rather than run with
 * an authority it could not resolve.
 *
 * ## Why `SERVICE_UNAVAILABLE` / 503, and why that is not a new wire shape
 *
 * `SERVICE_UNAVAILABLE` is an EXISTING member of the closed ADR-0112 wire
 * vocabulary (`StandardErrorCode`, `packages/spec/src/api/errors.zod.ts`), and
 * `HttpStatusErrorCodeMap` already maps it to 503 — "service exists but is
 * temporarily down". Nothing is added to the vocabulary and no envelope gains
 * or loses a key: a door that already renders `{ code, message }` renders this
 * one the same way. What changes is WHICH declared code an outage selects —
 * from the caller's `FORBIDDEN` to the operator's `SERVICE_UNAVAILABLE`.
 *
 * That is the ruling's own test, stated on the wire: 503 is not 403, so an
 * outage is no longer answerable as a capability denial.
 *
 * ## Recognise by BRAND, never by `instanceof`
 *
 * {@link isAuthzStoreUnavailableError} tests a own-property brand rather than
 * `instanceof`. This error crosses package boundaries (`@objectstack/core` →
 * rest / runtime / mcp / services / plugins) and a monorepo resolves the same
 * module through more than one path (`src` under vitest aliases, `dist` under
 * the published `exports`). Two copies of this class make `instanceof` answer
 * FALSE for a genuine instance — which, here, silently restores the exact
 * quiet 403 this module exists to remove. The brand survives duplication.
 */

/** HTTP status an unreachable authorization store answers with. */
export const AUTHZ_STORE_UNAVAILABLE_STATUS = 503 as const;

/**
 * Machine code — an EXISTING `StandardErrorCode` member (ADR-0112: SCREAMING).
 * Deliberately NOT a new code: the wire vocabulary is closed.
 */
export const AUTHZ_STORE_UNAVAILABLE_CODE = 'SERVICE_UNAVAILABLE' as const;

/**
 * Human-facing message. States the OUTAGE, and says explicitly that no
 * capability judgement was reached — so neither the caller nor the operator
 * reads it as a permission verdict.
 */
export const AUTHZ_STORE_UNAVAILABLE_MESSAGE =
  'The authorization store could not be read, so this request\'s permissions were never determined. '
  + 'This is a server-side outage, not a permission denial.';

/**
 * The own-property brand {@link isAuthzStoreUnavailableError} tests for.
 * A string-keyed own property (not a `Symbol.for` registry key) so it survives
 * `structuredClone`, and so a duplicated copy of this module still brands
 * identically.
 */
const AUTHZ_STORE_UNAVAILABLE_BRAND = '__objectstackAuthzStoreUnavailable' as const;

/**
 * Raised when a permission-store read FAILED — never when it legitimately
 * returned no rows.
 *
 * Carries the `object` whose read failed so an operator sees WHICH table was
 * unreachable, and the originating error as `cause` so the driver's own
 * diagnostic is not lost behind this one.
 */
export class AuthzStoreUnavailableError extends Error {
  /** Brand — see the module doc on why this is not `instanceof`. */
  readonly [AUTHZ_STORE_UNAVAILABLE_BRAND] = true as const;
  /** ADR-0112 wire code. */
  readonly code = AUTHZ_STORE_UNAVAILABLE_CODE;
  /** HTTP status a transport should answer. */
  readonly status = AUTHZ_STORE_UNAVAILABLE_STATUS;
  /** The object/table whose read failed (e.g. `sys_user_permission_set`). */
  readonly object: string;
  /** The driver's originating failure, kept so its diagnostic is not lost. */
  readonly cause?: unknown;

  constructor(object: string, cause?: unknown) {
    // `cause` is assigned manually — the ES2022 `ErrorOptions` constructor
    // overload is unavailable at this package's compile target (ES2020). Same
    // idiom as `packages/spec`'s `ConnectorUpstreamUnavailableError`.
    super(`${AUTHZ_STORE_UNAVAILABLE_MESSAGE} (failed read: \`${object}\`)`);
    this.name = 'AuthzStoreUnavailableError';
    this.object = object;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * True when `err` is the loud authorization-store failure above.
 *
 * The predicate every transport uses to tell "the store was unreachable" apart
 * from every other throw, so a fail-closed `catch` can re-raise THIS one
 * without loosening its handling of anything else.
 */
export function isAuthzStoreUnavailableError(err: unknown): err is AuthzStoreUnavailableError {
  return (
    typeof err === 'object'
    && err !== null
    && (err as Record<string, unknown>)[AUTHZ_STORE_UNAVAILABLE_BRAND] === true
  );
}

/**
 * The `.catch` argument every fail-closed seam between `resolveAuthzContext`
 * and a door should use in place of `() => undefined`.
 *
 * Re-raises {@link AuthzStoreUnavailableError} and swallows everything else to
 * `undefined`, so a seam keeps its existing fail-closed behaviour for every
 * fault EXCEPT the one the 2026-08-30 ruling requires to stay loud.
 *
 * ## Why the seams need this at all
 *
 * Making `tryFind` throw is necessary but NOT sufficient, and that was
 * MEASURED rather than assumed. Between the resolver and the package door sit
 * three independent nets — `computeExecCtx`'s `try { … } catch { return
 * undefined; }`, `resolvePackageRouteExecutionContext`'s `.catch(() =>
 * undefined)`, and `refusePackageRequest`'s own — and with the throw in place
 * but the nets untouched, the door answered **401**: the outage had simply
 * changed disguises, from "you hold no capability" (403) into "you are not
 * authenticated" (401), which is byte-identical to a genuine anonymous caller.
 * Distinguishable from a capability denial, yes — but still not LOUD, and now
 * wearing the costume of a different card's defect.
 *
 * A blanket `catch` cannot tell a fault from a refusal, so each net has to be
 * told once, in one shape. This is that shape.
 */
export function rethrowAuthzStoreUnavailable(err: unknown): undefined {
  if (isAuthzStoreUnavailableError(err)) throw err;
  return undefined;
}
