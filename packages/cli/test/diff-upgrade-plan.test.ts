// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os diff` reads its object and field changes from the package upgrade plan
 * (`comparePackageVersions`, `@objectstack/metadata-core`), the comparison the
 * install door and the `manifest` service's `planUpgrade` read too (epic
 * cloud#3652 Q3).
 *
 * The first block pins today's output, byte for byte (`JSON.stringify`, so the
 * key order of each entry is pinned as well — `--json` prints these objects),
 * over every shape the command reported before it moved onto the plan. It was
 * written against the command's own comparison and stayed green across the
 * move. The second block pins what the plan adds: renames, suspected renames
 * and seed datasets.
 */

import { describe, expect, it } from 'vitest';
import type { DriftCategory } from '@objectstack/driver-sql';
import type { UpgradeDriftCategory } from '@objectstack/metadata-core';
import { diffStacks } from '../src/commands/diff.js';

// The plan restates `schema-drift.ts`'s three drift words, since
// `@objectstack/metadata-core` cannot depend on a driver; this package depends
// on both, so the two unions are held equal here. A word added to or dropped
// from either side fails `tsc` on this line.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const driftWordsAgree: Equal<UpgradeDriftCategory, DriftCategory> = true;

const BEFORE = {
  objects: [
    { name: 'acme_deal', label: 'Deal', fields: { title: { type: 'text' }, amount: { type: 'number' }, stage: { type: 'text' } } },
    { name: 'acme_lead', label: 'Lead', fields: { legacy: { type: 'text' }, name: { type: 'text' } } },
    { name: 'acme_old', label: 'Old', fields: { x: { type: 'text' } } },
    { name: 'acme_dup', fields: { a: { type: 'text' } } },
    { name: 'acme_dup', fields: { b: { type: 'text' } } },
  ],
  views: [{ name: 'deal_list' }, { name: 'old_view' }],
  flows: [{ name: 'f1' }],
  positions: [{ name: 'p1' }],
};

const AFTER = {
  objects: [
    {
      name: 'acme_deal',
      label: 'Deals',
      fields: {
        title: { type: 'text' },
        amount: { type: 'currency' },
        stage: { type: 'text' },
        code: { type: 'text', required: true },
        note: { type: 'textarea' },
      },
    },
    { name: 'acme_lead', label: 'Lead', fields: { name: { type: 'text' } } },
    { name: 'acme_new', fields: {} },
    { name: 'acme_dup', fields: { b: { type: 'text' } } },
  ],
  views: [{ name: 'deal_list' }, { name: 'new_view' }],
  flows: [],
  apps: [{ name: 'a1' }],
  positions: [{ name: 'p1' }],
};

describe('os diff — the output it printed before the plan, unchanged', () => {
  it('every shape, in order, with each entry\'s key order', () => {
    expect(driftWordsAgree).toBe(true);
    const expected = [
      { type: 'removed', category: 'objects', name: 'acme_old', breaking: true },
      { type: 'added', category: 'objects', name: 'acme_new', breaking: false },
      { type: 'added', category: 'objects.acme_deal.fields', name: 'code', breaking: true, detail: 'required field added' },
      { type: 'added', category: 'objects.acme_deal.fields', name: 'note', breaking: false, detail: 'optional field added' },
      { type: 'modified', category: 'objects.acme_deal.fields', name: 'amount', breaking: true, detail: 'type changed: number → currency' },
      { type: 'modified', category: 'objects', name: 'acme_deal', breaking: false, detail: 'label changed: "Deal" → "Deals"' },
      { type: 'removed', category: 'objects.acme_lead.fields', name: 'legacy', breaking: true, detail: 'field removed' },
      { type: 'removed', category: 'views', name: 'old_view', breaking: true },
      { type: 'added', category: 'views', name: 'new_view', breaking: false },
      { type: 'removed', category: 'flows', name: 'f1', breaking: true },
      { type: 'added', category: 'apps', name: 'a1', breaking: false },
    ];
    expect(JSON.stringify(diffStacks(BEFORE, AFTER))).toBe(JSON.stringify(expected));
  });

  it('an identical pair reports nothing', () => {
    expect(diffStacks(BEFORE, structuredClone(BEFORE))).toEqual([]);
  });

  it('a stack with no objects on either side reports only its name-level categories', () => {
    expect(diffStacks({ views: [{ name: 'v' }] }, {})).toEqual([
      { type: 'removed', category: 'views', name: 'v', breaking: true },
    ]);
  });
});
