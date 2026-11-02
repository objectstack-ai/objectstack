// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  RECORD_PAGE_MAX_ACTIVITY_ROWS,
  RECORD_PAGE_MAX_ATTACHMENT_ROWS,
  RecordPageDiscussionSchema,
  RecordPageExplainOperationSchema,
  RecordPageRelatedAnswerSchema,
  RecordPageRequestSchema,
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

describe('[#28470] the record\'s streams and the related rows\' names are named by the request, strictly', () => {
  const ok = (body: unknown) => RecordPageRequestSchema.safeParse(body).success;

  it('takes a related list\'s expand, the discussion flag and each stream\'s window', () => {
    expect(ok({
      related: [{ object: 'note', field: 'account', top: 3, expand: ['owner', 'contact'] }],
      discussion: true,
      activity: { top: RECORD_PAGE_MAX_ACTIVITY_ROWS },
      attachments: { top: RECORD_PAGE_MAX_ATTACHMENT_ROWS },
    })).toBe(true);
    expect(ok({ attachments: { top: 0 } })).toBe(true);
  });

  it('refuses a window past its cap, an empty activity window, a key a part does not declare and a non-boolean flag', () => {
    for (const body of [
      { activity: { top: RECORD_PAGE_MAX_ACTIVITY_ROWS + 1 } },
      { activity: { top: 0 } },
      { activity: {} },
      { activity: { top: 5, order: 'asc' } },
      { attachments: { top: RECORD_PAGE_MAX_ATTACHMENT_ROWS + 1 } },
      { attachments: { top: 5, filter: ['name', '=', 'x'] } },
      { discussion: 'yes' },
      { discussion: { top: 5 } },
      { related: [{ object: 'note', field: 'account', top: 3, expand: [''] }] },
      { related: [{ object: 'note', field: 'account', top: 3, expand: 'owner' }] },
      { mentions: true },
    ]) {
      expect(ok(body), JSON.stringify(body)).toBe(false);
    }
  });
});

describe('[#28470] a stream part answers its rows or its refusal, never both and never neither', () => {
  const base = { object: 'account', id: 'a1', record: { id: 'a1' }, related: [] };
  const parses = (part: Record<string, unknown>) => RecordPageResponseSchema.safeParse({ ...base, ...part }).success;

  it('takes rows with a count, and a refusal alone, for activity and attachments', () => {
    for (const key of ['activity', 'attachments']) {
      expect(parses({ [key]: { total: 1, records: [{ id: 'r1' }] } }), key).toBe(true);
      expect(parses({ [key]: { error: refusal } }), key).toBe(true);
      for (const answer of [
        { total: 0, records: [], error: refusal },
        { records: [], error: refusal },
        { total: 2 },
        { records: [] },
        {},
      ]) {
        expect(parses({ [key]: answer }), `${key} ${JSON.stringify(answer)}`).toBe(false);
      }
    }
  });

  it('takes the thread with its reactions or their refusal, and the comment read\'s refusal alone', () => {
    expect(parses({ discussion: { comments: [{ id: 'c1' }], reactions: { records: [{ id: 'x1' }] } } })).toBe(true);
    expect(parses({ discussion: { comments: [{ id: 'c1' }], reactions: { error: { ...refusal, status: 404, code: 'OBJECT_NOT_FOUND' } } } })).toBe(true);
    expect(parses({ discussion: { error: refusal } })).toBe(true);
    for (const answer of [
      { comments: [], reactions: { records: [] }, error: refusal },
      { comments: [] },
      { reactions: { records: [] } },
      { comments: [], reactions: { records: [], error: refusal } },
      { comments: [], reactions: {} },
    ]) {
      expect(RecordPageDiscussionSchema.safeParse(answer).success && parses({ discussion: answer }), JSON.stringify(answer)).toBe(false);
    }
  });
});
