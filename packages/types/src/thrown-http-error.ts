// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE rule for "what HTTP answer does a THROWN error declare?" (#8016).
 *
 * A service or protocol throw that carries its own `.status` / `.statusCode`
 * and its own semantic `.code` is a *refusal*, not a fault: the caller asked
 * for something the platform will not do, and the honest answer is that status
 * with that code. A throw carrying neither is a fault, and the honest answer is
 * the caller's fallback — 500 `INTERNAL_ERROR` at an HTTP boundary.
 *
 * ## Why this is shared rather than restated per door
 *
 * `/api/v1/packages` has **two** HTTP doors. The runtime dispatcher's
 * `HttpDispatcher.errorFromThrown` read `.status` first and answered `409
 * DESTRUCTIVE_CHANGE` for a `metadata-protocol` refusal. The direct-mount REST
 * registrar (`packages/rest/src/package-routes.ts`) had four catch-alls that
 * answered `500 INTERNAL_ERROR` regardless — and *that* registrar mounts first
 * in the production stack, so 500 was what production actually returned. One
 * throw, two answers, and the wrong one was the live one (#8016).
 *
 * The rule therefore lives in ONE function that both doors call. It could not
 * live in `packages/runtime`: `@objectstack/runtime` depends on
 * `@objectstack/rest`, so the arrow only points one way and `errorFromThrown`
 * is unreachable from the REST door by construction. `@objectstack/types`
 * depends on nothing but `@objectstack/spec`, which is exactly why the other
 * shared HTTP-boundary helpers already live here — `looksLikeInternalErrorLeak`
 * ("do not ship driver internals to clients") and `sendOk`/`sendError` ("write
 * the declared envelope"). "What status does this throw mean?" is the same kind
 * of property: it belongs to the boundary, not to one router.
 *
 * ## Two spellings of the code, because the two envelopes are not equally closed
 *
 * {@link ThrownHttpError.code} is narrowed to `StandardErrorCode ∪
 * ERROR_CODE_LEDGER` — the union `ApiErrorSchema` validates against — so a
 * throw whose `.code` is not a registered member does not get to name itself;
 * it falls to the code the status derives. That is the same rule
 * `metadata-protocol`'s `toRowApiError` applies to a per-row batch error, and
 * it is what lets `sendError`'s closed `ErrorCode` parameter be satisfied
 * without a cast. The direct-mount REST door needs exactly this: its bodies are
 * parsed against `BaseResponseSchema` by its own conformance suite, so an
 * unregistered code there is a failing test, not a wire answer.
 *
 * {@link ThrownHttpError.declaredCode} is the producer's own string, verbatim
 * and un-narrowed. Until #9106 it was what the dispatcher door put in
 * `error.code`; since the #9106 ruling it is what BOTH doors surface as the
 * wire's `declaredCode` when it is not a vocabulary member (see below).
 *
 * [#8087] The first ruling on that gap (maintainer, 2026-08-12) kept the
 * dispatcher's verbatim spelling and delivered a GATE — the unregistered
 * producers are measured and classified
 * (`packages/runtime/src/dispatcher-error-vocabulary.ts`,
 * `pnpm check:dispatcher-error-vocabulary`) instead of named in prose here.
 * The gate's own first derivation then measured the limb no registration can
 * close: a metadata app's action code crosses the sandbox boundary carrying
 * the app's OWN `.code` (#7867), authored by tenants at runtime.
 *
 * [#9106] That limb was ruled (maintainer, 2026-08-16): **`error.code` is a
 * closed vocabulary at every door.** The dispatcher door now takes
 * {@link ThrownHttpError.code} — the demote this resolver has always computed,
 * and the REST door's spelling since #8016 — and a producer's unregistered
 * string rides the wire's `declaredCode` (declared on `ApiErrorSchema`)
 * instead of `error.code`. #7867's capability is preserved: the author's code
 * still crosses the sandbox and still reaches the wire — in the open,
 * author-authored channel, not the closed one. Use
 * {@link demotedDeclaredCode} to read the spelling a boundary should surface
 * beside the closed `code`.
 *
 * So the doors agree on **status** and on **code** unconditionally now — both
 * answers come from ONE function, which is what keeps agreement a construction
 * rather than two suites agreeing about literals.
 *
 * ## What this deliberately does NOT decide
 *
 *  - **Message disclosure.** A 5xx message may name physical tables or carry a
 *    driver dump; withholding it is `looksLikeInternalErrorLeak`'s job, applied
 *    by the caller (the dispatcher does; see #3867). This function returns the
 *    thrown message verbatim.
 *  - **Whether a declared status is *plausible*.** No 400-599 band is imposed,
 *    because the dispatcher never imposed one and this function exists to make
 *    the two doors agree. Narrowing the accepted band is a change to the rule,
 *    and it belongs here — in one place, for both doors — if it is ever made.
 */

import { ErrorCode, standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from './validation-failure.js';

/** The HTTP answer a thrown error declares. See {@link resolveThrownHttpError}. */
export interface ThrownHttpError {
  /** The producer's own `status`/`statusCode`, or the caller's fallback. */
  status: number;
  /**
   * The status the THROW ITSELF declared — `.status`, `.statusCode`, or the
   * 400 a validation-shaped throw declares by shape — and **absent** when it
   * declared none, i.e. when {@link ThrownHttpError.status} above is the
   * caller's `fallbackStatus`.
   *
   * ## Why `status` cannot answer this
   *
   * A producer that declares `500` and one that declares nothing both resolve
   * to `status: 500`, so a caller that must tell "the producer said so" from
   * "I supplied the default" cannot read it off the value. The workaround in
   * the repo was to probe this function with a fallback no producer declares
   * — `resolveThrownHttpError(e, 0).status !== 0`. That is a magic number
   * standing in for a fact this function already computed, and it fails
   * silently the day a producer declares the sentinel. So the fact is stated;
   * `packages/rest`'s publish-classification suite now reads
   * `resolveThrownHttpError(error).declaredStatus !== undefined` instead of
   * hand-spelling the workaround.
   *
   * ## Who needs the distinction
   *
   * A sink that mirrors the status onto RESPONSE DATA instead of into the
   * response's own status line — where the fallback would not be a default but
   * an invention. `metadata-protocol`'s `toRowApiError` is the measured one
   * (#8570): a batch row rides a **200**, so stamping `status` there would put
   * `httpStatus: 500` on every undeclared driver fault, an ADDITION to the
   * wire, where stamping `declaredStatus` restores only what a producer really
   * declared. Boundaries that answer with the status itself keep reading
   * `status` — the fallback is exactly what they want.
   */
  declaredStatus?: number;
  /**
   * A member of the declared ADR-0112 vocabulary — for a boundary whose
   * envelope is checked against it. Never the HTTP status.
   */
  code: ErrorCode;
  /**
   * The producer's own code, verbatim and un-narrowed, or `undefined` when it
   * declared none. Never for `error.code` — that slot takes {@link code} at
   * every door (#9106) — but for the wire's `declaredCode` channel when the
   * spelling is not a vocabulary member ({@link demotedDeclaredCode}). See the
   * module note on why there are two.
   */
  declaredCode?: string;
  /** The thrown message, UNSANITISED — see the module note on disclosure. */
  message: string;
  /**
   * Structured context: spec-validation `issues[]`, record-validation
   * `fields[]`. Absent rather than `{}` when the throw carried none, so an
   * empty object never reads as "there is context here".
   */
  details?: Record<string, unknown>;
}

/**
 * Resolve a thrown error into the status, code, message and structured context
 * an HTTP boundary should answer with.
 *
 * Precedence, in order:
 *
 * | Question | Answer |
 * |---|---|
 * | status | `.status` → `.statusCode` → 400 if it is a validation failure → `fallbackStatus` |
 * | declaredStatus | the same chain WITHOUT the fallback — absent when the throw declared none |
 * | code | `VALIDATION_FAILED` if it is one → a REGISTERED `.code` → derived from the status |
 * | declaredCode | `VALIDATION_FAILED` if it is one → any non-empty string `.code` → absent |
 * | message | `.message` when it is a string → `String(error)` |
 *
 * Both status spellings are read because both are produced in this repo:
 * `plugin-approvals`' lifecycle hooks and `metadata-protocol` throw
 * `statusCode`, `metadata-protocol`'s conflicts throw `status`. Reading one
 * spelling is how `/api/v1/data` answered 500 for a deliberate `409
 * RECORD_LOCKED` until #7525.
 */
export function resolveThrownHttpError(error: unknown, fallbackStatus = 500): ThrownHttpError {
  const e = error as any;
  const validation = validationFailureDetails(e);

  // The validation SHAPE is a declaration too: `ValidationError` carries no
  // status because deciding it means 400 is the boundary's job, but the
  // producer did say "this is a client's input problem" — which is the fact
  // `declaredStatus` reports. Only the `fallbackStatus` limb below is the
  // caller's own invention, and it is the only one left out.
  const declaredStatus =
    typeof e?.status === 'number' ? e.status
    : typeof e?.statusCode === 'number' ? e.statusCode
    : validation ? VALIDATION_FAILED_STATUS
    : undefined;
  const status = declaredStatus ?? fallbackStatus;

  const spelled = typeof e?.code === 'string' && e.code !== '' ? e.code : undefined;
  // A `.code` the ledger does not know cannot go in a slot typed as the closed
  // vocabulary — see the module note on why there are two spellings.
  const registered = spelled !== undefined && ErrorCode.safeParse(spelled).success
    ? (spelled as ErrorCode)
    : undefined;
  const code: ErrorCode = validation
    ? validation.code
    : (registered ?? standardErrorCodeForHttpStatus(status));
  const declaredCode = validation ? validation.code : spelled;

  const issues = Array.isArray(e?.issues) ? e.issues : undefined;
  const details: Record<string, unknown> = {
    // A truthy NON-string `code` (a driver errno, say) is context and stays
    // context — promoting it would put a number in the field callers branch on,
    // which is the drift #3842 removed.
    ...(!validation && e?.code && typeof e.code !== 'string' ? { code: e.code } : {}),
    ...(issues ? { issues } : {}),
    ...(validation ? { fields: validation.fields } : {}),
  };

  return {
    status,
    ...(declaredStatus !== undefined ? { declaredStatus } : {}),
    code,
    ...(declaredCode !== undefined ? { declaredCode } : {}),
    message: typeof e?.message === 'string' ? e.message : String(error),
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}

/**
 * The producer's spelling a boundary should surface as the wire's
 * `declaredCode` beside the closed `code` — or `undefined` when there is
 * nothing to surface (#9106).
 *
 * Present exactly when the throw spelled a code that did NOT survive into
 * {@link ThrownHttpError.code} — i.e. the demote happened. A registered code
 * is already in `code`, so emitting it again would put two spellings of one
 * fact on every refusal; a throw with no code has nothing to declare. Spelled
 * once here rather than as three `!==` comparisons at three exits, so
 * "presence means demotion" (`ApiErrorSchema.declaredCode`'s documented
 * semantics) has one definition.
 */
export function demotedDeclaredCode(thrown: ThrownHttpError): string | undefined {
  return thrown.declaredCode !== undefined && thrown.declaredCode !== thrown.code
    ? thrown.declaredCode
    : undefined;
}
