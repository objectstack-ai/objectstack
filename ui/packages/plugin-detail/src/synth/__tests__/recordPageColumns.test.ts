/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26678 / objectstack#27524 (Target 6) — the synthesized record
 * page laid out by its width, by one rule.
 *
 * Two facts are pinned here, both pure: the tier a container width takes
 * (`recordPageTierFor`), and how the synthesized tabbed page partitions into
 * its header, details, 动态 and related panels (`buildDefaultPageColumns`).
 * The partition is read off `buildDefaultPageSchema`'s real output, never a
 * hand-built page, so a synthesizer change reaches these assertions.
 */

import { describe, it, expect } from 'vitest';
import { buildDefaultPageSchema, buildDefaultTabs, type ObjectDefLike } from '../buildDefaultPageSchema';
import {
  RECORD_PAGE_TWO_COLUMN_MIN_WIDTH,
  RECORD_PAGE_WIDE_MIN_WIDTH,
  buildDefaultPageColumns,
  recordPageColumnOfTab,
  recordPageTierFor,
  recordPageTierHasRightColumn,
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
};

describe('recordPageTierFor — one rule by the container width (objectstack#27524, Target 6)', () => {
  it('wide from 1120 px, details | right column from 760 px, one column below — no tabbed tier', () => {
    expect(RECORD_PAGE_WIDE_MIN_WIDTH).toBe(1120);
    expect(RECORD_PAGE_TWO_COLUMN_MIN_WIDTH).toBe(760);
    expect(recordPageTierFor(1440)).toBe('wide');
    expect(recordPageTierFor(1120)).toBe('wide');
    expect(recordPageTierFor(1119.5)).toBe('two-column');
    expect(recordPageTierFor(900)).toBe('two-column');
    expect(recordPageTierFor(760)).toBe('two-column');
    expect(recordPageTierFor(759)).toBe('stack');
    expect(recordPageTierFor(600)).toBe('stack');
  });

  it('the faces the card measures: 1440 / 1200 page, 720 split pane, 390 phone', () => {
    const SIDEBAR = 256;
    // 「1440 窗口（含侧栏）」 — the record page root measured 1184 px there.
    expect(recordPageTierFor(1440 - SIDEBAR)).toBe('wide');
    // A 1200 px window with the sidebar: 944 px of container.
    expect(recordPageTierFor(1200 - SIDEBAR)).toBe('two-column');
    // A 1024 px window with the sidebar keeps the right column (768 px).
    expect(recordPageTierFor(1024 - SIDEBAR)).toBe('two-column');
    // The default split pane is 720 px wide: it stacks, it is not tabbed.
    expect(recordPageTierFor(720)).toBe('stack');
    expect(recordPageTierFor(390)).toBe('stack');
  });

  it('only the width counts: there is no embedded answer, and an embedded pane maximized to 1184 px is wide', () => {
    // The signature takes the width alone (objectstack#27524: the drawer, the
    // pane and the maximized pane use the page's rule).
    expect(recordPageTierFor.length).toBe(1);
    expect(recordPageTierFor(1184)).toBe('wide');
  });

  it('an unknown width is the stack, the narrowest tier', () => {
    expect(recordPageTierFor(0)).toBe('stack');
    expect(recordPageTierFor(Number.NaN)).toBe('stack');
    expect(recordPageTierFor(-1)).toBe('stack');
  });

  it('the right column, and so ⊟, exists in the two tiers beside the details only', () => {
    expect(recordPageTierHasRightColumn('wide')).toBe(true);
    expect(recordPageTierHasRightColumn('two-column')).toBe(true);
    expect(recordPageTierHasRightColumn('stack')).toBe(false);
    expect(recordPageTierHasRightColumn(null)).toBe(false);
  });
});

describe('recordPageColumnOfTab — every synthesized tab has a column', () => {
  it('from a maximal synthesis', () => {
    const tabs = buildDefaultTabs(leadDef, maximal);
    const values = tabs.properties.items.map((item: any) => item.value);
    // The maximal synthesis really emitted the whole strip.
    // `attachments` rides the Related tab now (objectstack#27055).
    expect(values).toEqual(expect.arrayContaining(['details', 'related', 'approvals', 'timeline']));
    for (const value of values) expect(recordPageColumnOfTab(value)).not.toBeNull();
  });

  it('a value the synthesizer does not emit has no column', () => {
    expect(recordPageColumnOfTab('overview')).toBeNull();
    expect(recordPageColumnOfTab(undefined)).toBeNull();
    expect(recordPageColumnOfTab(3)).toBeNull();
  });
});

describe('buildDefaultPageColumns (objectstack#26678)', () => {
  it('partitions the synthesized page: one header, the details, the 动态 panel, the related panels', () => {
    const page = buildDefaultPageSchema(leadDef, maximal);
    const columns = buildDefaultPageColumns(page);
    expect(columns).not.toBeNull();
    // The header is every node before the strip — the same nodes the strip draws above it.
    const main = page.regions.find((r: any) => r.name === 'main');
    const tabIndex = main.components.findIndex((n: any) => n.type === 'page:tabs');
    expect(columns!.header).toEqual(main.components.slice(0, tabIndex));
    expect(types(columns!.header)[0]).toBe('page:header');
    // The primary list is the record's body: a table in the details column
    // (objectstack#27055, Target 8).
    expect(types(columns!.details)).toEqual(['record:details', 'record:related_list']);
    // The one stream (objectstack#27055): a record:activity.
    expect(types(columns!.timeline)).toEqual(['record:activity']);
    // The Related tab (side lists, attachments at its foot), then Approvals.
    expect(types(columns!.related)).toEqual([
      'record:related_list',
      'record:related_list',
      'record:attachments',
      'record:approvals',
    ]);
    expect(columns!.related.slice(0, 2).map((n: any) => n.properties.objectName)).toEqual(['note', 'call']);
  });

  it('places every node the page holds exactly once', () => {
    const page = buildDefaultPageSchema(leadDef, maximal);
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

  it('answers null for a page with a region besides `main` — the synthesizer emits none (objectstack#27055)', () => {
    const page = buildDefaultPageSchema(leadDef, { related: RELATED });
    expect(page.regions.map((r: any) => r.name)).toEqual(['main']);
    const withAside = { ...page, regions: [...page.regions, { name: 'aside', components: [{ type: 'record:reference_rail' }] }] };
    expect(buildDefaultPageColumns(withAside)).toBeNull();
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
  });

  it('answers null — draw the page as written — for a strip it cannot read', () => {
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
