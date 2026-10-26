/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8348 — `object-tree` honours the `data` spelling its published row
 * declares, and no other.
 *
 * ## The ruling, and why the tree is reached only now
 *
 * Decision batch #83, maintainer verbatim 「8348 以协议为准」: a renderer honours
 * the `data` spelling its block's PUBLISHED row declares. Ruling batch #136
 * item 3 (Q1-C) had the protocol gain rows for `object-map`, `object-gantt` and
 * `object-tree`; until the tree's row was installable, no published face
 * declared a `data` row for this block, so it passed `'undeclared'` and honoured
 * ANY truthy `data`. The ruling's 「协议没有的能力删」 clause — "if tree's row
 * declares no `data`, tree stops honouring it" — did NOT fire: the row declares
 * `data` as the `ViewData` union. So the tree keeps the OBJECT arm and loses
 * only the bare-array spelling, and its `staticData` rung, which the same row
 * declares, is unchanged.
 *
 * ## Three carriers of one authored key, and each is pinned here
 *
 *  1. The shared ladder — `resolveRecordSourceConfig(schema, ARM)` at the
 *     component's call site. Rows 1–3.
 *  2. `SchemaRenderer`'s props spread — `recordSourceDataArmForType` decides
 *     whether an authored `data` also arrives as the React `data` prop
 *     (objectui#9571). Rows 2 and 7.
 *  3. `ObjectTree`'s OWN fetch effect, which read `rest.data ?? schema.data`
 *     with an `Array.isArray` test and so bypassed the ladder entirely. Moving
 *     the arm while leaving this reader in place would have removed nothing
 *     observable end to end — the "written from the read that looks right,
 *     cannot fail" shape `ObjectCalendar.recordSourceMembers-8314.test.tsx`
 *     warns about. Rows 2 and 6.
 *
 * Every behavioural row renders through the REAL `SchemaRenderer` and this
 * package's own registration, except row 6, which mounts the component directly
 * so the third carrier is measured with the second one out of the picture.
 *
 * ## The outcome, named — the same one `object-map` and `object-gantt` give
 *
 * A bare array under `data` draws nothing (`No records`) when the node names
 * no object, and the tree queries its `objectName` instead when it does — the
 * ladder falls through to rung 2, then rung 3. In a development build
 * `SchemaRenderer` says so once, naming the key and the spelling that works;
 * in production it is quiet. Same ladder, same arm, same diagnostic as the map
 * (`ObjectMap.schemaDataShorthand.test.tsx`).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ComponentRegistry, recordSourceDataArmForType } from '@object-ui/core';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { ObjectTree } from './ObjectTree';
// Registers `object-tree` and `tree` through this package's own entry.
import './index';

beforeEach(() => {
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

/** Rows an author put in the metadata. */
const AUTHORED = [
  { id: 'a1', name: 'Authored root', parent_id: null },
  { id: 'a2', name: 'Authored child', parent_id: 'a1' },
];
/** Rows a HOST pre-fetched and handed down — the carrier the rulings protect. */
const HOSTED = [{ id: 'h1', name: 'Host row', parent_id: null }];

const BASE = { type: 'object-tree', parentField: 'parent_id', labelField: 'name' };

function makeDataSource() {
  return {
    find: vi.fn(async (_object: string, _query?: unknown) => ({
      data: [{ id: 'q1', name: 'Queried row', parent_id: null }],
      total: 1,
    })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'category',
      fields: { name: { type: 'text' }, parent_id: { type: 'text' } },
    })),
  };
}

const renderNode = (
  schema: Record<string, unknown>,
  ds: ReturnType<typeof makeDataSource>,
  hostProps: Record<string, unknown> = {},
) =>
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <SchemaRenderer schema={schema as any} {...hostProps} />
    </SchemaRendererProvider>,
  );

/** The labels the tree drew, read once it has left its `Loading…` placeholder. */
async function drawn(): Promise<string[]> {
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
  return screen.queryAllByTestId('object-tree-row').map((row) => (row.textContent ?? '').trim());
}

/** The `SchemaRenderer` dev warnings that name `type`. */
const refusalWarningsFor = (warn: ReturnType<typeof vi.spyOn>, type: string): string[] =>
  warn.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .filter((message: string) => message.includes(`<${type}`) && message.includes('NOT passed to the component'));

type DerivedArm = 'view-data' | 'array' | 'no data row' | 'no row' | 'both arms' | 'neither arm';

/**
 * The arm a `ComponentPropsMap` row's `data` member declares — READ from the
 * installed row by parsing one value of each arm, ⛔ never restated.
 *
 * Read through `Record<string, any>` for the reason
 * `ObjectTree.schemaTyped-8655.test.ts` gives: `_def` is a zod internal the
 * spec publishes no type for.
 */
