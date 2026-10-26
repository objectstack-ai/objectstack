/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13458 — the list and gallery record overlays mount the shared
 * `RecordDetailPanel`, as the grid, tree, kanban, calendar and gantt overlays
 * do, in place of a raw `Object.entries(record)` dump.
 *
 * The object declares a label for `owner` and hides `internal_code`. The raw
 * dump drew neither the label (it printed the key) nor honoured `hidden` (it
 * printed every key the row carried), so both rows below were RED before the
 * change. The last row pins the fallback that stays: with no object name there
 * is no record for the panel to address, and the plain reading of the row is
 * what the overlay draws.
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import {
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
} from '@object-ui/test-support';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';
// Registers `object-gallery` → the real `ObjectGallery`.
import '../index';

const OBJECT = 'store';
const DEF = {
  name: OBJECT,
  fields: {
    name: { type: 'text', label: 'Store Name' },
    owner: { type: 'text', label: 'Assigned To' },
    internal_code: { type: 'text', label: 'Internal Code', hidden: true },
  },
};
const ROWS = [{ id: 'r1', name: 'Alpha', owner: 'Ada Lovelace', internal_code: 'ZZ-SECRET' }];

function makeDataSource() {
  return {
    find: vi.fn(async () => ROWS),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => DEF),
  };
}

const dialog = async () => {
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  return screen.getByRole('dialog');
};

/** The declared reading: the label, the value, and no hidden field. */
async function expectDeclaredReading() {
  const panel = await dialog();
  await waitFor(() => expect(within(panel).getByText('Assigned To')).toBeInTheDocument());
  expect(within(panel).getByText('Ada Lovelace')).toBeInTheDocument();
  expect(within(panel).queryByText('ZZ-SECRET')).toBeNull();
  // The raw dump's spelling of a key, which the panel never prints.
  expect(within(panel).queryByText('internal code')).toBeNull();
}

let prevObjectGrid: ReturnType<typeof ComponentRegistry.get>;

beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  // Minimal stand-in for the real grid: the row-click affordance ListView
  // hands every child view, and nothing else (`plugin-list` does not depend on
  // `plugin-grid`).
  ComponentRegistry.register('object-grid', (props: never) => {
    const onRowClick = (props as { onRowClick?: (r: unknown) => void }).onRowClick;
    return (
      <button type="button" data-testid="stub-row" onClick={() => onRowClick?.(ROWS[0])}>
        row
      </button>
    );
  });
});

afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});

beforeEach(() => installRecordSecurityExplainDouble(vi));

afterEach(() => {
  assertNoOtherNetworkEscape(expect);
  cleanup();
  vi.unstubAllGlobals();
});

describe('ListView record overlay (objectui#13458)', () => {
  it('mounts RecordDetailPanel: declared labels, `hidden` honoured', async () => {
    const ds = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
        <ListView
          schema={{
            type: 'list-view',
            objectName: OBJECT,
            viewType: 'grid',
            fields: ['name'],
            navigation: { mode: 'drawer' },
          } as ListViewSchema}
          dataSource={ds}
        />
      </SchemaRendererProvider>,
    );
    fireEvent.click(await screen.findByTestId('stub-row'));
    await expectDeclaredReading();
  });

  it('keeps the plain reading of the row when no object names a record', async () => {
    render(
      <SchemaRendererProvider dataSource={makeDataSource() as unknown as DataSource}>
        <ListView
          schema={{
            type: 'list-view',
            viewType: 'grid',
            fields: ['name'],
            data: { provider: 'value', items: ROWS },
            navigation: { mode: 'drawer' },
          } as ListViewSchema}
        />
      </SchemaRendererProvider>,
    );
    fireEvent.click(await screen.findByTestId('stub-row'));
    const panel = await dialog();
    expect(within(panel).getByText('internal code')).toBeInTheDocument();
    expect(within(panel).getByText('ZZ-SECRET')).toBeInTheDocument();
  });
});

describe('ObjectGallery record overlay (objectui#13458)', () => {
  it('mounts RecordDetailPanel: declared labels, `hidden` honoured', async () => {
    const ds = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
        <SchemaRenderer
          schema={{
            type: 'object-gallery',
            objectName: OBJECT,
            data: ROWS,
            gallery: { titleField: 'name' },
            navigation: { mode: 'drawer' },
          } as never}
        />
      </SchemaRendererProvider>,
    );
    fireEvent.click((await screen.findAllByRole('listitem'))[0]);
    await expectDeclaredReading();
  });
});
