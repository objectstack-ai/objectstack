// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #28005 (ruling B) — the anonymous public-form submit answer: `id`, plus the
 * engine-generated fields the form's `thank-you` panel names, and nothing else.
 */

import { describe, it, expect } from 'vitest';

import { PublicFormSubmitResponseSchema } from './protocol.zod';

describe('PublicFormSubmitResponseSchema', () => {
  it('accepts the id-only answer', () => {
    expect(PublicFormSubmitResponseSchema.safeParse({ id: 'rec_1' }).success).toBe(true);
  });

  it('accepts the id plus the named fields', () => {
    const answer = { id: 'rec_1', fields: { case_number: 'CASE-00042' } };
    const r = PublicFormSubmitResponseSchema.safeParse(answer);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(answer);
  });

  it('refuses any other top-level key — the stored record never rides along', () => {
    const r = PublicFormSubmitResponseSchema.safeParse({ id: 'rec_1', record: { subject: 'x' } });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('refuses an answer without an id, and a non-scalar field value', () => {
    expect(PublicFormSubmitResponseSchema.safeParse({ fields: { case_number: 'C-1' } }).success).toBe(false);
    expect(PublicFormSubmitResponseSchema.safeParse({ id: 'r', fields: { case_number: { v: 1 } } }).success)
      .toBe(false);
  });
});
