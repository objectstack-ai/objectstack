// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0160 D9] The record citation shape: closed, `quote` required and
 * non-empty, `context` admitted (third amendment), and the list capped.
 *
 * The refusal legs assert the issue zod answers (`unrecognized_keys`,
 * `too_small`, `invalid_type`, `too_big`) and its path, not a bare failure: a
 * shape that degraded to a loose object would still fail on `null`.
 */

import { describe, expect, it } from 'vitest';
import {
  RECORD_CITATIONS_MAX,
  RECORD_CITATIONS_PART_TYPE,
  RecordCitationSchema,
  RecordCitationsSchema,
} from './index';

const CITATION = { object: 'policy', id: 'p1', quote: 'Covers fire.' };

/** The first issue's code and path, or `undefined` when the parse succeeds. */
function firstIssue(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[]; keys?: string[] }> } } }, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) return undefined;
  const [issue] = result.error!.issues;
  return { code: issue.code, path: issue.path, keys: issue.keys };
}

describe('[ADR-0160 D9] RecordCitationSchema', () => {
  it('admits object, id and quote, with context and anchor optional', () => {
    expect(RecordCitationSchema.safeParse(CITATION).success).toBe(true);
    const full = { ...CITATION, context: 'crm-policy_document', anchor: 'exclusions' };
    const parsed = RecordCitationSchema.safeParse(full);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(full);
  });

  it('refuses an unknown key, never drops it', () => {
    expect(firstIssue(RecordCitationSchema, { ...CITATION, field: 'title' })).toMatchObject({
      code: 'unrecognized_keys',
      keys: ['field'],
    });
  });

  it('refuses an empty quote, and a missing one', () => {
    expect(firstIssue(RecordCitationSchema, { ...CITATION, quote: '' })).toMatchObject({ code: 'too_small', path: ['quote'] });
    const { quote: _quote, ...noQuote } = CITATION;
    expect(firstIssue(RecordCitationSchema, noQuote)).toMatchObject({ code: 'invalid_type', path: ['quote'] });
  });

  it('refuses null, and an empty context or anchor', () => {
    expect(firstIssue(RecordCitationSchema, null)).toMatchObject({ code: 'invalid_type', path: [] });
    expect(firstIssue(RecordCitationSchema, { ...CITATION, context: '' })).toMatchObject({ code: 'too_small', path: ['context'] });
    expect(firstIssue(RecordCitationSchema, { ...CITATION, anchor: '' })).toMatchObject({ code: 'too_small', path: ['anchor'] });
  });
});

describe('[ADR-0160 D9] RecordCitationsSchema and the data part', () => {
  it('caps the list at RECORD_CITATIONS_MAX', () => {
    expect(RECORD_CITATIONS_MAX).toBe(20);
    expect(RecordCitationsSchema.safeParse(Array.from({ length: RECORD_CITATIONS_MAX }, () => CITATION)).success).toBe(true);
    expect(firstIssue(RecordCitationsSchema, Array.from({ length: RECORD_CITATIONS_MAX + 1 }, () => CITATION))).toMatchObject({
      code: 'too_big',
      path: [],
    });
  });

  it('names the UI-message data part the verified list rides', () => {
    expect(RECORD_CITATIONS_PART_TYPE).toBe('data-record-citations');
  });
});
