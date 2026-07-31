// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `envelopeViolations` — the conformance check `BaseResponseSchema` cannot express.
 *
 * The schema does not declare `data`, and a plain `z.object` strips unknown keys
 * rather than rejecting them. So `safeParse` catches a missing `success` flag —
 * the drift #3675 / #3689 / #3843 were about — and nothing else.
 *
 * That gap was not theoretical. The `/share-links` dispatcher domain shipped
 * `{ success: true, data: link, link }` for as long as nobody looked, and
 * `safeParse` passed it the whole time (#4038, removed in #4049). Each conformance
 * suite had hand-written its own version of the missing assertions, which works
 * only for as long as whoever writes the next suite remembers to.
 *
 * The pairing below is the point of this file: every case asserts BOTH what the
 * schema says and what the predicate says, so the two never silently converge and
 * the reader can see exactly which check is load-bearing for which drift.
 */

import { describe, expect, it } from 'vitest';
import { BaseResponseSchema, envelopeViolations } from './contract.zod';

const parses = (b: unknown) => BaseResponseSchema.safeParse(b).success;
const conformant = (b: unknown) => envelopeViolations(b).length === 0;

describe('envelopeViolations — conformant bodies', () => {
  it('accepts a success body', () => {
    expect(envelopeViolations({ success: true, data: { id: 'a' } })).toEqual([]);
  });

  it('accepts `data` that is falsy, empty, or null — those are payloads', () => {
    // Only `undefined` means "no payload". A route legitimately answering an
    // empty list or a null record must not be called a violation.
    for (const data of [[], {}, null, 0, '', false]) {
      expect(envelopeViolations({ success: true, data }), JSON.stringify(data)).toEqual([]);
    }
  });

  it('accepts a failure body with the nested error', () => {
    expect(envelopeViolations({ success: false, error: { code: 'NOT_FOUND', message: 'gone' } })).toEqual([]);
  });

  it('accepts `meta` beside the payload — the dispatcher helper emits it', () => {
    expect(envelopeViolations({ success: true, data: 1, meta: { timestamp: 't' } })).toEqual([]);
    // `deps.success` builds `{ success, data, meta }` with meta possibly undefined.
    expect(envelopeViolations({ success: true, data: 1, meta: undefined })).toEqual([]);
  });
});

describe('envelopeViolations — what the schema already catches', () => {
  it('a missing success flag: both reject', () => {
    // The pre-#3983 bare body. This is the one drift `safeParse` does catch,
    // because `success` is required and it is the flag `unwrapResponse` keys on.
    const body = { links: [] };
    expect(parses(body)).toBe(false);
    expect(conformant(body)).toBe(false);
  });

  it('a bare-string error: both reject', () => {
    // The pre-#3675 dialect, where `body.error.message` read `undefined`.
    const body = { error: 'boom' };
    expect(parses(body)).toBe(false);
    expect(conformant(body)).toBe(false);
  });
});

describe('envelopeViolations — what the schema MISSES', () => {
  // Each of these parses clean. That is why the suites cannot lead with
  // `safeParse` and call it a contract check.

  it('a success body with no data at all', () => {
    const body = { success: true };
    expect(parses(body)).toBe(true);            // ← schema is satisfied
    expect(conformant(body)).toBe(false);
    expect(envelopeViolations(body)).toContain('success body carries no `data`');
  });

  it('the duplicate-payload drift #4049 removed', () => {
    // `{ success: true, data: link, link }` — the payload under BOTH the
    // envelope's `data` and a legacy top-level key, so two dialects stay alive
    // at once and no consumer has to choose.
    const body = { success: true, data: { id: 'l1' }, link: { id: 'l1' } };
    expect(parses(body)).toBe(true);            // ← schema is satisfied
    expect(envelopeViolations(body)).toEqual([
      'stray top-level key `link` — the payload belongs under `data`',
    ]);
  });

  it('a payload left at the top level beside the flag', () => {
    // The shim `GET /ai/agents` would have grown had it kept `agents` alive
    // beside `data` through the conversion. It did not — both producers moved
    // the payload rather than mirroring it (#4053) — and this is the check that
    // would have said so. See `ai-agents-envelope.test.ts` for that route's own
    // pins, including the half this predicate deliberately does not cover.
    const body = { success: true, data: [], agents: [] };
    expect(parses(body)).toBe(true);
    expect(conformant(body)).toBe(false);
  });

  it('a failure body with no error', () => {
    const body = { success: false };
    expect(parses(body)).toBe(true);
    expect(envelopeViolations(body)).toContain("failure body's `error` is missing, must be an object");
  });

  it('a failure body whose error lacks code or message', () => {
    expect(envelopeViolations({ success: false, error: {} })).toEqual([
      'error.code is missing or not a string',
      'error.message is missing or not a string',
    ]);
  });

  it('a success body that also carries an error', () => {
    expect(envelopeViolations({ success: true, data: 1, error: { code: 'X', message: 'y' } }))
      .toContain('success body carries an `error`');
  });
});

describe('envelopeViolations — non-objects', () => {
  it('names what it got, rather than throwing', () => {
    for (const body of [null, undefined, 42, 'str', true]) {
      const v = envelopeViolations(body);
      expect(v.length, String(body)).toBe(1);
      expect(v[0]).toMatch(/not an envelope object/);
    }
    expect(envelopeViolations([1, 2])[0]).toMatch(/is an array/);
  });
});

describe('envelopeViolations — reports every violation, not just the first', () => {
  it('a body can be wrong in several ways at once', () => {
    // A reader fixing one reason should see the rest in the same run rather than
    // rediscovering them one CI round at a time.
    const v = envelopeViolations({ success: true, link: 1, links: 2 });
    expect(v).toEqual([
      'success body carries no `data`',
      'stray top-level key `link` — the payload belongs under `data`',
      'stray top-level key `links` — the payload belongs under `data`',
    ]);
  });
});
