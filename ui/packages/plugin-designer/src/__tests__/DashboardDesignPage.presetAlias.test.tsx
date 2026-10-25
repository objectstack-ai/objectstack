/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4165 — the REWRITE-ON-SAVE half of the ADR-0089 alias window.
 *
 * The maintainer ruling (2026-08-11) made the bare preset NAME the single
 * canonical spelling of a `type: 'date'` global filter's `defaultValue`, and
 * turned the stored `{ preset }` object form into a documented legacy alias:
 * *lift on read, rewrite on next save, retirement window recorded at the read
 * site*.
 *
 * The lift half is pinned in `@object-ui/core` and `@object-ui/types`. This
 * file pins the rewrite half, and it is the load-bearing one for the window's
 * ability to ever CLOSE: the read-side lift makes a legacy document work
 * forever, which by itself would keep the alias alive forever too. Something
 * has to drain the legacy spelling off disk, and this page — the console's
 * `/design/dashboard/:name` route — is the only place in objectui that both
 * reads a stored dashboard document and writes one back (measured in #4165:
 * `resolveDashboardFilterDefs`' own callers are read-side, and no code path
 * persists a resolved filter def).
 *
 * Asserted against the real `dataSource.update` payload rather than component
 * state, because the payload is the thing that reaches storage — a lift that
 * only normalized the draft would look identical in state and change nothing
 * on disk.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';

const update = vi.fn().mockResolvedValue(undefined);
const dashboards: any[] = [];

vi.mock('react-router-dom', () => ({
  useParams: () => ({ dashboardName: 'sales' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAdapter: () => ({ update }),
    useMetadata: () => ({ dashboards, refresh: () => Promise.resolve() }),
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DashboardDesignPage } from '../pages/DashboardDesignPage';

/** The stored document, in whichever spelling the case is about. */
function storedDashboard(defaultValue: unknown): DashboardComponentSchema {
  return {
    type: 'dashboard',
    name: 'sales',
    title: 'Sales',
    columns: 2,
    widgets: [{ id: 'w1', type: 'metric', title: 'Revenue' }],
    globalFilters: [
      { name: 'created_at', field: 'created_at', type: 'date', label: 'Date Range', defaultValue },
    ],
  } as unknown as DashboardComponentSchema;
}

/**
 * Load the stored document into the page and make one ordinary edit.
 *
 * The edit is a real user gesture on a real control — adding a widget — rather
 * than a synthetic Ctrl+S, because dispatching a `KeyboardEvent` to trigger a
 * global listener is banned by ADR-0054 C1 (`object-ui/no-synthetic-event-
 * trigger`). It is also the better test: "the next save" in the ruling means
 * the next time the user changes anything, and `addWidget` touches only
 * `widgets`, so whatever reaches `globalFilters` in the payload got there from
 * the loaded draft and nowhere else.
 */
function loadAndEdit(stored: DashboardComponentSchema) {
  dashboards.length = 0;
  dashboards.push(stored);
  render(<DashboardDesignPage />);
  fireEvent.click(screen.getByTestId('dashboard-add-metric'));
  const calls = update.mock.calls;
  return calls[calls.length - 1];
}

const savedFilters = (call: unknown[] | undefined) =>
  (call?.[2] as { globalFilters?: Array<{ defaultValue?: unknown }> })?.globalFilters;

const savedFilterDefault = (call: unknown[] | undefined) => savedFilters(call)?.[0]?.defaultValue;

describe('DashboardDesignPage — rewrite-on-save for the legacy `{ preset }` alias (#4165)', () => {
  beforeEach(() => {
    update.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('persists the CANONICAL bare preset name for a dashboard stored with `{ preset }`', () => {
    const call = loadAndEdit(storedDashboard({ preset: 'last_7_days' }));
    expect(call?.[0]).toBe('sys_dashboard');
    expect(savedFilterDefault(call)).toBe('last_7_days');
  });

  it('never writes the object form back — not even nested somewhere else', () => {
    const call = loadAndEdit(storedDashboard({ preset: 'last_7_days' }));
    expect(JSON.stringify(call?.[2])).not.toContain('"preset"');
  });

  it('leaves an already-canonical dashboard\'s filters untouched, by identity', () => {
    // The lift returns the SAME reference when there is nothing to lift, so
    // opening a canonical dashboard cannot manufacture a spurious rewrite. The
    // edit replaces `widgets`, so `globalFilters` should still be the very array
    // that was loaded — identity, not just deep equality.
    const stored = storedDashboard('last_7_days');
    const call = loadAndEdit(stored);
    expect(savedFilters(call)).toBe((stored as unknown as { globalFilters: unknown }).globalFilters);
    expect(savedFilterDefault(call)).toBe('last_7_days');
  });

  it('leaves a `{ preset, from, to }` default alone — it has no canonical spelling', () => {
    // Rewriting it would have to drop the bounds. Storage keeps what it had;
    // the schema's named rejection is what surfaces the problem.
    const stored = storedDashboard({ preset: 'last_7_days', from: '2026-01-01' });
    const call = loadAndEdit(stored);
    expect(savedFilterDefault(call)).toEqual({ preset: 'last_7_days', from: '2026-01-01' });
  });
});
