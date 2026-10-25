/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6152 round 8 — the grid node `ObjectView` composes carries the grid's
 * `operations` toggles, and not the view's `read`.
 *
 * `@objectstack/spec` 17.7.0 types `object-grid`'s `operations` as the strict
 * `{ create?, update?, delete?, export? }` block and refuses `read` / `import` by
 * name: no `object-grid` code reads either. `read` is a live member of the
 * `object-view` itself — `ObjectView` reads it as its row-click gate — so it stays
 * there. The view used to hand its whole `operations` block to the grid it draws
 * (`{ ...operations, create: false }`), and with no `operations` authored that block
 * is the view's default, `read: true` included, so every such grid node carried a
 * member its row refuses. This file mounts the REGISTERED renderer through the real
 * `SchemaRenderer` and reads the node `ObjectGrid` receives.
 *
 * The behaviour the gate drives is pinned elsewhere and is unchanged:
 * `ObjectView.modifierClickNewTab-9806.test.tsx` holds `operations: { read: false }`
 * keeping a row inert.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
// Module scope, not a hook: this import IS the `object-view` registration.
import '../index';

/** A grid node as the probe records it: read key by key. */
type GridNode = Record<string, unknown>;

/** Every schema handed to `ObjectGrid`. */
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
beforeEach(() => {
  cleanup();
  gridSchemas.length = 0;
});

async function gridOperations(extra: Record<string, unknown>): Promise<Record<string, unknown>> {
  render(
    <SchemaRendererProvider dataSource={dataSource()}>
      <SchemaRenderer schema={{ type: 'object-view', objectName: 'task', ...extra } as never} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(gridSchemas.length).toBeGreaterThan(0));
  return gridSchemas[gridSchemas.length - 1].operations as Record<string, unknown>;
}

describe('objectui#6152 round 8 — the composed grid node\'s `operations` is the grid\'s block', () => {
  it('with no `operations` authored, the view\'s default reaches the grid without `read`', async () => {
    const ops = await gridOperations({});
    expect(ops).toEqual({ create: false, update: true, delete: true });
    expect('read' in ops).toBe(false);
  });

  it('a view-level `read: false` stays the view\'s: the grid receives the other toggles only', async () => {
    const ops = await gridOperations({ operations: { read: false, update: true, delete: false } });
    // Lit control: the view's block IS what reached the grid — its own `update` / `delete`.
    expect(ops).toEqual({ update: true, delete: false, create: false });
  });

  it('CONTROL: a `table.operations` block reaches the grid as authored, `create` overridden', async () => {
    const ops = await gridOperations({ table: { operations: { update: false, export: false } } });
    expect(ops).toEqual({ update: false, export: false, create: false });
  });
});
