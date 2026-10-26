/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ListView`'s record-detail overlay heading still resolves to ENGLISH, and to
 * the SAME BYTES as before, when no `I18nProvider` is mounted — objectui#3426.
 *
 * This is not a nice-to-have. Routing a literal through `t()` without a working
 * default is exactly how a provider-less consumer breaks, and it breaks in a
 * suite that is not this one: `list-view` is a public page block, so any host
 * that renders schema without mounting a provider (this package's own tests,
 * the preview gallery, an embedding app) reads whatever the defaults map says.
 * The English defaults live in `LIST_DEFAULT_TRANSLATIONS` (`ListView.tsx`) —
 * that map is what `createSafeTranslation` falls back to when its
 * `list.recordCount` probe comes back unresolved.
 *
 * The byte-identity matters beyond aesthetics: the heading is `Contacts Detail`
 * before the change and `Contacts Detail` after, so e2e specs and host tests
 * that address this chrome by its English name keep addressing it.
 *
 * Direction: this file was GREEN before the change and is GREEN after. It pins
 * the FALLBACK, not the fix — the fix is asserted in
 * `ListView.overlayTitleI18n.test.tsx`. A missing map entry would have turned
 * it red by rendering the raw key `detail.recordDetailWithLabel`, which is
 * precisely the regression it exists to catch.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` calls `instance.use(initReactI18next)`, and `initReactI18next`
 * registers that instance as **react-i18next's module-global default**. The
 * registration survives unmount and `cleanup()`. So the moment any test in a
 * file mounts `<I18nProvider config={{ defaultLanguage: 'zh' }}>`, every later
 * "no provider" render in that same file silently resolves against the Chinese
 * instance — a green-looking file that asserts nothing about the fallback.
 *
 * Vitest's `dom` project runs with `isolate: true`, so a file that never mounts
 * a provider gets a genuinely clean global. Keep it that way: **do not import
 * or mount `I18nProvider` here.**
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';
import type { DataSource, ListViewSchema } from '@object-ui/types';

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are partial stubs carrying only the members the path under test calls;
 * completing them would change which capability probes fire, and so would
 * change what these tests measure.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */

const rows = [{ id: '1', name: 'Alice' }];

const mockDataSource = {
  find: vi.fn().mockResolvedValue(rows),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

let prevObjectGrid: ReturnType<typeof ComponentRegistry.get>;

beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', (props: never) => {
    const onRowClick = (props as { onRowClick?: (r: unknown) => void }).onRowClick;
    return (
      <button type="button" data-testid="stub-row" onClick={() => onRowClick?.(rows[0])}>
        row
      </button>
    );
  });
});

afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});

afterEach(() => cleanup());

function renderList(schemaExtra: Record<string, unknown>) {
  return render(
    <SchemaRendererProvider dataSource={mockDataSource as unknown as DataSource}>
      <ListView
        schema={{
          type: 'list-view',
          viewType: 'grid',
          fields: ['name'],
          data: { provider: 'value', items: rows },
          navigation: { mode: 'drawer' },
          ...schemaExtra,
        } as unknown as ListViewSchema}
        dataSource={mockDataSource}
      />
    </SchemaRendererProvider>,
  );
}

async function openOverlay() {
  fireEvent.click(await screen.findByTestId('stub-row'));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
}

describe('ListView overlay heading — English fallback with no provider (objectui#3426)', () => {
  it('interpolates the authored label in English, never the raw key', async () => {
    renderList({ objectName: 'contacts', label: 'Contacts' });
    await openOverlay();

    expect(screen.getByText('Contacts Detail')).toBeInTheDocument();
    expect(screen.queryByText('detail.recordDetailWithLabel')).toBeNull();
  });

  it('capitalizes objectName in English when no label is authored', async () => {
    renderList({ objectName: 'contacts' });
    await openOverlay();

    expect(screen.getByText('Contacts Detail')).toBeInTheDocument();
  });

  it('falls back to the bare English heading when the schema names nothing', async () => {
    renderList({});
    await openOverlay();

    expect(screen.getByText('Record Detail')).toBeInTheDocument();
    expect(screen.queryByText('detail.recordDetail')).toBeNull();
  });
});
