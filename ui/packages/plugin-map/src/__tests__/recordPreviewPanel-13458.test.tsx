/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13458 — the map's record overlay mounts the shared
 * `RecordDetailPanel`, as the grid, tree, kanban, calendar and gantt overlays
 * do, in place of a raw `Object.entries(record)` dump.
 *
 * The object declares a label for `owner` and hides `internal_code`. The raw
 * dump drew neither the label (it printed the key) nor honoured `hidden` (it
 * printed every key the row carried), so this row was RED before the change.
 *
 * No WebGL2 under happy-dom, so the map lists its records instead of drawing
 * them (`map-webgl2-fallback`), and a row takes the marker's own click path —
 * the same `selectMarker` a pin calls.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-map` through this package's own entry, at module scope.
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
const ROWS = [{ id: 'm1', name: 'Alpha', lat: 40, lng: -74, owner: 'Ada Lovelace', internal_code: 'ZZ-SECRET' }];

beforeEach(() => {
  // The panel's record-grained permission probe; answered "no verdict" so it
  // fails open and never leaves the test.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 501, json: async () => ({}) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ObjectMap record overlay (objectui#13458)', () => {
  it('mounts RecordDetailPanel: declared labels, `hidden` honoured', async () => {
    const ds = {
      find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => DEF),
    };
    render(
      <SchemaRendererProvider dataSource={ds as never}>
        <SchemaRenderer
          schema={{
            type: 'object-map',
            objectName: OBJECT,
            map: { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name' },
            navigation: { mode: 'drawer' },
          } as never}
        />
      </SchemaRendererProvider>,
    );
    const list = await screen.findByTestId('map-webgl2-fallback');
    fireEvent.click(await within(list).findByText('Alpha'));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const panel = screen.getByRole('dialog');
    await waitFor(() => expect(within(panel).getByText('Assigned To')).toBeInTheDocument());
    expect(within(panel).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(panel).queryByText('ZZ-SECRET')).toBeNull();
    // The raw dump's spelling of a key, which the panel never prints.
    expect(within(panel).queryByText('internal code')).toBeNull();
  });
});
