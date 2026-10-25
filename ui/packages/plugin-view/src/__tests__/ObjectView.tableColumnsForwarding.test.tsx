/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5269 — `table.columns` reaches the NON-grid paths too.
 *
 * `ObjectViewSchema.table` is `Partial< Omit< ObjectGridSchema, 'type' |
 * 'objectName' > >`, where `columns` is the canonical spelling and `fields`
 * carries "@deprecated Use columns instead". `ObjectView` does not spread
 * `table`; it forwards a hand-written whitelist, and that whitelist had ONE
 * read of `table.columns` in the whole file — the grid one. Both other field-
 * list read points took the deprecated key alone:
 *
 *   generateViewSchema `baseProps`        `table.fields` only
 *   delegated `renderListView` schema     `table.fields` only
 *
 * So `table: { columns: [...] }` — the shape the type recommends — produced an
 * empty field list off the grid path, from a schema that compiled and read
 * correctly. Same silent-success shape as objectui#5102; different mechanism:
 * not a whitelist that knows only legacy spellings, but one that disagreed
 * with itself between two rendering paths.
 *
 * ## What this file pins, and on which surface
 *
 * Both changed sites are pinned where a CONSUMER can be observed, not merely
 * where the value is emitted:
 *
 *   `baseProps` -> `object-kanban`   consumed as `cardFields`
 *                                    (`ObjectKanban` reads `schema.cardFields`)
 *   `baseProps` -> `object-tree`     consumed as `fields`
 *                                    (`ObjectTree.getTreeConfig` reads `schema.fields`)
 *   delegated   -> `list-view`       consumed as `columns` (`ListView`'s column set)
 *
 * ## The surfaces that get NO test here, deliberately
 *
 * `baseProps` also feeds `object-gallery`, `object-calendar`, `object-timeline`,
 * `object-gantt` and `object-map`. Measured on this tree, none of those five
 * renderers reads a field list off its schema at all — every `.fields` in them
 * is `objectDef.fields` (object METADATA) or gallery's `schema.grouping.fields`.
 * So the value this fix forwards is inert on those five, before the fix and
 * after it. Asserting `fields` on their generated schema would pin the emit
 * and prove nothing about the surface, so it is stated here instead of tested.
 * (The card objectui#5269 names kanban / gallery / calendar as the affected
 * surfaces; the measurable set is kanban / tree / delegated.)
 *
 * ## One asymmetry between the two changed sites
 *
 * `table.columns` is `string[] | ListColumn[]`. The delegated `list-view`
 * slot declares that same union and `ListView` reads both, so it takes the
 * value RAW — flattening there would throw away the width/label the author
 * wrote. The non-grid `baseProps` slot is a names slot (both segments ahead of
 * `table` declare `string[]`; `ObjectKanban` indexes records by each entry), so
 * the `ListColumn[]` half is resolved to names with `columnIdentity` — the
 * same fold `ObjectGrid` applies to this very value. Both halves are pinned.
 *
 * ## Precedence
 *
 * Unchanged, and pinned below: the two segments ahead of `table`
 * (`listViews` entry, then `activeView`) still outrank it. Within the `table`
 * segment the canonical key wins and the deprecated one keeps working — the
 * same rule objectui#5102 applied to its four pairs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

/** Every schema the view hands to SchemaRenderer, in order. */
const rendered: any[] = [];

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

/** The grid the view delegates to, replaced by a probe that records its schema. */
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

const mockDataSource = () => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
});

/**
 * Render a non-grid view and return the schema `generateViewSchema` produced.
 * `views` drives the view types `defaultViewType` cannot spell (`tree`).
 */
async function generatedSchema(
  schema: Partial<ObjectViewSchema>,
  views?: any[],
): Promise<any> {
  rendered.length = 0;
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'task', ...schema } as ObjectViewSchema}
      views={views}
      dataSource={mockDataSource() as any}
    />,
  );
  await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
  return rendered[rendered.length - 1];
}

/** Render through the delegated `renderListView` slot and return its schema. */
function delegatedSchema(schema: Partial<ObjectViewSchema>): any {
  const seen: any[] = [];
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'task', ...schema } as ObjectViewSchema}
      dataSource={mockDataSource() as any}
      renderListView={({ schema: s }: any) => { seen.push(s); return <div data-testid="delegated" />; }}
    />,
  );
  return seen[0];
}

/** Render on the grid path and return the schema ObjectGrid was handed. */
function forwardedGridSchema(schema: Partial<ObjectViewSchema>): any {
  gridSchemas.length = 0;
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'task', ...schema } as ObjectViewSchema}
      dataSource={mockDataSource() as any}
    />,
  );
  return gridSchemas[0];
}

const KANBAN = { defaultViewType: 'kanban' as const };
const TREE_VIEWS = [{ id: 'tree-1', label: 'Tree', type: 'tree' as const }];

beforeEach(() => {
  vi.clearAllMocks();
  rendered.length = 0;
  gridSchemas.length = 0;
});

