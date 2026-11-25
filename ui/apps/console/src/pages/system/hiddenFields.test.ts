// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The declaration readers behind the Approvals Inbox queue figure: `hidden:
 * true` and the object's `highlightFields` (ADR-0085).
 *
 * Pins what the render test cannot see on its own: that BOTH served `fields`
 * shapes are read, which `highlightFields` entry is the figure, and that every
 * not-an-answer resolves to no figure rather than to a guess.
 *
 * ⛔ Nothing here reads `internal`. Per the maintainer's ruling on
 * objectstack#10749 (`hidden: true` stays UI-only; `internal: true` is the
 * serialization primitive) those are distinct primitives, and a test that
 * accepted either would license conflating them in the code.
 */

import { describe, it, expect, vi } from 'vitest';
import { hiddenFieldNames, inboxFigureField, readInboxFigureField, planHiddenFieldReads } from './hiddenFields';

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

describe('inboxFigureField — the first numeric `highlightFields` entry, or none', () => {
  it('takes the first numeric entry in `highlightFields` order, not declaration order', () => {
    // `overdue_amount` is declared first and its name looks like money; the
    // author's curated list names `total_score`, so that is the figure.
    expect(inboxFigureField({
      highlightFields: ['name', 'total_score', 'overdue_amount'],
      fields: {
        overdue_amount: { type: 'currency' },
        name: { type: 'text' },
        total_score: { type: 'number' },
      },
    })).toBe('total_score');
  });

  it('reads the array `fields` shape too', () => {
    expect(inboxFigureField({
      highlightFields: ['subject', 'budget'],
      fields: [{ name: 'subject', type: 'text' }, { name: 'budget', type: 'currency' }],
    })).toBe('budget');
  });

  it('accepts every numeric type, and a formula only when it computes a number', () => {
    for (const def of [
      { type: 'number' }, { type: 'currency' }, { type: 'percent' }, { type: 'summary' },
      { type: 'formula', returnType: 'number' }, { type: 'formula', returnType: 'currency' },
      { type: 'formula', returnType: 'percent' },
    ]) {
      expect(inboxFigureField({ highlightFields: ['x'], fields: { x: def } })).toBe('x');
    }
    for (const def of [
      { type: 'text' }, { type: 'date' }, { type: 'boolean' }, { type: 'formula' },
      { type: 'formula', returnType: 'text' }, { type: 'formula', returnType: 'date' }, {},
    ]) {
      expect(inboxFigureField({ highlightFields: ['x'], fields: { x: def } })).toBeNull();
    }
  });

  it('skips an entry the author declared `hidden: true`, and one the schema does not define', () => {
    expect(inboxFigureField({
      highlightFields: ['ghost', 'secret_total', 'fee'],
      fields: {
        secret_total: { type: 'currency', hidden: true },
        fee: { type: 'currency' },
      },
    })).toBe('fee');
  });

  it('is none when nothing numeric is declared — never a guess from field names', () => {
    const fields = { total_amount: { type: 'currency' }, subject: { type: 'text' } };
    expect(inboxFigureField({ fields })).toBeNull();
    expect(inboxFigureField({ highlightFields: [], fields })).toBeNull();
    expect(inboxFigureField({ highlightFields: ['subject'], fields })).toBeNull();
    for (const schema of [null, undefined, {}, 42, { highlightFields: 'total_amount', fields }]) {
      expect(inboxFigureField(schema)).toBeNull();
    }
  });
});

describe('readInboxFigureField — every not-an-answer is no figure', () => {
  it('resolves null when the source cannot describe objects at all', async () => {
    expect(await readInboxFigureField({}, 'showcase_purchase')).toBeNull();
    expect(await readInboxFigureField(null, 'showcase_purchase')).toBeNull();
  });

  it('resolves null — never rejects — when the read throws', async () => {
    const getObjectSchema = vi.fn(async () => { throw new Error('403'); });
    await expect(readInboxFigureField({ getObjectSchema }, 'showcase_purchase')).resolves.toBeNull();
    expect(getObjectSchema).toHaveBeenCalledWith('showcase_purchase');
  });

  it('returns the declared figure field when the read answers', async () => {
    const getObjectSchema = vi.fn(async () => ({
      highlightFields: ['x'],
      fields: { x: { type: 'number' } },
    }));
    expect(await readInboxFigureField({ getObjectSchema }, 'o')).toBe('x');
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
