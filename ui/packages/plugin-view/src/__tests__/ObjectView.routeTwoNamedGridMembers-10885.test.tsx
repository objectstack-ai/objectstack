/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10885 member 1 — route 2 reads a named view's GRID MEMBERS.
 *
 * `index.tsx` registers `object-view` as `ObjectView` with no `renderListView`,
 * so an authored node, and the Studio's `ViewPreview`, take route 2: the
 * `object-grid` node `ObjectView` builds (`gridSchema`) and hands `ObjectGrid`.
 * PR objectui#10884 (objectui#10758) made the HOST delegation read bucket ① of
 * the objectui#7924 ruling off the named view. Route 2 read `columns`, `filter`,
 * `sort`, `grouping` and `rowColor` off it and nothing else.
 *
 * This file mounts the REGISTERED renderer through the real `SchemaRenderer` and
 * registry, and reads the node `ObjectGrid` receives.
 *
 * ## Which bucket-① members route 2 takes, measured rather than listed
 *
 * A member is taken when the protocol declares it on a named view AND on
 * `object-grid`, under the same name, and `ObjectGrid` reads it. The first
 * describe below derives both declarations from the installed protocol. Three
 * bucket-① members are handled apart from that rule:
 *
 *  - `hiddenFields` — declared on the named view, NOT on `object-grid`, and
 *    `ObjectGrid` has no read of it. It is honoured as the protocol composes it:
 *    subtracted from the column projection route 2 hands the grid.
 *  - `navigation` — declared on both, but `ObjectView` hands `ObjectGrid` its own
 *    `onRowClick`, and the grid's navigation hook obeys that first. Relayed, the
 *    member would be read by nothing on this route, so it is not relayed;
 *    since member 4 the handler route 2 passes reads it
 *    (`ObjectView.namedViewNavigation-10885.test.tsx`).
 *  - `inlineEdit` — `object-grid` declares it as `editable`; since member 4
 *    route 2 hands it over under that name
 *    (`ObjectView.namedViewInlineEdit-10885.test.tsx`).
 *
 * The rest of bucket ① (`addRecord`, `allowPrinting`, `aria`, `compactToolbar`,
 * `description`, `emptyState`, `sharing`, `showRecordCount`, `userFilters`) is
 * list chrome `ListView` draws; `filterableFields` was among it until
 * objectui#13118 retired it with the spec, and nothing reads it now. `object-grid`
 * does not declare it under the same name, so route 2 has no slot to read it
 * into.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ComponentPropsMap, ObjectListViewSchema as SpecObjectListViewSchema } from '@objectstack/spec/ui';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Module scope, not a hook: this import IS the `object-view` registration.
import '../index';

/** Every schema handed to `ObjectGrid` — route 2's sink. */
const gridSchemas: any[] = [];

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: ({ schema }: any) => {
    gridSchemas.push(schema);
    return <div data-testid="object-grid" />;
  },
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

const dataSource = (): any => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
});

/**
 * ⚠️ `cleanup()` is load-bearing: without it a previously mounted view keeps
 * pushing into the sink, and the last entry answers the previous fixture (the
 * objectui#9242 trap).
 */
function resetSink() {
  cleanup();
  gridSchemas.length = 0;
}

beforeEach(resetSink);

/**
 * The bucket-① members route 2 relays, each with a named-view value and a node
 * value. This card gained no node read: only `table.pagination` and
 * `table.selection` were read off the node then. objectui#10976 made the node's
 * `table` the fallback of every other member too (its relay), so the node value
 * now arrives when the named view is silent, and still loses when it speaks.
 */
