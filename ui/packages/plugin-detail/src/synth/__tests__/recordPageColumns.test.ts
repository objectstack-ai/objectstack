/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26678 — the synthesized record page at two widths.
 *
 * Two facts are pinned here, both pure: the tier a container width takes
 * (`recordPageTierFor`), and how the synthesized tabbed page partitions into
 * the column tiers' header and columns (`buildDefaultPageColumns`). The
 * partition is read off `buildDefaultPageSchema`'s real output, never a
 * hand-built page, so a synthesizer change reaches these assertions.
 */

import { describe, it, expect } from 'vitest';
import { buildDefaultPageSchema, buildDefaultTabs, type ObjectDefLike } from '../buildDefaultPageSchema';
import {
  RECORD_PAGE_THREE_COLUMN_MIN_WIDTH,
  RECORD_PAGE_TWO_COLUMN_MIN_WIDTH,
  buildDefaultPageColumns,
  recordPageColumnOfTab,
  recordPageTierFor,
} from '../recordPageColumns';

const types = (nodes: any[]): string[] => nodes.map((n) => n?.type);

const leadDef: ObjectDefLike = {
  name: 'lead',
  label: 'Lead',
  enable: { files: true },
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    email: { name: 'email', label: 'Email', type: 'email' },
    status: {
      name: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { value: 'new', label: 'New' },
        { value: 'won', label: 'Won', kind: 'won' },
      ],
    },
  },
};

const RELATED = [
  { objectName: 'task', relationshipField: 'lead_id', title: 'Tasks', isPrimary: true },
  { objectName: 'note', relationshipField: 'parent_id', title: 'Notes' },
  { objectName: 'call', relationshipField: 'lead_id', title: 'Calls' },
];

/** Every option that adds a tab to the synthesized strip, at once. */
const maximal = {
  related: RELATED,
  approvals: { count: 2, node: { requests: [] } },
  showActivity: true,
  history: { entries: [], loading: false },
};

describe('recordPageTierFor (objectstack#26678)', () => {
  it('three columns from 1280 px, two from 1024 px, the tabs below', () => {
    expect(RECORD_PAGE_THREE_COLUMN_MIN_WIDTH).toBe(1280);
    expect(RECORD_PAGE_TWO_COLUMN_MIN_WIDTH).toBe(1024);
    expect(recordPageTierFor(1440)).toBe('three-column');
    expect(recordPageTierFor(1280)).toBe('three-column');
    expect(recordPageTierFor(1279.5)).toBe('two-column');
    expect(recordPageTierFor(1100)).toBe('two-column');
    expect(recordPageTierFor(1024)).toBe('two-column');
    expect(recordPageTierFor(1023)).toBe('tabs');
    expect(recordPageTierFor(900)).toBe('tabs');
  });

  it('an embedded page is tabbed at every width', () => {
    expect(recordPageTierFor(1440, { embedded: true })).toBe('tabs');
    expect(recordPageTierFor(1100, { embedded: true })).toBe('tabs');
  });

  it('an unknown width keeps the tabs', () => {
    expect(recordPageTierFor(0)).toBe('tabs');
    expect(recordPageTierFor(Number.NaN)).toBe('tabs');
    expect(recordPageTierFor(-1)).toBe('tabs');
  });
});

describe('recordPageColumnOfTab — every synthesized tab has a column', () => {
  it.each(['default', 'stack', 'tabs'] as const)('relatedLayout %s', (layout) => {
    const tabs = buildDefaultTabs(leadDef, {
      ...maximal,
      ...(layout === 'default' ? {} : { relatedLayout: layout }),
    });
    const values = tabs.properties.items.map((item: any) => item.value);
    // The maximal synthesis really emitted the whole strip.
    expect(values).toEqual(expect.arrayContaining(['details', 'approvals', 'attachments', 'activity', 'history']));
    for (const value of values) expect(recordPageColumnOfTab(value)).not.toBeNull();
  });

  it('a value the synthesizer does not emit has no column', () => {
    expect(recordPageColumnOfTab('overview')).toBeNull();
    expect(recordPageColumnOfTab(undefined)).toBeNull();
    expect(recordPageColumnOfTab(3)).toBeNull();
  });
});

