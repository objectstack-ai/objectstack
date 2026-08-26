// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The CLI-side READER for the declared REST response envelope (#3843).
 *
 * `sendOk` / `sendError` in `@objectstack/types` are the ONE writer of that
 * envelope, and every REST body the platform emits is one of:
 *
 *     { success: true,  data: { … } }
 *     { success: false, error: { code, message } }
 *
 * ## Why a reader exists at all, rather than three `body.data.…` reads
 *
 * The three `os datasource` subcommands each carried their own transcription of
 * the PRE-#3843 **flat** shape — `body.tables`, `body.draft`, `body.results`,
 * and `body.error` as a string. Nothing failed loudly when the server moved to
 * the envelope: every payload simply read `undefined`. `list-tables` reported
 * `No remote tables found.` against two real tables, `introspect` reported
 * `Failed to generate draft` against a draft the server had produced, and
 * `validate` reported `No federated objects to validate.` — **exit 0** —
 * against drift the server had flagged `missing_column … severity:error`
 * (#10675). A copied shape drifts silently; a copied shape in three files
 * drifts three times, and the three commands are how a human learns the server
 * disagrees with them.
 *
 * (`datasource` is a TOPIC, not a runnable command id: the three subcommands
 * are `datasource introspect`, `datasource list-tables` and `datasource
 * validate` — verified against the built oclif `Config`, where `datasource`
 * appears among the topics and not among the commands. The prose above names
 * the topic, and naming it is correct; a sweep over the documented CLI
 * invocations in this package flags `os datasource` as unresolved, and that
 * flag is a false positive — do not rewrite the sentence around one
 * subcommand, which would say something narrower and untrue.)
 *
 * ## Why an unreadable body is an ERROR here, never an empty payload
 *
 * That is the same defect generalised. The severe half was never the crash on
 * the error path — a crash reports itself. It was a gate answering "fine"
 * about a response it had not understood, which is indistinguishable
 * downstream from a real all-clear. So this reader is total and strict: a body
 * that is not the declared envelope yields `{ ok: false }` with a message
 * naming the HTTP status, **never** `{ ok: true, data: {} }`. A caller is then
 * left with only two outcomes — the server's payload, or a loud failure — and
 * "nothing found" stays reachable exclusively from a body that really said so.
 *
 * Strictness is also Prime Directive #12. This is an internal contract with the
 * platform's own server, so the reader deliberately does **not** also accept
 * the legacy flat shape "just in case": a consumer-side fallback would
 * re-create, as a second de-facto contract, exactly the divergence this file
 * exists to close.
 */

/** A response body read through the declared envelope. */
export type EnvelopeRead<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * The only thing this reader needs from a `fetch` response — structural for the
 * same reason `EnvelopeResponse` is on the writer side: it keeps the file free
 * of any HTTP contract, and lets a test hand it a plain object.
 */
export interface EnvelopeSource {
  status: number;
  json(): Promise<unknown>;
}

function atStatus(status?: number): string {
  return typeof status === 'number' ? ` (HTTP ${status})` : '';
}

/**
 * Read an already-parsed body as the declared envelope.
 *
 * `status` is used only to make a failure message diagnosable; the verdict is
 * taken from the body, because the envelope — not the status line — is what
 * the platform declares.
 */
export function readEnvelope<T>(body: unknown, status?: number): EnvelopeRead<T> {
  if (typeof body === 'object' && body !== null) {
    const envelope = body as { success?: unknown; data?: unknown; error?: unknown };

    if (envelope.success === true && typeof envelope.data === 'object' && envelope.data !== null) {
      return { ok: true, data: envelope.data as T };
    }

    if (envelope.success === false) {
      const error = envelope.error as { code?: unknown; message?: unknown } | null | undefined;
      // `message` is a FIELD of `error`, never a sibling of it and never the
      // object itself. Handing that object to oclif's `this.error()` — which
      // takes a string or an Error — is what produced `TypeError: first
      // argument must be a string or instance of Error` instead of printing
      // the server's own text.
      if (error && typeof error.message === 'string' && error.message.length > 0) {
        return { ok: false, message: error.message };
      }
      const code = error && typeof error.code === 'string' ? ` (code ${error.code})` : '';
      return {
        ok: false,
        message: `The server refused the request${atStatus(status)} without a readable error message${code}.`,
      };
    }
  }

  return {
    ok: false,
    message: `Unexpected response from the server${atStatus(status)}: not the declared { success, data } envelope.`,
  };
}

/**
 * Read a `fetch` response as the declared envelope.
 *
 * A body that is not JSON at all lands in the same loud branch as one that is
 * JSON but not an envelope: both mean the CLI could not read what the server
 * said, and neither is an empty payload.
 */
export async function readEnvelopeFrom<T>(res: EnvelopeSource): Promise<EnvelopeRead<T>> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return readEnvelope<T>(body, res.status);
}

