/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8980 — a READ POINT per protocol member a named list view declares.
 *
 * ## The card, and the ruling
 *
 * The protocol declares 17 live members on the value type of
 * `ViewSchema.listViews` / `ObjectSchema.listViews` (`ObjectListViewSchema`,
 * `@objectstack/spec/ui`) that `NamedListView` declared NONE of — objectui
 * NARROWER than the protocol, the direction the maintainer's standing principle
 * forbids. Director-seat class-one adjudication of 2026-09-13 ruled: declare all
 * 17 with their types taken from the protocol, and give each a read point IN THE
 * SAME DELIVERY. This file is that second half.
 *
 * ⛔ The declaration half is NOT re-pinned here; it lives with the census in
 * `packages/types/src/__tests__/object-view-unmirrored-keys-7779.test.ts`, which
 * partitions the interface into read and unread members (the counts are that
 * file's reading, re-derived on every run — not restated here) and fails in
 * EITHER direction when a member moves between them.
 *
 * ## objectui#10758 — the rest of the protocol members, on route 3
 *
 * Bucket ① of the objectui#7924 ruling: the protocol members a named view
 * declares that no route read off the named view. The delegation (route 3) now
 * reads each of them off the named view first. Their block is the last route-3
 * describe below: one named view per member FAMILY, with the members this file
 * already pinned riding the same fixture as the firing control.
 *
 * ## The three routes out of `ObjectView`, and which member uses which
 *
 * The component has three exits, and the card's members do not all leave by the
 * same one. Pinning only one of them would have left two thirds of the ruling
 * unmeasured.
 *
 *  1. `generateViewSchema` — the AUTHORED path for a non-grid view: no host
 *     supplied `renderListView`, so this is what the REGISTERED `object-view`
 *     renderer runs. Carries the 8 view-kind blocks to `ObjectKanban`,
 *     `ObjectCalendar`, `ObjectGallery`, `ObjectTimeline`, `ObjectGantt`,
 *     `ObjectMap`, `ObjectChart`, `ObjectTree`.
 *  2. `gridSchema` → `ObjectGrid` — the AUTHORED path for `type: 'grid'`, and
 *     the read point for `grouping` / `rowColor`, both of which `ObjectGrid`
 *     already reads (`collectGroupingFieldRefs(schema.grouping)`,
 *     `useRowColor(schema.rowColor)`).
 *  3. the `renderListView` delegation — the HOST path (objectui#5097), whose
 *     sink is `ListView`, the renderer that reads `fieldOrder`, `grouping`,
 *     `rowColor`, `userActions`, `appearance` and `data`.
 *
 * ## ⚠️ THREE MEMBERS ARE REPORTED, NOT WIRED — the ruling's own item 2
 *
 * "A member for which the renderer has no behaviour to attach is REPORTED on
 * this card with the measurement, ⛔ not silently declared inert and ⛔ not
 * dropped from the type."
 *
 *  - `tabs` and `pageName` — no reader on this surface at all. The last describe
 *    block below pins BOTH the absence and the control that makes it a reading.
 *  - `chart` / `tree` — READ (case 8 below proves it), but objectui#5321 ruled
 *    both view KINDS host-composition-only, so a named view reaches them only by
 *    declaring no `type` of its own while a host `views` entry selects one. That
 *    narrow route is pinned rather than described.
 *
 * ## Reverse verification — direction predicted BEFORE the run
 *
 * Each FIX case was predicted to go RED on the base tree (`bbc9dc34e3`), where
 * the canonical top-level blocks were undeclarable and none of the six relay /
 * grid rungs existed; each CONTROL case rides a rung this card did not touch and
 * was predicted GREEN. The asymmetry is the point: a control that moves with the
 * fix is a control that was carrying the fix. Measured outcome on the PR.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ObjectListViewSchema as SpecObjectListViewSchema } from '@objectstack/spec/ui';
import { ObjectView } from '../ObjectView';
import type { NamedListView, ObjectViewSchema } from '@object-ui/types';

/** Every node handed to SchemaRenderer, in order — route 1's sink. */
const rendered: any[] = [];
/** Every schema handed to ObjectGrid — route 2's sink. */
const gridSchemas: any[] = [];

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    },
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
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

