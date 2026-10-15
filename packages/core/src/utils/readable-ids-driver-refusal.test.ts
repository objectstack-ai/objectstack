// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D3] The shared walk, rewrite and refusal every driver uses for a
 * `ReadableIds` leaf. The drivers' own conformance suites
 * (`READABLE_IDS_CASES`) measure what each compiles; this pins the three
 * pieces they all stand on: which leaf the walk finds, that the rewrite never
 * edits the caller's tree, and the envelope.
 */

import { describe, it, expect, vi } from 'vitest';
import { ReadableIds, filterSubtreeProvenanceOf, markFilterSubtreeProvenance } from '@objectstack/spec/data';
import {
  findMisplacedReadableIds,
  readableIdsDriverRefusal,
  refuseReadableIdsOnce,
  replaceComposedReadableIds,
} from './readable-ids-driver-refusal.js';

const composed = () => ReadableIds.compose(ReadableIds.of('p'), { owner: 'u1' });

describe('findMisplacedReadableIds', () => {
  it('admits a composed $in comparand on a compiling driver, at any depth', () => {
    expect(findMisplacedReadableIds({ $or: [{ a: 1 }, { $not: { r: { $in: composed() } } }] }, true)).toBeNull();
  });

  it('finds an uncomposed leaf at any position, on any driver', () => {
    expect(findMisplacedReadableIds({ $and: [{ r: { $in: ReadableIds.of('p') } }] }, true)).toEqual({
      at: 'where.$and[0].r.$in',
      object: 'p',
      kind: 'uncomposed',
    });
  });

  it('finds a composed leaf outside a $in comparand', () => {
    expect(findMisplacedReadableIds({ r: { $nin: composed() } }, true)?.kind).toBe('misplaced');
    expect(findMisplacedReadableIds({ r: composed() }, true)?.kind).toBe('misplaced');
  });

  it('finds every composed leaf on a refusing driver', () => {
    expect(findMisplacedReadableIds({ r: { $in: composed() } }, false)?.kind).toBe('unsupported');
  });

  it('answers null for a tree with no leaf, cycles included', () => {
    const node: Record<string, unknown> = { a: { $in: [1, 2] } };
    node.self = { $and: [node] };
    expect(findMisplacedReadableIds(node, true)).toBeNull();
  });
});

describe('replaceComposedReadableIds', () => {
  it('rewrites copy-on-write, carrying the provenance mark of the node it replaces', () => {
    const leaf = composed();
    const branch = markFilterSubtreeProvenance({ r: { $in: leaf } }, 'author');
    const untouched = { b: 2 };
    const where = { $and: [branch, untouched] };
    const out = replaceComposedReadableIds(where, () => ['p1']) as any;
    expect(out).toEqual({ $and: [{ r: { $in: ['p1'] } }, { b: 2 }] });
    expect(where.$and[0]).toBe(branch);
    expect((branch as any).r.$in).toBe(leaf);
    expect(out.$and[1]).toBe(untouched);
    expect(filterSubtreeProvenanceOf(out.$and[0])).toBe('author');
  });

  it('returns a tree with no leaf by reference', () => {
    const where = { a: { $in: [1] } };
    expect(replaceComposedReadableIds(where, () => [])).toBe(where);
  });
});

describe('the refusal', () => {
  it('is INTERNAL_ERROR / 500, never INVALID_FILTER, and names the driver and the leaf', () => {
    const err = readableIdsDriverRefusal('driver-x', { at: 'where.r.$in', object: 'p', kind: 'uncomposed' });
    expect(err).toMatchObject({ code: 'INTERNAL_ERROR', status: 500, httpStatus: 500 });
    expect(err.message).toMatch(/^\[driver-x\] where\.r\.\$in holds a ReadableIds leaf/);
  });

  it('is logged at error once per state, and returned every time', () => {
    const log = { error: vi.fn(), warn: vi.fn() };
    const state = { logged: false };
    const site = { at: 'where.r.$in', object: 'p', kind: 'unsupported' } as const;
    const a = refuseReadableIdsOnce('driver-x', site, log, state);
    const b = refuseReadableIdsOnce('driver-x', site, log, state);
    expect([a.code, b.code]).toEqual(['INTERNAL_ERROR', 'INTERNAL_ERROR']);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
