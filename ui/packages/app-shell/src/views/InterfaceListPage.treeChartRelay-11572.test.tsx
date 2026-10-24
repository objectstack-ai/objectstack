// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11572 — an interface page relays its source view's `tree` and
 * `chart` blocks, and its own `allowPrinting`.
 *
 * ## The defect this pins
 *
 * An ADR-0047 interface page builds ONE list schema itself, hand-projecting
 * keys off the view its `interfaceConfig.sourceView` resolves to. The
 * visualization comes from `appearance.allowedVisualizations`, and the spec's
 * `VisualizationTypeSchema` admits `tree` and `chart`, so a page may whitelist
 * either and `viewType` becomes that kind. But the projection carried the
 * per-kind blocks of `kanban`, `calendar`, `gallery`, `timeline`, `gantt` and
 * `map` only. A stored `{ type: 'tree', tree: { parentField: 'parent_id' } }`
 * row (the block the console's `CreateViewDialog` writes) reached `ListView`
 * with `viewType: 'tree'` and no `tree`, so the tree branch never saw its
 * `parentField`; a `chart` row lost its block the same way. The object page
 * relays both, so one stored view rendered two ways.
 *
 * The page config's own `allowPrinting` ("Allow users to print the page",
 * declared on `InterfacePageConfigSchema`) was dropped the same way: `ListView`
 * draws its print button off `schema.allowPrinting`, and nothing on this page
 * wrote it. The census beside this file
 * (`InterfaceListPage.relayCensus-11572.test.ts`) is what found it.
 *
 * ## What the relay carries, and what it does not decide
 *
 * The declared block, verbatim, as `kanban` / `timeline` are carried. There is
 * no page-derived default for either kind — nothing here can guess a parent
 * pointer or a measure — so the `derives(kind)` rule (objectui#10380) has
 * nothing to gate, and a whitelisted kind with no declared block reaches
 * `ListView` with no block at all, exactly as before. How the block then
 * renders (`schema.tree || schema.options.tree`, and the chart binding) is
 * `plugin-list`'s half, pinned there, and not re-pinned here.
 *
 * ## Why the schema is captured rather than rendered
 *
 * The claim is about what THIS page hands down, so `ListView` is stubbed and
 * its `schema` prop recorded — the posture of
 * `InterfaceListPage.viewFieldKeysRelay-10638.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return {
    ...actual,
    useObjectTranslation: () => ({ t: (_k: string, o?: any) => o?.defaultValue ?? _k }),
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return { ...actual, useAuth: () => ({}) };
});

/** The list schema this page hands down — captured, not rendered. */
let captured: any = null;
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => {
    captured = props.schema;
    return null;
  },
}));

let testObjects: any[];

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return {
    ...actual,
    useAdapter: () => ({}),
    useMetadata: () => ({ objects: testObjects }),
  };
});

import { InterfaceListPage } from './InterfaceListPage';

const OBJECT_NAME = 'duly_task';
const VIEW_KEY = 'source';
const VIEW_COLUMNS = ['name', 'status', 'amount'];

/** The block `CreateViewDialog` writes for a tree view: the parent pointer alone. */
const TREE_BLOCK = { parentField: 'parent_id' };
/** A spec-valid ADR-0021 chart block (the spec's view schema refuses the legacy axes). */
const CHART_BLOCK = { dataset: 'ds_duly_task', dimensions: ['status'], values: ['amount'] };
/** A legacy `options` bag block, distinct from the top-level ones so a crossed wire fails. */
const BAG_TREE = { parentField: 'legacy_parent' };

function objectWith(view: Record<string, unknown>) {
  return {
    name: OBJECT_NAME,
    label: 'Task',
    fields: {
      name: { type: 'text', label: 'Name' },
      status: { type: 'select', label: 'Status' },
      amount: { type: 'number', label: 'Amount' },
      parent_id: { type: 'lookup', label: 'Parent', reference: OBJECT_NAME },
    },
    listViews: {
      [`${OBJECT_NAME}.${VIEW_KEY}`]: {
        name: `${OBJECT_NAME}.${VIEW_KEY}`,
        label: 'Source',
        type: 'grid',
        columns: VIEW_COLUMNS,
        ...view,
      },
    },
  };
}

function pageWith(cfg: Record<string, unknown> = {}) {
  return {
    name: 'duly_task_page',
    label: 'Task page',
    interfaceConfig: {
      source: OBJECT_NAME,
      sourceView: VIEW_KEY,
      recordAction: 'none',
      ...cfg,
    },
  };
}

/** Render the page and return the whole schema it handed `ListView`. */
async function relayed(view: Record<string, unknown>, cfg?: Record<string, unknown>): Promise<any> {
  captured = null;
  testObjects = [objectWith(view)];
  render(<InterfaceListPage page={pageWith(cfg) as any} />);
  // `columns` is written unconditionally by the same object literal as the
  // keys under test, so its arrival is the signal the page built its schema —
  // waiting on `tree` itself would hang rather than fail on a regression.
  await waitFor(() => {
    expect(captured?.columns).toBeTruthy();
  });
  return captured;
}

const whitelisting = (...kinds: string[]) => ({ appearance: { allowedVisualizations: kinds } });

beforeEach(() => {
  cleanup();
  captured = null;
  testObjects = [];
});

describe("InterfaceListPage relays its source view's tree and chart blocks (objectui#11572)", () => {
  it("THE FIX: a whitelisted tree reaches the renderer with the view's declared `tree` block, verbatim", async () => {
    // The card's measurement, as a pin: before the relay this schema carried
    // `viewType: 'tree'` and no `tree`, so the tree branch got no parentField.
    const schema = await relayed({ type: 'tree', tree: TREE_BLOCK }, whitelisting('tree'));
    expect(schema.viewType).toBe('tree');
    expect(schema.tree).toEqual(TREE_BLOCK);
  });

  it("THE FIX: a whitelisted chart reaches the renderer with the view's declared `chart` block, whole", async () => {
    // Whole, not a projection of its keys: the object page forwards the block
    // as a pointer (objectui#7823), so this page must not re-list its keys.
    const schema = await relayed({ type: 'chart', chart: CHART_BLOCK }, whitelisting('chart'));
    expect(schema.viewType).toBe('chart');
    expect(schema.chart).toEqual(CHART_BLOCK);
  });

  it('THE FIX: the blocks travel whichever kind is shown first, as the per-kind blocks do', async () => {
    // A switcher page: `viewType` is `grid`, and the tree and chart entries
    // still need their bindings for `ListView`'s capability gate to offer them.
    const schema = await relayed(
      { tree: TREE_BLOCK, chart: CHART_BLOCK },
      whitelisting('grid', 'tree', 'chart'),
    );
    expect(schema.viewType).toBe('grid');
    expect(schema.tree).toEqual(TREE_BLOCK);
    expect(schema.chart).toEqual(CHART_BLOCK);
  });

  it("PRECEDENCE: a row carrying both its own block and the legacy bag's sends both, and `ListView` lays the block over the bag", async () => {
    // The bag is forwarded verbatim under `options` (objectui#10380); the
    // block goes out at the top level, the slot `ListView` reads first.
    const schema = await relayed(
      { type: 'tree', tree: TREE_BLOCK, options: { tree: BAG_TREE } },
      whitelisting('tree'),
    );
    expect(schema.tree).toEqual(TREE_BLOCK);
    expect(schema.options?.tree).toEqual(BAG_TREE);
  });

  it('CONTROL: a row whose only tree config is the legacy bag sends no top-level block — the bag rules alone', async () => {
    // Green on the base by construction. What it fails is a relay that writes
    // `tree: undefined` or an empty block, which would read as a second source.
    const schema = await relayed({ type: 'tree', options: { tree: BAG_TREE } }, whitelisting('tree'));
    expect('tree' in schema).toBe(false);
    expect(schema.options?.tree).toEqual(BAG_TREE);
  });

  it('CONTROL: no page-derived default exists for either kind — a whitelisted kind with no declared block gets no invented one', async () => {
    // The `derives(kind)` rule gates a page-derived default, and there is none
    // for a parent pointer or a chart measure. A guess here would outrank
    // nothing and bind the wrong field.
    const schema = await relayed({}, whitelisting('tree', 'chart'));
    expect('tree' in schema).toBe(false);
    expect('chart' in schema).toBe(false);
  });

  it('CONTROL: a view that authors neither block leaves the schema without them', async () => {
    // Absent, not `undefined`-valued: the schema's key set is what it was.
    const schema = await relayed({});
    expect('tree' in schema).toBe(false);
    expect('chart' in schema).toBe(false);
  });
});

describe("InterfaceListPage relays the page config's own `allowPrinting` (objectui#11572)", () => {
  it("THE FIX: the page's `allowPrinting` reaches the renderer", async () => {
    const schema = await relayed({}, { allowPrinting: true });
    expect(schema.allowPrinting).toBe(true);
  });

  it("CONTROL: the source view's `allowPrinting` does not stand in for the page's — it is page presentation policy", async () => {
    // The same rule as its siblings `showRecordCount` and `addRecord`: the
    // page config declares the key, so the page's own value is the only one.
    const schema = await relayed({ allowPrinting: true });
    expect(schema.allowPrinting).toBeUndefined();
  });
});