describe('buildDefaultPageColumns (objectstack#26678)', () => {
  it('partitions the synthesized page: one header, details | timeline | related', () => {
    const page = buildDefaultPageSchema(leadDef, maximal);
    const columns = buildDefaultPageColumns(page);
    expect(columns).not.toBeNull();
    // The header is every node before the strip — the same nodes the tabbed tier draws.
    const main = page.regions.find((r: any) => r.name === 'main');
    const tabIndex = main.components.findIndex((n: any) => n.type === 'page:tabs');
    expect(columns!.header).toEqual(main.components.slice(0, tabIndex));
    expect(types(columns!.header)[0]).toBe('page:header');
    expect(types(columns!.details)).toEqual(['record:details']);
    // The discussion footer first (its composer on top), then Activity, History.
    expect(types(columns!.timeline)).toEqual(['record:discussion', 'record:activity', 'record:history']);
    // The strip's order: the primary list's own tab, the stacked rest, Approvals, Attachments.
    expect(types(columns!.related)).toEqual([
      'record:related_list',
      'record:related_list',
      'record:related_list',
      'record:approvals',
      'record:attachments',
    ]);
    expect(columns!.related.slice(0, 3).map((n: any) => n.properties.objectName)).toEqual(['task', 'note', 'call']);
    expect(columns!.relatedCount).toBe(3);
  });

  it('places every node the page holds exactly once', () => {
    const page = buildDefaultPageSchema(leadDef, { ...maximal, relatedLayout: 'tabs' });
    const columns = buildDefaultPageColumns(page)!;
    const placed = [...columns.header, ...columns.details, ...columns.timeline, ...columns.related];
    const main = page.regions.find((r: any) => r.name === 'main');
    const tabs = main.components.find((n: any) => n.type === 'page:tabs');
    const expected = [
      ...main.components.filter((n: any) => n !== tabs),
      ...tabs.properties.items.flatMap((item: any) => item.children),
    ];
    expect(placed).toHaveLength(expected.length);
    for (const node of expected) expect(placed.filter((n) => n === node)).toHaveLength(1);
  });

  it('folds the opt-in reference rail into the related column — one rail, not two', () => {
    const page = buildDefaultPageSchema(leadDef, {
      showReferenceRail: true,
      related: RELATED,
      slots: { rightRail: { type: 'card', title: 'Watchers' } },
    });
    // The tabbed page keeps today's aside, and the rail suppresses the Related tab.
    expect(page.regions.map((r: any) => r.name)).toEqual(['main', 'aside']);
    const columns = buildDefaultPageColumns(page)!;
    // The rail and the `rightRail` slot, then the Attachments tab (`enable.files`).
    expect(types(columns.related)).toEqual(['record:reference_rail', 'card', 'record:attachments']);
    expect(columns.relatedCount).toBe(RELATED.length);
    // No related list is drawn twice: the rail stands in for the suppressed tab.
    expect(types(columns.related)).not.toContain('record:related_list');
  });

  it('a slotted details body lands in the details column', () => {
    const body = { type: 'record:details', properties: { sections: [{ label: 'Mine', fields: ['email'] }] } };
    const page = buildDefaultPageSchema(leadDef, { related: RELATED, slots: { details: body } });
    expect(buildDefaultPageColumns(page)!.details).toEqual([body]);
  });

  it('a page without a discussion, activity or history has an empty timeline', () => {
    const page = buildDefaultPageSchema({ name: 'thing', fields: {} }, { hideDiscussion: true });
    const columns = buildDefaultPageColumns(page)!;
    expect(columns.timeline).toEqual([]);
    expect(columns.related).toEqual([]);
    expect(columns.relatedCount).toBe(0);
  });

  it('answers null — keep the tabs — for a strip it cannot read', () => {
    const tabsSlot = { type: 'page:tabs', properties: { items: [{ label: 'Overview', value: 'overview', children: [] }] } };
    // An authored strip (a `kind: 'full'` page's own; the slotted `tabs` slot
    // that once carried one retired, objectstack#27053).
    expect(buildDefaultPageColumns({ type: 'record', regions: [{ name: 'main', components: [tabsSlot] }] })).toBeNull();

    const gated = buildDefaultPageSchema(leadDef, { related: RELATED });
    const main = gated.regions.find((r: any) => r.name === 'main');
    const strip = main.components.find((n: any) => n.type === 'page:tabs');
    strip.properties.items[1].visibleWhen = 'record.status == "won"';
    expect(buildDefaultPageColumns(gated)).toBeNull();

    expect(buildDefaultPageColumns({ type: 'record', regions: [{ name: 'main', components: [] }] })).toBeNull();
    expect(buildDefaultPageColumns({ type: 'record' })).toBeNull();
    expect(buildDefaultPageColumns(null)).toBeNull();
  });
});
