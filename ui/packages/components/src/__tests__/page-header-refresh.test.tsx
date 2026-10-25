/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `page:header` — the manual refresh ⟳ (objectui#3460).
 *
 * MES shop-floor scenario: operator A sits on a work-order detail page while
 * operator B starts/reports the same order. A had no way to see it but F5.
 * The header now offers a ⟳ that publishes on the #2269 invalidation bus, so
 * the record, its related lists and the tab-count badges refetch IN PLACE.
 *
 * What this file pins, and why each one is a separate failure mode:
 *
 *   1. The button is HOST-OPTED-IN — it renders iff `RecordContext.refresh`
 *      exists. Every other host (previews, the embedded drawer, non-record
 *      pages) must render byte-for-byte what it rendered before, so the
 *      no-refresh cases assert the *absence* of the button AND the survival of
 *      the `data-page-actions-slot` layout div.
 *   2. It is page CHROME, not a header action: it lives OUTSIDE the actions
 *      `role="toolbar"`, at the far end of the row, and therefore cannot be
 *      collapsed into the `⋯` overflow when an object declares more actions
 *      than `maxVisible`. That property is the whole reason it isn't wired
 *      through the action pipeline, so it is asserted rather than assumed.
 *   3. Its accessible name comes from `common.refresh` — an existing key in all
 *      ten packs — so an icon-only button is not English-only for the nine
 *      other locales (the same failure objectstack#5407 fixed for `⋯`).
 *   4. Clicking calls the host's refresh exactly once and spins for a floor of
 *      ~650ms. The bus is fire-and-forget, so without the floor a warm backend
 *      renders the click as "nothing happened".
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `page:header` at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';

/** Must track MANUAL_REFRESH_SPIN_MS in `renderers/layout/containers.tsx`. */
const SPIN_MS = 650;

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

const refreshButton = () => document.querySelector('[data-page-refresh]') as HTMLButtonElement | null;
const spinIcon = () => refreshButton()?.querySelector('svg')?.getAttribute('class') ?? '';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('page:header — the ⟳ is host-opted-in (objectui#3460)', () => {
  it('renders no ⟳ when the host provides no refresh', () => {
    renderHeader();

    expect(refreshButton()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('leaves a no-refresh header exactly as it was — actions slot included', () => {
    const { container } = renderHeader();

    // The empty-actions layout placeholder must still be the header's own
    // trailing child, not moved inside a new wrapper: this is the regression
    // guard for every host that never opts in.
    const slot = container.querySelector('[data-page-actions-slot]');
    expect(slot).toBeTruthy();
    expect(slot!.parentElement?.tagName).toBe('HEADER');
  });

  it('renders the ⟳ once the host provides refresh', () => {
    renderHeader({ refresh: vi.fn() });

    expect(refreshButton()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });

  it('renders the ⟳ before the record has loaded (bare-title header branch)', () => {
    // A record page's first paint has no `ctx.data`, so `page:header` takes its
    // non-record layout. The button must not pop in and out between branches.
    renderHeader({ refresh: vi.fn(), record: undefined });

    expect(refreshButton()).toBeTruthy();
  });
});

describe('page:header — the ⟳ is chrome, not an action (objectui#3460)', () => {
  it('sits at the far end of the header row, after the ⋯ overflow trigger', () => {
    // Four actions against the default maxVisible of 3 → three inline buttons
    // plus the ⋯ trigger. The ⟳ comes last of all.
    renderHeader({
      refresh: vi.fn(),
      actions: [
        { name: 'start', locations: ['record_header'], label: 'Start' },
        { name: 'expedite', locations: ['record_header'], label: 'Expedite' },
        { name: 'edit', locations: ['record_header'], label: 'Edit' },
        { name: 'archive', locations: ['record_header'], label: 'Archive' },
      ],
    });

    const buttons = Array.from(document.querySelectorAll('header button'));
    expect(buttons.length).toBeGreaterThan(4);
    expect(buttons[buttons.length - 1]).toBe(refreshButton());
    // …and the one before it is the overflow trigger, i.e. the ⟳ did not steal
    // an inline slot from the actions.
    expect(buttons[buttons.length - 2]?.getAttribute('aria-label')).toBe('More actions');
  });

  it('stays out of the actions toolbar so the overflow budget cannot swallow it', () => {
    renderHeader({
      refresh: vi.fn(),
      actions: [
        { name: 'a', locations: ['record_header'], label: 'A' },
        { name: 'b', locations: ['record_header'], label: 'B' },
        { name: 'c', locations: ['record_header'], label: 'C' },
        { name: 'd', locations: ['record_header'], label: 'D' },
      ],
    });

    const toolbar = document.querySelector('[role="toolbar"]');
    expect(toolbar).toBeTruthy();
    expect(toolbar!.contains(refreshButton())).toBe(false);
    // Not routed into the ⋯ menu either — it is still a visible button.
    expect(refreshButton()).toBeTruthy();
  });

  it('renders alongside the actions when the host also injects system actions', () => {
    renderHeader({
      refresh: vi.fn(),
      actions: [{ name: 'start', locations: ['record_header'], label: 'Start' }],
    });

    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
    expect(refreshButton()).toBeTruthy();
  });
});

describe('page:header — the ⟳ speaks the session locale (objectui#3460)', () => {
  it('reads common.refresh under a zh session', () => {
    renderHeader({ refresh: vi.fn(), language: 'zh' });

    expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy();
    // The English literal asserted negatively too — a re-inlined default would
    // otherwise pass the positive assertion on a header with two buttons.
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('reads common.refresh under a ja session', () => {
    renderHeader({ refresh: vi.fn(), language: 'ja' });

    expect(screen.getByRole('button', { name: '更新' })).toBeTruthy();
  });

  it('still reads English under an en session', () => {
    renderHeader({ refresh: vi.fn(), language: 'en' });

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });
});

describe('page:header — clicking the ⟳ (objectui#3460)', () => {
  it("calls the host's refresh exactly once per click", () => {
    const refresh = vi.fn();
    renderHeader({ refresh });

    fireEvent.click(refreshButton()!);
    expect(refresh).toHaveBeenCalledTimes(1);

    fireEvent.click(refreshButton()!);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('spins for the whole feedback floor, then stops', () => {
    const refresh = vi.fn();
    renderHeader({ refresh });
    expect(spinIcon()).not.toContain('animate-spin');

    vi.useFakeTimers();
    fireEvent.click(refreshButton()!);
    expect(spinIcon()).toContain('animate-spin');

    // Still spinning just short of the floor…
    act(() => { vi.advanceTimersByTime(SPIN_MS - 50); });
    expect(spinIcon()).toContain('animate-spin');

    // …and stopped once it elapses.
    act(() => { vi.advanceTimersByTime(60); });
    expect(spinIcon()).not.toContain('animate-spin');
  });

  it('restarts the floor on a second click instead of ending early', () => {
    const refresh = vi.fn();
    renderHeader({ refresh });

    vi.useFakeTimers();
    fireEvent.click(refreshButton()!);
    act(() => { vi.advanceTimersByTime(SPIN_MS - 100); });
    fireEvent.click(refreshButton()!);
    // The first click's timer would have fired here; the second click's floor
    // must still be running.
    act(() => { vi.advanceTimersByTime(150); });
    expect(spinIcon()).toContain('animate-spin');

    act(() => { vi.advanceTimersByTime(SPIN_MS); });
    expect(spinIcon()).not.toContain('animate-spin');
  });
});
