/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ListView`'s record-detail overlay heading resolves an inline locale map —
 * objectui#9373.
 *
 * ## The defect this pins
 *
 * `ListViewSchema.label` is an `I18nLabel`: a plain string **OR** an inline
 * locale map (`{ en: 'Accounts', 'zh-CN': '客户' }`). The `detailTitle`
 * computation handed the raw member straight into `t()`'s interpolation
 * options as `{ label: schema.label }`. Both interpolators stringify an object
 * the same way, so the heading rendered `[object Object] Detail`.
 *
 * `detailTitle` is `NavigationOverlay`'s `title` prop, and objectui#3426
 * established that whatever it computes IS the visible heading of the
 * record-detail drawer / modal / split / popover — the overlay's own
 * `detail.recordDetail` default never applies once a host passes a title. So
 * these assertions go through the mounted overlay and read the heading, never
 * a local variable.
 *
 * ## Why no compiler run ever named the site
 *
 * `createSafeTranslation`'s `t` declares its options bag as a record of
 * `unknown`. An `unknown`-typed sink accepts the map without a diagnostic, so
 * no `tsc` run could reach this read and none would appear if the fix were
 * reverted. Only an executed assertion holds it — this file.
 *
 * ## Resolution happens BEFORE the truthiness test, and that is observable
 *
 * `resolveI18nLabel` answers `undefined` for a map with no usable entry and
 * `''` for an empty entry. Every object is truthy, so testing the raw
 * `schema.label` cannot fall through to the `objectName` branch the way a
 * missing label always did. The two fall-through cases below are what
 * distinguish resolving before the test from resolving inside the branch;
 * a fix written the second way leaves them red.
 *
 * ## Direction, written before the run (reverse verification)
 *
 * On the pre-fix tree the three map cases were PREDICTED red — heading
 * `[object Object] Detail` — and the string-label case green, since the string
 * arm never touched the union's second limb and is the negative control that
 * proves the harness itself is sound. Measured outcome is recorded on the PR.
 *
 * ## Locale channel, and why this file mounts no `I18nProvider`
 *
 * `useDisplayLocale` composes tenant locale → active UI language → `'en'`.
 * `LocalizationProvider` drives its first limb, pinning the locale
 * deterministically without registering a react-i18next global instance.
 * That registration is the hazard `ListView.overlayTitleNoProviderFallback`
 * documents: it survives `cleanup()`, so one mounted `I18nProvider` would
 * silently resolve every later render in this file against that instance.
 * Keeping it out means the leg measured here is the provider-less
 * `interpolateFallback` path, where the option value reaches `String(v)`.
 * The i18next interpolator leg is measured in
 * `ListView.overlayTitleI18n.test.tsx`, which already owns a provider.
 *
 * **Do not import or mount `I18nProvider` here.**
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { LocalizationProvider } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';
import type { DataSource, ListViewSchema } from '@object-ui/types';

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The value
 * this file injects is deliberately NOT an adapter — it is a partial stub
 * carrying only the members the path under test calls; completing it would
 * change which capability probes fire, and so would change what this test
 * measures. The injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`.
 */

const rows = [{ id: '1', name: 'Alice' }];

const mockDataSource = {
  find: vi.fn().mockResolvedValue(rows),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

/** The map an author writes; `zh-CN` exists so a locale switch is observable. */
const INLINE_MAP = { en: 'Accounts', 'zh-CN': '客户' };

/** The exact byte sequence the defect produced, quoted so a reader sees it. */
const STRINGIFIED = '[object Object] Detail';

let prevObjectGrid: ReturnType<typeof ComponentRegistry.get>;

beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  // Minimal stand-in for the real grid: exposes the row-click affordance
  // ListView hands every child view, and nothing else. `plugin-list` does not
  // depend on `plugin-grid`.
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

function renderList(schemaExtra: Record<string, unknown>, locale: string) {
  return render(
    <LocalizationProvider value={{ locale }}>
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
      </SchemaRendererProvider>
    </LocalizationProvider>,
  );
}

/** Open the detail overlay the way a user does: click a row in the child view. */
async function openOverlay(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByTestId('stub-row'));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  return screen.getByRole('dialog');
}

describe('ListView record-detail overlay heading resolves an inline locale map (objectui#9373)', () => {
  /* ── The map arm: what was broken ─────────────────────────────────────── */

  it('renders the audience-locale entry, not the stringified object', async () => {
    renderList({ objectName: 'accounts', label: INLINE_MAP }, 'zh-CN');
    const dialog = await openOverlay();

    // The heading element itself, inside the overlay, not a local variable.
    expect(within(dialog).getByText('客户 Detail')).toBeInTheDocument();
    // Stated separately because this is the exact string the defect rendered.
    expect(within(dialog).queryByText(STRINGIFIED)).toBeNull();
    // And the heading is what NAMES the overlay, which is the user-visible
    // claim objectui#3426 settled for this family.
    expect(screen.getByRole('dialog', { name: '客户 Detail' })).toBeInTheDocument();
  });

  it('picks the English entry of the same map under an en audience', async () => {
    renderList({ objectName: 'accounts', label: INLINE_MAP }, 'en');
    const dialog = await openOverlay();

    expect(within(dialog).getByText('Accounts Detail')).toBeInTheDocument();
    expect(within(dialog).queryByText(STRINGIFIED)).toBeNull();
  });

  /* ── Fall-through: resolution precedes the truthiness test ────────────── */

  it('falls through to objectName when the map carries no usable entry', async () => {
    renderList({ objectName: 'contacts', label: {} }, 'zh-CN');
    const dialog = await openOverlay();

    expect(within(dialog).getByText('Contacts Detail')).toBeInTheDocument();
    expect(within(dialog).queryByText(STRINGIFIED)).toBeNull();
  });

  it('falls through to objectName when the audience entry is empty', async () => {
    renderList({ objectName: 'contacts', label: { 'zh-CN': '' } }, 'zh-CN');
    const dialog = await openOverlay();

    expect(within(dialog).getByText('Contacts Detail')).toBeInTheDocument();
    expect(within(dialog).queryByText(STRINGIFIED)).toBeNull();
  });

  /* ── The string arm: the negative control ─────────────────────────────── */

  it('CONTROL — a plain string label is untouched by the resolution', async () => {
    renderList({ objectName: 'accounts', label: 'Accounts' }, 'zh-CN');
    const dialog = await openOverlay();

    expect(within(dialog).getByText('Accounts Detail')).toBeInTheDocument();
  });
});