describe('kanban: a canonical table.columns reaches the cards (objectui#5269)', () => {
  it('forwards table.columns as the kanban card fields', async () => {
    // Before the fix this arrived as `cardFields: []` — the card fields the
    // author declared were dropped at the forwarding hop, not at the renderer.
    const s = await generatedSchema({ ...KANBAN, table: { columns: ['stage', 'owner'] } as any });
    expect(s.type).toBe('object-kanban');
    expect(s.cardFields).toEqual(['stage', 'owner']);
    expect(s.fields).toEqual(['stage', 'owner']);
  });

  it('still forwards the deprecated table.fields', async () => {
    // The alias must keep working — every view authored against today's docs
    // writes it. (Green before AND after the fix: this pins the half that must
    // NOT change, not the defect.)
    const s = await generatedSchema({ ...KANBAN, table: { fields: ['stage'] } as any });
    expect(s.cardFields).toEqual(['stage']);
  });

  it('prefers the canonical table.columns over the deprecated table.fields', async () => {
    const s = await generatedSchema({
      ...KANBAN,
      table: { columns: ['stage'], fields: ['owner'] } as any,
    });
    expect(s.cardFields).toEqual(['stage']);
  });

  it('resolves the ListColumn[] form of table.columns to field NAMES', async () => {
    // `ObjectGridSchema.columns` is `string[] | ListColumn[]`, but this slot is
    // a names slot: `resolveKanbanCardFields` casts to `string[]` and the card
    // loop indexes the record by each entry. Forwarding the objects raw would
    // produce a non-empty card field list naming nothing — and a non-empty list
    // suppresses ObjectKanban's `highlightFields` fallback, so the cards would
    // come out emptier than before this card. Resolved at the boundary with
    // `columnIdentity`, the same fold ObjectGrid applies to this very value.
    const s = await generatedSchema({
      ...KANBAN,
      table: { columns: [{ field: 'stage', label: 'Stage', width: 120 }] } as any,
    });
    expect(s.cardFields).toEqual(['stage']);
  });

  it('falls through to table.fields when no column entry names a field', async () => {
    // The empty-array trap: `[] || x` is `[]`, so a `columns` whose entries all
    // fail to resolve must yield `undefined`, not an empty list that stops the
    // chain on a falsy-looking truthy value.
    const s = await generatedSchema({
      ...KANBAN,
      table: { columns: [{ label: 'no identity here' }], fields: ['owner'] } as any,
    });
    expect(s.cardFields).toEqual(['owner']);
  });

  it('keeps a named view outranking the table segment', async () => {
    // Precedence is unchanged by this card and must stay that way: the two
    // segments ahead of `table` still win. (Green on both legs — a guard on
    // the fix, not evidence of it.)
    const s = await generatedSchema({
      ...KANBAN,
      listViews: { mine: { label: 'Mine', columns: ['assignee'] } },
      defaultListView: 'mine',
      table: { columns: ['stage'] } as any,
    } as any);
    expect(s.cardFields).toEqual(['assignee']);
  });
});

describe('tree: a canonical table.columns reaches the flat columns (objectui#5269)', () => {
  it('forwards table.columns as the tree view fields', async () => {
    const s = await generatedSchema({ table: { columns: ['stage', 'owner'] } as any }, TREE_VIEWS);
    expect(s.type).toBe('object-tree');
    expect(s.fields).toEqual(['stage', 'owner']);
  });

  it('still forwards the deprecated table.fields', async () => {
    const s = await generatedSchema({ table: { fields: ['stage'] } as any }, TREE_VIEWS);
    expect(s.fields).toEqual(['stage']);
  });
});

describe('delegated renderListView: canonical first, alias still working (objectui#5269)', () => {
  it('hands over a canonical table.columns as the list-view columns', () => {
    expect(delegatedSchema({ table: { columns: ['stage', 'owner'] } as any }).columns)
      .toEqual(['stage', 'owner']);
  });

  it('hands over the ListColumn[] form of table.columns unchanged', () => {
    // `ObjectGridSchema.columns` (and `list-view`'s own `columns`) are both
    // `string[] | ListColumn[]`, so the object form is a declared shape on
    // this slot and must not be flattened on the way through.
    const cols = [{ field: 'stage', label: 'Stage', width: 200 }];
    expect(delegatedSchema({ table: { columns: cols } as any }).columns).toEqual(cols);
  });

  it('still hands over the deprecated table.fields', () => {
    expect(delegatedSchema({ table: { fields: ['stage'] } as any }).columns).toEqual(['stage']);
  });

  it('prefers the canonical table.columns over the deprecated table.fields', () => {
    expect(delegatedSchema({ table: { columns: ['stage'], fields: ['owner'] } as any }).columns)
      .toEqual(['stage']);
  });

  it('keeps a named view outranking the table segment', () => {
    const s = delegatedSchema({
      listViews: { mine: { label: 'Mine', columns: ['assignee'] } },
      defaultListView: 'mine',
      table: { columns: ['stage'] } as any,
    } as any);
    expect(s.columns).toEqual(['assignee']);
  });
});

describe('grid path: unchanged by this card — the control', () => {
  it('keeps emitting table.columns and table.fields in their own slots', () => {
    // The grid path forwards BOTH slots and lets `ObjectGrid` arbitrate
    // (objectui#5102's shape). This card does not touch it; the assertion is
    // here so a future "make all three sites identical" tidy-up cannot
    // collapse the two slots without a red test.
    //
    // The `undefined` half is counter-probed by the populated half in the same
    // render: `fields: undefined` alone would also be what a probe that saw no
    // grid schema at all would report.
    const canonicalOnly = forwardedGridSchema({ table: { columns: ['stage'] } as any });
    expect(canonicalOnly.columns).toEqual(['stage']);
    expect(canonicalOnly.fields).toBeUndefined();

    const legacyOnly = forwardedGridSchema({ table: { fields: ['owner'] } as any });
    expect(legacyOnly.fields).toEqual(['owner']);
    expect(legacyOnly.columns).toBeUndefined();
  });
});
