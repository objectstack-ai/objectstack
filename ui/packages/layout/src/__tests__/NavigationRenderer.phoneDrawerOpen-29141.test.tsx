/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29141 — opening the phone nav drawer renders each row once, and
 * a long menu's opening frame draws only the rows that fit the window.
 *
 * Before: every row asked `useIsMobile()` itself. That hook answers `false` on
 * its first render and corrects itself in an effect, so each time the drawer
 * opened (the sheet mounts the tree afresh) the whole tree rendered at desktop
 * size, then every row set state and the tree rendered a second time. At 4x
 * CPU the showcase drawer (54 rows) took 300-580 ms to open.
 *
 * The harness opens the "drawer" the way the shell does: the sidebar provider
 * is already mounted and settled at a phone's width, and the tree mounts under
 * it. Each row with no `label` asks `resolveTargetLabel` for its text once per
 * render, so the spy counts row renders. A `Profiler` records the links in the
 * DOM at each commit of the tree.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import { NavigationRenderer, type NavTargetLabelResolver } from '../NavigationRenderer';

const BASE = '/apps/showcase';

beforeAll(() => {
  // jsdom has no `matchMedia`; the sidebar provider's `useIsMobile` reads it.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight };
function setWindow(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
}

afterEach(() => {
  cleanup();
  setWindow(ORIGINAL.width, ORIGINAL.height);
});

/** `count` unlabelled object entries: each shows its target's label. */
const entries = (count: number): NavigationItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `entry_${i + 1}`,
    type: 'object',
    objectName: `object_${i + 1}`,
  })) as NavigationItem[];

/**
 * Mounts the provider, lets it settle at the window's width, then opens the
 * tree under it. Returns the label spy and the link count at each commit.
 */
async function openDrawer(items: NavigationItem[], width: number, height: number) {
  setWindow(width, height);
  const labelOf = vi.fn<NavTargetLabelResolver>((target) =>
    target.kind === 'object' ? `Label ${target.objectName}` : undefined,
  );
  const linksPerCommit: number[] = [];
  let open: () => void = () => {};
  function Drawer() {
    const [shown, setShown] = React.useState(false);
    open = () => setShown(true);
    if (!shown) return null;
    return (
      <React.Profiler
        id="nav"
        onRender={() => {
          linksPerCommit.push(document.querySelectorAll('a[href]').length);
        }}
      >
        <NavigationRenderer items={items} basePath={BASE} resolveTargetLabel={labelOf} />
      </React.Profiler>
    );
  }
  render(
    <MemoryRouter initialEntries={[BASE]}>
      <SidebarProvider>
        <Drawer />
      </SidebarProvider>
    </MemoryRouter>,
  );
  await act(async () => {
    open();
  });
  return { labelOf, linksPerCommit };
}

/** How many times each object's row rendered. */
function rendersPerRow(labelOf: ReturnType<typeof vi.fn>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [target] of labelOf.mock.calls) {
    const name = (target as { objectName: string }).objectName;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

describe('NavigationRenderer — opening the phone drawer (objectstack#29141)', () => {
  it('renders each row once, in one commit, when the menu fits the window', async () => {
    const { labelOf, linksPerCommit } = await openDrawer(entries(6), 375, 844);
    const counts = rendersPerRow(labelOf);
    expect([...counts.keys()]).toEqual(entries(6).map((e) => (e as { objectName: string }).objectName));
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
    expect(linksPerCommit).toEqual([6]);
    // Drawn at phone size, from the first commit.
    expect(screen.getByRole('link', { name: 'Label object_1' })).toHaveClass('min-h-[44px]');
  });

  it('a long menu draws the rows that fit in the opening frame, the rest right after, each row once', async () => {
    const fit = Math.ceil(844 / 44);
    const { labelOf, linksPerCommit } = await openDrawer(entries(60), 375, 844);
    // The opening frame holds at least the rows the window shows, and not the whole menu.
    expect(linksPerCommit.length).toBe(2);
    expect(linksPerCommit[0]).toBeGreaterThanOrEqual(fit);
    expect(linksPerCommit[0]).toBeLessThan(60);
    // Then every entry, in order, each rendered once: the rows drawn first are not drawn again.
    expect(linksPerCommit[1]).toBe(60);
    const counts = rendersPerRow(labelOf);
    expect(counts.size).toBe(60);
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
    const names = screen.getAllByRole('link').map((a) => a.textContent);
    expect(names).toEqual(entries(60).map((_, i) => `Label object_${i + 1}`));
  });

  it('a group counts its open children toward the opening frame, and every row still shows', async () => {
    const items: NavigationItem[] = [
      { id: 'grp_a', type: 'group', label: 'Group A', children: entries(30) },
      {
        id: 'grp_b',
        type: 'group',
        label: 'Group B',
        children: entries(40).slice(30).map((e) => ({ ...e, id: `b_${e.id}` })),
      },
    ] as NavigationItem[];
    const { linksPerCommit } = await openDrawer(items, 375, 844);
    // Group A (31 rows) fills the window, so Group B joins after the opening frame.
    expect(linksPerCommit[0]).toBe(30);
    expect(linksPerCommit[linksPerCommit.length - 1]).toBe(40);
    expect(screen.getByRole('button', { name: 'Group B' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('on a wide window the whole menu draws at once, and each row keeps its icon-rail tooltip', async () => {
    const { labelOf, linksPerCommit } = await openDrawer(entries(60), 1280, 844);
    // Every row from the first commit (the tooltips' own state may commit again; no row re-renders).
    expect(linksPerCommit[0]).toBe(60);
    expect([...rendersPerRow(labelOf).values()].every((n) => n === 1)).toBe(true);
    // The tooltip trigger marks the row; on a phone the primitive would draw that tooltip hidden.
    expect(screen.getByRole('link', { name: 'Label object_1' })).toHaveAttribute('data-state', 'closed');
    expect(screen.getByRole('link', { name: 'Label object_1' })).not.toHaveClass('min-h-[44px]');
  });

  it('a phone row carries no tooltip trigger', async () => {
    await openDrawer(entries(3), 375, 844);
    expect(screen.getByRole('link', { name: 'Label object_1' })).not.toHaveAttribute('data-state');
  });
});
