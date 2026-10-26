// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What one HTTP error body yielded: the human sentence to show, and the machine
 * code to discriminate on. Either may be absent; the CALLER supplies its own
 * last-resort text.
 */
export interface ErrorEnvelopeReading {
  /** The server's human-readable sentence, or `undefined` when it wrote none. */
  message?: string;
  /** The server's machine code, or `undefined` when the body carries none. */
  code?: string;
}

/**
 * Read the message and the machine code out of an ObjectStack HTTP error body,
 * across every envelope dialect that is on the wire today.
 *
 * ## Why this function exists (objectui#9594)
 *
 * The same failure ladder was hand-copied at four `res.ok` sites in this module
 * -- `searchAll`, `rawFindWithPopulate`, `exportDownload` and
 * `fetchObjectSchemaFresh` -- and every copy read exactly two of the three live
 * dialects. It read the ADR-0112 nested shape (`error: { message }`) and the
 * flat-with-`message` shape, and it did NOT read the flat shape whose `error`
 * key holds the sentence as a bare STRING.
 *
 * That third dialect is the one the REST export gate writes. A denied CSV
 * export answers `403 { code: 'EXPORT_NOT_PERMITTED', error: "Export is not
 * permitted on object 'crm_lead' for this user", object: 'crm_lead' }` -- no
 * `message` key anywhere -- so all three rungs missed and the ladder fell
 * through to `res.statusText`. The operator was told the single word
 * `Forbidden` while the server was naming the object, the user and the axis.
 *
 * The blast radius is not one route: the REST package answers a wide family of
 * these `{ code, error }` bodies, and `VALIDATION_ERROR` / `PERMISSION_DENIED`
 * / `INVALID_FILTER` arriving as `Bad Request` / `Forbidden` is the same loss
 * with a much wider audience than the export button. The population is
 * producer-side, so nothing in THIS repo re-derives it; the count on
 * objectui#9594 is a historical reading taken against one published
 * `@objectstack/rest` version and is deliberately NOT copied here as if it were
 * live (AGENTS.md #9).
 *
 * ## Not a lenient fallback -- this reads a DECLARED shape (AGENTS.md #0.1)
 *
 * The flat envelope is not an off-spec producer this reader is papering over.
 * ADR-0112's 2026-07-30 amendment records the flat and the wrapped envelopes as
 * the two LIVE, sanctioned shapes, and assigns converging them to a separate
 * line of work; D5 leaves the flat shape's permanent position an open
 * maintainer question. `@objectstack/core`'s own consumer guidance beside
 * `ANONYMOUS_DENY_BODY` states the rule this function obeys: read the envelope
 * the seam you called DECLARES -- flat from `/data` and `/meta`, wrapped from a
 * dispatcher-mounted surface. Every site routed through here calls a `/data`
 * route, so the flat dialect is that seam's declared answer and reading it is
 * conformance, not tolerance. Changing the wire shape belongs to the producer's
 * ratchet card in the `objectstack` repo, not to this reader.
 *
 * ## The rung ORDER is load-bearing, not arbitrary
 *
 * `message` is consulted BEFORE the bare-string `error`, and inverting those
 * two is a silent regression rather than a style choice. The REST 401 body is
 * flat AND carries both keys: `{ error: 'UNAUTHENTICATED', code:
 * 'UNAUTHENTICATED', message: 'Authentication is required to access this
 * endpoint.' }` -- there its `error` holds the CODE word, not a sentence. Read
 * `error` first and that 401 stops rendering its sentence and starts rendering
 * the word `UNAUTHENTICATED`. The 401/403 pair in `error-envelope.test.ts` is
 * that control, and it is also the evidence that the producer is not at fault:
 * same URL, one status apart, and the only body the old ladder could not read
 * was the one carrying the actionable sentence.
 *
 * ## The code is read from `code`, NEVER from a bare `error`
 *
 * `code` falls back only to the NESTED `error.code`. It deliberately does not
 * fall back to a string-valued `error`, even though the 401 body happens to
 * spell its code there: `@objectstack/core`'s guidance names
 * `body.error?.code ?? body.error` as precisely the chain an envelope
 * regression hides inside, because it silently accepts both families for one
 * key. A sentence is not a code, and this function never promotes one into
 * that slot.
 *
 * ## Two precedence rules, on purpose
 *
 * `message` skips blank strings, reproducing the `||` chains this replaces --
 * an empty server sentence is no sentence, and the caller's fallback should
 * win. `code` skips only `null` / `undefined`, reproducing the `??` chain
 * `rawFindWithPopulate` already used, so hoisting the ladder moves no
 * behaviour on the one site that was already reading the code.
 *
 * @param body the parsed HTTP error body, or anything at all.
 * @returns the sentence and code it yielded; absent keys stay absent.
 */
export function readErrorEnvelope(body: unknown): ErrorEnvelopeReading {
  if (!body || typeof body !== 'object') return {};
  const env = body as Record<string, unknown>;
  const nested =
    env.error && typeof env.error === 'object'
      ? (env.error as Record<string, unknown>)
      : undefined;

  const reading: ErrorEnvelopeReading = {};

  const message =
    text(nested?.message) ?? text(env.message) ?? text(env.error);
  if (message !== undefined) reading.message = message;

  const code = present(env.code) ?? present(nested?.code);
  if (code !== undefined) reading.code = code;

  return reading;
}

/** A non-blank string, or `undefined` -- the `||` rung this reproduces. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** A string that is merely present, or `undefined` -- the `??` rung. */
function present(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
