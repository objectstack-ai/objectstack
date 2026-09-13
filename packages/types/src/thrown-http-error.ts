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
 * [#12509] And the channel has a SCOPE, ruled 2026-08-27 (option D): on a 5xx
 * the producer did not declare, the demoted spelling came off an undeclared
 * producer and is withheld with the prose, while an author-declared code
 * survives. The discriminator is {@link serverFaultProvenance} — one function,
 * read by {@link demotedDeclaredCode}, which every door already calls, so no
 * registrar carries a variant. Read that function's note for why the status
 * channel is the only honest signal here.
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
import { declaresServerFault, looksLikeInternalErrorLeak } from './error-leak.js';
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
   *
   * ⚠️ This field records what the producer WROTE, not what a boundary may
   * emit: since #12509 a demoted spelling is withheld on an undeclared 5xx.
   * ⛔ Read {@link demotedDeclaredCode}, never this field, when deciding what
   * goes on a wire.
   */
  declaredCode?: string;
  /** The thrown message, UNSANITISED — see the module note on disclosure. */
  message: string;
  /**
   * The producer's user-facing refusal text, verbatim — present exactly when
   * the throw carried a non-empty string `userMessage` (#9934).
   *
   * This is the producer-side opt-in the objectui#5210 ruling asked for
   * (maintainer, 2026-08-19, option 1): an application hook's refusal has no
   * way to distinguish author-written user guidance from platform diagnostics,
   * so the console substitutes a generic string on 403 (the recorded #3821
   * fix) and every author-written remedy is suppressed with the diagnostics.
   * A producer that sets `userMessage` on the thrown error is saying, at throw
   * time, "this exact text is addressed to the END USER" — a consumer renders
   * it verbatim and keeps the generic substitution for everything unmarked.
   *
   * Deliberately a FIELD carrying the text, not a boolean beside `message`:
   * the mark and the marked text are one value, so a boundary that rewraps or
   * substitutes `message` (sanitisation, truncation, the sandbox debug
   * wrapper) can never accidentally promote platform prose into the marked
   * channel — the #3821 protection holds by construction. Read through
   * {@link declaredUserMessage}, never with an inline `typeof` probe.
   *
   * Status-agnostic on purpose (the ruling's second constraint): a 400, 403,
   * 409 or 503 refusal may all carry it. It never REPLACES `message` — the
   * diagnostic channel keeps its wording for logs and developers.
   */
  userMessage?: string;
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
 * | userMessage | a non-empty string `.userMessage` → absent (see {@link declaredUserMessage}) |
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

  const userMessage = declaredUserMessage(error);

  return {
    status,
    ...(declaredStatus !== undefined ? { declaredStatus } : {}),
    code,
    ...(declaredCode !== undefined ? { declaredCode } : {}),
    message: typeof e?.message === 'string' ? e.message : String(error),
    ...(userMessage !== undefined ? { userMessage } : {}),
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}

/**
 * The user-facing refusal text a thrown error DECLARED, or `undefined` when it
 * declared none (#9934). See {@link ThrownHttpError.userMessage} for what the
 * declaration means and why it is a text-carrying field rather than a flag.
 *
 * The ONE read every boundary applies — the REST classification door, the
 * dispatcher door, and the sandbox side-channel all call this rather than
 * probing `error.userMessage` themselves, so "what counts as marked" cannot
 * fork per door the way the `status`/`statusCode` spelling once did (#7525).
 *
 * A non-string or blank `userMessage` is NOT a declaration: `undefined`, a
 * number, `''` and whitespace-only all answer `undefined`, so nothing invents
 * a marked message for a producer that never wrote one — absent means the
 * consumer keeps its generic substitution (#3821 preserved by construction).
 */
export function declaredUserMessage(error: unknown): string | undefined {
  const declared = (error as { userMessage?: unknown } | null | undefined)?.userMessage;
  return typeof declared === 'string' && declared.trim().length > 0 ? declared : undefined;
}

/**
 * [#12509] WHO named this 5xx — the producer, or this resolver's fallback.
 * `undefined` for anything below 500, where nothing is sanitised at all.
 *
 * This is the ONE definition of the distinction ADR-0112's 5xx-sanitisation
 * scope turns on (maintainer ruling 2026-08-27, option D), and it exists as a
 * named function rather than as an inline conjunction because TWO rules read
 * it and they read opposite limbs:
 *
 *  - `'undeclared'` — the throw declared no HTTP answer, so
 *    {@link ThrownHttpError.status} is the caller's `fallbackStatus` and
 *    EVERYTHING this resolver picked up off that throw is the producer's
 *    internals rather than an answer it composed. A driver errno
 *    (`SQLITE_ERROR`, `42P01`) is the measured case, and it is why
 *    {@link demotedDeclaredCode} withholds the code here: the spelling names
 *    the backend, which is one of the two disclosures the 5xx message
 *    withhold exists to prevent (`looksLikeInternalErrorLeak`; the other,
 *    identifiers, is already covered).
 *  - `'declared'` — the producer named a 5xx ITSELF, so its code is authored
 *    and survives. #11718's `{ status: 503, code: 'SERVICE_UNAVAILABLE' }`
 *    relay is this limb, and so is a metadata app's own 5xx refusal spelling
 *    (#7867), which the ADR-0112 amendment wrote `declaredCode` for.
 *
 * ⚠️ The DISCRIMINATOR is the status channel, not the code's shape. There is
 * no other structural signal: a driver errno and an app's own spelling both
 * arrive on `.code` as a plain string, so anything that told them apart by
 * LOOKING at the string would be a heuristic over an open channel — the
 * consumer-side tolerance ADR-0112 exists to forbid, and unfalsifiable besides
 * (nothing stops an app from spelling `SQLITE_ERROR`). The cost of the
 * structural answer is stated rather than hidden: a producer that spells a
 * code but declares NO status loses that code on a 5xx. It keeps it by
 * declaring the status it means, which is the shape the ADR already asks for.
 *
 * ⛔ NOT gated on whether `looksLikeInternalErrorLeak` actually fired on the
 * message. That predicate is a heuristic over a DIFFERENT channel, and gating
 * here on it would leak the errno for exactly the dialects whose prose the
 * heuristic misses — the ceiling `sendThrownError`'s note records. The 5xx
 * sanitisation REGIME is the condition, not one of its two outcomes.
 *
 * ⭐ #12281 — the prose axis of the same 2026-08-27 ruling — is the
 * `'declared'` limb of this same function: the dispatcher door withholds the
 * message of EVERY declared 5xx, aligning to `/data`. It is a separate card
 * with its own measurement-first step, so nothing here applies it; this
 * function is the shape it will read rather than a second copy it would have
 * to grow.
 */
export type ServerFaultProvenance = 'declared' | 'undeclared';

/** See {@link ServerFaultProvenance}. */
export function serverFaultProvenance(thrown: ThrownHttpError): ServerFaultProvenance | undefined {
  if (thrown.status < 500) return undefined;
  return thrown.declaredStatus === undefined ? 'undeclared' : 'declared';
}

/**
 * [#16146] The prose a producer DECLARED to be a deliberate 5xx REFUSAL
 * addressed to its caller — or `undefined` for everything else, which is the
 * default and stays the default.
 *
 * ## What it is
 *
 * `ApiErrorSchema.refusal` (`@objectstack/spec`) is the producer-side
 * declaration ruled by the director seat in decision batch #58 (2026-09-06,
 * option C): refusal versus fault is a declaration on the published ADR-0112
 * envelope, NOT a status heuristic and NOT a second allow-list. A producer
 * that composes a 5xx FOR its caller sets `refusal: true` beside the `status`
 * and `code` it already declares; a fault declares nothing here and its prose
 * is withheld exactly as before. That is the third row of the table in that
 * field's own docblock; the first two rows are unchanged and the second is
 * still what an undeclared field means.
 *
 * ## Why this is ONE function and not a read at each arm
 *
 * Three arms withhold a declared 5xx's prose BECAUSE it was declared —
 * `declaredServerFaultAnswer` and `resolveErrorResponse`'s 5xx passthrough in
 * `@objectstack/rest`, and `errorResponseBase` in `@objectstack/runtime` — and
 * the 2026-08-27 ruling on #12509 that governs this family says the rule is
 * "implemented once at the shared resolver layer so all doors inherit one
 * rule; no per-registrar variants". A `refusal` read re-derived at each arm is
 * exactly the divergence {@link serverFaultProvenance} and
 * {@link demotedDeclaredCode} were extracted to end. ⛔ Do not probe
 * `error.refusal` at a door; ask here.
 *
 * ## The four conditions, and why each one is load-bearing
 *
 *  - **`refusal === true`, and only `true`.** The spec declares the key as
 *    `z.literal(true).optional()`: presence IS the declaration, so a
 *    `refusal: 'yes'` or `refusal: 1` from a producer that guessed at the
 *    shape declares nothing and is withheld like any other fault.
 *  - **A DECLARED status in the 5xx band**, read through both spellings
 *    (`status` then `statusCode`) and bounded 500-599 — the same band and the
 *    same two-spelling read `packages/rest`'s `declaredHttpStatus` applies, so
 *    a producer's answer cannot depend on which field it reached for (#7525),
 *    and a nonsense `status: 700` is not a declaration here any more than it
 *    is there. The field QUALIFIES a declared status; it never invents one, so
 *    a throw that declared no status is untouched and still goes through the
 *    undeclared-5xx heuristic (#5667).
 *  - **A non-empty string `code`**, asked through {@link declaresServerFault}
 *    rather than restated — the same "the producer declared this shape"
 *    predicate the relay already trusts to decide whether `code` travels, and
 *    the shape the spec's own table row names (`status >= 500`, a `code`, and
 *    `refusal: true`). It is why this read gives that function a SECOND live
 *    production caller rather than replacing it.
 *  - **The message does not trip {@link looksLikeInternalErrorLeak}.** The
 *    floor under the whole channel: the declaration decides whether prose is
 *    ADDRESSED to the caller, and the heuristic decides whether it is SAFE to
 *    send — a producer cannot buy its way past the driver/SQL filter by
 *    declaring a refusal. It costs nothing that exists (a refusal is authored
 *    prose, not a driver dump) and it means the answer here is fail-closed in
 *    both directions: no declaration ⇒ withheld, a declaration over leaky
 *    prose ⇒ withheld and logged by the arm exactly as a fault is.
 *
 * ⛔ It answers the MESSAGE, not a boolean, for the reason
 * {@link ThrownHttpError.userMessage} is a text-carrying field: the mark and
 * the text it releases are one value here too, so no arm can hold "this is a
 * refusal" while composing a body from some other string. What each arm then
 * applies is its OWN door's caller-addressed bound — `truncateClientMessage`
 * in `packages/rest`, none at the dispatcher exit, which is what "bounded
 * exactly as a 4xx message is" (#5423) means per door.
 */
export function declaredRefusalMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const e = error as {
    refusal?: unknown;
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
  };
  if (e.refusal !== true) return undefined;
  const declaredStatus =
    typeof e.status === 'number' ? e.status
    : typeof e.statusCode === 'number' ? e.statusCode
    : undefined;
  if (declaredStatus === undefined || declaredStatus < 500 || declaredStatus >= 600) return undefined;
  if (!declaresServerFault({ status: declaredStatus, code: e.code })) return undefined;
  const message = typeof e.message === 'string' ? e.message : '';
  if (message.trim().length === 0) return undefined;
  return looksLikeInternalErrorLeak(message) ? undefined : message;
}