const NODE = { type: 'object-view', objectName: 'task' } as unknown as ObjectViewSchema;

/**
 * ⚠️ `cleanup()` is load-bearing, not hygiene — the trap recorded on
 * objectui#9242: without it the previously mounted `ObjectView`s keep pushing
 * into the sinks, so the last entry answers the PREVIOUS fixture's question and
 * every reading comes back shifted by one.
 */
function resetSinks() {
  cleanup();
  rendered.length = 0;
  gridSchemas.length = 0;
}

/** Route 1 — the node `generateViewSchema` emits for a NAMED view. */
async function generatedNodeFor(view: NamedListView, views?: any[]): Promise<any> {
  resetSinks();
  render(
    <ObjectView
      schema={{ ...NODE, listViews: { v1: view } } as unknown as ObjectViewSchema}
      views={views}
      dataSource={dataSource()}
    />,
  );
  await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
  return rendered[rendered.length - 1];
}

/** Route 2 — the `object-grid` schema a `type: 'grid'` named view produces. */
async function gridSchemaFor(view: NamedListView): Promise<any> {
  resetSinks();
  render(
    <ObjectView
      schema={{ ...NODE, listViews: { v1: view } } as unknown as ObjectViewSchema}
      dataSource={dataSource()}
    />,
  );
  await waitFor(() => expect(gridSchemas.length).toBeGreaterThan(0));
  return gridSchemas[gridSchemas.length - 1];
}

/** Route 3 — the `list-view` schema the host delegation hands down. */
function delegatedSchemaFor(view: NamedListView, nodeExtra: Record<string, unknown> = {}): any {
  resetSinks();
  const seen: any[] = [];
  render(
    <ObjectView
      schema={{ ...NODE, ...nodeExtra, listViews: { v1: view } } as unknown as ObjectViewSchema}
      dataSource={dataSource()}
      renderListView={({ schema: s }: any) => {
        seen.push(s);
        return <div data-testid="delegated" />;
      }}
    />,
  );
  expect(seen.length).toBeGreaterThan(0);
  return seen[0];
}

beforeEach(resetSinks);

/* ─────────────────────────────────────────────────────────────────────────────
 * Route 1 — the eight view-KIND blocks, at the protocol's own top level
 * ────────────────────────────────────────────────────────────────────────── */

