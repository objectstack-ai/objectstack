/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10976 — every key the `object-view` `table` slot types reaches the
 * grid `ObjectView` draws.
 *
 * `ObjectViewSchema.table` declared every `ObjectGridSchema` member but the two
 * identity keys, and the grid node `ObjectView` builds (route 2: the registered
 * renderer, no `renderListView`) copied a fixed handful of them. So
 * `table: { editable: true }` — and `frozenColumns`, `rowHeight`, `rowActions`
 * and the rest — type-checked and did nothing. The card's ruling: relay what
 * `ObjectGrid` honours, and withhold the rest from the slot.
 *
 * This file mounts the REGISTERED renderer through the real `SchemaRenderer`
 * and registry, and reads the node `ObjectGrid` receives. It pins:
 *
 *  1. completeness, at COMPILE time: every key the slot declares is either read
 *     by name, relayed (`OBJECT_VIEW_TABLE_RELAY_KEYS`), or one of the three
 *     retirement tombstones. A key added to the slot and handed to nothing is a
 *     `tsc` error here (`pnpm --filter @object-ui/plugin-view type-check`);
 *  2. arrival, at RUNTIME: one render carries every relayed and by-name key,
 *     and each arrives on the grid node;
 *  3. precedence: a named view that declares the same member wins over `table`;
 *  4. nothing invented: a `table` that writes none of the relayed keys hands
 *     the grid none of them;
 *  5. the withheld keys stay withheld: authored anyway (past the type), none
 *     reaches the grid.
 *
 * The withheld set, and the validator's by-name refusal of it, are pinned in
 * `@object-ui/types` (`object-view-slot-key-lists.test.ts`). The end-to-end
 * effect of the card's headline key on the REAL grid is
 * `ObjectView.tableEditable-10976.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ObjectViewSchema } from '@object-ui/types';
// Module scope, not a hook: this import IS the `object-view` registration.
import '../index';
import { OBJECT_VIEW_TABLE_RELAY_KEYS } from '../ObjectView';

/** A grid node as the probe records it: read key by key. */
type GridNode = Record<string, unknown>;

/** Every schema handed to `ObjectGrid` — route 2's sink. */
const gridSchemas: GridNode[] = [];

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: ({ schema }: { schema: GridNode }) => {
    gridSchemas.push(schema);
    return <div data-testid="object-grid" />;
  },
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

const dataSource = (): DataSource => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
}) as unknown as DataSource;

/** ⚠️ `cleanup()` is load-bearing: a view left mounted keeps pushing into the sink. */
function resetSink() {
  cleanup();
  gridSchemas.length = 0;
}

beforeEach(resetSink);

/* ── 1. Completeness — compile time ─────────────────────────────────────────── */

type TableSlot = NonNullable<ObjectViewSchema['table']>;
type SlotKey = keyof TableSlot;
type RelayKey = (typeof OBJECT_VIEW_TABLE_RELAY_KEYS)[number];

/** The keys the grid-node build reads off `table` BY NAME (not through the relay). */
type ByNameKey =
  | 'className' | 'columns' | 'fields' | 'filter' | 'operations'
  | 'pageSize' | 'pagination' | 'selectable' | 'selection' | 'sort' | 'title';

/**
 * `ObjectGridSchema`'s own retirement tombstones, which type no value an author
 * can write. `defaultFilters` joined them with `@objectstack/spec` 18
 * (objectstack#11509), when this component stopped reading it by name
 * (objectui#12030).
 */
type TombstoneKey = 'body' | 'children' | 'defaultFilters' | 'defaultSort';

/**
 * ⭐ The compile-time pins. Each alias resolves to `never` when the claim holds;
 * assigning `true` to the conditional then type-checks, and fails otherwise.
 *  - `Unclassified`: a slot key handed to nothing — the card's defect.
 *  - `Overlap`: a key both relayed and read by name — two writers of one slot.
 *  - `Phantom`: a by-name or tombstone key the slot does not declare — a stale list here.
 */
type Unclassified = Exclude<SlotKey, RelayKey | ByNameKey | TombstoneKey>;
type Overlap = Extract<RelayKey, ByNameKey | TombstoneKey>;
type Phantom = Exclude<ByNameKey | TombstoneKey, SlotKey>;
const everySlotKeyIsHandedToTheGrid: [Unclassified] extends [never] ? true : Unclassified = true;
const noKeyHasTwoWriters: [Overlap] extends [never] ? true : Overlap = true;
const theListsNameOnlySlotKeys: [Phantom] extends [never] ? true : Phantom = true;

/**
 * One authored value per relayed key. `Required<Pick<…>>` makes a new relay key
 * without a sample a compile error, so section 2 cannot silently skip one.
 */
const RELAYED: Required<Pick<TableSlot, RelayKey>> = {
  aggregations: [{ field: 'amount', type: 'sum' }],
  bulkActionDefs: [{ name: 'close_all', label: 'Close all', operation: 'update', patch: { stage: 'closed' } }],
  bulkActions: ['archive'],
  conditionalFormatting: [{ condition: "stage == 'won'", style: { backgroundColor: '#dcfce7' } }],
  editable: true,
  exportOptions: { formats: ['xlsx'] },
  frozenColumns: 2,
  grouping: { fields: [{ field: 'owner', order: 'asc' }] },
  label: 'All tasks',
  reorderableColumns: true,
  resizable: false,
  rowActions: ['edit', 'archive'],
  rowColor: { field: 'stage', colors: { won: '#16a34a' } },
  rowHeight: 'tall',
  searchableFields: ['subject'],
  showColumnTypeIcons: true,
  showPagination: false,
  showSearch: false,
  singleClickEdit: true,
};

/**
 * `table.defaultFilters` as metadata written before `@objectstack/spec` 18
 * carried it: the `filter` rule array. The slot's declaration is the tombstone
 * now (objectstack#11509), so the sample is cast past it; nothing reads it
 * (objectui#12030), which the case below pins.
 */
const RETIRED_DEFAULT_FILTERS = [{ field: 'stage', operator: 'equals', value: 'lost' }];

/** One authored value per by-name key, each copied onto the node unchanged. */
const BY_NAME: Required<Pick<TableSlot, Exclude<ByNameKey, 'operations'>>> = {
  className: 'table-probe',
  columns: ['subject', 'stage'],
  fields: ['subject', 'stage'],
  filter: [{ field: 'stage', operator: 'equals', value: 'open' }],
  pageSize: 50,
  pagination: { pageSize: 25 },
  selectable: 'multiple',
  selection: { type: 'multiple' },
  sort: [{ field: 'subject', order: 'asc' }],
  title: 'Tasks',
};

/**
 * The node `ObjectGrid` receives from the REGISTERED renderer — through
 * `SchemaRenderer`, so no `renderListView` is in play.
 */
async function gridNode(extra: Record<string, unknown>): Promise<GridNode> {
  resetSink();
  render(
    <SchemaRendererProvider dataSource={dataSource()}>
      <SchemaRenderer schema={{ type: 'object-view', objectName: 'task', ...extra } as never} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(gridSchemas.length).toBeGreaterThan(0));
  return gridSchemas[gridSchemas.length - 1];
}

describe('objectui#10976 — the slot\'s keys are classified (compile-time pins, read at runtime too)', () => {
  it('every slot key is read by name, relayed, or a tombstone — and no key has two writers', () => {
    expect(everySlotKeyIsHandedToTheGrid).toBe(true);
    expect(noKeyHasTwoWriters).toBe(true);
    expect(theListsNameOnlySlotKeys).toBe(true);
  });

  it('the relay list has no duplicate, and its samples cover it exactly', () => {
    expect(new Set(OBJECT_VIEW_TABLE_RELAY_KEYS).size).toBe(OBJECT_VIEW_TABLE_RELAY_KEYS.length);
    expect(Object.keys(RELAYED).sort()).toEqual([...OBJECT_VIEW_TABLE_RELAY_KEYS].sort());
  });
});

/* ── 2. Arrival — every relayed and by-name key reaches the grid node ───────── */

describe('objectui#10976 — a key written on `table` reaches the grid `ObjectView` draws', () => {
  it('THE FIX: each relayed key arrives on the `object-grid` node as authored', async () => {
    const s = await gridNode({ table: { ...RELAYED, pagination: { pageSize: 25 } } });
    expect(s.type).toBe('object-grid');
    for (const [key, value] of Object.entries(RELAYED)) {
      expect(s[key], `\`table.${key}\` did not reach the grid`).toEqual(value);
    }
    // LIT CONTROL on the same render: a key this build copied before the card.
    expect(s.pagination).toEqual({ pageSize: 25 });
  });

  it('CONTROL: each by-name key still arrives, and `operations` still merges the view\'s `create: false`', async () => {
    const s = await gridNode({ table: { ...BY_NAME, operations: { update: false } } });
    for (const [key, value] of Object.entries(BY_NAME)) {
      expect(s[key], `\`table.${key}\` no longer reaches the grid`).toEqual(value);
    }
    expect(s.defaultFilters).toBeUndefined();
    expect(s.operations).toMatchObject({ update: false, create: false });
  });

  it('a retired `table.defaultFilters` arrives in neither slot, even with `table.filter` absent (objectui#12030)', async () => {
    const s = await gridNode({ table: { defaultFilters: RETIRED_DEFAULT_FILTERS } as unknown as TableSlot });
    expect(s.filter).toBeUndefined();
    expect(s.defaultFilters).toBeUndefined();
  });
});

