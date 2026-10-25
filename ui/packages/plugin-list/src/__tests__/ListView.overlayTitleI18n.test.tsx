/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ListView`'s record-detail overlay heading speaks the session locale —
 * objectui#3426.
 *
 * ── Why this path is user-reachable (the issue left it unverified) ─────────
 * `list-view` / `list` are PUBLIC page blocks (`packages/core/src/registry/
 * public-blocks.ts`) and `navigation` is an authorable key on the list schema
 * (`ViewNavigationConfig`, aligned with `@objectstack/spec ListView.navigation`).
 * `useNavigationOverlay` turns `mode: 'drawer' | 'modal' | 'split' | 'popover'`
 * into `isOverlay`; `ListView` forwards `navigation.handleClick` to whichever
 * child view it renders (`viewComponentSchema.onRowClick`) and owns the overlay
 * itself. So any page metadata that drops a list block with an overlay
 * navigation mode gets this drawer — no console/app-shell involvement.
 *
 * The one host that DOES suppress it is `app-shell`'s `ObjectView`, which
 * passes its own `onRowClick` (that takes full priority inside
 * `useNavigationOverlay`) and renders its own overlay. That is a host override,
 * not proof the branch is dead: `ObjectView` is one consumer of a public block.
 *
 * The child view is stubbed (same pattern as `ListView.test.tsx`'s inline-edit
 * spy) so the row click under test is ListView's OWN `onRowClick` contract with
 * its child, not a re-test of `ObjectGrid`'s row rendering — `plugin-list` does
 * not depend on `plugin-grid`.
 *
 * ── Direction of these assertions ─────────────────────────────────────────
 * The non-English cases (zh / ja / de) were RED before the change — the drawer
 * was titled by a TypeScript template literal (`` `${schema.label} Detail` ``),
 * so a zh session read "Contacts Detail" — and are GREEN after. The `en` case
 * was GREEN before AND after: it pins that routing the heading through `t()`
 * did not change a single byte of what an English session sees.
 *
 * The provider-less fallback is asserted in
 * `ListView.overlayTitleNoProviderFallback.test.tsx` — it cannot live in this
 * file, because `createI18n` registers its instance as react-i18next's
 * module-global default and that registration survives `cleanup()`.
 *
 * ── The inline-locale-map arm (objectui#9373) ─────────────────────────────
 * `label` is an `I18nLabel`, so an author may write an inline locale map
 * instead of a string. The last case below covers the map on THIS leg — the
 * i18next interpolator — and was RED before that change: the raw map reached
 * the interpolation options and the heading read `[object Object]详情`. The
 * provider-less `interpolateFallback` leg, the map's fall-through cases and
 * the string negative control live in
 * `ListView.overlayTitleInlineLocale-9373.test.tsx`, which must mount no
 * provider for the reason stated just above.
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
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
  // Minimal stand-in for the real grid: exposes the row-click affordance
  // ListView hands every child view, and nothing else.
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

function renderListIn(language: string, schemaExtra: Partial<ListViewSchema>) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <SchemaRendererProvider dataSource={mockDataSource as unknown as DataSource}>
        <ListView
          schema={{
            type: 'list-view',
            objectName: 'contacts',
            viewType: 'grid',
            fields: ['name'],
            navigation: { mode: 'drawer' },
            ...schemaExtra,
          } as ListViewSchema}
          dataSource={mockDataSource}
        />
      </SchemaRendererProvider>
    </I18nProvider>,
  );
}

/** Open the detail overlay the way a user does: click a row in the child view. */
async function openOverlay() {
  fireEvent.click(await screen.findByTestId('stub-row'));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
}

describe('ListView record-detail overlay heading (objectui#3426)', () => {
  it('renders the authored label in English under an en session', async () => {
    renderListIn('en', { label: 'Contacts' });
    await openOverlay();

    expect(screen.getByText('Contacts Detail')).toBeInTheDocument();
  });

  it('renders the zh bundle value under a zh session', async () => {
    renderListIn('zh', { label: '联系人' });
    await openOverlay();

    expect(screen.getByText('联系人详情')).toBeInTheDocument();
    // The whole point of the issue: no English leaks into a zh drawer.
    expect(screen.queryByText('联系人 Detail')).toBeNull();
  });

  it('renders the ja bundle value under a ja session', async () => {
    renderListIn('ja', { label: '取引先' });
    await openOverlay();

    expect(screen.getByText('取引先の詳細')).toBeInTheDocument();
  });

  it('renders the de bundle value under a de session', async () => {
    renderListIn('de', { label: 'Kontakte' });
    await openOverlay();

    expect(screen.getByText('Kontakte-Details')).toBeInTheDocument();
  });

  /**
   * Second branch: no `label`, so the heading is built from the capitalized
   * `objectName`. Same key, same interpolation — this exists because the
   * branch is separately spelled in the source and a partial fix would leave
   * it English.
   */
  it('falls back to the capitalized objectName through the same key', async () => {
    renderListIn('zh', {});
    await openOverlay();

    expect(screen.getByText('Contacts详情')).toBeInTheDocument();
  });

  /**
   * Third branch: neither label nor objectName — reuses `detail.recordDetail`,
   * the very key `NavigationOverlay` defaults to. Pins that the two headings
   * cannot drift into two different translations of one control.
   *
   * Rows come from inline `data` here: with no `objectName` there is nothing
   * for the data-source fetch to query, so the view would paint its empty
   * state and render no child view at all.
   */
  it('reuses detail.recordDetail when the schema names nothing', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={mockDataSource as unknown as DataSource}>
          <ListView
            schema={{
              type: 'list-view',
              viewType: 'grid',
              fields: ['name'],
              data: { provider: 'value', items: rows },
              navigation: { mode: 'drawer' },
            } as unknown as ListViewSchema}
            dataSource={mockDataSource}
          />
        </SchemaRendererProvider>
      </I18nProvider>,
    );
    await openOverlay();

    expect(screen.getByText('记录详情')).toBeInTheDocument();
  });

  /**
   * The map arm on the i18next interpolator (objectui#9373). `label` admits an
   * inline locale map, and handing that object to the options bag stringifies
   * it — the heading named the record `[object Object]` in every session. The
   * `zh` entry is asserted rather than `en` so the reading also shows the
   * resolution honouring the audience locale rather than always answering the
   * first key.
   */
  it('resolves an inline locale map for the session locale', async () => {
    renderListIn('zh', { label: { en: 'Contacts', zh: '联系人' } as ListViewSchema['label'] });
    await openOverlay();

    expect(screen.getByText('联系人详情')).toBeInTheDocument();
    expect(screen.queryByText('[object Object]详情')).toBeNull();
  });
});
