/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `page:header` — the manual refresh (objectui#3460), drawn as the first item
 * of the `⋯` menu (objectstack#27055).
 *
 * MES shop-floor scenario: operator A sits on a work-order detail page while
 * operator B starts/reports the same order. A had no way to see it but F5.
 * The header offers a Refresh that publishes on the #2269 invalidation bus,
 * so the record, its related lists and the tab-count badges refetch IN PLACE.
 *
 * The v3 header (objectstack#27055, the maintainer-approved design: 「1 主 +
 * 2 次 + ⋯（刷新收进 ⋯）」) moved it from a ⟳ button at the end of the row
 * into the `⋯`. What this file pins, and why each one is a separate failure
 * mode:
 *
 *   1. It is HOST-OPTED-IN — it renders iff `RecordContext.refresh` exists.
 *      Every other host (previews, the embedded drawer, non-record pages)
 *      must render what it rendered before, so the no-refresh cases assert
 *      the *absence* of the item AND the survival of the
 *      `data-page-actions-slot` layout div.
 *   2. It is the FIRST item of the `⋯` and never takes an inline slot: the
 *      row is 1 primary + 2 secondary, the rest folds. With no action at all
 *      the `⋯` still draws, holding the refresh alone.
 *   3. Its accessible name comes from `common.refresh` — an existing key in all
 *      ten packs.
 *   4. Choosing it calls the host's refresh exactly once.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `page:header` at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

const OBJECT_SCHEMA = { name: 'mes_work_order', label: 'Work Order' };
const RECORD = { id: 'WO-1', name: 'WO-0001' };

interface Opts {
  refresh?: () => void;
  /** Omit for "the record hasn't loaded yet" (the bare-title header branch). */
  record?: any;
  actions?: any[];
  language?: string;
}

function renderHeader(opts: Opts = {}) {
  const schema: any = { type: 'page:header', title: 'Work Order' };
  if (opts.actions) schema.actions = opts.actions;
  return render(
    <I18nProvider
      config={{ defaultLanguage: opts.language ?? 'en', detectBrowserLanguage: false }}
    >
      <ActionProvider>
        <RecordContextProvider
          objectName={OBJECT_SCHEMA.name}
          recordId={RECORD.id}
          data={'record' in opts ? opts.record : RECORD}
          objectSchema={OBJECT_SCHEMA}
          refresh={opts.refresh}
        >
          <PageHeader schema={schema} />
        </RecordContextProvider>
      </ActionProvider>
    </I18nProvider>,
  );
}

const refreshItem = () => document.querySelector('[data-page-refresh]') as HTMLElement | null;
const moreTrigger = () => screen.queryByRole('button', { name: /More actions|更多操作|その他の操作/ });

async function openMore(): Promise<void> {
  const trigger = moreTrigger();
  expect(trigger, 'the ⋯ trigger is drawn').toBeTruthy();
  fireEvent.pointerDown(trigger!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
}

afterEach(() => {
  cleanup();
});

describe('page:header — the refresh is host-opted-in (objectui#3460)', () => {
  it('draws no ⋯ and no refresh when the host provides no refresh and the page no action', () => {
    renderHeader();

    expect(moreTrigger()).toBeNull();
    expect(refreshItem()).toBeNull();
  });

  it('leaves a no-refresh header exactly as it was — actions slot included', () => {
    const { container } = renderHeader();

    const slot = container.querySelector('[data-page-actions-slot]');
    expect(slot).toBeTruthy();
    expect(slot!.parentElement?.tagName).toBe('HEADER');
  });

  it('draws the ⋯ holding the refresh alone once the host provides refresh', async () => {
    renderHeader({ refresh: vi.fn() });

    // No ⟳ in the row any more (objectstack#27055).
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    await openMore();
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Refresh']);
  });

  it('draws it before the record has loaded (bare-title header branch)', async () => {
    renderHeader({ refresh: vi.fn(), record: undefined });

    await openMore();
    expect(refreshItem()).toBeTruthy();
  });
});

describe('page:header — 1 primary + 2 secondary + ⋯, refresh first in the ⋯ (objectstack#27055)', () => {
  it('four actions → one filled primary, two outline buttons, the fourth and the refresh in the ⋯', async () => {
    renderHeader({
      refresh: vi.fn(),
      actions: [
        { name: 'start', locations: ['record_header'], label: 'Start' },
        { name: 'expedite', locations: ['record_header'], label: 'Expedite' },
        { name: 'report', locations: ['record_header'], label: 'Report' },
        { name: 'archive', locations: ['record_header'], label: 'Archive' },
      ],
    });

    const toolbar = document.querySelector('[role="toolbar"]')!;
    const rowNames = Array.from(toolbar.querySelectorAll(':scope > button, :scope > span > button')).map(
      (button) => button.getAttribute('aria-label') ?? button.textContent,
    );
    expect(rowNames).toEqual(['Start', 'Expedite', 'Report', 'More actions']);
    await openMore();
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Refresh', 'Archive']);
  });

  it('a record_more-only action folds behind the refresh', async () => {
    renderHeader({
      refresh: vi.fn(),
      actions: [
        { name: 'start', locations: ['record_header'], label: 'Start' },
        { name: 'clone', locations: ['record_more'], label: 'Clone' },
      ],
    });

    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
    await openMore();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Refresh', 'Clone']);
  });
});

describe('page:header — the refresh speaks the session locale (objectui#3460)', () => {
  it('reads common.refresh under a zh session', async () => {
    renderHeader({ refresh: vi.fn(), language: 'zh' });

    await openMore();
    expect(screen.getByRole('menuitem', { name: '刷新' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Refresh' })).toBeNull();
  });

  it('reads common.refresh under a ja session', async () => {
    renderHeader({ refresh: vi.fn(), language: 'ja' });

    await openMore();
    expect(screen.getByRole('menuitem', { name: '更新' })).toBeTruthy();
  });
});

describe('page:header — choosing Refresh (objectui#3460)', () => {
  it("calls the host's refresh exactly once per choice", async () => {
    const refresh = vi.fn();
    renderHeader({ refresh });

    await openMore();
    fireEvent.click(refreshItem()!);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