/**
 * Read a PRINTABLE failure message out of a response body the CLI has already
 * decided is a failure.
 *
 * ## Why this is tolerant when {@link readEnvelope} above is strict
 *
 * They do different jobs, and the strictness follows the job rather than the
 * file. `readEnvelope` decides **whether** a request succeeded and hands back
 * its payload; tolerating an off-spec body there would let a payload be read as
 * data, which is how a second de-facto contract grows (Prime Directive #12) and
 * why that reader refuses the legacy flat shape outright.
 *
 * This function decides **nothing**. The caller has already seen
 * `!response.ok`; the only remaining question is which bytes to show a human.
 * The failure is reported either way — the choice is between the server's own
 * sentence and a placeholder.
 *
 * ## What the control plane actually sends (measured, not assumed)
 *
 * The `/api/v1/cloud/**` publish routes are served by the sibling `cloud` repo,
 * which this repo's dispatcher explicitly refuses — so no in-repo ledger can
 * vouch for them (`docs/audits/2026-07-dispatcher-client-route-coverage.md`
 * §10). The measurement comes from the closest first-hand reader of that same
 * `service-cloud` family, `readApiError` in objectui's
 * `packages/app-shell/src/console/marketplace/marketplaceApi.ts`, which records
 * that those routes answer failures in TWO shapes and are mid-conversion from
 * one to the other (cloud#944):
 *
 *     { success: false, error: 'a sentence' }        today, via the cloud's `fail()`
 *     { success: false, error: { code, message } }   the declared envelope
 *
 * So BOTH arms are live. That is what rules out reusing `readEnvelope` here:
 * against the dialect the control plane still emits today it would discard a
 * real explanation and print "not the declared envelope" instead — trading one
 * unreadable failure for another.
 *
 * ## This accommodation is bounded, and it is the consumer's only option
 *
 * The flat dialect is a PRODUCER defect, tracked and being converted at the
 * producer (cloud#944) — it is not a shape this repo can fix, and not one it is
 * hiding. When that conversion lands, the `fail()` branch below is deletable on
 * its own, and nothing else here changes.
 *
 * Deliberately NOT accepted: a top-level `body.message`. objectui's reader
 * tolerates one because a few OTHER routes in that family put text there; no
 * publish route was measured doing it, and inventing a third dialect to read is
 * the accretion #12 forbids.
 *
 * ## Why it can never return `[object Object]`
 *
 * Every branch either yields a checked non-empty string or falls through. The
 * defect under repair was `String(parsed?.error)` over an `error` that is an
 * OBJECT: `??` never fell through to `statusText`, because an object is not
 * nullish, so the fallback chain was unreachable and the operator got
 * `[object Object]` instead of the reason the publish was refused.
 *
 * `statusText` is treated as absent when blank for the same reason the original
 * chain failed: HTTP/2 carries no reason phrase, so `??` would have kept an
 * empty string and printed nothing at all.
 */
export function readErrorMessage(
  body: unknown,
  res: { status: number; statusText?: string },
): string {
  return errorTextFrom(body) ?? blankToUndefined(res.statusText) ?? `HTTP ${res.status}`;
}

/** A string is usable as a message only when it is actually a non-blank string. */
function blankToUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * The server's own text, in whichever of the two measured dialects it arrived —
 * or `undefined` when the body carries none, so the caller can fall back.
 */
function errorTextFrom(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const error = (body as { error?: unknown }).error;

  if (typeof error === 'object' && error !== null) {
    // The declared envelope: `message` is a FIELD of `error`, never the object
    // itself. `code` is the last resort that keeps a refusal naming SOMETHING
    // machine-readable rather than degrading to a bare status line.
    const declared = error as { code?: unknown; message?: unknown };
    return blankToUndefined(declared.message) ?? blankToUndefined(declared.code);
  }

  // The control plane's `fail()` dialect (cloud#944): `error` IS the sentence.
  return blankToUndefined(error);
}