describe('objectui#8980 — a canonical top-level view-kind block reaches the renderer ObjectView dispatches to', () => {
  it('`kanban` → `object-kanban` (ObjectKanban)', async () => {
    const node = await generatedNodeFor({ label: 'Board', type: 'kanban', kanban: { groupByField: 'stage' } });
    expect(node.type).toBe('object-kanban');
    // The lane the branch resolves is the one the CANONICAL block declared.
    expect(node.groupBy).toBe('stage');
  });

  it('`calendar` → `object-calendar` (ObjectCalendar)', async () => {
    const node = await generatedNodeFor({ label: 'Cal', type: 'calendar', calendar: { startDateField: 'due_at' } });
    expect(node.type).toBe('object-calendar');
    expect(node.startDateField).toBe('due_at');
  });

  it('`gallery` → `object-gallery` (ObjectGallery)', async () => {
    const node = await generatedNodeFor({ label: 'Cards', type: 'gallery', gallery: { coverField: 'photo' } });
    expect(node.type).toBe('object-gallery');
    // Nested since objectui#12053: the node's own `gallery`, where
    // `ObjectGallery` reads the cover binding.
    expect(node.gallery.coverField).toBe('photo');
  });

  it('`timeline` → `object-timeline` (ObjectTimeline)', async () => {
    const node = await generatedNodeFor({ label: 'Feed', type: 'timeline', timeline: { startDateField: 'created_at' } });
    expect(node.type).toBe('object-timeline');
    expect(node.startDateField).toBe('created_at');
  });

  it('`gantt` → `object-gantt` (ObjectGantt)', async () => {
    // ⚠️ `titleField` is not decoration here: unlike the four blocks this
    // package keeps a local `.partial()` dialect for, `gantt` flows into the
    // mirror straight from `SpecListViewSchema.shape`, so the protocol's own
    // three required bindings are required on the declared face too. Measured
    // by tsc while this file was written — the fixture without it does not
    // compile, which is the narrowing being declared rather than described.
    const node = await generatedNodeFor({
      label: 'Plan',
      type: 'gantt',
      gantt: { startDateField: 'start_at', endDateField: 'end_at', titleField: 'subject' },
    });
    expect(node.type).toBe('object-gantt');
    expect(node.startDateField).toBe('start_at');
    expect(node.endDateField).toBe('end_at');
  });

  it('`map` → `object-map` (ObjectMap)', async () => {
    const node = await generatedNodeFor({ label: 'Where', type: 'map', map: { latitudeField: 'lat', longitudeField: 'lng' } });
    expect(node.type).toBe('object-map');
    expect(node.latitudeField).toBe('lat');
    expect(node.longitudeField).toBe('lng');
  });

  it('`chart` and `tree` are READ, on the ONE route objectui#5321 leaves open to a named view', async () => {
    // ⚠️ Neither kind is a member of `NamedListView['type']`, so a named view
    // cannot select the branch itself. It reaches it by declaring no `type`
    // while a host `views` entry selects one — and the CONFIG still comes off
    // the named view, which is what makes the declaration meaningful. This is
    // the reachability reading reported on objectui#8980; ⛔ not a reason to
    // drop either member from the type.
    // ⚠️ MEASURED WHILE WRITING THIS FILE, and reported on objectui#8980: the
    // protocol's chart config is the ADR-0021 DATASET-BOUND shape alone
    // (`dataset` + `values`, required). The renderer carried a legacy
    // inline-aggregate branch below it (`xAxisField` / `valueField` /
    // `aggregation`) that the declared face could not express — tsc refused
    // the fixture. That was the protocol narrowing a legacy escape hatch,
    // ⛔ not a defect in this declaration, and ⛔ not licence to widen the type
    // locally. objectui#6152 round 15 retired that branch on every route: a
    // chart block naming no `dataset` now builds the unbound node, which
    // `ObjectChart` refuses on screen (a named view's own `options.chart` bag
    // is folded at `ViewPreview` since objectui#7928, onto this same block).
    const chartNode = await generatedNodeFor(
      { label: 'Agg', chart: { dataset: 'deals_by_stage', dimensions: ['stage'], values: ['amount'], chartType: 'line' } },
      [{ id: 'c', label: 'Agg', type: 'chart' }],
    );
    expect(chartNode.type).toBe('object-chart');
    expect(chartNode.chartType).toBe('line');
    expect(chartNode.dataset).toBe('deals_by_stage');
    expect(chartNode.xAxisKey).toBe('stage');

    const treeNode = await generatedNodeFor(
      { label: 'Tree', tree: { parentField: 'parent_id' } },
      [{ id: 't', label: 'Tree', type: 'tree' }],
    );
    expect(treeNode.type).toBe('object-tree');
    expect(treeNode.parentField).toBe('parent_id');
  });
});

/*
 * ⭐ objectui#7928 INVERTED this block (director ruling, comment 5856694523,
 * Q1 A; ⛔ no assertion deleted). A named view's legacy `options.KIND` bag is
 * refused by the contract (`ObjectViewSchema.listViews` is the protocol's strict
 * record by reference) and is NO LONGER READ here. The per-key merge these
 * cases pinned moved to the one door that relays a STORED body into a named
 * view, `@object-ui/app-shell`'s `ViewPreview` (`foldStoredListOptions`), and
 * is pinned there, through this same renderer, in
 * `ViewPreview.optionsFold-7928.test.tsx`. Each case below asserts what the
 * renderer does with the bag now; the fold file asserts the lane it used to
 * resolve still resolves.
 */
