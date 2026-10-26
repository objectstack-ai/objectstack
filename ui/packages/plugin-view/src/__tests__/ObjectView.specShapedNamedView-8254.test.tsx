/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8254 — `ObjectView` honours a SPEC-SHAPED named list view.
 *
 * ## The card, and the ordering it inherits
 *
 * objectui#7928's ruling (decision batch #70, option A) mirrors
 * `ObjectViewSchema.listViews` BY REFERENCE onto the protocol's
 * `ObjectListViewSchema` (`@objectstack/spec/ui`) — the direction already ruled
 * for `navigation` / `searchableFields` / `filterableFields` on objectui#7779.
 * That ruling also fixes the ORDER: ⛔ the mirror is never shipped as a
 * type-only edit, because a declaration that admits a shape the renderer drops
 * is a contract the product does not keep. This file is the renderer half, and
 * it is written so the mirror can land after it without a single new assertion.
 *
 * ## THE FIXTURE IS SPEC-SHAPED BY CONSTRUCTION, NOT BY ASSERTION
 *
 * {@link SPEC_VIEW} is built by running `ObjectListViewSchema.parse(...)`. A
 * fixture that merely LOOKS spec-shaped pins the author's memory of the
 * protocol; one that has been through the protocol's own parser cannot drift
 * from it, and when the protocol moves this file fails at construction time
 * with the parser's own message rather than passing while testing the wrong
 * shape. The schema is `.strict()` upstream, so the parse is also what proves
 * the fixture carries no local-dialect key.
 *
 * ## BOTH LEGS RIDE ONE FIXTURE, SIDE BY SIDE
 *
 * Every case below resolves the spec-shaped view and {@link LOCAL_VIEW} — the
 * equivalent written in the local `NamedListView` dialect — through the SAME
 * route and asserts them against each other in the same `expect`. The card asks
 * that "a spec-shaped named view renders the same columns/filter as the
 * equivalent local one did"; asserting the two against a hard-coded literal in
 * two separate cases would let both drift together and still pass. Equivalence
 * is the claim, so equivalence is what is asserted.
 *
 * ## The gap this pins, measured on the base tree
 *
 * `columns`. The protocol declares it `string[] | ListColumn[]`; the local
 * `NamedListView` declares `string[]`. Two of the three routes out of
 * `ObjectView` end in a NAME slot (`ObjectGridSchema.fields`, and the `fields`
 * of the node `generateViewSchema` emits) whose consumers index records by each
 * entry. Before this change the named-view segment reached both raw, so a
 * spec-shaped `ListColumn[]` arrived as a non-empty field list naming nothing —
 * verbatim the failure `tableColumnFieldNames`' own header describes for
 * `table.columns`, which objectui#5269 already answered at that boundary.
 * `viewColumnFieldNames` answers it at this one.
 *
 * `filter`, `sort`, `label` and `data` needed no renderer change and are pinned
 * anyway, because "already works" is exactly the claim that rots silently.
 *
 * ## Reverse verification — prediction, and where the prediction was WRONG
 *
 * Predicted before the run: the four `columns` cases RED with the two
 * `viewColumnFieldNames(...)` call sites reverted to their raw forwards, every
 * other case GREEN. Measured: THREE red, and the prediction was wrong about
 * which three — recorded here rather than quietly re-fitted, because the miss
 * is the useful part. Two of the four `columns` cases assert a UNION slot
 * (`ObjectGridSchema.columns`, the delegated `list-view` `columns`), which the
 * fix never touched, so they stayed green exactly as they should — they are
 * controls, not fix cases, and the prediction had mis-sorted them. The third
 * red came from the controls block instead: the no-identity case, which rides
 * the fold. ⇒ RED = the two NAME-slot cases plus the no-identity case; GREEN =
 * everything else, the two union-slot cases included. A control that moves with
 * the fix is a control that was carrying the fix; these did not move.
 *
 * The mutation reached the code under test directly — this file imports
 * `../ObjectView` by relative path, so no `dist/` sits between the edit and the
 * run and no rebuild can mask it. Both legs (mutate, restore) proved the edit
 * on disk by occurrence count and by `git hash-object` against the `HEAD` blob;
 * the run log and the two hashes are quoted on the PR.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ObjectListViewSchema } from '@objectstack/spec/ui';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