/**
 * The producer's spelling a boundary should surface as the wire's
 * `declaredCode` beside the closed `code` — or `undefined` when there is
 * nothing to surface (#9106).
 *
 * Present exactly when the throw spelled a code that did NOT survive into
 * {@link ThrownHttpError.code} — i.e. the demote happened — AND the answer is
 * not an undeclared server fault. A registered code is already in `code`, so
 * emitting it again would put two spellings of one fact on every refusal; a
 * throw with no code has nothing to declare. Spelled once here rather than as
 * three `!==` comparisons at three exits, so "presence means demotion"
 * (`ApiErrorSchema.declaredCode`'s documented semantics) has one definition.
 *
 * [#12509] The withhold limb, ruled 2026-08-27 (option D): on a 5xx the
 * producer did NOT declare, the spelling this resolver demoted came off an
 * undeclared producer — a driver errno, measured on the wire at three of this
 * repo's doors — and it is withheld along with the prose. An AUTHOR-declared
 * code survives at every status. The judgement lives in
 * {@link serverFaultProvenance}; it is applied HERE, in the one read every
 * boundary already makes, so all of them inherit it without a door growing a
 * rule of its own. ⛔ Do not re-derive the condition at a door: a per-door
 * variant is the divergence this channel has now been repaired for twice.
 */
export function demotedDeclaredCode(thrown: ThrownHttpError): string | undefined {
  if (serverFaultProvenance(thrown) === 'undeclared') return undefined;
  return thrown.declaredCode !== undefined && thrown.declaredCode !== thrown.code
    ? thrown.declaredCode
    : undefined;
}
