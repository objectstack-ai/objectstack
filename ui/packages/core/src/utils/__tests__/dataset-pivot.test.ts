// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { pivotBucketId, pivotCellKey, pivotDimensionValue } from '../dataset-pivot.js';

/**
 * The encoders' whole job is that DIFFERENT dimension-value tuples never spell
 * the SAME id. Every historical defect in this family was one pair of tuples
 * that did (objectstack#5473 a space join, objectstack#5665 an empty join,
 * objectui#4056 a null placeholder), so the tests are written as pairs that
 * used to collide — not as literal id spellings, which is what let the old
 * encodings read as correct.
 */
describe('pivotDimensionValue', () => {
  it('maps an absent value to null and everything else to its string form', () => {
    expect(pivotDimensionValue(null)).toBeNull();
    expect(pivotDimensionValue(undefined)).toBeNull();
    expect(pivotDimensionValue('North')).toBe('North');
    expect(pivotDimensionValue(0)).toBe('0');
    expect(pivotDimensionValue(false)).toBe('false');
    // The empty string is a VALUE a dimension can hold, not an absent value —
    // `?? ` never coerced it and neither does this.
    expect(pivotDimensionValue('')).toBe('');
  });

  it('does not map any string to null — including the placeholder it replaced', () => {
    // objectui#4056: the old spelling was `String(v ?? '∅')`, which mapped an
    // absent value ONTO a string, so this character had two meanings.
    expect(pivotDimensionValue('∅')).toBe('∅');
    expect(pivotDimensionValue('null')).toBe('null');
  });
});

describe('pivotBucketId', () => {
  it('keeps an absent value apart from every string spelling of it (objectui#4056)', () => {
    expect(pivotBucketId([null])).not.toBe(pivotBucketId(['∅']));
    expect(pivotBucketId([null])).not.toBe(pivotBucketId(['null']));
    expect(pivotBucketId([null])).not.toBe(pivotBucketId(['']));
    // …and the pair as the callers actually build it, raw value in.
    expect(pivotBucketId([pivotDimensionValue(null)])).not.toBe(
      pivotBucketId([pivotDimensionValue('∅')]),
    );
  });

  it('keeps tuples apart that concatenate to the same string', () => {
    expect(pivotBucketId(['x', 'yz'])).not.toBe(pivotBucketId(['xy', 'z']));
    expect(pivotBucketId(['New', 'York Q1'])).not.toBe(pivotBucketId(['New York', 'Q1']));
  });

  it('distinguishes an absent value by POSITION, not just by presence', () => {
    expect(pivotBucketId([null, 'a'])).not.toBe(pivotBucketId(['a', null]));
    expect(pivotBucketId([null, 'a'])).not.toBe(pivotBucketId([null, null, 'a']));
  });

  it('is deterministic, and unchanged for all-string tuples', () => {
    expect(pivotBucketId(['North', 'Q1'])).toBe(pivotBucketId(['North', 'Q1']));
    // Regrouping stability: data with no absent values encodes exactly as it did
    // before objectui#4056, so existing buckets do not re-key.
    expect(pivotBucketId(['North', 'Q1'])).toBe(JSON.stringify(['North', 'Q1']));
  });
});

describe('pivotCellKey', () => {
  it('keeps cell keys apart whose row/column ids meet at a different point', () => {
    expect(pivotCellKey('a', 'bc')).not.toBe(pivotCellKey('ab', 'c'));
  });

  it('keys a null bucket and a placeholder bucket to different cells', () => {
    const col = pivotBucketId(['Q1']);
    expect(pivotCellKey(pivotBucketId([null]), col)).not.toBe(
      pivotCellKey(pivotBucketId(['∅']), col),
    );
  });
});
