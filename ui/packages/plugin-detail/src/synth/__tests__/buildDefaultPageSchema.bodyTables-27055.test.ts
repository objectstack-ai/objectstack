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
 * AFTER the field sections the page draws open (objectstack#35742: the
 * record's own fields first, then its master-detail tables; objectstack#35597
 * placed it before every section, objectstack#27069 after the FIRST one);
 * several stack in the order given. The sections drawn closed that trail the
 * last open one follow the tables. Every other
 * list is a tab of its own (objectstack#35595, which retired the one `Related`
 * tab). A field group whose `relatedList` names a body table's
 * relationship places that table at the group's position instead
 * (objectstack#27069, objectstack#27241).
 */

import { describe, expect, it } from 'vitest';
import { BODY_TABLE_PAGE_SIZE, buildDefaultHighlights, buildDefaultPageSchema, buildDefaultTabs } from '../buildDefaultPageSchema';
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
const tabOf = (tabs: any, value: string) => items(tabs).find((i: any) => i.value === value);
const shape = (nodes: any[]) =>
  nodes.map((n) =>
    n.type === 'record:details'
      ? `details(${(n.properties?.sections ?? []).map((s: any) => s.label ?? s.group).join(',')})`
      : `${n.type === 'record:related_list' ? 'table' : n.type}(${n.properties.objectName})`,
  );

describe('body tables sit in the Details tab after the field sections (objectstack#27055, objectstack#35742)', () => {
  it('splits the details around the body tables; each side list takes a tab of its own (objectstack#35595)', () => {
    const tabs = buildDefaultTabs(quoteDef, { sections: SECTIONS, related: [LINES, TASKS, SCHEDULE] });
    // 动态 is last for every object (objectstack#34590).
    expect(items(tabs).map((i: any) => i.value)).toEqual(['details', 'related:task.quote', 'timeline']);
    expect(shape(items(tabs)[0].children)).toEqual([
      'details(Basic,Terms,Notes)',
      'table(quote_line_item)',
      'table(quote_schedule)',
    ]);
    expect(tabOf(tabs, 'related:task.quote').children.map((n: any) => n.properties.objectName)).toEqual(['task']);
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
    // A side list is a tab of its own, second after 概览 (objectstack#35595).
    expect(items(asSide)[1].value).toBe('related:task.quote');
  });

  it('with one section the tables follow it', () => {
    const tabs = buildDefaultTabs(quoteDef, { sections: SECTIONS.slice(0, 1), related: [LINES] });
    expect(shape(items(tabs)[0].children)).toEqual(['details(Basic)', 'table(quote_line_item)']);
  });

  it('with no section the details node (the highlight fields) leads and the tables follow it', () => {
    const tabs = buildDefaultTabs({ name: 'quote', fields: quoteDef.fields }, { related: [LINES, SCHEDULE] });
    expect(shape(items(tabs)[0].children)).toEqual(['details()', 'table(quote_line_item)', 'table(quote_schedule)']);
  });

  it('a body table takes no tab of its own: only the side lists do (objectstack#35595)', () => {
    const tabs = buildDefaultTabs(quoteDef, { sections: SECTIONS, related: [{ ...TASKS, isPrimary: true }, LINES] });
    expect(items(tabs).some((i: any) => String(i.value).startsWith('related:'))).toBe(false);
    // CONTROL: the same list as a side list is a tab.
    const side = buildDefaultTabs(quoteDef, { sections: SECTIONS, related: [TASKS, LINES] });
    expect(items(side).map((i: any) => i.value)).toEqual(['details', 'related:task.quote', 'timeline']);
  });
});

describe('the page knows its body tables', () => {
  const page = buildDefaultPageSchema(quoteDef, { sections: SECTIONS, related: [LINES, TASKS] });

  it('bodyTableIdsOf reads them off the Details tab', () => {
    expect([...bodyTableIdsOf(page)]).toEqual(['quote_line_item.quote']);
  });

  it('the laid-out page draws them in the details column, side lists as the right column\'s panels', () => {
    const columns = buildDefaultPageColumns(page)!;
    expect(shape(columns.details)).toEqual(['details(Basic,Terms,Notes)', 'table(quote_line_item)']);
    expect(columns.related.map((n: any) => n.properties.objectName)).toEqual(['task']);
  });
});

describe('a field group places a body table at its position (objectstack#27069, objectstack#27241)', () => {
  // 基本信息 · 条款 · [明细行] · 备注 — the author put the line items after the terms.
  const placed = (entry: string, groupsOrder = ['basic', 'terms', 'lines', 'notes']) => ({
    name: 'quote',
    fields: {
      name: { type: 'text', label: 'Name', group: 'basic' },
      terms: { type: 'textarea', label: 'Terms', group: 'terms' },
      notes: { type: 'textarea', label: 'Notes', group: 'notes' },
    },
    fieldGroups: groupsOrder.map((key) => (key === 'lines' ? { key, label: 'Lines', relatedList: entry } : { key, label: key })),
  });
  const detailsOf = (def: any, related: any[]) => shape(items(buildDefaultTabs(def, { related }))[0].children);

  it('the table named by a group (child object name) sits at that group; the others keep "after the sections"', () => {
    expect(detailsOf(placed('quote_line_item'), [LINES, SCHEDULE])).toEqual([
      'details(basic,terms)',
      'table(quote_line_item)',
      'details(notes)',
      'table(quote_schedule)',
    ]);
  });

  it('an `object.field` entry names the one FK; an entry naming another FK places nothing', () => {
    expect(detailsOf(placed('quote_line_item.quote'), [LINES])).toEqual([
      'details(basic,terms)',
      'table(quote_line_item)',
      'details(notes)',
    ]);
    expect(detailsOf(placed('quote_line_item.other_fk'), [LINES])).toEqual([
      'details(basic,terms,notes)',
      'table(quote_line_item)',
    ]);
  });

  it('a group declared before every field group puts its table first', () => {
    expect(detailsOf(placed('quote_line_item', ['lines', 'basic', 'terms', 'notes']), [LINES])).toEqual([
      'table(quote_line_item)',
      'details(basic,terms,notes)',
    ]);
  });

  it('a group declared last puts its table after every field section', () => {
    expect(detailsOf(placed('quote_line_item', ['basic', 'terms', 'notes', 'lines']), [LINES])).toEqual([
      'details(basic,terms,notes)',
      'table(quote_line_item)',
    ]);
  });

  it('a group only positions a body table: naming a side card promotes nothing (objectstack#27478)', () => {
    // The spec refuses this group (`isBodyTableRelationship`, ruling B on
    // objectstack#27055); the renderer never second-guesses body-ness either.
    const tabs = buildDefaultTabs(placed('task'), { related: [LINES, TASKS] });
    expect(shape(items(tabs)[0].children)).toEqual(['details(basic,terms,notes)', 'table(quote_line_item)']);
    expect(tabOf(tabs, 'related:task.quote').children.map((n: any) => n.properties.objectName)).toEqual(['task']);
  });

  it('the host-passed sections place the same way (the `{ group }` sections RecordDetailView passes)', () => {
    const def = placed('quote_line_item');
    // The `{ group }` reference form, as the host writes it (the options type
    // names the enumerated form only).
    const sections: Array<Record<string, unknown>> = [{ group: 'basic' }, { group: 'terms' }, { group: 'notes' }];
    expect(shape(items(buildDefaultTabs(def, { sections, related: [LINES] }))[0].children)).toEqual([
      'details(basic,terms)',
      'table(quote_line_item)',
      'details(notes)',
    ]);
  });
});

describe("the record's own fields lead the Overview, its master-detail tables follow (objectstack#35742)", () => {
  // A meeting: no stage field, no key fields, one master-detail child.
  const meetingDef = {
    name: 'meeting',
    fields: {
      subject: { type: 'text', label: 'Subject', group: 'basic' },
      owner: { type: 'text', label: 'Owner', group: 'basic' },
      meeting_date: { type: 'date', label: 'Date', group: 'basic' },
      location: { type: 'text', label: 'Location', group: 'basic' },
    },
    fieldGroups: [{ key: 'basic', label: 'Basic' }],
  };
  const TODOS = { objectName: 'meeting_todo', relationshipField: 'meeting', title: 'To-dos', isBody: true };
  const columnsOf = (def: any, options: any) => buildDefaultPageColumns(buildDefaultPageSchema(def, options))!;
  const stripShape = (nodes: any[]) => nodes.map((n) => n.type);

  it('an object with no stage bar and no key fields draws its field groups first, the body table under them', () => {
    const columns = columnsOf(meetingDef, { related: [TODOS] });
    expect(stripShape(columns.strip)).toEqual([]);
    expect(shape(columns.details)).toEqual(['details(basic)', 'table(meeting_todo)']);
  });

  it('declared key fields draw no strip (objectstack#35891): the field groups, then the body table', () => {
    const columns = columnsOf({ ...meetingDef, highlightFields: ['owner', 'meeting_date'] }, { related: [TODOS] });
    expect(stripShape(columns.strip)).toEqual([]);
    expect(shape(columns.details)).toEqual(['details(basic)', 'table(meeting_todo)']);
  });

  it('a slotted strip (key fields, stage) still leads: the strip, the field groups, the body table', () => {
    const staged = {
      ...meetingDef,
      highlightFields: ['owner'],
      fields: {
        ...meetingDef.fields,
        status: {
          type: 'select',
          label: 'Status',
          group: 'basic',
          options: [{ value: 'planned', label: 'Planned' }, { value: 'held', label: 'Held' }],
        },
      },
    };
    const columns = columnsOf(staged, {
      related: [TODOS],
      slots: { highlights: buildDefaultHighlights(staged, { statusField: 'status' }) },
    });
    expect(stripShape(columns.strip)).toEqual(['record:highlights', 'record:path']);
    expect(shape(columns.details)).toEqual(['details(basic)', 'table(meeting_todo)']);
  });

  describe('a section drawn closed that trails the open ones follows the tables (common fields first)', () => {
    const grouped = (collapses: Record<string, 'collapsed' | 'expanded'>) => ({
      name: 'quote',
      fields: {
        name: { type: 'text', label: 'Name', group: 'basic' },
        terms: { type: 'textarea', label: 'Terms', group: 'terms' },
        notes: { type: 'textarea', label: 'Notes', group: 'notes' },
      },
      fieldGroups: ['basic', 'terms', 'notes'].map((key) =>
        collapses[key] ? { key, label: key, collapse: collapses[key] } : { key, label: key }),
    });

    it('a trailing `collapsed` group (the `{ group }` reference form) follows the tables', () => {
      expect(shape(items(buildDefaultTabs(grouped({ notes: 'collapsed' }), { related: [LINES] }))[0].children)).toEqual([
        'details(basic,terms)',
        'table(quote_line_item)',
        'details(notes)',
      ]);
    });

    it('a closed group between two open ones keeps its declared place before the tables', () => {
      expect(shape(items(buildDefaultTabs(grouped({ terms: 'collapsed' }), { related: [LINES] }))[0].children)).toEqual([
        'details(basic,terms,notes)',
        'table(quote_line_item)',
      ]);
    });

    it('an `expanded` group (collapsible, open when the page opens) is a common one: it stays before the tables', () => {
      expect(shape(items(buildDefaultTabs(grouped({ notes: 'expanded' }), { related: [LINES] }))[0].children)).toEqual([
        'details(basic,terms,notes)',
        'table(quote_line_item)',
      ]);
    });

    it('with every section closed the tables follow them all: the record still leads', () => {
      const allClosed = grouped({ basic: 'collapsed', terms: 'collapsed', notes: 'collapsed' });
      expect(shape(items(buildDefaultTabs(allClosed, { related: [LINES] }))[0].children)).toEqual([
        'details(basic,terms,notes)',
        'table(quote_line_item)',
      ]);
    });

    it('the enumerated form the host passes: `collapsible` + `defaultCollapsed` trails, an open "More details" leads', () => {
      const closedMore = [
        { label: 'Basic', fields: ['name'] },
        { label: 'More details', collapsible: true, defaultCollapsed: true, fields: ['terms', 'notes'] },
      ];
      expect(shape(items(buildDefaultTabs(quoteDef, { sections: closedMore, related: [LINES] }))[0].children)).toEqual([
        'details(Basic)',
        'table(quote_line_item)',
        'details(More details)',
      ]);
      // The host's "More details" (`deriveRecordDetailSections`) opens
      // expanded, so it is drawn open and stays before the tables.
      const openMore = [closedMore[0], { ...closedMore[1], defaultCollapsed: false }];
      expect(shape(items(buildDefaultTabs(quoteDef, { sections: openMore, related: [LINES] }))[0].children)).toEqual([
        'details(Basic,More details)',
        'table(quote_line_item)',
      ]);
    });

    it('a group-placed table keeps its group position ahead of the trailing closed group', () => {
      const def = {
        ...grouped({ notes: 'collapsed' }),
        fieldGroups: [
          { key: 'basic', label: 'basic' },
          { key: 'lines', label: 'Lines', relatedList: 'quote_line_item' },
          { key: 'terms', label: 'terms' },
          { key: 'notes', label: 'notes', collapse: 'collapsed' as const },
        ],
      };
      expect(shape(items(buildDefaultTabs(def, { related: [LINES, SCHEDULE] }))[0].children)).toEqual([
        'details(basic)',
        'table(quote_line_item)',
        'details(terms)',
        'table(quote_schedule)',
        'details(notes)',
      ]);
    });
  });

  it('CONTROL: an object with no body table draws one details node, and a side list never joins the Overview', () => {
    const columns = columnsOf(meetingDef, { related: [{ ...TODOS, isBody: false }] });
    expect(shape(columns.details)).toEqual(['details(basic)']);
    expect(columns.related.map((n: any) => n.properties.objectName)).toEqual(['meeting_todo']);
  });
});
