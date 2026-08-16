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
 * and un-narrowed, which is what the dispatcher door has always put on the
 * wire.
 *
 * [#8087] That contract question — should the dispatcher's `error.code` be
 * closed too? — has since been ruled: **option B**, keep the verbatim spelling
 * and register the producers, delivered as a GATE rather than a one-time sweep
 * (maintainer, 2026-08-12). So `declaredCode` stays exactly as it is; what
 * changed is that the unregistered producers are now measured and classified
 * (`packages/runtime/src/dispatcher-error-vocabulary.ts`,
 * `pnpm check:dispatcher-error-vocabulary`) instead of being named in prose
 * here. Narrowing this spelling would be option A, which was NOT ruled.
 *
 * So the doors agree on **status** unconditionally and on **code** for every
 * registered code, and differ only where a producer emits a code the ledger
 * does not know — a case that is already a contract violation on either door.
 * Both answers come from ONE function, which is what keeps that difference a
 * documented one rather than a drift.
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
   * declared none. For the dispatcher door, whose `error.code` is not closed in
   * practice. See the module note on why there are two.
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
