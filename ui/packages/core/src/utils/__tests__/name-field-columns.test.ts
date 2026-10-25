/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7245 — the name-space half of the ADR-0079 title ladder, and the
 * column-list helper the three default-list synthesis faces share.
 *
 * The reported defect: `showcase_account` declares
 * `highlightFields: ["status", "industry", "annual_revenue"]` against
 * `nameField: "name"` and no list views, so every face that synthesized a
 * default grid from `highlightFields` alone rendered 14 rows with no column
 * identifying any of them.
 *
 * `highlightFields` is not a column list — it is ADR-0085's "most important
 * fields", and its first consumer (the detail highlight strip) deliberately
 * REMOVES the title field because the page H1 already shows it. So the metadata
 * is correct and the synthesis was wrong.
 */

import { describe, it, expect } from 'vitest';
import { resolveNameField, leadWithNameField, getRecordDisplayName } from '../record-title';

/** The served `showcase_account` shape, abridged to the keys under test. */
const showcaseAccount = {
  name: 'showcase_account',
  nameField: 'name',
  highlightFields: ['status', 'industry', 'annual_revenue'],
  fields: {
    name: { type: 'text', label: 'Account Name', required: true },
    industry: { type: 'select', label: 'Industry' },
    annual_revenue: { type: 'currency', label: 'Annual Revenue' },
    status: { type: 'select', label: 'Lifecycle' },
    organization_id: { type: 'lookup', system: true, hidden: true },
  },
};

describe('resolveNameField — which FIELD titles an object', () => {
  it('returns the declared canonical `nameField`', () => {
    expect(resolveNameField(showcaseAccount)).toBe('name');
  });

  it('honours the deprecated `displayNameField` alias when `nameField` is absent', () => {
    expect(
      resolveNameField({ displayNameField: 'activity_name', fields: { activity_name: { type: 'text' } } }),
    ).toBe('activity_name');
  });

  it('prefers the canonical pointer over the deprecated alias', () => {
    expect(resolveNameField({ nameField: 'subject', displayNameField: 'legacy' })).toBe('subject');
  });

  it('falls back to the type-aware derivation when nothing is declared', () => {
    // Same ladder `getRecordDisplayName` step 4 runs: name-ish exact beats
    // declaration order, and the date field is not title-eligible.
    expect(
      resolveNameField({ fields: { due_at: { type: 'datetime' }, title: { type: 'text' } } }),
    ).toBe('title');
  });

  it('does NOT read the render-only `titleFormat` — a template is not a field name', () => {
    // Deliberate omission, not a gap: there is no column, sort key or `$select`
    // entry to be had from a template. Value-space still renders it.
    const def = { titleFormat: '{a} · {b}', fields: { a: { type: 'text' }, b: { type: 'text' } } };
    expect(resolveNameField(def)).toBe('a'); // the derivation, not the template
    expect(getRecordDisplayName(def, { a: 'x', b: 'y' })).toBe('x · y');
  });

  it('returns undefined when nothing declares or derives a name field', () => {
    expect(resolveNameField({ fields: { when: { type: 'datetime' } } })).toBeUndefined();
    expect(resolveNameField(undefined)).toBeUndefined();
  });

  it('reads the SAME declared ladder value-space reads', () => {
    // The `??` chain has one spelling (`declaredNameField`). If the two ever
    // disagree, an object's list column and its record title name different
    // fields — the divergence ADR-0079 collapsed in the first place.
    const def = { nameField: 'activity_name', fields: { activity_name: { type: 'text' } } };
    expect(getRecordDisplayName(def, { activity_name: 'Kickoff' })).toBe('Kickoff');
    expect(resolveNameField(def)).toBe('activity_name');
  });
});

describe('leadWithNameField — the synthesized default column list', () => {
  it('THE REPRO: prepends the name column to a curated highlightFields list', () => {
    expect(leadWithNameField(showcaseAccount, ['status', 'industry', 'annual_revenue'])).toEqual([
      'name',
      'status',
      'industry',
      'annual_revenue',
    ]);
  });

  it('does not duplicate a name field the curated list already contains', () => {
    expect(leadWithNameField(showcaseAccount, ['name', 'status'])).toEqual(['name', 'status']);
  });

  it('MOVES the name field to the front when it is listed later', () => {
    // "The column that identifies the row" means first, not merely present.
    // Same treatment `deriveLookupColumns` gives the picker's display field.
    expect(leadWithNameField(showcaseAccount, ['status', 'name', 'industry'])).toEqual([
      'name',
      'status',
      'industry',
    ]);
  });

  it('leaves the order of the remaining columns untouched', () => {
    expect(leadWithNameField(showcaseAccount, ['annual_revenue', 'status', 'industry'])).toEqual([
      'name',
      'annual_revenue',
      'status',
      'industry',
    ]);
  });

  it('leads via the DERIVED name field when the object declares none', () => {
    const def = {
      highlightFields: ['stage'],
      fields: { stage: { type: 'select' }, title: { type: 'text' } },
    };
    expect(leadWithNameField(def, ['stage'])).toEqual(['title', 'stage']);
  });

  describe('cases that must NOT lead', () => {
    it('a name field the object carries no field def for — never fabricate a column', () => {
      const def = { nameField: 'ghost', fields: { status: { type: 'select' } } };
      expect(leadWithNameField(def, ['status'])).toEqual(['status']);
    });

    it('a `hidden: true` name field — the author said do not show it', () => {
      const def = {
        nameField: 'secret_name',
        fields: { secret_name: { type: 'text', hidden: true }, status: { type: 'select' } },
      };
      expect(leadWithNameField(def, ['status'])).toEqual(['status']);
    });

    it('a DERIVED pick that lands on a system-managed column (#2702 / #2777)', () => {
      // `deriveTitleField` filters by TYPE only, so with no name-ish business
      // field it can pick an injected column. Leading a default list with a raw
      // id is exactly the regression those two issues fixed.
      const def = {
        fields: {
          owner_id: { type: 'text', system: true },
          amount: { type: 'currency' },
        },
      };
      expect(resolveNameField(def)).toBe('owner_id'); // the derivation does pick it…
      expect(leadWithNameField(def, ['amount'])).toEqual(['amount']); // …and the guard refuses it
    });

    it('but a DECLARED system field still leads — `sys_migration` really points at `id`', () => {
      // An author's explicit designation is not a heuristic misfire.
      const def = {
        nameField: 'id',
        fields: { id: { type: 'text', system: true }, applied_at: { type: 'datetime' } },
      };
      expect(leadWithNameField(def, ['applied_at'])).toEqual(['id', 'applied_at']);
    });

    it('an object with no resolvable name field at all', () => {
      const def = { fields: { when: { type: 'datetime' }, amount: { type: 'currency' } } };
      expect(leadWithNameField(def, ['when', 'amount'])).toEqual(['when', 'amount']);
    });

    it('an absent / empty object definition', () => {
      expect(leadWithNameField(undefined, ['a'])).toEqual(['a']);
      expect(leadWithNameField({}, ['a'])).toEqual(['a']);
    });
  });
});