/** Every node handed to SchemaRenderer, in order — the `generateViewSchema` sink. */
const rendered: any[] = [];
/** Every schema handed to ObjectGrid — the `type: 'grid'` sink. */
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
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'deal', fields: {} }),
});

const NODE = { type: 'object-view', objectName: 'deal' } as unknown as ObjectViewSchema;

/** The spec filter — a rule OBJECT, not the local tuple dialect. One value, shared by both legs. */
const FILTER = [{ field: 'stage', operator: 'equals', value: 'won' }];
const SORT = [{ field: 'amount', order: 'desc' as const }];

/**
 * The named view as the PROTOCOL spells it: `columns` carries the `ListColumn[]`
 * half of the declared union, which is the half the local dialect cannot hold.
 */
const SPEC_VIEW = ObjectListViewSchema.parse({
  label: 'Won deals',
  type: 'grid',
  columns: [{ field: 'name', label: 'Name' }, { field: 'amount' }],
  filter: FILTER,
  sort: SORT,
});

/** The same view as an author writes it in the local dialect today. */
const LOCAL_VIEW = {
  label: 'Won deals',
  type: 'grid',
  columns: ['name', 'amount'],
  filter: FILTER,
  sort: SORT,
};

/** The two field identities both legs name, in order. The equivalence, spelled once. */
const IDENTITIES = ['name', 'amount'];

/** Non-grid twin of the pair — `generateViewSchema` is only reached by a non-grid type. */
const SPEC_CALENDAR = ObjectListViewSchema.parse({
  label: 'Due',
  type: 'calendar',
  columns: [{ field: 'name' }, { field: 'due' }],
  calendar: { startDateField: 'due' },
});
const LOCAL_CALENDAR = {
  label: 'Due',
  type: 'calendar',
  columns: ['name', 'due'],
  calendar: { startDateField: 'due' },
};
const CALENDAR_IDENTITIES = ['name', 'due'];

/**
 * ⚠️ `cleanup()` is load-bearing, not hygiene (the trap recorded on
 * objectui#9242): without it the previously mounted `ObjectView`s keep pushing
 * into the sinks, so the last entry answers the PREVIOUS fixture's question.
 */
function resetSinks() {
  cleanup();
  rendered.length = 0;
  gridSchemas.length = 0;
}
beforeEach(resetSinks);

/** Route — the `object-grid` schema a `type: 'grid'` named view produces. */
async function gridSchemaFor(view: unknown, node: Record<string, unknown> = {}): Promise<any> {
  resetSinks();
  render(
    <ObjectView
      schema={{ ...NODE, ...node, listViews: { v1: view } } as unknown as ObjectViewSchema}
      dataSource={dataSource()}
    />,
  );
  await waitFor(() => expect(gridSchemas.length).toBeGreaterThan(0));
  return gridSchemas[gridSchemas.length - 1];
}

/** Route — the node `generateViewSchema` emits for a NON-GRID named view. */
async function generatedNodeFor(view: unknown): Promise<any> {
  resetSinks();
  render(
    <ObjectView
      schema={{ ...NODE, listViews: { v1: view } } as unknown as ObjectViewSchema}
      dataSource={dataSource()}
    />,
  );
  await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
  return rendered[rendered.length - 1];
}

