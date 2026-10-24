/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { defaultListColumnsFromObject } from './ObjectView';

describe('defaultListColumnsFromObject', () => {
  // Mirrors how the framework's `applySystemFields` presents an object with no
  // declared list view to the console: the injected system fields (owner_id,
  // audit columns, tenancy FK) are spread to the FRONT of the field map and
  // carry `system: true`; `owner_id` is deliberately non-hidden / non-readonly
  // because ownership is reassignable. This is the exact `showcase_invoice`
  // shape from #2777.
  const invoiceLike = {
    fields: {
      owner_id: { type: 'lookup', label: 'Owner id', system: true },
      created_at: { type: 'datetime', system: true, readonly: true },
      created_by: { type: 'lookup', system: true, readonly: true },
      organization_id: { type: 'lookup', system: true, hidden: true },
      invoice_no: { type: 'text', label: '发票号' },
      account: { type: 'lookup', label: '客户' },
      contact: { type: 'lookup', label: '联系人' },
      owner: { type: 'user', label: '负责人' },
    },
  };

  it('#2777: does NOT lead the auto-list with the injected owner_id — business fields come first', () => {
    const cols = defaultListColumnsFromObject(invoiceLike, 5);
    expect(cols[0]).toBe('invoice_no');
    expect(cols).not.toContain('owner_id');
    expect(cols).not.toContain('created_at');
    expect(cols).not.toContain('created_by');
    expect(cols).not.toContain('organization_id');
    // The business `owner` (Field.user, display value) survives — only the
    // injected `owner_id` id column is dropped.
    expect(cols).toEqual(['invoice_no', 'account', 'contact', 'owner']);
  });

  it('excludes owner_id even when it arrives WITHOUT the system flag (name fallback)', () => {
    const cols = defaultListColumnsFromObject({
      fields: { owner_id: { type: 'lookup' }, title: { type: 'text' } },
    });
    expect(cols).toEqual(['title']);
  });

  it('honors highlightFields as the curated override (owner_id kept if explicitly listed)', () => {
    const cols = defaultListColumnsFromObject({
      highlightFields: ['invoice_no', 'owner_id'],
      fields: invoiceLike.fields,
    });
    expect(cols).toEqual(['invoice_no', 'owner_id']);
  });

  // objectui#7245. `highlightFields` is ADR-0085's "most important fields", not
  // a column list — the detail highlight strip, its first consumer, strips the
  // title field out because the page H1 above it already shows one. A grid has
  // no H1, so a curated list that (correctly) omits the name left every row
  // unidentifiable. The synthesized default therefore always leads with the
  // object's name field.
  describe('#7245: the synthesized default always leads with the name field', () => {
    // The served `showcase_account`: `nameField: "name"`, three curated
    // highlight fields that do not include it, and no list views at all.
    const showcaseAccount = {
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

    it('THE REPRO: prepends nameField to a curated list that omits it', () => {
      expect(defaultListColumnsFromObject(showcaseAccount, 5)).toEqual([
        'name',
        'status',
        'industry',
        'annual_revenue',
      ]);
    });

    it('does not duplicate a nameField the curated list already carries', () => {
      const cols = defaultListColumnsFromObject(
        { ...showcaseAccount, highlightFields: ['name', 'status'] },
        5,
      );
      expect(cols).toEqual(['name', 'status']);
    });

    it('moves a late-listed nameField to the front', () => {
      const cols = defaultListColumnsFromObject(
        { ...showcaseAccount, highlightFields: ['status', 'name', 'industry'] },
        5,
      );
      expect(cols).toEqual(['name', 'status', 'industry']);
    });

    it('still appends the org attribution column last', () => {
      const cols = defaultListColumnsFromObject(showcaseAccount, 5, { orgAttribution: true });
      expect(cols).toEqual(['name', 'status', 'industry', 'annual_revenue', 'organization_id']);
    });

    it('leads the derived walk too, and BEFORE the limit slice', () => {
      // The walk is declaration-ordered, so a nameField declared after `limit`
      // other fields used to fall off the end of the slice entirely.
      const fields: Record<string, any> = {};
      for (let i = 0; i < 8; i++) fields[`b_${i}`] = { type: 'text' };
      fields.headline = { type: 'text' };
      const cols = defaultListColumnsFromObject({ nameField: 'headline', fields }, 5);
      expect(cols).toHaveLength(5);
      expect(cols[0]).toBe('headline');
      expect(cols).toEqual(['headline', 'b_0', 'b_1', 'b_2', 'b_3']);
    });

    it('does not lead with a nameField the object has no field def for', () => {
      const cols = defaultListColumnsFromObject(
        { nameField: 'ghost', highlightFields: ['status'], fields: showcaseAccount.fields },
        5,
      );
      expect(cols).toEqual(['status']);
    });
  });

  it('caps the auto-derived business columns at the requested limit', () => {
    const fields: Record<string, any> = { owner_id: { type: 'lookup', system: true } };
    for (let i = 0; i < 10; i++) fields[`b_${i}`] = { type: 'text' };
    const cols = defaultListColumnsFromObject({ fields }, 5);
    expect(cols).toHaveLength(5);
    expect(cols).not.toContain('owner_id');
    expect(cols[0]).toBe('b_0');
  });

  it('returns an empty list when the object has no fields', () => {
    expect(defaultListColumnsFromObject({})).toEqual([]);
    expect(defaultListColumnsFromObject(undefined)).toEqual([]);
  });

  // ADR-0105 group posture: reads span every organization the member belongs
  // to, so org-walled rows need attribution — organization_id is appended as a
  // TRAILING column, business fields still lead.
  describe('orgAttribution (ADR-0105 group posture)', () => {
    it('appends organization_id last for an org-walled object', () => {
      const cols = defaultListColumnsFromObject(invoiceLike, 5, { orgAttribution: true });
      expect(cols).toEqual(['invoice_no', 'account', 'contact', 'owner', 'organization_id']);
    });

    it('appends after a curated highlightFields set too', () => {
      const cols = defaultListColumnsFromObject(
        { highlightFields: ['invoice_no'], fields: invoiceLike.fields },
        5,
        { orgAttribution: true },
      );
      expect(cols).toEqual(['invoice_no', 'organization_id']);
    });

    it('does not append for an object without organization_id (not org-walled)', () => {
      const cols = defaultListColumnsFromObject(
        { fields: { title: { type: 'text' } } },
        5,
        { orgAttribution: true },
      );
      expect(cols).toEqual(['title']);
    });

    it('does not duplicate when the curated set already lists organization_id', () => {
      const cols = defaultListColumnsFromObject(
        { highlightFields: ['invoice_no', 'organization_id'], fields: invoiceLike.fields },
        5,
        { orgAttribution: true },
      );
      expect(cols).toEqual(['invoice_no', 'organization_id']);
    });

    it('is a no-op when the flag is off or absent (non-group postures unchanged)', () => {
      expect(defaultListColumnsFromObject(invoiceLike, 5, { orgAttribution: false })).toEqual(
        defaultListColumnsFromObject(invoiceLike, 5),
      );
    });
  });
});
