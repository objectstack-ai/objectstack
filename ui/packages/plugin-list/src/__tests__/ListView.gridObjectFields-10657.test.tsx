/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ListView` hands the grid the field catalogue it already holds WITH the
 * rows, so the grid has no first-paint window (objectui#10657, which folded
 * objectui#10706).
 *
 * `ListView` fetches the rows and hands them down as `data`, so they paint
 * before the grid's own `getObjectSchema` read settles; in that window an
 * untyped column over a `password` field has no type, and the grid can only
 * withhold it (`maskedFirstPaint-10657.test.tsx` in `@object-ui/plugin-grid`
 * pins that side, including what the grid draws once it is handed
 * `objectFields`). This list read the object definition BEFORE its rows, so it
 * passes `objectFields` beside `data` — the host channel `SchemaRenderer`
 * keeps for the catalogue (objectui#8818).
 *
 * What is pinned is the HANDOFF, read off a probe registered as `object-grid`:
 * every props bag that carries rows carries the declared catalogue too, so no
 * render ever hands the grid rows without their types. The control is the
 * failed definition read: the rows still arrive, and no catalogue with them,
 * which is the case the grid withholds on its own.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider, SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

const OBJECT = 'vault';

const FIELDS = {
  id: { type: 'text', label: 'Id', hidden: true },
  name: { type: 'text', label: 'Name' },
  api_key: { type: 'password', label: 'API Key' },
};

const ROWS = [{ id: 'v1', name: 'Ada', api_key: 'RAW-ZULU-10657' }];

/** Records every props bag `SchemaRenderer` hands the `object-grid` node. */
const GridProbe = vi.fn((_props: Record<string, unknown>) => <div data-testid="grid-probe" />);

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

beforeEach(() => {
  GridProbe.mockClear();
  ComponentRegistry.register('object-grid', GridProbe as never);
});

afterEach(() => {
  ComponentRegistry.unregister?.('object-grid');
  vi.restoreAllMocks();
  cleanup();
});

function makeDataSource(schemaRead: 'ok' | 'rejected') {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => {
      if (schemaRead === 'rejected') throw new Error('metadata unavailable');
      return { name, label: 'Vault', fields: FIELDS };
    }),
  } as any;
}

function renderList(ds: unknown) {
  const schema = { type: 'list-view', objectName: OBJECT, columns: ['name', 'api_key'] } as unknown as ListViewSchema;
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <SchemaRendererProvider dataSource={ds as any}>
        <ListView schema={schema} dataSource={ds as any} />
      </SchemaRendererProvider>
    </I18nProvider>,
  );
}

/** Every props bag the grid probe received that carried rows. */
const bagsWithRows = () =>
  GridProbe.mock.calls
    .map((call) => call[0])
    .filter((props) => Array.isArray(props.data) && (props.data as unknown[]).length > 0);

describe('ListView → object-grid — the field catalogue travels with the rows (objectui#10657)', () => {
  it('every render that hands the grid rows hands it the declared fields too', async () => {
    const ds = makeDataSource('ok');
    renderList(ds);
    await waitFor(() => expect(bagsWithRows().length).toBeGreaterThan(0));

    for (const bag of bagsWithRows()) {
      expect(bag.objectFields, 'the rows never arrive without their field types').toEqual(FIELDS);
    }
  });

  it('CONTROL: after a failed definition read the rows still arrive, with no catalogue', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = makeDataSource('rejected');
    renderList(ds);
    await waitFor(() => expect(bagsWithRows().length).toBeGreaterThan(0));

    for (const bag of bagsWithRows()) {
      expect('objectFields' in bag, 'nothing is handed down when nothing was read').toBe(false);
    }
  });
});
