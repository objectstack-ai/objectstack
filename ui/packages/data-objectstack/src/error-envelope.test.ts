// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins the ONE error-envelope reader (objectui#9594).
 *
 * ## What this file is defending
 *
 * `readErrorEnvelope` replaced four hand-copied failure ladders in
 * `ObjectStackAdapter` -- in `searchAll`, `rawFindWithPopulate`,
 * `exportDownload` and `fetchObjectSchemaFresh`. Every copy read the ADR-0112
 * nested shape and the flat-with-`message` shape, and none of them read the
 * flat shape that spells its sentence in a bare STRING `error`. That third
 * dialect is what the REST export gate answers, so a 403 naming the exact
 * grant to add rendered as the single word `Forbidden`.
 *
 * ## The 401/403 pair is the load-bearing case, and it is a CONTROL
 *
 * Both bodies below are flat, both come from the same URL one status apart, and
 * they disagree about what the `error` key holds:
 *
 *  - 403 -- `{ code, error: <sentence>, object }`, no `message` key at all.
 *  - 401 -- `{ error: 'UNAUTHENTICATED', code: 'UNAUTHENTICATED', message }`,
 *    where `error` holds the CODE WORD and the sentence is in `message`.
 *
 * So the 403 case fails against the old ladder and passes here, while the 401
 * case passes BOTH -- that is what makes it a control rather than a second
 * copy of the same assertion. It proves the producer is not at fault (the same
 * ladder, the same seam, renders one of the two fine) and it pins the rung
 * ORDER: consult `message` before a string `error`, or this 401 stops saying
 * its sentence and starts saying the word `UNAUTHENTICATED`. Inverting those
 * two rungs in the reader turns the 401 assertions red and leaves every 403
 * assertion green, which is exactly the regression the order exists to stop.
 *
 * ## A sentence is never promoted into the `code` slot
 *
 * `code` reads the top-level `code`, then the NESTED `error.code`, and stops.
 * It does not fall back to a string-valued `error` even though the 401 body
 * happens to spell its code there -- `@objectstack/core`'s guidance beside
 * `ANONYMOUS_DENY_BODY` names that exact chain as where an envelope regression
 * hides. The 403 body is the case that would break if it did: its `error` is a
 * sentence, and a sentence is not a code.
 */

import { describe, it, expect } from 'vitest';
import { readErrorEnvelope } from './error-envelope';

/** The REST export gate's 403 -- flat, sentence in `error`, NO `message`. */
const EXPORT_DENIED_403 = {
  code: 'EXPORT_NOT_PERMITTED',
  error: "Export is not permitted on object 'crm_lead' for this user",
  object: 'crm_lead',
};

/** The REST auth seam's 401 -- flat, code word in `error`, sentence in `message`. */
const UNAUTHENTICATED_401 = {
  error: 'UNAUTHENTICATED',
  code: 'UNAUTHENTICATED',
  message: 'Authentication is required to access this endpoint.',
};

/** The ADR-0112 nested/wrapped envelope. */
const NESTED_404 = {
  success: false,
  error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' },
};

describe('readErrorEnvelope -- the three live envelope dialects', () => {
  it('reads the flat dialect whose sentence is a bare string `error`', () => {
    // The defect this card exists for: every rung of the old ladder missed.
    expect(readErrorEnvelope(EXPORT_DENIED_403)).toEqual({
      message: "Export is not permitted on object 'crm_lead' for this user",
      code: 'EXPORT_NOT_PERMITTED',
    });
  });

  it('reads the ADR-0112 nested envelope, message and code', () => {
    expect(readErrorEnvelope(NESTED_404)).toEqual({
      message: 'Not found',
      code: 'ENDPOINT_NOT_FOUND',
    });
  });

  it('reads the flat-with-`message` dialect', () => {
    expect(readErrorEnvelope(UNAUTHENTICATED_401)).toEqual({
      message: 'Authentication is required to access this endpoint.',
      code: 'UNAUTHENTICATED',
    });
  });
});

describe('readErrorEnvelope -- the 401/403 control pair (same seam, one status apart)', () => {
  it('403: yields the actionable sentence, not a status word', () => {
    const { message, code } = readErrorEnvelope(EXPORT_DENIED_403);
    expect(message).toBe(
      "Export is not permitted on object 'crm_lead' for this user",
    );
    expect(code).toBe('EXPORT_NOT_PERMITTED');
  });

  it('401 CONTROL: `message` wins over the code word in `error`', () => {
    // Red if the string-`error` rung is ever moved above `message`.
    const { message, code } = readErrorEnvelope(UNAUTHENTICATED_401);
    expect(message).toBe('Authentication is required to access this endpoint.');
    expect(message).not.toBe('UNAUTHENTICATED');
    expect(code).toBe('UNAUTHENTICATED');
  });

  it('never promotes a sentence into the `code` slot', () => {
    // The 403's `error` is a sentence; `code` must come from `code`/`error.code`.
    expect(readErrorEnvelope({ error: 'a bare sentence, no code anywhere' })).toEqual({
      message: 'a bare sentence, no code anywhere',
    });
  });
});

describe('readErrorEnvelope -- precedence and absence', () => {
  it('prefers the nested message over a flat one when both exist', () => {
    const r = readErrorEnvelope({
      error: { message: 'nested wins' },
      message: 'flat loses',
    });
    expect(r.message).toBe('nested wins');
  });

  it('prefers the top-level code over the nested one', () => {
    const r = readErrorEnvelope({ code: 'TOP', error: { code: 'NESTED' } });
    expect(r.code).toBe('TOP');
  });

  it('falls back to the nested code when there is no top-level one', () => {
    expect(readErrorEnvelope({ error: { code: 'NESTED' } }).code).toBe('NESTED');
  });

  it('treats a blank message as absent so the caller fallback wins', () => {
    // Reproduces the `||` rung the four ladders used.
    expect(readErrorEnvelope({ message: '   ' }).message).toBeUndefined();
    expect(readErrorEnvelope({ error: '' }).message).toBeUndefined();
    expect(readErrorEnvelope({ error: { message: '' } }).message).toBeUndefined();
  });

  it('reports absence rather than inventing text', () => {
    expect(readErrorEnvelope({})).toEqual({});
    expect(readErrorEnvelope(null)).toEqual({});
    expect(readErrorEnvelope(undefined)).toEqual({});
    expect(readErrorEnvelope('a bare string body')).toEqual({});
    expect(readErrorEnvelope(42)).toEqual({});
  });

  it('ignores non-string code and message values instead of coercing them', () => {
    expect(readErrorEnvelope({ code: 500, message: 12 })).toEqual({});
    expect(readErrorEnvelope({ error: { code: 7, message: [] } })).toEqual({});
  });
});
