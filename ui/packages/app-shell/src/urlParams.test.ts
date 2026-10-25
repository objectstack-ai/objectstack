// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Record breadcrumb trail (`?from=`) codec — the drill-in path that lets a
 * child record page (account → invoice → invoice-line) render a clickable path
 * back up. The encode/decode/append helpers must be total: a malformed or
 * hostile `from` value can never throw or break the page, and the trail must
 * stay bounded so deep nesting can't grow the URL without limit.
 */

import { describe, it, expect } from 'vitest';
import {
  RECORD_TRAIL_PARAM,
  RESERVED_URL_PARAMS,
  decodeRecordTrail,
  encodeRecordTrail,
  appendRecordTrail,
  buildRecordTrailHref,
  type RecordTrailEntry,
} from './urlParams.js';

describe('record trail codec', () => {
  it('reserves the `from` param', () => {
    expect(RECORD_TRAIL_PARAM).toBe('from');
    expect(RESERVED_URL_PARAMS).toContain('from');
  });

  it('round-trips a trail through encode → decode', () => {
    const trail: RecordTrailEntry[] = [
      { o: 'showcase_account', i: 'acct1', t: 'Acme Corp' },
      { o: 'showcase_invoice', i: 'inv1', t: 'INV-001' },
    ];
    expect(decodeRecordTrail(encodeRecordTrail(trail))).toEqual(trail);
  });

  it('returns [] for missing / malformed / hostile input (never throws)', () => {
    expect(decodeRecordTrail(null)).toEqual([]);
    expect(decodeRecordTrail(undefined)).toEqual([]);
    expect(decodeRecordTrail('')).toEqual([]);
    expect(decodeRecordTrail('not json')).toEqual([]);
    expect(decodeRecordTrail('{"not":"array"}')).toEqual([]);
    // Entries missing required keys are dropped, not fatal.
    expect(decodeRecordTrail('[{"o":"x"},{"i":"y"},42,null]')).toEqual([]);
  });

  it('appends the current record and dedupes a trailing self-reference', () => {
    const first = appendRecordTrail(null, { o: 'showcase_account', i: 'acct1', t: 'Acme' });
    expect(decodeRecordTrail(first)).toEqual([{ o: 'showcase_account', i: 'acct1', t: 'Acme' }]);

    const second = appendRecordTrail(first, { o: 'showcase_invoice', i: 'inv1', t: 'INV-001' });
    expect(decodeRecordTrail(second)).toEqual([
      { o: 'showcase_account', i: 'acct1', t: 'Acme' },
      { o: 'showcase_invoice', i: 'inv1', t: 'INV-001' },
    ]);

    // Re-entering the same record must not stack a duplicate crumb.
    const dupe = appendRecordTrail(second, { o: 'showcase_invoice', i: 'inv1', t: 'INV-001' });
    expect(decodeRecordTrail(dupe)).toEqual(decodeRecordTrail(second));
  });

  it('caps trail depth so deep nesting cannot grow the URL unbounded', () => {
    let raw: string | null = null;
    for (let n = 0; n < 20; n++) {
      raw = appendRecordTrail(raw, { o: 'obj', i: `id${n}`, t: `T${n}` });
    }
    const trail = decodeRecordTrail(raw);
    expect(trail.length).toBe(8);
    // Keeps the MOST RECENT ancestors (nearest to the current record).
    expect(trail[trail.length - 1]).toEqual({ o: 'obj', i: 'id19', t: 'T19' });
  });

  it('truncates over-long titles', () => {
    const long = 'x'.repeat(200);
    const [entry] = decodeRecordTrail(appendRecordTrail(null, { o: 'obj', i: 'id', t: long }));
    expect(entry.t!.length).toBe(48);
  });

  it('builds a record href, carrying preceding ancestors into its own ?from=', () => {
    const trail: RecordTrailEntry[] = [
      { o: 'showcase_account', i: 'acct1', t: 'Acme' },
      { o: 'showcase_invoice', i: 'inv1', t: 'INV-001' },
    ];
    // Outermost ancestor: no ancestors before it → clean URL, no ?from=.
    expect(buildRecordTrailHref('/apps/demo', trail[0], [])).toBe(
      '/apps/demo/showcase_account/record/acct1',
    );
    // Second ancestor: carries the account before it.
    const href = buildRecordTrailHref('/apps/demo', trail[1], trail.slice(0, 1));
    expect(href.startsWith('/apps/demo/showcase_invoice/record/inv1?from=')).toBe(true);
    const carried = decodeRecordTrail(new URLSearchParams(href.split('?')[1]).get('from'));
    expect(carried).toEqual([trail[0]]);
  });
});
