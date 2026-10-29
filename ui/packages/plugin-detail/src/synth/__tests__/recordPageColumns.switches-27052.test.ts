/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27052 — the record page's column switches: the default a
 * reader who never chose gets, derived from the object with no key of its
 * own (one row per branch of `recordTimelineDefaultReason`), and how a column
 * tier re-flows when a switch is off (`recordPageArrangementFor`).
 */

import { describe, it, expect } from 'vitest';
import {
  recordPageArrangementFor,
  recordPageColumnDefaults,
  recordTimelineDefaultReason,
} from '../recordPageColumns';

const lead = {
  name: 'crm_lead',
  fields: {
    status: {
      type: 'select',
      options: [
        { value: 'new', label: 'New', kind: 'open' },
        { value: 'converted', label: 'Converted', kind: 'won' },
      ],
    },
  },
};

describe('recordTimelineDefaultReason — the timeline is on for a worked object (objectstack#27052)', () => {
  it('stage-field: `stageField` names a field', () => {
    expect(recordTimelineDefaultReason({ stageField: 'phase', fields: {} })).toBe('stage-field');
  });

  it('option-kinds: a field whose options declare a lifecycle kind', () => {
    expect(recordTimelineDefaultReason(lead)).toBe('option-kinds');
    // An array-shaped field list reads the same.
    expect(recordTimelineDefaultReason({ fields: Object.values(lead.fields) })).toBe('option-kinds');
  });

  it('`stageField: false` turns the stage role off: option kinds no longer count', () => {
    expect(recordTimelineDefaultReason({ ...lead, stageField: false })).toBeNull();
  });

  it('files: `enable.files: true`', () => {
    expect(recordTimelineDefaultReason({ enable: { files: true }, fields: {} })).toBe('files');
    expect(recordTimelineDefaultReason({ enable: { files: false }, fields: {} })).toBeNull();
  });

  it('a `master_detail` parent and nothing else is off: owning child rows is a container, not a worked record', () => {
    const priceBook = { name: 'price_book', fields: { name: { type: 'text' } } };
    const entry = { name: 'price_book_entry', fields: { price_book: { type: 'master_detail', reference: 'price_book' } } };
    expect(recordTimelineDefaultReason(priceBook)).toBeNull();
    expect(recordPageColumnDefaults(priceBook)).toEqual({ timeline: false, related: true });
    // The child that holds the `master_detail` is not worked by it either.
    expect(recordTimelineDefaultReason(entry)).toBeNull();
  });

  it('none of them: off — a product, a price-book entry', () => {
    const product = { name: 'product', fields: { name: { type: 'text' }, family: { type: 'select', options: [{ value: 'a', label: 'A' }] } } };
    expect(recordTimelineDefaultReason(product)).toBeNull();
    expect(recordTimelineDefaultReason(undefined)).toBeNull();
  });
});

describe('recordPageColumnDefaults (objectstack#27052)', () => {
  it('the timeline follows the derivation; the related column is on', () => {
    expect(recordPageColumnDefaults(lead)).toEqual({ timeline: true, related: true });
    expect(recordPageColumnDefaults({ fields: {} })).toEqual({ timeline: false, related: true });
  });
});

describe('recordPageArrangementFor — a switched-off column frees its room (objectstack#27052)', () => {
  it('three columns, both on: details | timeline | related', () => {
    expect(recordPageArrangementFor('three-column', { timeline: true, related: true })).toEqual({
      columns: ['details', 'timeline', 'related'],
      timelineFolded: false,
      relatedRail: false,
    });
  });

  it('three columns, timeline off: details | related, the timeline folded into it', () => {
    expect(recordPageArrangementFor('three-column', { timeline: false, related: true })).toEqual({
      columns: ['details', 'related'],
      timelineFolded: true,
      relatedRail: false,
    });
  });

  it('three columns, related off: details | timeline, and no rail (objectstack#27241)', () => {
    expect(recordPageArrangementFor('three-column', { timeline: true, related: false })).toEqual({
      columns: ['details', 'timeline'],
      timelineFolded: false,
      relatedRail: false,
    });
  });

  it('two columns, related off: details | timeline, and no rail — the switch decides whether the column exists (objectstack#27241)', () => {
    expect(recordPageArrangementFor('two-column', { timeline: true, related: false })).toEqual({
      columns: ['details', 'timeline'],
      timelineFolded: false,
      relatedRail: false,
    });
  });

  it('two columns: details | timeline with the rail, or details | related when the timeline is off', () => {
    expect(recordPageArrangementFor('two-column', { timeline: true, related: true })).toEqual({
      columns: ['details', 'timeline'],
      timelineFolded: false,
      relatedRail: true,
    });
    expect(recordPageArrangementFor('two-column', { timeline: false, related: true })).toEqual({
      columns: ['details', 'related'],
      timelineFolded: true,
      relatedRail: false,
    });
  });

  it('both off: details alone, and no rail (objectstack#27241)', () => {
    expect(recordPageArrangementFor('three-column', { timeline: false, related: false })).toEqual({
      columns: ['details'],
      timelineFolded: true,
      relatedRail: false,
    });
    expect(recordPageArrangementFor('two-column', { timeline: false, related: false }).relatedRail).toBe(false);
  });
});
