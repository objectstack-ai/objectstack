/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#5236 — `allowAddTab` rendered a dead button.
 *
 * The affordance had hover styling and `title="Add filter tab"` but no
 * `onClick`, and the component took no add-tab callback: a control that looked
 * fully clickable and did nothing, which disguises "not implemented" as "a bug
 * where clicking does nothing". Maintainer ruling **A1** (2026-08-06) wired it
 * up instead of removing it: naming input, snapshot of the filters currently
 * applied, and the new tab is **session-scoped**.
 *
 * Session scope here means **component state** — no metadata, no API, no
 * storage (ADR-0047: an end user's filter choices are session-scoped and never
 * become metadata). `sessionStorage` was available and deliberately not used:
 * `UserFilters` receives no object/view identity, so any storage key it could
 * invent would be shared by every list in the browser tab. These tests pin
 * that decision from both sides — nothing is written (`Storage.setItem`, the
 * data source, `fetch` all stay at zero calls) and nothing survives a remount.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import { UserFilters } from '../UserFilters';
import type { DataSource } from '@object-ui/types';

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Two authored presets, the first one the author's default. */
const tabsConfig = {
  element: 'tabs' as const,
  tabs: [
    {
      name: 'open',
      label: 'Open',
      isDefault: true,
      filter: [{ field: 'status', operator: 'equals', value: 'todo' }],
    },
    {
      name: 'urgent',
      label: 'Urgent',
      filter: [{ field: 'priority', operator: 'equals', value: 'urgent' }],
    },
  ],
};

const OPEN_CONDITIONS = [['status', 'equals', 'todo']];
const URGENT_CONDITIONS = [['priority', 'equals', 'urgent']];

/** Open the naming popover, type `label`, confirm. */
function addTab(label: string) {
  fireEvent.click(screen.getByTestId('filter-tab-add'));
  fireEvent.change(screen.getByTestId('filter-tab-add-input'), { target: { value: label } });
  fireEvent.click(screen.getByTestId('filter-tab-add-confirm'));
}

/** The pill wrapper carries the active styling for a session tab. */
function pillClassName(tabId: string): string {
  return screen.getByTestId(`filter-tab-${tabId}`).parentElement?.className ?? '';
}