const MEMBERS: Record<string, { named: unknown; table: unknown }> = {
  pagination: { named: { pageSize: 5, pageSizeOptions: [5, 10] }, table: { pageSize: 100 } },
  selection: { named: { type: 'single' }, table: { type: 'multiple' } },
  rowHeight: { named: 'tall', table: 'extra_tall' },
  resizable: { named: false, table: true },
  searchableFields: { named: ['subject'], table: ['node_search'] },
  conditionalFormatting: {
    named: [{ condition: "stage == 'won'", style: { backgroundColor: '#dcfce7' } }],
    table: [{ condition: "stage == 'open'", style: { backgroundColor: '#e0f2fe' } }],
  },
  rowActions: { named: ['archive'], table: ['node_row'] },
  bulkActions: { named: ['delete'], table: ['node_bulk'] },
  bulkActionDefs: {
    named: [{ name: 'close_all', label: 'Close all', operation: 'update', patch: { stage: 'closed' } }],
    table: [{ name: 'node_def', label: 'Node', operation: 'delete' }],
  },
  exportOptions: { named: { formats: ['csv'] }, table: { formats: ['xlsx'] } },
};

/** The members whose node rung route 2 already had before objectui#10976 — `table.KEY`. */
const NODE_RUNG = ['pagination', 'selection'];

const pick = (source: 'named' | 'table'): Record<string, unknown> =>
  Object.fromEntries(Object.entries(MEMBERS).map(([k, v]) => [k, v[source]]));

/**
 * The members route 2 read off a named view before this card, riding every
 * fixture as the FIRING CONTROL: they arrive on the same render, so a member
 * that reads `undefined` is a reading of that member, not of a named view that
 * was never selected.
 */
const CONTROL = {
  label: 'Open work',
  type: 'grid',
  columns: ['subject', 'stage'],
  sort: [{ field: 'stage', order: 'desc' }],
  grouping: { fields: [{ field: 'owner' }] },
};

function expectControl(s: any) {
  expect(s.type).toBe('object-grid');
  expect(s.columns).toEqual(['subject', 'stage']);
  expect(s.fields).toEqual(['subject', 'stage']);
  expect(s.sort).toEqual([{ field: 'stage', order: 'desc' }]);
  expect(s.grouping).toEqual({ fields: [{ field: 'owner' }] });
}

/**
 * The node `ObjectGrid` receives when the REGISTERED `object-view` renderer
 * draws `view` as the active named view — through `SchemaRenderer`, so no
 * `renderListView` is in play.
 */
async function gridNodeThroughRenderer(view: Record<string, unknown>, table?: Record<string, unknown>): Promise<any> {
  resetSink();
  render(
    <SchemaRendererProvider dataSource={dataSource()}>
      <SchemaRenderer
        schema={{
          type: 'object-view',
          objectName: 'task',
          defaultListView: 'v1',
          listViews: { v1: view },
          ...(table ? { table } : {}),
        } as any}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(gridSchemas.length).toBeGreaterThan(0));
  return gridSchemas[gridSchemas.length - 1];
}

describe('objectui#10885 — the member set route 2 takes, derived from the installed protocol', () => {
  const namedView = Object.keys(SpecObjectListViewSchema.shape);
  const grid = Object.keys((ComponentPropsMap['object-grid'] as unknown as { shape: Record<string, unknown> }).shape);

  it('every relayed member is declared on a named view AND on `object-grid`, under the same name', () => {
    const members = Object.keys(MEMBERS);
    expect(members.filter((m) => !namedView.includes(m))).toEqual([]);
    expect(members.filter((m) => !grid.includes(m))).toEqual([]);
    // Control on the same two lists: objectui's own `allowExport` (ruled on
    // objectui#7924) is on neither, so "none missing" is a reading.
    expect(namedView).not.toContain('allowExport');
    expect(grid).not.toContain('allowExport');
  });

  it('`hiddenFields` is a named-view member `object-grid` does not declare — so it is applied, not relayed', () => {
    expect(namedView).toContain('hiddenFields');
    expect(grid).not.toContain('hiddenFields');
  });

  it('the named view carrying every relayed member is a PROTOCOL document — the strict `ObjectListViewSchema` parses it', () => {
    const r = SpecObjectListViewSchema.safeParse({ ...CONTROL, ...pick('named'), hiddenFields: ['stage'] });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });
});

