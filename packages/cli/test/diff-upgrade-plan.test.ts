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

describe('os diff — what the upgrade plan adds', () => {
  const lead = (fields: Record<string, unknown>, data?: unknown[]) => ({
    objects: [{ name: 'acme_lead', label: 'Lead', fields }],
    ...(data ? { data } : {}),
  });

  it('a field removed and one added with no renamedFrom: both listed, and a suspected rename on the removed key', () => {
    expect(diffStacks(lead({ company: { type: 'text' } }), lead({ account_name: { type: 'text' } }))).toEqual([
      { type: 'removed', category: 'objects.acme_lead.fields', name: 'company', breaking: true, detail: 'field removed' },
      { type: 'added', category: 'objects.acme_lead.fields', name: 'account_name', breaking: false, detail: 'optional field added' },
      {
        type: 'modified', category: 'objects.acme_lead.fields', name: 'company', breaking: true,
        detail: 'suspected rename to account_name: no renamedFrom declares it, so the new key installs as a new empty column',
      },
    ]);
  });

  it('the same pair with renamedFrom: one rename, no removed, added or suspected entry', () => {
    expect(diffStacks(
      lead({ company: { type: 'text' } }),
      lead({ account_name: { type: 'text', renamedFrom: ['company'] } }),
    )).toEqual([
      { type: 'modified', category: 'objects.acme_lead.fields', name: 'account_name', breaking: true, detail: 'renamed from company, declared by renamedFrom' },
    ]);
  });

  it('a declared rename that changes type prints the type change too', () => {
    expect(diffStacks(
      lead({ amount: { type: 'text' } }),
      lead({ amount_value: { type: 'number', renamedFrom: ['amount'] } }),
    ).map((e) => e.detail)).toEqual(['renamed from amount, declared by renamedFrom', 'type changed: text → number']);
  });

  it('seed datasets, after every other category, each with its mode', () => {
    const before = lead({}, [
      { object: 'acme_stage', mode: 'upsert', records: [{ name: 'new' }] },
      { object: 'acme_region', records: [{ name: 'emea' }] },
      { object: 'acme_old', mode: 'insert', records: [{ name: 'x' }] },
    ]);
    const after = {
      ...lead({}, [
        { object: 'acme_stage', mode: 'upsert', records: [{ name: 'new' }, { name: 'won' }] },
        { object: 'acme_region', records: [{ name: 'apac' }] },
        { object: 'acme_tier', mode: 'replace', records: [{ name: 'gold' }] },
      ]),
      views: [{ name: 'lead_list' }],
    };
    expect(diffStacks(before, after)).toEqual([
      { type: 'added', category: 'views', name: 'lead_list', breaking: false },
      { type: 'removed', category: 'data', name: 'acme_old', breaking: false, detail: 'seed dataset removed, mode insert' },
      {
        type: 'added', category: 'data', name: 'acme_tier', breaking: false,
        detail: 'seed dataset added: 1 record(s); mode replace; a replay deletes nothing and inserts these again, so rows already in the table stay',
      },
      {
        type: 'modified', category: 'data', name: 'acme_stage', breaking: false,
        detail: 'seed dataset changed: records; mode upsert; a replay writes its columns over the rows it matches',
      },
      { type: 'modified', category: 'data', name: 'acme_region', breaking: false, detail: 'seed dataset changed: records; mode ignore' },
    ]);
  });

  it('an insert dataset, added or changed, says a replay inserts its records again; ignore stays silent', () => {
    const before = lead({}, [
      { object: 'acme_source', mode: 'insert', records: [{ name: 'web' }] },
      { object: 'acme_region', mode: 'ignore', records: [{ name: 'emea' }] },
    ]);
    const after = lead({}, [
      { object: 'acme_source', mode: 'insert', records: [{ name: 'web' }, { name: 'event' }] },
      { object: 'acme_region', mode: 'ignore', records: [{ name: 'apac' }] },
      { object: 'acme_channel', mode: 'insert', records: [{ name: 'email' }] },
    ]);
    const insertNote = "a replay inserts these again, and a row the database refuses is that row's error";
    expect(diffStacks(before, after)).toEqual([
      {
        type: 'added', category: 'data', name: 'acme_channel', breaking: false,
        detail: `seed dataset added: 1 record(s); mode insert; ${insertNote}`,
      },
      {
        type: 'modified', category: 'data', name: 'acme_source', breaking: false,
        detail: `seed dataset changed: records; mode insert; ${insertNote}`,
      },
      { type: 'modified', category: 'data', name: 'acme_region', breaking: false, detail: 'seed dataset changed: records; mode ignore' },
    ]);
  });
});
