/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An authored `object-grid` writes its props in the spec's `properties` bag,
 * and the bag draws what the flat spelling drew (objectui#11276, the
 * `object-grid` batch).
 *
 * `@object-ui/types` now arms the authored node from
 * `ComponentPropsMap['object-grid']`: `{ type: 'object-grid', properties: {
 * … } }` validates, and the flat spelling is refused by name
 * (`object-grid-properties-bag-11276.test.ts` holds both faces). That move is
 * only safe if the renderer reads the bag, so this file renders the node
 * through the real registry and a recording adapter:
 *
 *  - the bag queries its `objectName` with its own `filter` and `sort`, and
 *    paints the returned row;
 *  - the flat spelling — what a stored document, `ObjectView` and `ListView`
 *    still hand the renderer — makes the identical call and paints the same
 *    text: `SchemaRenderer` hoists the bag onto the node before `ObjectGrid`
 *    reads it, and that hoist is unchanged, so a stored flat node keeps
 *    rendering;
 *  - a bag bound through the node's `dataSource` queries the bound object;
 *  - control: a bag naming a different object queries that object and never
 *    the fixture's, so the first row cannot pass on a fetch the bag did not
 *    drive.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ObjectGridBlockNode, ObjectGridSchema } from '@object-ui/types';
import { safeValidateSchema } from '@object-ui/types/zod';
// Module scope, not a hook: this import IS the registration (AGENTS.md
// test-discipline section).
import '../index';

const FILTER = [{ field: 'status', operator: 'equals' as const, value: 'open' }];
const SORT = [{ field: 'title', order: 'desc' as const }];
const ROW = { id: 't1', title: 'Write the bag pin', status: 'open' };

/** The authored spelling, spec-valid. */
const BAG: ObjectGridBlockNode = { type: 'object-grid', properties: { objectName: 'task', columns: ['title', 'status'], filter: FILTER, sort: SORT } };
/** The same props written flat — what a stored document or a code composer hands the renderer. */
const FLAT: ObjectGridSchema = { type: 'object-grid', objectName: 'task', columns: ['title', 'status'], filter: FILTER, sort: SORT };
/** The bag with its object supplied by the node's binding instead. */
const BOUND_BAG: ObjectGridBlockNode = { type: 'object-grid', dataSource: { object: 'task' }, properties: { columns: ['title', 'status'] } };

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: [ROW], total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockImplementation(async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, title: { type: 'text' }, status: { type: 'text' } },
    })),
  };
}

function renderNode(schema: ObjectGridBlockNode | ObjectGridSchema) {
  const adapter = makeAdapter();
  const view = render(
    <SchemaRendererProvider dataSource={adapter as unknown as DataSource}>
      <SchemaRenderer schema={schema} />
    </SchemaRendererProvider>,
  );
  return { adapter, ...view };
}

describe('object-grid renders from its `properties` bag (objectui#11276)', () => {
  it('the fixtures are the spellings the validator now tells apart (lit control)', () => {
    expect(safeValidateSchema(BAG).success).toBe(true);
    expect(safeValidateSchema(BOUND_BAG).success).toBe(true);
    expect(safeValidateSchema(FLAT).success).toBe(false);
  });

  it('the bag queries its object with its own filter and sort, and paints the row', async () => {
    const { adapter, container } = renderNode(BAG);
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const [object, params] = adapter.find.mock.calls[0] as [string, { $filter?: unknown; $orderby?: unknown }];
    expect(object).toBe('task');
    expect(JSON.stringify(params.$filter)).toContain('status');
    expect(params.$orderby).toBeDefined();
    await waitFor(() => expect(container.textContent).toContain(ROW.title));
  });

  it('a stored flat node keeps rendering: the identical call, the same painted row', async () => {
    const bag = renderNode(BAG);
    await waitFor(() => expect(bag.adapter.find).toHaveBeenCalled());
    await waitFor(() => expect(bag.container.textContent).toContain(ROW.title));
    const bagCall = bag.adapter.find.mock.calls[0];
    cleanup();
    const flat = renderNode(FLAT);
    await waitFor(() => expect(flat.adapter.find).toHaveBeenCalled());
    await waitFor(() => expect(flat.container.textContent).toContain(ROW.title));
    expect(flat.adapter.find.mock.calls[0]).toEqual(bagCall);
  });

  it('a bag bound through the node\'s `dataSource` queries the bound object', async () => {
    const { adapter, container } = renderNode(BOUND_BAG);
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(adapter.find.mock.calls[0][0]).toBe('task');
    await waitFor(() => expect(container.textContent).toContain(ROW.title));
  });

  it('control: a bag naming another object queries that object, never the fixture\'s', async () => {
    const { adapter } = renderNode({ ...BAG, properties: { ...BAG.properties, objectName: 'milestone' } });
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const objects = adapter.find.mock.calls.map((call) => call[0]);
    expect(objects).toContain('milestone');
    expect(objects).not.toContain('task');
  });
});