describe('objectui#10885 — through the registered `object-view` renderer, route 2 reads each grid member off the named view', () => {
  it('THE FIX: each member\'s named value reaches `ObjectGrid`, and wins over the node', async () => {
    const s = await gridNodeThroughRenderer({ ...CONTROL, ...pick('named') }, pick('table'));
    expectControl(s);
    for (const [member, v] of Object.entries(MEMBERS)) {
      expect(s[member], `\`${member}\` did not arrive from the named view`).toEqual(v.named);
    }
  });

  it('`exportOptions` in the protocol\'s legacy bare-array spelling reaches the grid in the slot\'s shape — the protocol\'s own lift', async () => {
    // The protocol accepts a bare format array on a named view and lifts it to
    // `{ formats }` at parse. `ObjectGrid` reads `exportOptions.formats`, which
    // an array does not have, so the node carries the lifted shape.
    expect(SpecObjectListViewSchema.shape.exportOptions.parse(['xlsx'])).toEqual({ formats: ['xlsx'] });
    const s = await gridNodeThroughRenderer({ ...CONTROL, exportOptions: ['xlsx'] });
    expectControl(s);
    expect(s.exportOptions).toEqual({ formats: ['xlsx'] });
  });

  it('CONTROL: with the members absent from the named view, the node\'s `table` applies — for every member since objectui#10976', async () => {
    // Before objectui#10976 only `NODE_RUNG` arrived here and the rest read
    // `undefined`: the slot typed them and route 2 copied none. The relay made
    // the node's `table` every member's fallback; the named view still wins
    // above.
    const s = await gridNodeThroughRenderer({ ...CONTROL }, pick('table'));
    expectControl(s);
    for (const [member, v] of Object.entries(MEMBERS)) {
      const since = NODE_RUNG.includes(member) ? 'objectui#10885' : 'objectui#10976';
      expect(s[member], `\`${member}\` does not arrive from the node's \`table\` (a rung since ${since})`).toEqual(v.table);
    }
  });
});

describe('objectui#10885 — `hiddenFields` subtracts from the projection route 2 hands the grid', () => {
  it('THE FIX: a hidden field leaves both the `fields` and the `columns` slot, and no `hiddenFields` key reaches the grid', async () => {
    const s = await gridNodeThroughRenderer({ ...CONTROL, columns: ['subject', 'amount', 'stage'], hiddenFields: ['amount'] });
    expect(s.fields).toEqual(['subject', 'stage']);
    expect(s.columns).toEqual(['subject', 'stage']);
    expect(s).not.toHaveProperty('hiddenFields');
  });

  it('an object-shaped column keeps its shape — only the hidden entry is dropped', async () => {
    const s = await gridNodeThroughRenderer({
      ...CONTROL,
      columns: [{ field: 'subject', width: 240 }, { field: 'amount' }],
      hiddenFields: ['amount'],
    });
    expect(s.columns).toEqual([{ field: 'subject', width: 240 }]);
    expect(s.fields).toEqual(['subject']);
  });

  it('the projection the named view does not declare is narrowed too — the node\'s `table.columns` loses the hidden field', async () => {
    const { columns: _none, ...noColumns } = CONTROL;
    const s = await gridNodeThroughRenderer({ ...noColumns, hiddenFields: ['amount'] }, { columns: ['subject', 'amount'] });
    expect(s.columns).toEqual(['subject']);
  });

  it('with no projection anywhere, nothing is invented — the grid derives its own columns', async () => {
    const { columns: _none, ...noColumns } = CONTROL;
    const s = await gridNodeThroughRenderer({ ...noColumns, hiddenFields: ['amount'] });
    expect(s.columns).toBeUndefined();
    expect(s.fields).toBeUndefined();
  });

  it('every projected field hidden keeps the empty projection the author wrote', async () => {
    const s = await gridNodeThroughRenderer({ ...CONTROL, hiddenFields: ['subject', 'stage'] });
    expect(s.columns).toEqual([]);
    expect(s.fields).toEqual([]);
  });
});
