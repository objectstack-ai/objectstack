// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10638 — an interface page relays its source view's `hiddenFields`
 * and `fieldOrder`.
 *
 * ## The defect this pins
 *
 * An ADR-0047 interface page does not hand `ListView` the object's list views;
 * it builds ONE list schema itself, hand-projecting keys off the view its
 * `interfaceConfig.sourceView` resolves to (`filter`, `columns`, `sort`, …).
 * `hiddenFields` and `fieldOrder` — the subtraction and the ordering of the
 * per-view field composition — were not among them. So a source view that
 * authored either showed every column of its `columns`, in `columns` order:
 * declared by the protocol, accepted and served, then dropped at this page.
 * It is the objectui#7516 relay on the second door (`ObjectView` carries both
 * since that card).
 *
 * ## What the relay carries, and what it does not decide
 *
 * objectstack#15184 ruling B wrote the composition into the contract, per
 * view: `columns` projects, `hiddenFields` subtracts, `fieldOrder` sorts what
 * survives (an unlisted survivor sorts last). `ListView`'s `effectiveFields`
 * memo runs those steps on whatever it receives, so this page composes
 * nothing — it only delivers the view's two values beside the view's
 * `columns`.
 *
 * ## The precedence, and why it is whole-composition
 *
 * The page's column list resolves `page → source view → object default`, and
 * the two keys resolve with it, as one unit from one source:
 *
 * - the page's own `columns` win, and then NEITHER view key applies. The page
 *   config declares no spelling of either key (`InterfacePageConfigSchema` is
 *   strict), its `columns` is "defined directly on the page (no view
 *   inheritance)", and `sourceView` is "still honored at runtime as a fallback
 *   when the page has no own `columns`" — the spec's own words. It is also what
 *   keeps the design-mode column drag honest: that drag persists the order it
 *   drew as the page's `columns`, which a relayed view `fieldOrder` would
 *   re-sort straight back.
 * - else the view's `columns`, and its `hiddenFields` / `fieldOrder` with them;
 * - else the object-derived default columns, with neither key: an empty
 *   `columns` "declares no projection, so neither of them applies" (the spec,
 *   on `ListViewSchema.columns`).
 *
 * ## Why the schema is captured rather than rendered
 *
 * The claim is about what THIS page hands down, so `ListView` is stubbed and
 * its `schema` prop recorded — the posture of
 * `ObjectView.fieldOrderRelay-7516.test.tsx`. How the captured keys then shape
 * the columns is `plugin-list`'s half, and is not re-pinned here.
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
const VIEW_KEY = 'by_stage';

/** The view's projection — the H1 fixture's three columns, in this order. */
const VIEW_COLUMNS = ['name', 'owner', 'stage'];
const VIEW_HIDDEN = ['owner'];
const VIEW_FIELD_ORDER = ['stage', 'name'];
/** A page-level projection. Distinct from the view's so a crossed wire fails. */
const PAGE_COLUMNS = ['owner', 'name'];

function objectWith(view: Record<string, unknown>) {
  return {
    name: OBJECT_NAME,
    label: 'Task',
    fields: {
      name: { type: 'text', label: 'Name' },
      stage: { type: 'text', label: 'Stage' },
      owner: { type: 'text', label: 'Owner' },
    },
    listViews: {
      [`${OBJECT_NAME}.${VIEW_KEY}`]: {
        name: `${OBJECT_NAME}.${VIEW_KEY}`,
        label: 'By stage',
        type: 'grid',
        columns: VIEW_COLUMNS,
        ...view,
      },
    },
  };
}

function pageWith(cfg: Record<string, unknown> = {}) {
  return {
    name: 'duly_task_board',
    label: 'Task board',
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
  // waiting on `hiddenFields` itself would hang rather than fail on a
  // regression.
  await waitFor(() => {
    expect(captured?.columns).toBeTruthy();
  });
  return captured;
}

beforeEach(() => {
  cleanup();
  captured = null;
  testObjects = [];
});

describe("InterfaceListPage relays its source view's hiddenFields and fieldOrder (objectui#10638)", () => {
  it("THE FIX: the source view's `hiddenFields` reaches the renderer, verbatim", async () => {
    const schema = await relayed({ hiddenFields: VIEW_HIDDEN });
    expect(schema.hiddenFields).toEqual(VIEW_HIDDEN);
  });

  it("THE FIX: the source view's `fieldOrder` reaches the renderer, verbatim", async () => {
    // Verbatim, because the order IS the value: the page sorts nothing and
    // filters nothing — composing it with `columns` and `hiddenFields` is
    // `ListView`'s job.
    const schema = await relayed({ fieldOrder: VIEW_FIELD_ORDER });
    expect(schema.fieldOrder).toEqual(VIEW_FIELD_ORDER);
  });

  it("THE FIX: the view's whole composition arrives together — `columns`, `hiddenFields`, `fieldOrder`", async () => {
    // The card's first measurement, as a pin: before the relay this schema
    // carried the three columns and nothing else, so the page drew
    // name / owner / stage in `columns` order.
    const schema = await relayed({ hiddenFields: VIEW_HIDDEN, fieldOrder: VIEW_FIELD_ORDER });
    expect(schema.columns).toEqual(VIEW_COLUMNS);
    expect(schema.hiddenFields).toEqual(VIEW_HIDDEN);
    expect(schema.fieldOrder).toEqual(VIEW_FIELD_ORDER);
  });

  it("PRECEDENCE: the page's own `columns` replace the view's composition whole — neither view key applies", async () => {
    // Green on the base by construction (the base relays neither key); what
    // this case fails is a relay that ignores the precedence and lets the
    // view's `fieldOrder` re-sort, or its `hiddenFields` thin, a column list
    // the page defined for itself.
    const schema = await relayed(
      { hiddenFields: VIEW_HIDDEN, fieldOrder: VIEW_FIELD_ORDER },
      { columns: PAGE_COLUMNS },
    );
    expect(schema.columns).toEqual(PAGE_COLUMNS);
    expect('hiddenFields' in schema).toBe(false);
    expect('fieldOrder' in schema).toBe(false);
  });

  it('CONTROL: a view with an empty `columns` declares no projection — defaults are derived and neither key applies', async () => {
    const schema = await relayed({
      columns: [],
      hiddenFields: VIEW_HIDDEN,
      fieldOrder: VIEW_FIELD_ORDER,
    });
    // The object-derived default, not the view's (empty) list.
    expect(schema.columns).toEqual(['name', 'stage', 'owner']);
    expect('hiddenFields' in schema).toBe(false);
    expect('fieldOrder' in schema).toBe(false);
  });

  it('CONTROL: a view that authors neither key leaves the schema without them', async () => {
    // Absent, not `undefined`-valued: the schema's key set is what it was.
    const schema = await relayed({});
    expect(schema.columns).toEqual(VIEW_COLUMNS);
    expect('hiddenFields' in schema).toBe(false);
    expect('fieldOrder' in schema).toBe(false);
  });
});
