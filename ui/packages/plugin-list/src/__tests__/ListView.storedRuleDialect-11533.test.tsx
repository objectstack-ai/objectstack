/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A list view STORED with a rule in the retired native dialect still reaches its
 * grid (objectui#11533).
 *
 * objectui#11533 retired the native `{ field, operator, value }` rule, its
 * `expression` and the top-level colour keys from the list view's (and the
 * grid's) AUTHORING faces: `ListViewSchema` refuses each by name. Stored stock
 * is not authoring. A view saved before the retirement keeps its rules, nothing
 * on the render path parses a stored node, and `ListView` hands the rules to the
 * `object-grid` it builds exactly as stored. The grid's shared resolver keeps
 * every arm as a compatibility read, so the row still paints — that half is
 * pinned at the real grid in `@object-ui/plugin-grid`'s
 * `gridRowDecorationMembers-8071.test.tsx`.
 *
 * What is pinned here is the HANDOFF, read off a probe registered as
 * `object-grid`, beside the authoring refusal of the same document: refused at
 * authoring, relayed untouched at render. The control is the
 * `{ condition, style }` respelling, accepted and relayed the same way.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListViewSchema } from '@object-ui/types/zod';
import { ListView } from '../ListView';

const OBJECT = 'task';

/** The native rule, exactly as a list view stored before objectui#11533 carries it. */
const STORED_RULES = [{ field: 'status', operator: 'equals', value: 'late', backgroundColor: '#fee2e2' }];

/** Its `{ condition, style }` respelling, the one dialect the authoring faces take. */
const RESPELLED_RULES = [{ condition: "record.status == 'late'", style: { backgroundColor: '#fee2e2' } }];

/** Records every props bag `SchemaRenderer` hands the `object-grid` node. */
const GridProbe = vi.fn((_props: Record<string, unknown>) => <div data-testid="grid-probe" />);

beforeEach(() => {
  GridProbe.mockClear();
  ComponentRegistry.register('object-grid', GridProbe as never);
});

afterEach(() => {
  ComponentRegistry.unregister?.('object-grid');
  cleanup();
});

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [{ id: 't1', name: 'Ship it', status: 'late' }], total: 1, hasMore: false })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      fields: { id: { name: 'id', type: 'text' }, name: { name: 'name', type: 'text' }, status: { name: 'status', type: 'text' } },
    })),
  } as never;
}

const storedView = (rules: unknown[]) => ({
  type: 'list-view',
  objectName: OBJECT,
  viewType: 'grid',
  columns: ['name', 'status'],
  conditionalFormatting: rules,
});

/** The rules the grid probe was handed, read off the node `ListView` built. */
async function rulesHandedToTheGrid(rules: unknown[]): Promise<unknown> {
  const ds = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={storedView(rules) as never} dataSource={ds} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(GridProbe).toHaveBeenCalled());
  const props = GridProbe.mock.calls.at(-1)![0] as { schema?: { conditionalFormatting?: unknown } };
  return props.schema?.conditionalFormatting;
}

describe('a list view STORED with a retired rule dialect (objectui#11533)', () => {
  it('is refused BY NAME on the authoring face, and its rules still reach the grid untouched', async () => {
    const parsed = ListViewSchema.safeParse(storedView(STORED_RULES));
    expect(parsed.success).toBe(false);
    const atField = parsed.error!.issues.find((i) => i.path.join('.') === 'conditionalFormatting.0.field');
    expect(atField?.message).toContain('RETIRED (objectui#11533)');

    // Render is not a validation door: the stored rules ride the grid node as
    // stored, for the grid's resolver to paint.
    expect(await rulesHandedToTheGrid(STORED_RULES)).toEqual(STORED_RULES);
  });

  it('CONTROL — the `{ condition, style }` respelling is accepted and relayed the same way', async () => {
    expect(ListViewSchema.safeParse(storedView(RESPELLED_RULES)).success).toBe(true);
    expect(await rulesHandedToTheGrid(RESPELLED_RULES)).toEqual(RESPELLED_RULES);
  });
});