describe('objectui#8980 → objectui#7928 — the legacy `options.<kind>` nesting is no longer read off a named view; the canonical block is the only source', () => {
  it('INVERTED: the legacy nesting alone no longer resolves the lane — the fold at `ViewPreview` does (objectui#7928)', async () => {
    // Was the firing control for every canonical case above ("the legacy
    // nesting alone still resolves the lane"). The canonical cases keep their
    // own control: the `kanban` case at the top of this file.
    const node = await generatedNodeFor({ label: 'Board', type: 'kanban', options: { kanban: { groupByField: 'legacy_lane' } } } as any);
    expect(node.groupBy).not.toBe('legacy_lane');
    // The branch's own floor, which is what a view with no lane declared gets.
    expect(node.groupBy).toBe('status');
  });

  it('the canonical block WINS for a key both spell — here because the bag is not read; the per-key rule itself is the fold\'s', async () => {
    const node = await generatedNodeFor({
      label: 'Board',
      type: 'kanban',
      kanban: { groupByField: 'canonical_lane' },
      options: { kanban: { groupByField: 'legacy_lane' } },
    } as any);
    expect(node.groupBy).toBe('canonical_lane');
    expect(node.groupBy).not.toBe('legacy_lane');
  });

  it('INVERTED: a key only the legacy nesting spells does NOT survive off a named view — the per-key merge is the fold\'s now (objectui#7928)', async () => {
    // Was "survives from the legacy nesting — the merge is per-key, not
    // wholesale". The stored population that mixes the two spellings is still
    // protected: `foldStoredListOptions` merges per key before the body becomes
    // a named view, and `ViewPreview.optionsFold-7928.test.tsx` asserts this
    // exact `titleField` through this renderer.
    const node = await generatedNodeFor({
      label: 'Board',
      type: 'kanban',
      kanban: { groupByField: 'canonical_lane' },
      options: { kanban: { titleField: 'subject' } },
    } as any);
    expect(node.groupBy).toBe('canonical_lane');
    expect(node.titleField).not.toBe('subject');
    // The branch's own default, which is what an undeclared title gets.
    expect(node.titleField).toBe('name');
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Route 2 — the authored grid path
 * ────────────────────────────────────────────────────────────────────────── */

describe('objectui#8980 — `grouping` and `rowColor` reach ObjectGrid from a named view', () => {
  const GROUPING = { fields: [{ field: 'owner' }] };
  const ROW_COLOR = { field: 'stage', colors: { won: '#16a34a' } };

  it('THE FIX: both keys arrive on the `object-grid` schema', async () => {
    const grid = await gridSchemaFor({ label: 'All', type: 'grid', grouping: GROUPING, rowColor: ROW_COLOR } as any);
    expect(grid.type).toBe('object-grid');
    expect(grid.grouping).toEqual(GROUPING);
    expect(grid.rowColor).toEqual(ROW_COLOR);
  });

  it('ABSENCE CONTROL: a named view that declares neither leaves both undefined — the value before this card, for every document', async () => {
    const grid = await gridSchemaFor({ label: 'All', type: 'grid' });
    expect(grid.grouping).toBeUndefined();
    expect(grid.rowColor).toBeUndefined();
    // …and the rest of the grid schema is still assembled, so the absence above
    // is a reading of these two keys and not of a renderer that never ran.
    expect(grid.objectName).toBe('task');
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Route 3 — the host delegation, whose sink is `ListView`
 * ────────────────────────────────────────────────────────────────────────── */

describe('objectui#8980 — the host delegation relays the named view\'s protocol keys', () => {
  const VIEW: NamedListView = {
    label: 'All',
    type: 'grid',
    data: { provider: 'api' } as any,
    fieldOrder: ['name', 'stage'],
    grouping: { fields: [{ field: 'owner' }] } as any,
    rowColor: { field: 'stage' } as any,
    userActions: { group: true } as any,
    appearance: { showDescription: false } as any,
  };

  it('THE FIX: all six reach the `list-view` schema the host receives', () => {
    const s = delegatedSchemaFor(VIEW);
    expect(s.type).toBe('list-view');
    expect(s.data).toEqual({ provider: 'api' });
    expect(s.fieldOrder).toEqual(['name', 'stage']);
    expect(s.grouping).toEqual({ fields: [{ field: 'owner' }] });
    expect(s.rowColor).toEqual({ field: 'stage' });
    expect(s.appearance).toEqual({ showDescription: false });
    expect(s.userActions.group).toBe(true);
  });

  it('`userActions` MERGES rather than replaces — a named view toggling one action does not blank the node\'s others', () => {
    // Spread, not `??`. This slot is a merge of toggle sets: the node's legacy
    // `show*` flags fold into it through `normalizeListViewSchema`, and a named
    // view that sets `group` must not delete the `search: false` the node set.
    const s = delegatedSchemaFor(VIEW, { showSearch: false });
    expect(s.userActions.group).toBe(true);
    expect(s.userActions.search).toBe(false);
  });

  it('ABSENCE CONTROL: with none of the six declared, every slot reads undefined and the relay still runs', () => {
    const s = delegatedSchemaFor({ label: 'All', type: 'grid', columns: ['name'] });
    expect(s.fieldOrder).toBeUndefined();
    expect(s.appearance).toBeUndefined();
    expect(s.grouping).toBeUndefined();
    expect(s.rowColor).toBeUndefined();
    // The firing control on the same object: a rung this card did not touch.
    expect(s.columns).toEqual(['name']);
  });

  it('`data` is relayed WITHOUT the `as any` cast on the named-view config — objectui#7928\'s open half', () => {
    // The cast is gone from the source; this is the behavioural half of the
    // same fact. The source half is pinned in the types census
    // (`object-view-unmirrored-keys-7779.test.ts`).
    const s = delegatedSchemaFor({ label: 'All', type: 'grid', data: { provider: 'api' } as any });
    expect(s.data).toEqual({ provider: 'api' });
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Route 3, continued — objectui#10758: bucket ① of the objectui#7924 ruling
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * One entry of `ObjectViewSchema.listViews` — the protocol's strict
 * `ObjectListViewSchema` by reference (objectui#7928). The fixtures below are
 * typed as it, and each is also PARSED by the protocol's own schema, so every
 * value on the named-view side is one a conforming author can write.
 */
type SpecNamedView = NonNullable<ObjectViewSchema['listViews']>[string];

/**
 * The same member, three values: the one the NAMED view authors, the one the
 * host `views` entry carries, and the one on the object-view NODE. Distinct on
 * purpose, so the value that arrives names the source it came from.
 */
type Sources = { named: unknown; host: unknown; node: unknown };

/**
 * The members of bucket ①, grouped into FAMILIES — one named view each, as the
 * card asks. The grouping is by what the member configures on the rendered
 * list; `ListView` (the delegation's sink) reads every one of them off the
 * `list-view` node it is handed, directly or through the grid it renders.
 *
 * ⚠️ Four members have NO node rung, so their `node` value must never arrive:
 * the three rungs objectui#10758 added (`description`, `exportOptions`,
 * `bulkActionDefs`) and `rowHeight` (the host entry through the fold, since
 * objectui#7924's ruling A′). Adding a node read for any of them would add a
 * name to the objectui#5097 HOST-COMPOSITION exemption the 2026-08-18 ruling
 * fixed at 27 — a ruling, not a refactor. {@link NO_NODE_RUNG}.
 */
const FAMILIES: Record<string, Record<string, Sources>> = {
  'list chrome': {
    description: { named: 'Open work only', host: 'Host description', node: 'Node description' },
    compactToolbar: { named: true, host: false, node: true },
    allowPrinting: { named: true, host: false, node: true },
    showRecordCount: { named: false, host: true, node: false },
    sharing: { named: { type: 'collaborative' }, host: { type: 'personal' }, node: { type: 'personal', lockedBy: 'node' } },
    aria: { named: { ariaLabel: 'Named tasks' }, host: { ariaLabel: 'Host tasks' }, node: { ariaLabel: 'Node tasks' } },
    emptyState: { named: { title: 'Named empty' }, host: { title: 'Host empty' }, node: { title: 'Node empty' } },
  },
  'record actions': {
    addRecord: { named: { enabled: true, position: 'bottom' }, host: { enabled: false }, node: { enabled: true, position: 'top' } },
    inlineEdit: { named: true, host: false, node: true },
    rowActions: { named: ['archive'], host: ['host_row'], node: ['node_row'] },
    bulkActions: { named: ['delete'], host: ['host_bulk'], node: ['node_bulk'] },
    bulkActionDefs: {
      named: [{ name: 'close_all', label: 'Close all', operation: 'update', patch: { stage: 'closed' } }],
      host: [{ name: 'host_def', label: 'Host', operation: 'delete' }],
      node: [{ name: 'node_def', label: 'Node', operation: 'delete' }],
    },
    exportOptions: { named: { formats: ['csv'] }, host: { formats: ['json'] }, node: { formats: ['xlsx'] } },
  },
  'grid presentation': {
    rowHeight: { named: 'tall', host: 'short', node: 'extra_tall' },
    pagination: { named: { pageSize: 5 }, host: { pageSize: 50 }, node: { pageSize: 100 } },
    selection: { named: { type: 'single' }, host: { type: 'multiple' }, node: { type: 'none' } },
    resizable: { named: true, host: false, node: true },
    hiddenFields: { named: ['secret'], host: ['host_hidden'], node: ['node_hidden'] },
    conditionalFormatting: {
      named: [{ condition: "stage == 'won'", style: { backgroundColor: '#dcfce7' } }],
      host: [{ condition: "stage == 'lost'", style: { backgroundColor: '#fee2e2' } }],
      node: [{ condition: "stage == 'open'", style: { backgroundColor: '#e0f2fe' } }],
    },
  },
  'search, filter and navigation': {
    searchableFields: { named: ['subject'], host: ['host_search'], node: ['node_search'] },
    // `filterableFields` rode this family until objectui#13118: the spec
    // retires it (objectstack#24640, ruling C) and no source relays it now —
    // pinned by its own row below the families.
    userFilters: {
      named: { element: 'dropdown', fields: [{ field: 'stage' }] },
      host: { element: 'dropdown', fields: [{ field: 'owner' }] },
      node: { element: 'dropdown', fields: [{ field: 'node_field' }] },
    },
    navigation: { named: { mode: 'drawer' }, host: { mode: 'modal' }, node: { mode: 'page' } },
  },
};

const NO_NODE_RUNG = ['bulkActionDefs', 'description', 'exportOptions', 'rowHeight'];

/** Every bucket-① member, across the families. */
const BUCKET_ONE = Object.values(FAMILIES).flatMap((f) => Object.keys(f)).sort();

/** The part of a family one source carries. */
const valuesOf = (family: Record<string, Sources>, source: keyof Sources): Record<string, unknown> =>
  Object.fromEntries(Object.entries(family).map(([k, v]) => [k, v[source]]));

/**
 * Route 3 with all three sources in play: the named view (`listViews`), the
 * host `views` entry, and the node. Whatever the host receives is what it
 * renders — the `list-view` node handed to `renderListView` is the input of the
 * rendered list, and nothing between this call and `ListView` rewrites it.
 */
/** The `list-view` node a host receives — read by key, so an index shape is all it needs. */
type HandedDown = Record<string, unknown>;

function delegatedWithSources(view: SpecNamedView, host: Record<string, unknown> | null, node: Record<string, unknown>): HandedDown {
  resetSinks();
  const seen: HandedDown[] = [];
  render(
    <ObjectView
      schema={{ ...NODE, ...node, listViews: { v1: view } } as unknown as ObjectViewSchema}
      views={host ? [{ id: 'h', label: 'Host', type: 'grid' as const, ...host }] : undefined}
      dataSource={dataSource()}
      renderListView={({ schema: s }: { schema: HandedDown }) => {
        seen.push(s);
        return <div data-testid="delegated" />;
      }}
    />,
  );
  expect(seen.length).toBeGreaterThan(0);
  return seen[0];
}

/**
 * The members this file already pinned on route 3 before objectui#10758, riding
 * every fixture below as the FIRING CONTROL: they arrive from the named view on
 * the same render, so a family that reads undefined is a reading of that
 * family, not of a relay that never ran or a named view that was not selected.
 */
const CONTROL: SpecNamedView = {
  label: 'Open work',
  type: 'grid',
  columns: ['subject', 'stage'],
  fieldOrder: ['stage', 'subject'],
  grouping: { fields: [{ field: 'owner' }] },
};

function expectControl(s: HandedDown) {
  expect(s.type).toBe('list-view');
  expect(s.label).toBe('Open work');
  expect(s.columns).toEqual(['subject', 'stage']);
  expect(s.fieldOrder).toEqual(['stage', 'subject']);
  expect(s.grouping).toEqual({ fields: [{ field: 'owner' }] });
}

describe('objectui#10758 — the host delegation reads bucket ① off the named view, one named view per member family', () => {
  it('the families cover bucket ① exactly once, and every member is a protocol member of a named view', () => {
    // 23 is the ruling's figure (objectui#7924, comment 5690906005); 22 since
    // objectui#13118 retired `filterableFields`, which the spec retires and no
    // source relays (its own row below). The types census re-derives the
    // partition on every run, so this is the fixture's coverage, not a second
    // census.
    expect(BUCKET_ONE).toHaveLength(22);
    expect(new Set(BUCKET_ONE).size).toBe(22);
    expect(BUCKET_ONE).not.toContain('filterableFields');
    const protocol = Object.keys(SpecObjectListViewSchema.shape);
    expect(BUCKET_ONE.filter((m) => !protocol.includes(m))).toEqual([]);
    // Control on the same query: a key the protocol does NOT declare on a
    // named view (objectui's own `allowExport`, a tombstone since
    // objectui#11013) is refused by it.
    expect(protocol).not.toContain('allowExport');
  });

  describe.each(Object.entries(FAMILIES))('family: %s', (_name, family) => {
    const namedView = (): SpecNamedView => ({ ...CONTROL, ...valuesOf(family, 'named') } as SpecNamedView);

    it('the named view is a PROTOCOL document — the strict `ObjectListViewSchema` parses it, so a conforming author can write every value', () => {
      const r = SpecObjectListViewSchema.safeParse(namedView());
      expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    });

    it('THE FIX: the named view\'s value reaches the rendered list — it wins over the host `views` entry and the node', () => {
      const s = delegatedWithSources(namedView(), valuesOf(family, 'host'), valuesOf(family, 'node'));
      expectControl(s);
      for (const [member, v] of Object.entries(family)) {
        expect(s[member], `\`${member}\` did not arrive from the named view`).toEqual(v.named);
      }
    });

    it('CONTROL: with the family absent from the named view, the host `views` entry supplies it — the rung before this card, and the fallback of the three rungs it added', () => {
      const s = delegatedWithSources({ ...CONTROL }, valuesOf(family, 'host'), valuesOf(family, 'node'));
      expectControl(s);
      for (const [member, v] of Object.entries(family)) {
        expect(s[member], `\`${member}\` no longer arrives from the host \`views\` entry`).toEqual(v.host);
      }
    });

    it('CONTROL: with neither view declaring it, the node still supplies it — except on the four rungs with no node read', () => {
      const s = delegatedWithSources({ ...CONTROL }, null, valuesOf(family, 'node'));
      expectControl(s);
      for (const [member, v] of Object.entries(family)) {
        if (NO_NODE_RUNG.includes(member)) {
          // View-sourced only: the node's value must NOT arrive. This is the
          // behavioural half of "no new `(schema as any)` read"; the source
          // half is `objectViewHostSurface.test.tsx`.
          expect(s[member], `\`${member}\` is now read off the object-view NODE`).toBeUndefined();
        } else {
          expect(s[member], `\`${member}\` no longer arrives from the node`).toEqual(v.node);
        }
      }
    });
  });

  it('RETIRED (objectui#13118) — `filterableFields` reaches the list from no source: not the named view, not the host entry, not the node', () => {
    // It was a bucket-① member read named view first, then the host entry,
    // then the node. `@objectstack/spec` 18 retires it (objectstack#24640,
    // ruling C) and no per-view Filter-panel whitelist replaces it, so all
    // three rungs went with the `ListView` reader they fed. The control rides
    // the same render: the named view's other members still arrive.
    const retired: Record<string, unknown> = { filterableFields: ['stage'] };
    const s = delegatedWithSources(
      { ...CONTROL, ...retired } as SpecNamedView,
      { filterableFields: ['host_filter'] },
      { filterableFields: ['node_filter'] },
    );
    expectControl(s);
    expect(s).not.toHaveProperty('filterableFields');
  });

  it('`rowHeight`: the named view is read as ITSELF, and the host entry still goes through the fold', () => {
    // The fold (objectui#7924, ruling A′) maps a stored host entry's retired
    // `densityMode` onto `rowHeight`. The named view needs no fold — the strict
    // record refuses `densityMode` — so a named `rowHeight` wins outright, and
    // with none the host entry's retired spelling still arrives canonical.
    expect(delegatedWithSources({ ...CONTROL, rowHeight: 'tall' }, { densityMode: 'compact' }, {}).rowHeight).toBe('tall');
    expect(delegatedWithSources({ ...CONTROL }, { densityMode: 'compact' }, {}).rowHeight).toBe('compact');
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * `name` — the tab strip's display fallback
 * ────────────────────────────────────────────────────────────────────────── */

describe('objectui#8980 — `name` is read on the named-view tab strip', () => {
  const twoViews = (v1: NamedListView) => ({ ...NODE, listViews: { v1, v2: { label: 'Other', type: 'grid' } } } as unknown as ObjectViewSchema);

  it('THE FIX: a view declaring `name` and no `label` shows the NAME, not the record key', async () => {
    resetSinks();
    const { findByText } = render(<ObjectView schema={twoViews({ name: 'my_deals', type: 'grid' } as any)} dataSource={dataSource()} />);
    expect(await findByText('my_deals')).toBeTruthy();
  });

  it('PRECEDENCE CONTROL: `label` still wins over `name` — the existing rung is untouched', async () => {
    resetSinks();
    const { findByText, queryByText } = render(
      <ObjectView schema={twoViews({ label: 'My Deals', name: 'my_deals', type: 'grid' } as any)} dataSource={dataSource()} />,
    );
    expect(await findByText('My Deals')).toBeTruthy();
    expect(queryByText('my_deals')).toBeNull();
  });

  it('KEY CONTROL: with neither, the record key is still the label — the value before this card', async () => {
    resetSinks();
    const { findByText } = render(<ObjectView schema={twoViews({ type: 'grid' } as any)} dataSource={dataSource()} />);
    expect(await findByText('v1')).toBeTruthy();
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * The REPORTED members — ruling item 2's "no behaviour to attach" clause
 * ────────────────────────────────────────────────────────────────────────── */

describe('objectui#8980 — `tabs` and `pageName` are declared and NOT read here, which is the ruled outcome', () => {
  it('neither reaches the host delegation, and the control on the same object fires', () => {
    // ⭐ The measurement the ruling requires to be REPORTED rather than silently
    // absorbed. `tabs` on the list shape is the `ViewTabSchema[]` multi-tab
    // definition list (⛔ NOT `userFilters.tabs`, which `ObjectUserFiltersSchema`
    // omits as page-only); objectui's tab bar for an object is the HOST-owned
    // saved-view switcher (ADR-0053), so nothing on this surface reads it.
    // `pageName` configures the protocol's `type: 'page'` branch, and `page` is
    // not a member of `NamedListView['type']`, so no authored named view can
    // select it.
    //
    // ⛔ Do NOT "fix" this by relaying the keys: a rung with no reader behind it
    // is objectui#7924's defect pointed the other way. Either the reader lands
    // on its own card, or the protocol card the report feeds decides otherwise.
    const s = delegatedSchemaFor({
      label: 'All',
      type: 'grid',
      columns: ['name'],
      tabs: [{ name: 'open' }] as any,
      pageName: 'deals_page' as any,
    });
    expect(s.tabs).toBeUndefined();
    expect(s.pageName).toBeUndefined();
    // The firing control: a key declared on the SAME fixture that the same relay
    // does carry. Without it these two `undefined`s are an unrun probe.
    expect(s.columns).toEqual(['name']);
  });
});
