// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { FieldErrorCode } from '@objectstack/spec/api';
import { zodIssuesToFields } from './rest-server';

/**
 * Zod issue → field-level catalog (ADR-0114 D3).
 *
 * Every case here drives a REAL `safeParse` rather than hand-writing an issue
 * object. That is the point of the file: the mapping reads `origin` and `format`,
 * which are Zod's internals, so a test built on an ASSUMED issue shape would keep
 * passing after a Zod upgrade quietly changed one — the wire would fall back to
 * `invalid_value` for everything while every assertion stayed green.
 *
 * Writing it that way is also how the `input` handling got found: the first draft
 * of the mapping read `issue.input` to tell a missing property from a wrong-typed
 * one, and a real parse showed v4 issues do not carry it — so that branch could
 * never have fired.
 */
describe('zodIssuesToFields', () => {
  /**
   * Parse `value` against `schema` and return the mapped field entries, passing
   * the parsed input the way the routes do — required-vs-wrong-type needs it,
   * because a Zod v4 issue does not carry the offending value.
   */
  const fieldsFor = (schema: z.ZodType, value: unknown) => {
    const r = schema.safeParse(value);
    expect(r.success, 'the fixture must actually fail to parse').toBe(false);
    return zodIssuesToFields((r as { error: { issues: unknown[] } }).error.issues, value);
  };

  /** The same, without the input — the conservative path. */
  const fieldsForBlind = (schema: z.ZodType, value: unknown) => {
    const r = schema.safeParse(value);
    return zodIssuesToFields((r as { error: { issues: unknown[] } }).error.issues);
  };

  it('disambiguates too_small by what was too small', () => {
    // The ambiguity #3977 flagged as having no clean answer: one Zod code, three
    // meanings. `origin` carries the answer.
    expect(fieldsFor(z.object({ a: z.string().min(3) }), { a: 'x' })[0].code).toBe('min_length');
    expect(fieldsFor(z.object({ a: z.number().min(5) }), { a: 1 })[0].code).toBe('min_value');
    expect(fieldsFor(z.object({ a: z.array(z.string()).min(2) }), { a: ['one'] })[0].code).toBe('min_items');
  });

  it('disambiguates too_big the same way', () => {
    expect(fieldsFor(z.object({ a: z.string().max(2) }), { a: 'toolong' })[0].code).toBe('max_length');
    expect(fieldsFor(z.object({ a: z.number().max(1) }), { a: 9 })[0].code).toBe('max_value');
    expect(fieldsFor(z.object({ a: z.array(z.string()).max(1) }), { a: ['a', 'b'] })[0].code).toBe('max_items');
  });

  it('maps a missing property to required, not to a type error', () => {
    // The user-visible bug, not a tidy-up: Zod reports an absent required
    // property as `invalid_type` (expected string, received undefined). Passed
    // through, a form marked a MISSING input as the wrong TYPE.
    expect(fieldsFor(z.object({ a: z.string() }), {})[0].code).toBe('required');
  });

  it('still reports a genuine type mismatch as invalid_type', () => {
    expect(fieldsFor(z.object({ a: z.string() }), { a: 42 })[0].code).toBe('invalid_type');
  });

  it('keeps invalid_type when the input is not supplied, rather than guessing', () => {
    // Missing and wrong-type are INDISTINGUISHABLE on the issue alone — v4 gives
    // both the same `code`, the same `expected`, and no value. The only other
    // signal is the message text ("received undefined"), and depending on Zod's
    // phrasing for a wire contract is the leak this mapping removes. So a caller
    // that cannot supply the input gets the accurate-but-less-specific code.
    expect(fieldsForBlind(z.object({ a: z.string() }), {})[0].code).toBe('invalid_type');
    expect(fieldsForBlind(z.object({ a: z.string() }), { a: 42 })[0].code).toBe('invalid_type');
  });

  it('maps declared formats to their own members', () => {
    expect(fieldsFor(z.object({ a: z.string().email() }), { a: 'no' })[0].code).toBe('invalid_email');
    expect(fieldsFor(z.object({ a: z.string().url() }), { a: 'no' })[0].code).toBe('invalid_url');
    // A pattern with no dedicated member falls back to the generic format code.
    expect(fieldsFor(z.object({ a: z.string().regex(/^\d+$/) }), { a: 'abc' })[0].code).toBe('invalid_format');
  });

  it('maps a closed set to invalid_option', () => {
    expect(fieldsFor(z.object({ a: z.enum(['x', 'y']) }), { a: 'z' })[0].code).toBe('invalid_option');
  });

  it('maps an unexpected key to unknown_field', () => {
    expect(fieldsFor(z.object({ a: z.string() }).strict(), { a: 'ok', extra: 1 })[0].code).toBe('unknown_field');
  });

  it('never emits a code outside the catalog, whatever Zod produced', () => {
    // The invariant that matters most: an unmapped Zod code must land on a member
    // rather than leak. Exercised across a deliberately varied schema so a Zod
    // upgrade that introduces a NEW issue code fails here rather than on the wire.
    const schema = z.object({
      s: z.string().min(2).max(4),
      n: z.number().int().positive().multipleOf(3),
      e: z.enum(['a', 'b']),
      arr: z.array(z.number()).min(1),
      nested: z.object({ deep: z.string().email() }),
      u: z.union([z.string(), z.number()]),
      d: z.string().refine(() => false, 'always fails'),
    }).strict();
    const fields = fieldsFor(schema, {
      s: 'toolongvalue', n: -2.5, e: 'nope', arr: [], nested: { deep: 'bad' },
      u: { neither: true }, d: 'x', surprise: 1,
    });
    expect(fields.length).toBeGreaterThan(5);
    for (const f of fields) {
      expect(() => FieldErrorCode.parse(f.code), `'${f.code}' is not a catalog member`).not.toThrow();
    }
  });

  it('keeps the dotted path and the server message', () => {
    const [entry] = fieldsFor(z.object({ nested: z.object({ deep: z.string() }) }), { nested: { deep: 1 } });
    expect(entry.field).toBe('nested.deep');
    // `message` is what a UI shows verbatim, so the mapping must not touch it.
    expect(entry.message).toBeTruthy();
    expect(entry.message).not.toBe(entry.code);
  });

  it('tolerates a non-array argument', () => {
    for (const junk of [null, undefined, {}, 'issues', 0]) {
      expect(zodIssuesToFields(junk)).toEqual([]);
    }
  });
});
