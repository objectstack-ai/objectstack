/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12082 — the `object-view` toolbar's create button reads the
 * `listNew` row of the affordance-to-grant map.
 *
 * Before, the button read the node's own `showCreate` and `operations.create`
 * toggles and no grant at all, so a caller without the create grant was
 * offered a New that opened a form the server then refused to save. The
 * console's own list pages already read `listNew` (`ObjectView` /
 * `ObjectDataPage` in `@object-ui/app-shell`); this is the same affordance on
 * the SDUI `object-view` node, so it reads the same row.
 *
 * Measured through the REAL `MePermissionsProvider`, over the four grant
 * shapes the map's enumeration pin uses. The authoring toggles still narrow:
 * `showCreate: false` hides the button under the full grant.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import type { ObjectViewSchema, DataSource } from '@object-ui/types';

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => <div data-testid="schema-renderer">{schema?.type}</div>,
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

import { ObjectView } from '../ObjectView';

afterEach(cleanup);

const OBJECT = 'contacts';

const dataSource = (): DataSource => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue({}),
  update: vi.fn().mockResolvedValue({}),
  delete: vi.fn().mockResolvedValue({}),
  getObjectSchema: vi.fn().mockResolvedValue({ name: OBJECT, label: 'Contacts', fields: { name: { type: 'text' } } }),
} as unknown as DataSource);

const SHAPES: Array<{ shape: string; bits: Record<string, boolean>; create: boolean }> = [
  { shape: 'create-only', bits: { allowCreate: true, allowRead: true, allowEdit: false, allowDelete: false }, create: true },
  { shape: 'edit-only', bits: { allowCreate: false, allowRead: true, allowEdit: true, allowDelete: false }, create: false },
  { shape: 'read-only', bits: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false }, create: false },
  { shape: 'full', bits: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true }, create: true },
];

const envelope = (bits: Record<string, boolean>): MePermissionsResponse => ({
  authenticated: true,
  userId: 'u-pin',
  tenantId: null,
  roles: ['member'],
  permissionSets: ['member'],
  objects: { [OBJECT]: bits },
  fields: {},
});

const schema = (extra: Partial<ObjectViewSchema> = {}): ObjectViewSchema => ({ type: 'object-view', objectName: OBJECT, ...extra });

describe('object-view create button reads the listNew row (objectui#12082)', () => {
  it.each(SHAPES)('$shape grant: New shows exactly when the create grant allows it', async ({ bits, create }) => {
    render(
      <MePermissionsProvider initialPermissions={envelope(bits)}>
        <ObjectView schema={schema()} dataSource={dataSource()} />
      </MePermissionsProvider>,
    );
    // Wait for the schema read to settle so the policy layer has its answer.
    await screen.findByTestId('object-grid');
    expect(screen.queryByRole('button', { name: 'New' }) !== null).toBe(create);
  });

  it('fail-open: with no permission provider mounted, New shows as before', async () => {
    render(<ObjectView schema={schema()} dataSource={dataSource()} />);
    await screen.findByTestId('object-grid');
    expect(screen.getByRole('button', { name: 'New' })).toBeDefined();
  });

  it('the authoring toggle still narrows: showCreate false hides New under the full grant', async () => {
    render(
      <MePermissionsProvider initialPermissions={envelope(SHAPES[3].bits)}>
        <ObjectView schema={schema({ showCreate: false })} dataSource={dataSource()} />
      </MePermissionsProvider>,
    );
    await screen.findByTestId('object-grid');
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
  });

  it('the effective operation set still narrows: an apiOperations set without create hides New under the full grant', async () => {
    render(
      <MePermissionsProvider
        initialPermissions={{ ...envelope(SHAPES[3].bits), objects: { [OBJECT]: { ...SHAPES[3].bits, apiOperations: ['read', 'update'] } } }}
      >
        <ObjectView schema={schema()} dataSource={dataSource()} />
      </MePermissionsProvider>,
    );
    await screen.findByTestId('object-grid');
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
  });
});