describe('UserFilters tabs — allowAddTab (objectstack#5236, ruling A1)', () => {
  it('clicking add opens a naming input; confirming snapshots the applied filters into a new, selected tab', () => {
    const onFilterChange = vi.fn();
    const onSelectionsChange = vi.fn();
    render(
      <UserFilters
        config={{ ...tabsConfig, allowAddTab: true }}
        data={[]}
        onFilterChange={onFilterChange}
        onSelectionsChange={onSelectionsChange}
      />,
    );

    // Move off the default so the snapshot has something distinguishable in it.
    fireEvent.click(screen.getByTestId('filter-tab-urgent'));
    expect(onFilterChange).toHaveBeenLastCalledWith(URGENT_CONDITIONS);

    // The add affordance now opens a naming input rather than doing nothing.
    fireEvent.click(screen.getByTestId('filter-tab-add'));
    expect(screen.getByTestId('filter-tab-add-content')).toBeTruthy();
    const input = screen.getByTestId('filter-tab-add-input') as HTMLInputElement;
    // Empty name cannot be confirmed.
    expect((screen.getByTestId('filter-tab-add-confirm') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: '  My urgent  ' } });
    expect((screen.getByTestId('filter-tab-add-confirm') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('filter-tab-add-confirm'));

    // The new tab renders in the same bar, label trimmed, and is selected.
    const added = screen.getByTestId('filter-tab-__session_1__');
    expect(added.textContent).toBe('My urgent');
    expect(added.closest('[data-testid="user-filters-tabs"]')).toBeTruthy();
    expect(pillClassName('__session_1__')).toContain('bg-primary');
    expect(onSelectionsChange).toHaveBeenLastCalledWith({ _tab: ['__session_1__'] });

    // …carrying the conditions that were applied when it was created.
    expect(onFilterChange).toHaveBeenLastCalledWith(URGENT_CONDITIONS);
  });

  it('the snapshot is stored, not recomputed — switching away and back re-emits the captured conditions', () => {
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        config={{ ...tabsConfig, allowAddTab: true }}
        data={[]}
        onFilterChange={onFilterChange}
      />,
    );

    fireEvent.click(screen.getByTestId('filter-tab-urgent'));
    addTab('Snapshot');

    fireEvent.click(screen.getByTestId('filter-tab-open'));
    expect(onFilterChange).toHaveBeenLastCalledWith(OPEN_CONDITIONS);

    fireEvent.click(screen.getByTestId('filter-tab-__session_1__'));
    expect(onFilterChange).toHaveBeenLastCalledWith(URGENT_CONDITIONS);
    expect(pillClassName('__session_1__')).toContain('bg-primary');
  });

  it('snapshots an empty condition set when "All records" is the active tab', () => {
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        config={{ ...tabsConfig, allowAddTab: true }}
        data={[]}
        onFilterChange={onFilterChange}
      />,
    );

    fireEvent.click(screen.getByTestId('filter-tab-__all__'));
    addTab('Everything');
    expect(onFilterChange).toHaveBeenLastCalledWith([]);

    fireEvent.click(screen.getByTestId('filter-tab-urgent'));
    fireEvent.click(screen.getByTestId('filter-tab-__session_1__'));
    expect(onFilterChange).toHaveBeenLastCalledWith([]);
  });

  it('confirms on Enter as well as on the button', () => {
    render(
      <UserFilters config={{ ...tabsConfig, allowAddTab: true }} data={[]} onFilterChange={vi.fn()} />,
    );

    fireEvent.click(screen.getByTestId('filter-tab-add'));
    fireEvent.change(screen.getByTestId('filter-tab-add-input'), { target: { value: 'Typed' } });
    fireEvent.keyDown(screen.getByTestId('filter-tab-add-input'), { key: 'Enter' });

    expect(screen.getByTestId('filter-tab-__session_1__').textContent).toBe('Typed');
  });

  it('adds a second tab under its own id', () => {
    render(
      <UserFilters config={{ ...tabsConfig, allowAddTab: true }} data={[]} onFilterChange={vi.fn()} />,
    );

    addTab('First');
    addTab('Second');

    expect(screen.getByTestId('filter-tab-__session_1__').textContent).toBe('First');
    expect(screen.getByTestId('filter-tab-__session_2__').textContent).toBe('Second');
  });
});

describe('UserFilters tabs — adding a tab writes nothing (ADR-0047)', () => {
  it('calls no data-source method, no fetch, and no web storage', () => {
    const dataSource = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // Storage.prototype covers both sessionStorage and localStorage.
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    // COUNTER-PROBE (objectui#7786). `toHaveBeenCalledTimes(0)` at the bottom
    // of this test is a NEGATIVE assertion, and a BLIND instrument satisfies it
    // for the wrong reason -- measured on Node 26.7.0, where the memory-storage
    // swap in `vitest.setup.base.ts` hands out a plain object that never
    // inherited from `Storage.prototype`, this file passed green while the spy
    // could not see a single write. So before asserting anything about writes
    // this component did NOT make, assert once that the spy observes writes we
    // make ourselves -- in BOTH stores the comment above claims to cover, since
    // a store can be handed out already bound to its own method.
    const PROBE_KEY = 'objectui:7786:counter-probe';
    sessionStorage.setItem(PROBE_KEY, '1');
    localStorage.setItem(PROBE_KEY, '1');
    expect(
      setItem,
      'the Storage.prototype spy is BLIND: it did not observe the two writes made in this very test, so the zero-write assertions below would pass for the wrong reason',
    ).toHaveBeenCalledTimes(2);
    sessionStorage.removeItem(PROBE_KEY);
    localStorage.removeItem(PROBE_KEY);
    // The probe's own writes are not the component's; clear them so the
    // load-bearing assertion below stays exactly the claim it always was.
    setItem.mockClear();

    render(
      <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
        <UserFilters
          config={{ ...tabsConfig, allowAddTab: true }}
          data={[]}
          onFilterChange={vi.fn()}
        />
      </SchemaRendererProvider>,
    );

    fireEvent.click(screen.getByTestId('filter-tab-urgent'));
    addTab('No metadata please');
    expect(screen.getByTestId('filter-tab-__session_1__')).toBeTruthy();

    // A session tab is not metadata: no write API of any shape was reached.
    expect(dataSource.create).toHaveBeenCalledTimes(0);
    expect(dataSource.update).toHaveBeenCalledTimes(0);
    expect(dataSource.delete).toHaveBeenCalledTimes(0);
    expect(dataSource.find).toHaveBeenCalledTimes(0);
    expect(dataSource.findOne).toHaveBeenCalledTimes(0);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(setItem).toHaveBeenCalledTimes(0);
  });
});

