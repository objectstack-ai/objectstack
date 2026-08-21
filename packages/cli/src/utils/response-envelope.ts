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