/** Route — the `list-view` schema the host delegation hands down (objectui#5097). */
function delegatedSchemaFor(view: unknown): any {
  resetSinks();
  const seen: any[] = [];
  render(
    <ObjectView
      schema={{ ...NODE, listViews: { v1: view } } as unknown as ObjectViewSchema}
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

/* ─────────────────────────────────────────────────────────────────────────────
 * `columns` — the one member that needed a renderer change
 * ────────────────────────────────────────────────────────────────────────── */

describe('objectui#8254 — a spec-shaped `columns` reaches every slot in the shape that slot declares', () => {
  it('the grid route: `fields` is a NAME slot, so both legs name the same two fields', async () => {
    const spec = await gridSchemaFor(SPEC_VIEW);
    const local = await gridSchemaFor(LOCAL_VIEW);
    // The equivalence the card asks for, asserted between the legs rather than
    // against a literal either leg could drift away from together.
    expect(spec.fields).toEqual(local.fields);
    expect(spec.fields).toEqual(IDENTITIES);
  });

  it('the grid route: `columns` beside it is the UNION slot, so the authored value arrives raw', async () => {
    const spec = await gridSchemaFor(SPEC_VIEW);
    const local = await gridSchemaFor(LOCAL_VIEW);
    // ⛔ NOT equal to each other — and that is the point. `ObjectGridSchema.columns`
    // is `string[] | ListColumn[]`, so the richer authored value (a column's own
    // `label`) must survive to the slot that can hold it. Narrowing here would be
    // a silent data loss, which is why only the names slot above is folded.
    expect(spec.columns).toEqual(SPEC_VIEW.columns);
    expect(local.columns).toEqual(LOCAL_VIEW.columns);
    // The identities still agree — one value, two shapes.
    expect((spec.columns as any[]).map((c: any) => c.field)).toEqual(local.columns);
  });

  it('the non-grid route: the node `generateViewSchema` emits carries identities, not column objects', async () => {
    const spec = await generatedNodeFor(SPEC_CALENDAR);
    const local = await generatedNodeFor(LOCAL_CALENDAR);
    expect(spec.fields).toEqual(local.fields);
    expect(spec.fields).toEqual(CALENDAR_IDENTITIES);
  });

  it('the host-delegation route: `list-view` declares the union, so both legs keep their own shape and agree on identities', () => {
    const spec = delegatedSchemaFor(SPEC_VIEW);
    const local = delegatedSchemaFor(LOCAL_VIEW);
    expect(spec.columns).toEqual(SPEC_VIEW.columns);
    expect(local.columns).toEqual(LOCAL_VIEW.columns);
    expect((spec.columns as any[]).map((c: any) => c.field)).toEqual(local.columns);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * The members that needed NO renderer change — pinned because "already works"
 * is exactly the claim that rots without an instrument
 * ────────────────────────────────────────────────────────────────────────── */

describe('objectui#8254 — `filter` / `sort` / `label` / `data` already honour the protocol, and now have an instrument saying so', () => {
  it('the spec `filter` (rule OBJECTS, not the local tuple dialect) reaches the grid and the delegation unchanged', async () => {
    const spec = await gridSchemaFor(SPEC_VIEW);
    const local = await gridSchemaFor(LOCAL_VIEW);
    // objectui#11880 item 5: a named view's filter rides `filter`, the one
    // filter slot the grid node carries.
    expect(spec.filter).toEqual(local.filter);
    expect(spec.filter).toEqual(FILTER);
    expect(spec.defaultFilters).toBeUndefined();
    expect(delegatedSchemaFor(SPEC_VIEW).filter).toEqual(delegatedSchemaFor(LOCAL_VIEW).filter);
  });

  it('the spec `sort` reaches the delegation unchanged', () => {
    expect(delegatedSchemaFor(SPEC_VIEW).sort).toEqual(delegatedSchemaFor(LOCAL_VIEW).sort);
    expect(delegatedSchemaFor(SPEC_VIEW).sort).toEqual(SORT);
  });

  it('`label` is read off the named view WITHOUT a cast — the protocol makes it optional, and the read already survives its absence', () => {
    expect(delegatedSchemaFor(SPEC_VIEW).label).toBe('Won deals');
    // The protocol declares `label` optional; the local dialect requires it. A
    // spec-shaped view may therefore omit it, and the read must degrade to the
    // host's rather than throw — the half a cast would have hidden.
    const unlabelled = ObjectListViewSchema.parse({ type: 'grid', columns: [{ field: 'name' }] });
    expect('label' in unlabelled).toBe(false);
    expect(delegatedSchemaFor(unlabelled).label).toBeUndefined();
  });

  it('a spec-shaped `data` block reaches the delegated `data` slot — declared on both faces since objectui#8980, cast already gone', () => {
    const withData = ObjectListViewSchema.parse({
      label: 'Inline',
      type: 'grid',
      columns: [{ field: 'name' }],
      data: { provider: 'value', items: [{ name: 'a' }] },
    });
    expect(delegatedSchemaFor(withData).data).toEqual(withData.data);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Controls — what this change deliberately did NOT move
 * ────────────────────────────────────────────────────────────────────────── */

describe('objectui#8254 — controls: the fold changes SHAPE only, never precedence and never another segment', () => {
  it('an authored EMPTY `columns` still stops the `||` chain exactly where it stopped before', async () => {
    // `ObjectListViewSchema` accepts `columns: []`. The sibling fold
    // `tableColumnFieldNames` folds an empty list to `undefined` so ITS chain
    // falls through to the deprecated `table.fields`; doing that here would move
    // a view's source of columns, which is a precedence change this card does
    // not own. `[]` in, `[]` out.
    const empty = ObjectListViewSchema.parse({ label: 'Empty', type: 'grid', columns: [] });
    const grid = await gridSchemaFor(empty, { table: { fields: ['fallback'] } });
    expect(grid.fields).toEqual([]);
  });

  it('a column entry that resolves to no identity collapses instead of naming nothing — the improvement, stated as a case', async () => {
    // Not reachable from a spec-shaped view (the schema requires `field`), but
    // reachable from stored host metadata, and it is the shape the old raw
    // forward turned into a non-empty list of nameless columns.
    const grid = await gridSchemaFor({ label: 'Junk', type: 'grid', columns: [{ width: 120 }] });
    expect(grid.fields).toEqual([]);
  });

  it('the `table.columns` segment is untouched — it already had its own fold (objectui#5269)', async () => {
    const grid = await gridSchemaFor(
      { label: 'No columns of its own', type: 'grid' },
      { table: { columns: [{ field: 'name' }, { field: 'stage' }], fields: ['unused'] } },
    );
    // The grid route's `fields` chain ends at `table.fields`, not at
    // `table.columns` — unchanged by this card, and pinned so a later tidy-up
    // cannot quietly reroute it while these cases stay green.
    expect(grid.fields).toEqual(['unused']);
    expect(grid.columns).toEqual([{ field: 'name' }, { field: 'stage' }]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * `ViewPreview`'s spread — the producer the card names
 * ────────────────────────────────────────────────────────────────────────── */

describe("objectui#8254 — the metadata-admin preview's spread keeps working on a spec-shaped body", () => {
  /**
   * `ViewPreview` (`@object-ui/app-shell`, the metadata-admin previews) surfaces
   * the draft being edited as a named view by spreading the draft body into
   * `listViews[id]` and overriding `label` — `{ ...body, label: body.label ??
   * draft.label ?? name }`. That WRITE is the reason objectui#7928 ordered the
   * renderer half first, so the shape it produces is reproduced here rather
   * than described. ⛔ Not imported: `app-shell` depends on this package, not
   * the other way round, so importing it here would invert the graph.
   */
  const previewWrite = (body: Record<string, unknown>, name: string) => ({
    ...body,
    label: (body as any).label ?? name,
  });

  it('a spec-parsed draft body spread into `listViews` renders the same columns as the body itself does', async () => {
    const direct = await gridSchemaFor(SPEC_VIEW);
    const throughPreview = await gridSchemaFor(previewWrite(SPEC_VIEW, 'won_deals'));
    expect(throughPreview.fields).toEqual(direct.fields);
    expect(throughPreview.columns).toEqual(direct.columns);
  });

  it("the spread's `label` override wins, and an unlabelled spec body takes the preview's name", async () => {
    const unlabelled = ObjectListViewSchema.parse({ type: 'grid', columns: [{ field: 'name' }] });
    expect(delegatedSchemaFor(previewWrite(unlabelled, 'my_draft')).label).toBe('my_draft');
  });
});