/* ── 3. Precedence — a named view's member wins over `table` ────────────────── */

describe('objectui#10976 — the active named view outranks `table` where it declares the member', () => {
  it('a named `rowHeight` / `rowActions` / `inlineEdit` wins; a key the named view lacks falls back to `table`', async () => {
    const s = await gridNode({
      defaultListView: 'v1',
      listViews: {
        v1: { label: 'Open', type: 'grid', columns: ['subject'], rowHeight: 'short', rowActions: ['archive'], inlineEdit: false },
      },
      table: { rowHeight: 'tall', rowActions: ['edit'], editable: true, frozenColumns: 3, grouping: { fields: [{ field: 'owner', order: 'asc' }] } },
    });
    expect(s.rowHeight).toBe('short');
    expect(s.rowActions).toEqual(['archive']);
    // `inlineEdit: false` is a declared value, so it wins over `table.editable`.
    expect(s.editable).toBe(false);
    // Not declared on the named view: the node's `table` is the fallback.
    expect(s.frozenColumns).toBe(3);
    expect(s.grouping).toEqual({ fields: [{ field: 'owner', order: 'asc' }] });
  });
});

/* ── 4. Nothing invented ────────────────────────────────────────────────────── */

describe('objectui#10976 — a `table` that writes none of the relayed keys hands the grid none of them', () => {
  it('every relayed slot reads `undefined`, while the by-name `columns` still arrives', async () => {
    const s = await gridNode({ table: { columns: ['subject'] } });
    for (const key of OBJECT_VIEW_TABLE_RELAY_KEYS) {
      expect(s[key], `\`${key}\` was invented for a table that did not write it`).toBeUndefined();
    }
    // The firing control: the render ran, and it read `table`.
    expect(s.columns).toEqual(['subject']);
  });
});

/* ── 5. The withheld keys stay withheld ─────────────────────────────────────── */

describe('objectui#10976 — a withheld key written past the type reaches nothing', () => {
  // One per withheld reason; the full set and its by-name refusal are pinned in
  // `@object-ui/types`. Authored through a cast, because `tsc` refuses them.
  const WITHHELD = {
    emptyState: { title: 'Nothing here' },
    showFilters: false,
    description: 'Every open task',
    keyboardNavigation: false,
    staticData: [{ id: 'x' }],
    navigation: { mode: 'page' },
    batchActions: ['archive'],
    resizableColumns: false,
    testId: 'probe',
  };

  it('none of them arrives on the grid node', async () => {
    const s = await gridNode({ table: { columns: ['subject'], ...WITHHELD } });
    for (const key of Object.keys(WITHHELD)) {
      expect(s, `withheld \`table.${key}\` reached the grid`).not.toHaveProperty(key);
    }
    expect(s.columns).toEqual(['subject']);
  });
});
