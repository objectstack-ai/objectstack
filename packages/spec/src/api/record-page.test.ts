// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  RecordPageExplainOperationSchema,
  RecordPageRelatedAnswerSchema,
  RecordPageResponseSchema,
} from './record-page.zod';

const refusal = { code: 'PERMISSION_DENIED', status: 403, message: 'No.' };

describe('[#27627] a related list answers its rows or its refusal, never both and never neither', () => {
  it('takes a count with rows, and a refusal alone', () => {
    expect(RecordPageRelatedAnswerSchema.safeParse({ object: 'note', field: 'account', total: 2, records: [{ id: 'n1' }] }).success).toBe(true);
    expect(RecordPageRelatedAnswerSchema.safeParse({ object: 'note', field: 'account', error: refusal }).success).toBe(true);
  });

  it('refuses a refusal carrying a count or rows, and an answer carrying neither', () => {
    for (const answer of [
      { object: 'note', field: 'account', total: 0, error: refusal },
      { object: 'note', field: 'account', records: [], error: refusal },
      { object: 'note', field: 'account', total: 2, records: [], error: refusal },
      { object: 'note', field: 'account' },
      { object: 'note', field: 'account', total: 2 },
    ]) {
      expect(RecordPageRelatedAnswerSchema.safeParse(answer).success, JSON.stringify(answer)).toBe(false);
    }
  });
});

describe('[#27627] the explain part carries exactly the operations the request admits', () => {
  it('has one optional key per request operation, and no other', () => {
    const explain = (RecordPageResponseSchema as any).shape.explain.unwrap();
    expect(Object.keys(explain.shape).sort()).toEqual([...RecordPageExplainOperationSchema.options].sort());
    const base = { object: 'account', id: 'a1', record: { id: 'a1' }, related: [] };
    expect(RecordPageResponseSchema.safeParse({ ...base, explain: {} }).success).toBe(true);
    for (const operation of RecordPageExplainOperationSchema.options) {
      const answer = { ...base, explain: { [operation]: { error: refusal } } };
      expect(RecordPageResponseSchema.safeParse(answer).success, operation).toBe(true);
    }
  });
});
