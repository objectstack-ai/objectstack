/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27055, Target 8 — body tables vs side cards (maintainer,
 * 2026-10-28: 「如果是一个报价单，明细行的子表放在右侧合适嘛？」, 「他如果做到放在基本
 * 信息下面，而条款和备注在后面」, 「如果有多个子表呢」).
 *
 * A related list that is the record's own body (`isBody`, else
 * `relatedList: 'primary'`) is a table section of the Details tab, placed
 * right after the FIRST field section; several stack in the order given; the
 * remaining sections follow. Every other list is a side card in the one
 * `Related` tab. The `fieldGroups` placement entry is fenced (#27069).
 */

import { describe, expect, it } from 'vitest';
import { BODY_TABLE_PAGE_SIZE, buildDefaultPageSchema, buildDefaultTabs } from '../buildDefaultPageSchema';
import { bodyTableIdsOf, buildDefaultPageColumns } from '../recordPageColumns';

const quoteDef = {
  name: 'quote',
  fields: {
    name: { type: 'text', label: 'Name' },
    terms: { type: 'textarea', label: 'Terms', group: 'terms' },
    notes: { type: 'textarea', label: 'Notes', group: 'notes' },
  },
};
const SECTIONS = [
  { label: 'Basic', fields: ['name'] },
  { label: 'Terms', fields: ['terms'] },
  { label: 'Notes', fields: ['notes'] },
];
const LINES = { objectName: 'quote_line_item', relationshipField: 'quote', title: 'Line items', isBody: true };
const SCHEDULE = { objectName: 'quote_schedule', relationshipField: 'quote', title: 'Schedule', isBody: true };
const TASKS = { objectName: 'task', relationshipField: 'quote', title: 'Tasks' };

const items = (tabs: any) => tabs.properties.items;
const shape = (nodes: any[]) =>
  nodes.map((n) =>
    n.type === 'record:details'
      ? `details(${(n.properties.sections ?? []).map((s: any) => s.label).join(',')})`
      : `${n.type === 'record:related_list' ? 'table' : n.type}(${n.properties.objectName})`,
  );

describe('body tables sit in the Details tab after the first section (objectstack#27055)', () => {
  it('splits the details around the body tables; side lists stay in Related', () => {
    const tabs = buildDefaultTabs(quoteDef, { sections: SECTIONS, related: [LINES, TASKS, SCHEDULE] });
    expect(items(tabs).map((i: any) => i.value)).toEqual(['details', 'related']);
    expect(shape(items(tabs)[0].children)).toEqual([
      'details(Basic)',
      'table(quote_line_item)',
      'table(quote_schedule)',
      'details(Terms,Notes)',
    ]);
    expect(items(tabs)[1].children.map((n: any) => n.properties.objectName)).toEqual(['task']);
  });

  it('a body table opens on a first page of ten rows unless its list names a limit', () => {
    const tabs = buildDefaultTabs(quoteDef, { sections: SECTIONS, related: [LINES, { ...SCHEDULE, limit: 3 }] });
    const tables = items(tabs)[0].children.filter((n: any) => n.type === 'record:related_list');
    expect(tables.map((n: any) => n.properties.limit)).toEqual([BODY_TABLE_PAGE_SIZE, 3]);
    expect(BODY_TABLE_PAGE_SIZE).toBe(10);
  });

  it("`relatedList: 'primary'` is the body unless the host says otherwise", () => {
    const primary = { ...TASKS, isPrimary: true };
    const asBody = buildDefaultTabs(quoteDef, { sections: SECTIONS, related: [primary] });
    expect(shape(items(asBody)[0].children)).toContain('table(task)');
    const asSide = buildDefaultTabs(quoteDef, { sections: SECTIONS, related: [{ ...primary, isBody: false }] });
    expect(shape(items(asSide)[0].children)).not.toContain('table(task)');
    expect(items(asSide)[1].value).toBe('related');
  });

  it('with one section the tables follow the details', () => {
    const tabs = buildDefaultTabs(quoteDef, { sections: SECTIONS.slice(0, 1), related: [LINES] });
    expect(shape(items(tabs)[0].children)).toEqual(['details(Basic)', 'table(quote_line_item)']);
  });

  it('emits no per-list tab any more — the strip is Details / Related', () => {
    const tabs = buildDefaultTabs(quoteDef, { sections: SECTIONS, related: [{ ...TASKS, isPrimary: true }, LINES] });
    expect(items(tabs).some((i: any) => String(i.value).startsWith('related:'))).toBe(false);
  });
});

describe('the page knows its body tables', () => {
  const page = buildDefaultPageSchema(quoteDef, { sections: SECTIONS, related: [LINES, TASKS] });

  it('bodyTableIdsOf reads them off the Details tab', () => {
    expect([...bodyTableIdsOf(page)]).toEqual(['quote_line_item.quote']);
  });

  it('the column tiers draw them in the details column, side lists in the related column', () => {
    const columns = buildDefaultPageColumns(page)!;
    expect(shape(columns.details)).toEqual(['details(Basic)', 'table(quote_line_item)', 'details(Terms,Notes)']);
    expect(columns.related.map((n: any) => n.properties.objectName)).toEqual(['task']);
    expect(columns.relatedCount).toBe(1);
  });
});
