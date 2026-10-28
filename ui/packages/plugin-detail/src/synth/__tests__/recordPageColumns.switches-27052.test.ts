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
    expect(recordTimelineDefaultReason({ name: 'deal', stageField: 'phase', fields: {} })).toBe('stage-field');
  });

  it('option-kinds: a field whose options declare a lifecycle kind', () => {
    expect(recordTimelineDefaultReason(lead)).toBe('option-kinds');
    // An array-shaped field list reads the same.
    expect(recordTimelineDefaultReason({ name: 'x', fields: Object.values(lead.fields) })).toBe('option-kinds');
  });

  it('`stageField: false` turns the stage role off: option kinds no longer count', () => {
    expect(recordTimelineDefaultReason({ ...lead, stageField: false })).toBeNull();
  });

  it('files: `enable.files: true`', () => {
    expect(recordTimelineDefaultReason({ name: 'account', enable: { files: true }, fields: {} })).toBe('files');
    expect(recordTimelineDefaultReason({ name: 'account', enable: { files: false }, fields: {} })).toBeNull();
  });

  it('master-detail-parent: another object owns child records through a `master_detail` to it', () => {
    const objects = [
      { name: 'quote', fields: {} },
      { name: 'quote_line', fields: { quote: { type: 'master_detail', reference: 'quote' } } },
      { name: 'note', fields: { account: { type: 'lookup', reference: 'account' } } },
    ];
    expect(recordTimelineDefaultReason(objects[0], objects)).toBe('master-detail-parent');
    // A lookup is not ownership.
    expect(recordTimelineDefaultReason({ name: 'account', fields: {} }, objects)).toBeNull();
    // The child itself is not a parent.
    expect(recordTimelineDefaultReason(objects[1], objects)).toBeNull();
  });

  it('none of them: off — a product, a price-book entry', () => {
    const product = { name: 'product', fields: { name: { type: 'text' }, family: { type: 'select', options: [{ value: 'a', label: 'A' }] } } };
    expect(recordTimelineDefaultReason(product, [product])).toBeNull();
    expect(recordTimelineDefaultReason(undefined)).toBeNull();
  });
});

describe('recordPageColumnDefaults (objectstack#27052)', () => {
  it('the timeline follows the derivation; the related column is on', () => {
    expect(recordPageColumnDefaults(lead)).toEqual({ timeline: true, related: true });
    expect(recordPageColumnDefaults({ name: 'product', fields: {} })).toEqual({ timeline: false, related: true });
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

  it('three columns, related off: details | timeline, the related column in the rail', () => {
    expect(recordPageArrangementFor('three-column', { timeline: true, related: false })).toEqual({
      columns: ['details', 'timeline'],
      timelineFolded: false,
      relatedRail: true,
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

  it('both off: details alone, the related column (timeline folded in) in the rail', () => {
    expect(recordPageArrangementFor('three-column', { timeline: false, related: false })).toEqual({
      columns: ['details'],
      timelineFolded: true,
      relatedRail: true,
    });
  });
});
