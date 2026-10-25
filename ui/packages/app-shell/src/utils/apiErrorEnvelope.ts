// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ONE read of the platform's ADR-0112 failure envelope — the prose a person
 * should be shown when a request was refused.
 *
 * ## The rule this implements, and whose rule it is
 *
 * The envelope writer (`sendError`, `@objectstack/types` `response-envelope.ts`)
 * nests the refusal under `error`:
 *
 *     res.status(status).json({ success: false, error: { code, message, ...extra } });
 *
 * and `extra` is where the producer's declared channels ride. Two of the fields
 * under `error` are prose, and they are NOT two spellings of one thing:
 *
 *  - `message` — the DIAGNOSTIC. Always present, written for whoever is
 *    debugging. In the 5xx band the door substitutes the generic
 *    `Internal server error` into it (see below), so it is the text that can be
 *    withheld.
 *  - `userMessage` — the text a producer marked, AT THROW TIME, as addressed to
 *    the END USER (objectstack `79c46da90`). Its presence IS the marking, and the envelope
 *    writer's own words are the rule this module implements: "a consumer that
 *    sees the field renders it verbatim and keeps its generic substitution
 *    ([objectstack-ai/objectstack#3821]) for everything unmarked". The bracketed
 *    card name is the one substituted word: the writer's bare number names it only
 *    inside objectstack. It is the sharing-rule dialog card, and its objectui fix
 *    (objectui#2920) is where a refused write's raw server text first became
 *    localized copy, the generic substitution itself.
 *
 * So the mark OUTRANKS the diagnostic. That order is the contract's, not a
 * preference — a reader that ignores `userMessage` is not degrading gracefully,
 * it is discarding the one sentence a producer deliberately wrote for the
 * person now reading the screen.
 *
 * ## Measured, not assumed: both doors that serve these routes emit the field
 *
 * `GET /api/v1/packages` and its lifecycle siblings are served by two doors,
 * and each spreads the marked channel onto the wire beside `details` /
 * `declaredCode`:
 *
 *  - `sendThrownError` (`@objectstack/rest` `package-routes.ts`):
 *    `...(thrown.userMessage !== undefined ? { userMessage: thrown.userMessage } : {})`
 *  - `errorFromThrown` (`@objectstack/runtime` `http-dispatcher.ts`), which that
 *    same door's note calls "byte for byte the dispatcher twin's expression …
 *    which serves this same path and has emitted the channel since
 *    [objectstack `79c46da90`]".
 *
 * The framework pins the pair wire-side in `package-door-user-message.test.ts`.
 *
 * ## Why the 5xx band is where the loss became visible
 *
 * The producing door withholds the producer's PROSE above:
 *
 *     const message = thrown.status >= 500 && looksLikeInternalErrorLeak(thrown.message)
 *       ? INTERNAL_ERROR_MESSAGE
 *       : thrown.message;
 *
 * The withhold rewrites a LOCAL `message` const, and `looksLikeInternalErrorLeak`
 * is only ever handed `thrown.message` — so `userMessage` is never an input to
 * it and rides through a sanitised 500 untouched. A reader that only knew about
 * `message` therefore showed the author the GENERIC sentence on exactly the
 * bodies that were carrying a specific one. Nothing invalid was displayed,
 * which is what made the loss quiet.
 *
 * ⛔ NOT scoped to 5xx, deliberately. The producing door applies no status
 * condition to this channel — "a marked text is the producer's deliberate
 * statement to the caller at any status" — so a consumer that honoured the mark
 * in one band only would re-create, on the READING end, precisely the
 * divergence that door refused to create on the WRITING end.
 *
 * ⛔ Not a tolerant alias ladder either. These are two DECLARED fields with
 * different meanings. An unmarked refusal carries no `userMessage` at all (the
 * producer's `declaredUserMessage` already applied its non-empty-string rule),
 * so the overwhelmingly common case falls straight through to `message` with
 * byte-identical output.
 *
 * ## Why this returns `null` instead of a fallback
 *
 * The three readers that share this rule do NOT share a fallback: the
 * `packages-io` readers say `HTTP <status>` and `PackagesPage`'s `apiJson` says
 * `Request failed (<status>)`, and `apiJson` additionally keeps two legacy rungs
 * (a bare-string `error`, a top-level `message`) for the shapes older runtimes
 * send. Folding a fallback in here would have forced a `fallback` parameter and
 * a `legacyRungs` flag — three different things pressed into one signature,
 * which is harder to read than the copies it replaces. So the shared part is
 * exactly the part that IS shared: envelope in, the person's prose out, or
 * `null` when this body carried no prose at all. Each caller keeps its own
 * fallback, on its own line, where a reader can see it.
 *
 * @param payload The parsed response body, or `null` when it could not be
 *   parsed. Typed `unknown` because every caller obtains it differently
 *   (`res.json().catch(() => null)`, `res.text()` + `JSON.parse`) and none of
 *   them can promise a shape.
 * @returns The prose to show, with `error.code` appended in parentheses when
 *   the envelope declared one; `null` when the body carried no prose, in which
 *   case the caller states its own fallback. A code NEVER rescues a
 *   prose-less body: a machine code alone is not a sentence to show a person.
 */
export function readEnvelopeFailureText(payload: unknown): string | null {
  const error = (payload as { error?: unknown } | null | undefined)?.error;
  // A bare-string `error` (an older runtime's shape) is not this envelope. It
  // is left to the caller that still knows about it — see the note above.
  if (!error || typeof error !== 'object') return null;
  const { code, message, userMessage } = error as {
    code?: unknown;
    message?: unknown;
    userMessage?: unknown;
  };
  // A typed `string` check, not a truthiness one, and it is load-bearing twice:
  // a non-string mark is not a mark (it is a producer bug, and falling through
  // to the diagnostic is the honest answer), and an empty-string mark is not
  // one either — `declaredUserMessage` already applies that rule producer-side,
  // and this reader does not depend on the producer having applied it.
  const marked = typeof userMessage === 'string' ? userMessage : '';
  const diagnostic = typeof message === 'string' ? message : '';
  const prose = marked || diagnostic;
  if (!prose) return null;
  const declaredCode = typeof code === 'string' ? code : '';
  return declaredCode ? `${prose} (${declaredCode})` : prose;
}