describe('UserFilters tabs — session tabs do not survive a remount', () => {
  it('drops the added tab and falls back to the author default, even when the host mirrored the tab id back', () => {
    const first = vi.fn();
    const { unmount } = render(
      <UserFilters config={{ ...tabsConfig, allowAddTab: true }} data={[]} onFilterChange={first} />,
    );
    fireEvent.click(screen.getByTestId('filter-tab-urgent'));
    addTab('Ephemeral');
    expect(screen.getByTestId('filter-tab-__session_1__')).toBeTruthy();

    unmount();

    // The host persists `_tab` (uf_* URL params), so it hands the synthetic id
    // straight back. The tab itself is gone and the restored id resolves to
    // nothing, so the author's default wins — no empty bar, no stale filters.
    const second = vi.fn();
    render(
      <UserFilters
        config={{ ...tabsConfig, allowAddTab: true }}
        data={[]}
        onFilterChange={second}
        initialSelections={{ _tab: ['__session_1__'] }}
      />,
    );

    expect(screen.queryByTestId('filter-tab-__session_1__')).toBeNull();
    expect(screen.queryByText('Ephemeral')).toBeNull();
    expect(second).toHaveBeenLastCalledWith(OPEN_CONDITIONS);
    expect(screen.getByTestId('filter-tab-open').className).toContain('bg-primary');
  });
});

describe('UserFilters tabs — session tabs can be removed', () => {
  it('removing the active session tab re-selects the author default and re-emits its filters', () => {
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        config={{ ...tabsConfig, allowAddTab: true }}
        data={[]}
        onFilterChange={onFilterChange}
      />,
    );

    fireEvent.click(screen.getByTestId('filter-tab-urgent'));
    addTab('Temporary');
    fireEvent.click(screen.getByTestId('filter-tab-remove-__session_1__'));

    expect(screen.queryByTestId('filter-tab-__session_1__')).toBeNull();
    expect(onFilterChange).toHaveBeenLastCalledWith(OPEN_CONDITIONS);
    expect(screen.getByTestId('filter-tab-open').className).toContain('bg-primary');
  });

  it('removing an inactive session tab leaves the applied filters alone', () => {
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        config={{ ...tabsConfig, allowAddTab: true }}
        data={[]}
        onFilterChange={onFilterChange}
      />,
    );

    addTab('Temporary');
    fireEvent.click(screen.getByTestId('filter-tab-urgent'));
    const callsBefore = onFilterChange.mock.calls.length;

    fireEvent.click(screen.getByTestId('filter-tab-remove-__session_1__'));

    expect(screen.queryByTestId('filter-tab-__session_1__')).toBeNull();
    expect(onFilterChange.mock.calls.length).toBe(callsBefore);
    expect(screen.getByTestId('filter-tab-urgent').className).toContain('bg-primary');
  });

  it('offers no remove affordance on authored presets', () => {
    render(
      <UserFilters config={{ ...tabsConfig, allowAddTab: true }} data={[]} onFilterChange={vi.fn()} />,
    );

    expect(screen.queryByTestId('filter-tab-remove-open')).toBeNull();
    expect(screen.queryByTestId('filter-tab-remove-urgent')).toBeNull();
    expect(screen.queryByTestId('filter-tab-remove-__all__')).toBeNull();
  });
});

describe('UserFilters tabs — allowAddTab off (regression)', () => {
  it('renders no add affordance when allowAddTab is false', () => {
    render(
      <UserFilters config={{ ...tabsConfig, allowAddTab: false }} data={[]} onFilterChange={vi.fn()} />,
    );
    expect(screen.getByTestId('user-filters-tabs')).toBeTruthy();
    expect(screen.queryByTestId('filter-tab-add')).toBeNull();
  });

  it('renders no add affordance when allowAddTab is omitted', () => {
    render(<UserFilters config={tabsConfig} data={[]} onFilterChange={vi.fn()} />);
    expect(screen.getByTestId('user-filters-tabs')).toBeTruthy();
    expect(screen.queryByTestId('filter-tab-add')).toBeNull();
  });
});
