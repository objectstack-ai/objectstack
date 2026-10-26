// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `hidden: true` reader behind the Approvals drawer trim (objectui#5565).
 *
 * Pins the two things the render test cannot see on its own: that BOTH served
 * `fields` shapes are read, and that every not-an-answer resolves to the empty
 * set rather than to a guess — the fail-open direction the drawer depends on.
 *
 * ⛔ Nothing here reads `internal`. Per the maintainer's ruling on
 * objectstack#10749 (`hidden: true` stays UI-only; `internal: true` is the
 * serialization primitive) those are distinct primitives, and a test that
 * accepted either would license conflating them in the code.
 */

import { describe, it, expect, vi } from 'vitest';
import { hiddenFieldNames, readHiddenFields, planHiddenFieldReads } from './hiddenFields';

describe('hiddenFieldNames — both served `fields` shapes', () => {
  it('reads the record shape (`{ name: def }`)', () => {
    const hidden = hiddenFieldNames({
      fields: {
        subject: { type: 'text' },
        diagnosis_code: { type: 'text', hidden: true },
        internal_scratch: { type: 'text', internal: true },
      },
    });
    expect([...hidden]).toEqual(['diagnosis_code']);
    // `internal` is a different primitive and is NOT this filter's business.
    expect(hidden.has('internal_scratch')).toBe(false);
  });

  it('reads the array shape (`[{ name, ...def }]`)', () => {
    const hidden = hiddenFieldNames({
      fields: [
        { name: 'subject', type: 'text' },
        { name: 'diagnosis_code', type: 'text', hidden: true },
        { name: '', type: 'text', hidden: true },
      ],
    });
    expect([...hidden]).toEqual(['diagnosis_code']);
  });

  it('is strict about `=== true` — a truthy non-true value is not a declaration', () => {
    const hidden = hiddenFieldNames({
      fields: {
        a: { hidden: 'false' },
        b: { hidden: 1 },
        c: { hidden: true },
      },
    });
    expect([...hidden]).toEqual(['c']);
  });

  it('yields the empty set for every unreadable schema shape', () => {
    for (const schema of [null, undefined, {}, { fields: null }, { fields: 'nope' }, 42]) {
      expect(hiddenFieldNames(schema).size).toBe(0);
    }
  });
});

describe('readHiddenFields — every not-an-answer is the empty set', () => {
  it('resolves empty when the source cannot describe objects at all', async () => {
    expect((await readHiddenFields({}, 'showcase_purchase')).size).toBe(0);
    expect((await readHiddenFields(null, 'showcase_purchase')).size).toBe(0);
  });

  it('resolves empty — never rejects — when the read throws', async () => {
    const getObjectSchema = vi.fn(async () => { throw new Error('403'); });
    await expect(readHiddenFields({ getObjectSchema }, 'showcase_purchase'))
      .resolves.toEqual(new Set());
    expect(getObjectSchema).toHaveBeenCalledWith('showcase_purchase');
  });

  it('returns the declared names when the read answers', async () => {
    const getObjectSchema = vi.fn(async () => ({ fields: { x: { hidden: true } } }));
    expect([...(await readHiddenFields({ getObjectSchema }, 'o'))]).toEqual(['x']);
  });
});

describe('planHiddenFieldReads — the cost model for a queue of N rows', () => {
  it('is one read per distinct object, not one per row', () => {
    // A page of six rows spanning two objects costs two metadata reads
    // (objectui#6020). The returned length IS the call count, so the cost is
    // asserted rather than described.
    const rows = ['showcase_purchase', 'showcase_invoice', 'showcase_purchase',
      'showcase_invoice', 'showcase_purchase', 'showcase_invoice'];
    expect(planHiddenFieldReads(rows)).toEqual(['showcase_purchase', 'showcase_invoice']);
  });

  it('keeps first-seen order — stable output for stable input', () => {
    expect(planHiddenFieldReads(['b', 'a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
  });

  it('drops what is not an object name, rather than reading it', () => {
    // A row mid-load, or one the server sent without an object, is not an
    // object to ask about — and `''` would be a request for `/meta/object/`.
    expect(planHiddenFieldReads([null, undefined, '', 'showcase_purchase']))
      .toEqual(['showcase_purchase']);
  });
});
