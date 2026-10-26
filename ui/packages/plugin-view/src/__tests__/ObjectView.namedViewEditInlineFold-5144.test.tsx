/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5144 — on a host's `renderListView`, the named view's `inlineEdit`
 * outranks the host's, for whether inline editing is offered too.
 *
 * `normalizeListViewSchema` folds a view's `inlineEdit` into
 * `userActions.editInline`, and `ListView` withholds inline editing where that
 * reads `false` (an absent key reads on, objectui#12086). The relay that builds
 * the `list-view` node merges `userActions` across three layers: the node, the
 * host's `views` entry, and the named view, most specific last. It folded the first two and spread the
 * named view's raw. So once the fold existed, a host-layer `inlineEdit` became
 * a folded `editInline` that outranked the named view's own `inlineEdit`, the
 * inverse of the named-first `inlineEdit` rung on the same node. The seat's
 * decision on the card folds the named layer like the other two.
 *
 * Each case reads what `ListView` reads: the node handed to `renderListView`,
 * through the fold.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { normalizeListViewSchema } from '@object-ui/core';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: () => null,
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => null,
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => null,
}));

const dataSource = (): any => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
});

type Layer = Record<string, unknown>;

/**
 * The `editInline` and `inlineEdit` `ListView` reads off the node a host
 * receives, for a named view and a host `views` entry.
 */
function read(named: Layer, host: Layer | null): { editInline: unknown; inlineEdit: unknown } {
  const seen: Record<string, unknown>[] = [];
  render(
    <ObjectView
      schema={{
        type: 'object-view',
        objectName: 'task',
        listViews: { v1: { label: 'Open work', type: 'grid', columns: ['subject'], ...named } },
      } as unknown as ObjectViewSchema}
      views={host ? [{ id: 'h', label: 'Host', type: 'grid' as const, ...host }] : undefined}
      dataSource={dataSource()}
      renderListView={({ schema }: { schema: Record<string, unknown> }) => {
        seen.push(schema);
        return <div data-testid="delegated" />;
      }}
    />,
  );
  expect(seen.length).toBeGreaterThan(0);
  // The named view was selected: its label is on the node.
  expect(seen[0].label).toBe('Open work');
  const node = normalizeListViewSchema(seen[0]) as { userActions?: Layer; inlineEdit?: unknown };
  return { editInline: node.userActions?.editInline, inlineEdit: node.inlineEdit };
}

beforeEach(() => {
  cleanup();
});

describe('objectui#5144 — the named view`s inlineEdit outranks the host`s on renderListView', () => {
  it('named `inlineEdit: true` over host `inlineEdit: false` reads offered', () => {
    expect(read({ inlineEdit: true }, { inlineEdit: false })).toEqual({ editInline: true, inlineEdit: true });
  });

  it('named `inlineEdit: false` over host `inlineEdit: true` reads off', () => {
    expect(read({ inlineEdit: false }, { inlineEdit: true })).toEqual({ editInline: false, inlineEdit: false });
  });

  it('control: a named view that says nothing leaves the host`s `inlineEdit` in force', () => {
    // Proves the host layer reaches this node at all, so the two cases above
    // read a precedence and not a host layer the relay never saw.
    expect(read({}, { inlineEdit: true })).toEqual({ editInline: true, inlineEdit: true });
  });

  it('control: inside the named view, an explicit `userActions.editInline` still wins over its `inlineEdit`', () => {
    expect(read({ inlineEdit: true, userActions: { editInline: false } }, null)).toEqual({ editInline: false, inlineEdit: true });
  });
});
