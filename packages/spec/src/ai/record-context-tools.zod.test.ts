// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0160 D3, D4] The `get_record_context` input admits `outlineFrom`, the
 * page of a long body's outline to list, and the body answers `outlineNext`,
 * where the next page starts.
 *
 * The refusal legs assert the issue zod answers (`too_small`, `invalid_type`)
 * and its path, not a bare failure: a shape that degraded to a loose object
 * would still fail on `null`.
 */

import { describe, expect, it } from 'vitest';
import {
  GET_RECORD_CONTEXT_TOOL_NAME,
  GetRecordContextInputSchema,
  RecordContextBodySchema,
  getRecordContextToolJsonSchemas,
} from './index';

const CALL = { objectName: 'policy', recordId: 'p1' };

/** The first issue's code and path, or `undefined` when the parse succeeds. */
function firstIssue(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[] }> } } }, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) return undefined;
  const [issue] = result.error!.issues;
  return { code: issue.code, path: issue.path };
}

describe('[ADR-0160 D3] get_record_context — outlineFrom', () => {
  it('admits a whole number of at least 0', () => {
    for (const outlineFrom of [0, 1, 80, 240]) {
      expect(GetRecordContextInputSchema.safeParse({ ...CALL, outlineFrom }).success).toBe(true);
    }
  });

  it('refuses a negative number, a fraction and a string, at `outlineFrom`', () => {
    expect(firstIssue(GetRecordContextInputSchema, { ...CALL, outlineFrom: -1 })).toEqual({ code: 'too_small', path: ['outlineFrom'] });
    expect(firstIssue(GetRecordContextInputSchema, { ...CALL, outlineFrom: 1.5 })).toEqual({ code: 'invalid_type', path: ['outlineFrom'] });
    expect(firstIssue(GetRecordContextInputSchema, { ...CALL, outlineFrom: '80' })).toEqual({ code: 'invalid_type', path: ['outlineFrom'] });
  });

  it('is in the tool\'s JSON Schema parameters as an integer of at least 0', () => {
    const { parameters } = getRecordContextToolJsonSchemas()[GET_RECORD_CONTEXT_TOOL_NAME];
    expect((parameters as { properties: Record<string, unknown> }).properties.outlineFrom).toMatchObject({ type: 'integer', minimum: 0 });
  });
});

describe('[ADR-0160 D3] get_record_context — the body\'s outlineNext', () => {
  const BODY = { field: 'content', label: 'Content', outline: [{ anchor: 'scope', heading: 'Scope', level: 1 }] };

  it('admits a whole number of at least 1, and its absence', () => {
    expect(RecordContextBodySchema.safeParse({ ...BODY, outlineNext: 80 }).success).toBe(true);
    expect(RecordContextBodySchema.safeParse(BODY).success).toBe(true);
  });

  it('refuses 0 and a fraction, at `outlineNext`', () => {
    expect(firstIssue(RecordContextBodySchema, { ...BODY, outlineNext: 0 })).toEqual({ code: 'too_small', path: ['outlineNext'] });
    expect(firstIssue(RecordContextBodySchema, { ...BODY, outlineNext: 2.5 })).toEqual({ code: 'invalid_type', path: ['outlineNext'] });
  });
});