function armDeclaredByRow(type: string): DerivedArm {
  const entry = (ComponentPropsMap as unknown as Record<string, any>)[type];
  if (!entry?._def) return 'no row';
  const def = entry._def;
  const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
  const data = shape?.data;
  if (!data) return 'no data row';
  const takesObject = data.safeParse({ provider: 'value', items: [] }).success;
  const takesArray = data.safeParse([]).success;
  if (takesObject && takesArray) return 'both arms';
  if (takesObject) return 'view-data';
  if (takesArray) return 'array';
  return 'neither arm';
}

describe('object-tree honours only the `data` arm its published row declares (objectui#8348)', () => {
  it('1. ⛔ CONTROL: the DECLARED `{ provider: value, items }` form draws its rows and queries nothing', async () => {
    const ds = makeDataSource();
    renderNode({ ...BASE, id: 't1', data: { provider: 'value', items: AUTHORED } }, ds);

    expect(await drawn()).toEqual(['Authored root', 'Authored child']);
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('2. ⭐ a bare array under `data` draws nothing — and `SchemaRenderer` says why, once', async () => {
    // The removal this card makes, end to end. Two carriers had to close for
    // this to go quiet: the props spread (the arm table) and the component's
    // own `schema.data` read (the fetch effect). Either one alone still drew
    // the rows.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = makeDataSource();
    renderNode({ ...BASE, id: 't2', data: AUTHORED }, ds);

    expect(await drawn()).toEqual([]);
    expect(screen.getByText('No records')).toBeTruthy();
    expect(ds.find).not.toHaveBeenCalled();
    expect(refusalWarningsFor(warn, 'object-tree')).toHaveLength(1);
  });

  it('3. ⭐ …and with an `objectName` beside it, the ladder falls through and QUERIES that object', async () => {
    // The other face of the same removal, and the one an author feels: the
    // rows are not merely dropped, the block asks its object instead. Before
    // this card the bare array was rung 1 here and no `find` was issued.
    const ds = makeDataSource();
    renderNode({ ...BASE, id: 't3', objectName: 'category', data: AUTHORED }, ds);

    expect(await drawn()).toEqual(['Queried row']);
    expect(ds.find).toHaveBeenCalledWith('category', expect.anything());
  });

  it('4. ⛔ CONTROL: `staticData` — declared by the same row — is unchanged, and still draws', async () => {
    const ds = makeDataSource();
    renderNode({ ...BASE, id: 't4', staticData: AUTHORED }, ds);

    expect(await drawn()).toEqual(['Authored root', 'Authored child']);
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('5. ⛔ MUST NOT CHANGE: a HOST `data` prop through `SchemaRenderer` still draws', async () => {
    // Option B of objectui#9571 — gating the PROP on the arm — was refused to
    // keep this path: `...props` is spread LAST in `SchemaRenderer`, and the
    // fetch effect still reads `rest.data`.
    const ds = makeDataSource();
    renderNode({ ...BASE, id: 't5' }, ds, { data: HOSTED });

    expect(await drawn()).toEqual(['Host row']);
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('6. mounted directly, with no `SchemaRenderer` in the way, the authored array still draws nothing', async () => {
    // The third carrier on its own. With no spread at all, the only reader
    // that could draw an authored bare array is the component's own fetch
    // effect — so this row is the one that holds `schema.data` out of it.
    render(<ObjectTree schema={{ ...BASE, data: AUTHORED } as any} />);

    expect(await drawn()).toEqual([]);
  });

  it('7. every KEY this plugin registers onto the tree renderer answers the arm the INSTALLED row declares', () => {
    // The alias hazard `RecordSourceDataArm`'s docblock names, closed against
    // the REGISTRY rather than against the table, and against the spec row
    // rather than against a constant: a spec release that moves the row, or a
    // registered spelling added without a table row, turns this red.
    const siblings = ComponentRegistry.getAllTypes().filter(
      (type) => ComponentRegistry.get(type) === ComponentRegistry.get('object-tree'),
    );
    const declared = armDeclaredByRow('object-tree');

    // Two keys since objectui#10859 batch 8 retired the `tree` / `view:tree` alias.
    expect([...siblings].sort()).toEqual(['object-tree', 'plugin-tree:object-tree']);
    expect(declared).toBe('view-data');
    for (const type of siblings) {
      expect([type, recordSourceDataArmForType(type)]).toEqual([type, declared]);
    }
  });

  it('8. ⛔ CONTROL: the row reader discriminates — the array-arm row and an absent row read differently', () => {
    // Without these, a reader that answered `view-data` for everything would
    // make row 7 a restatement instead of a measurement.
    expect(armDeclaredByRow('object-calendar')).toBe('array');
    expect(armDeclaredByRow('BOGUS_CONTROL_BLOCK')).toBe('no row');
  });
});
