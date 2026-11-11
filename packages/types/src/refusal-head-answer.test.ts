// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32279] The thrown-error half of the head/hint split: a 4xx refusal that
 * carries a one-line head (the filter-comparand face's `INVALID_FILTER`)
 * answers the head as `error` and its prescription as `details.hint`, on every
 * exit that renders a thrown error's sentence (`mapDataError`, and through the
 * same wrapper `@objectstack/rest`'s declared-status passthrough). And the
 * `fields[]` half the runtime dispatcher's doors read through
 * `fieldsFromZodIssues`.
 */

import { describe, it, expect } from 'vitest';
import { FindDataRequestSchema } from '@objectstack/spec/api';
import { assertListComparandShapes, QUERY_CURSOR_REMOVED } from '@objectstack/spec/data';
import { mapDataError, withDeclaredUserMessage } from './data-error-classification.js';
import { fieldsFromZodIssues } from './validation-failure.js';

function faceRefusal(node: unknown): any {
  try {
    assertListComparandShapes(node, "find('deal')");
  } catch (error) {
    return error;
  }
  throw new Error('the face accepted the node');
}

describe('[#32279] a thrown refusal with a head', () => {
  it('mapDataError answers the head as `error` and the prescription as `details.hint`; status and code unchanged', () => {
    const err = faceRefusal({ title: { $in: 'x' } });
    const answer = mapDataError(err, 'deal');
    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe('INVALID_FILTER');
    expect(answer.body.error).toBe(err.refusalHead);
    expect(answer.body.error).toBe(
      `find('deal'): Operator "$in" on field "title" requires an array of values: wrap a single value in a list, or use "=" ($eq).`,
    );
    expect((answer.body.details as { hint: string }).hint).toBe(err.message);
  });

  it('the declared-status passthrough\'s wrapper does the same, and keeps a `details` member another arm set', () => {
    const err = faceRefusal({ title: { $in: 'x' } });
    const answer = withDeclaredUserMessage(err, {
      status: 400,
      body: { error: err.message, code: 'INVALID_FILTER', details: { candidates: ['a'] } },
    });
    expect(answer.body.error).toBe(err.refusalHead);
    expect(answer.body.details).toEqual({ candidates: ['a'], hint: err.message });
  });

  it('CONTROL — a refusal without a head answers exactly as before', () => {
    const err = Object.assign(new Error('Plain refusal sentence.'), { code: 'INVALID_FILTER', status: 400 });
    const answer = mapDataError(err, 'deal');
    expect(answer.body.error).toBe('Plain refusal sentence.');
    expect(answer.body).not.toHaveProperty('details');
  });

  it('CONTROL — a 5xx carrying a head is left to its own rules (no head, no hint)', () => {
    const err = Object.assign(new Error('boom'), { refusalHead: 'a head', status: 503, code: 'SERVICE_UNAVAILABLE' });
    const mapped = { status: 503, body: { error: 'Internal server error', code: 'SERVICE_UNAVAILABLE' } };
    expect(withDeclaredUserMessage(err, mapped)).toEqual(mapped);
  });
});

describe('[#32279] fieldsFromZodIssues carries the hint', () => {
  it('a retired query key: `message` is the head, `hint` the prescription', () => {
    const input = { object: 'deal', query: { object: 'deal', cursor: { id: 1 } } };
    const parsed = FindDataRequestSchema.safeParse(input);
    const [entry] = fieldsFromZodIssues(parsed.error!.issues as never, input);
    expect(entry.field).toBe('query.cursor');
    expect(entry.message.length).toBeLessThanOrEqual(160);
    expect(entry.message).toContain('`query.cursor`');
    expect(entry.hint).toBe(QUERY_CURSOR_REMOVED);
  });
});
