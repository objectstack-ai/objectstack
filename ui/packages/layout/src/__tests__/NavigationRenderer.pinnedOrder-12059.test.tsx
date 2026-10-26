/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12059 — the sidebar's menu offers no drag-to-reorder; the pinned
 * section is the one place a user orders entries.
 *
 * The maintainer's ruling reverses objectui#11626: an app's menu order is
 * authored in Studio and every user sees it, so `NavigationRenderer` retires
 * `enableReorder` / `onReorder` and draws no grip on any menu row. Personal
 * ordering moves to the pinned section: `pinnedOrder` orders it, and
 * `onPinnedReorder` makes its rows sortable by the row itself (no grip at
 * rest; a grab cursor and an insertion line while dragging), from the keyboard
 * through dnd-kit's keyboard sensor.
 *
 * Instrument: the REAL `DndContext`, sensors and sortable list; nothing in
 * `@dnd-kit` is mocked. The test DOM does no layout, so `getBoundingClientRect`
 * lays the pinned section's rows out one per 32px, which is all
 * `sortableKeyboardCoordinates` and `closestCenter` read. The live drag in a
 * browser is measured on the pull request.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import { NavigationRenderer, type NavigationRendererProps } from '../NavigationRenderer';
import type { AppSchemaRendererProps } from '../AppSchemaRenderer';

const BASE = '/apps/crm';

const entry = (id: string, extra: Partial<NavigationItem> = {}): NavigationItem =>
  ({ id, type: 'object', objectName: id, label: id.toUpperCase(), ...extra }) as NavigationItem;
const pinned = (id: string) => entry(id, { pinned: true } as Partial<NavigationItem>);

/** A grouped menu, the stock shape: three pinned entries in one group. */
const GROUPED: NavigationItem[] = [
  entry('nav_home'),
  {
    id: 'grp_sales',
    type: 'group',
    label: 'Sales',
    children: [pinned('nav_accounts'), pinned('nav_contacts'), pinned('nav_deals')],
  },
  { id: 'grp_ops', type: 'group', label: 'Ops', children: [entry('nav_cases')] },
];
const FLAT: NavigationItem[] = [pinned('nav_accounts'), pinned('nav_contacts'), entry('nav_cases')];

function renderNav(items: NavigationItem[], props: Partial<NavigationRendererProps> = {}) {
  return render(
    <MemoryRouter initialEntries={[BASE]}>
      <SidebarProvider defaultOpen>
        <NavigationRenderer items={items} basePath={BASE} enablePinning onPinToggle={() => {}} {...props} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

/** The pinned section's group; the rest of the sidebar is the app's menu. */
const pinnedSection = () => screen.getByText('Favorites').closest('[data-sidebar="group"]') as HTMLElement;
const pinnedLinks = () => within(pinnedSection()).getAllByRole('link');
const pinnedLabels = () => pinnedLinks().map((a) => a.textContent);
const menuLinks = (container: HTMLElement) =>
  [...container.querySelectorAll('a')].filter((a) => !pinnedSection().contains(a));

// One pinned row every ROW px, in the pinned section's list (the first menu in
// the document); every other element has no box.
const ROW = 32;
const originalRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const list = document.querySelector('[data-sidebar="menu"]');
    const index = list && this.parentElement === list ? [...list.children].indexOf(this) : -1;
    const box = index >= 0 ? { left: 0, top: 100 + index * ROW, width: 240, height: ROW } : { left: 0, top: 0, width: 0, height: 0 };
    const { left, top, width, height } = box;
    return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => box } as DOMRect;
  };
});
afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = originalRect;
});

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const said = () => document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '';

/** Focus a pinned row's link, pick it up with Space, press `arrows`, then `finish`. */
async function keyboardMove(label: string, arrows: string[], finish: 'Space' | 'Escape' = 'Space') {
  const link = within(pinnedSection()).getByRole('link', { name: label });
  link.focus();
  fireEvent.keyDown(link, { code: 'Space', key: ' ' });
  // dnd-kit's keyboard sensor listens for the next key one tick later.
  await tick();
  for (const code of arrows) {
    fireEvent.keyDown(document, { code, key: code });
    await tick();
  }
  const indicator = document.querySelector('[data-drop-indicator]');
  const indicatorAt = indicator
    ? { at: indicator.getAttribute('data-drop-indicator'), row: indicator.closest('li')?.textContent }
    : null;
  // The dragged row's own box while it is held: a keyboard drag does not move it.
  draggedTransform = (link.closest('li') as HTMLElement).style.transform;
  fireEvent.keyDown(document, { code: finish, key: finish === 'Space' ? ' ' : finish });
  await tick();
  return indicatorAt;
}
let draggedTransform = '';

describe('objectui#12059 — the app’s menu is not user-reorderable', () => {
  it.each([
    ['grouped', GROUPED],
    ['group-free', FLAT],
  ] as const)('%s: no menu row carries a grip, a sortable role or the drag instructions', (_shape, items) => {
    const { container } = renderNav(items, { onPinnedReorder: vi.fn() });

    expect(container.querySelectorAll('[aria-roledescription="sortable"]')).toHaveLength(0);
    expect(container.querySelectorAll('[aria-label="Drag to reorder"]')).toHaveLength(0);
    const menu = menuLinks(container);
    // Control: the menu's rows are there to judge.
    expect(menu.length).toBeGreaterThan(0);
    for (const link of menu) {
      expect(link).not.toHaveAttribute('aria-describedby');
      expect(link).not.toHaveClass('cursor-grab');
    }
  });

  it('the retired menu-reorder props are gone from both published prop types', () => {
    // @ts-expect-error — retired (objectui#12059)
    type A = NavigationRendererProps['enableReorder'];
    // @ts-expect-error — retired (objectui#12059)
    type B = NavigationRendererProps['onReorder'];
    // @ts-expect-error — retired (objectui#12059)
    type C = AppSchemaRendererProps['enableReorder'];
    // @ts-expect-error — retired (objectui#12059)
    type D = AppSchemaRendererProps['onReorder'];
    const order: NavigationRendererProps['pinnedOrder'] = ['nav_accounts'];
    expect(order).toEqual(['nav_accounts']);
    expectTypeless<[A, B, C, D]>();
  });
});

describe('objectui#12059 — the pinned section keeps the user’s order', () => {
  it('draws the pinned entries in `pinnedOrder`; an entry it does not name follows in menu order', () => {
    renderNav(GROUPED, { pinnedOrder: ['nav_deals', 'nav_accounts'] });
    expect(pinnedLabels()).toEqual(['NAV_DEALS', 'NAV_ACCOUNTS', 'NAV_CONTACTS']);
  });

  it('control: without `pinnedOrder` the pinned section follows the menu', () => {
    renderNav(GROUPED);
    expect(pinnedLabels()).toEqual(['NAV_ACCOUNTS', 'NAV_CONTACTS', 'NAV_DEALS']);
  });

  it('a pinned row is its own handle: a link with a grab cursor and the drag instructions, no grip', () => {
    renderNav(GROUPED, { onPinnedReorder: vi.fn() });
    for (const link of pinnedLinks()) {
      expect(link).toHaveClass('cursor-grab');
      const instructions = document.getElementById(link.getAttribute('aria-describedby') ?? '');
      expect(instructions?.textContent?.length ?? 0).toBeGreaterThan(0);
      // No grip and no extra focus stop: the row holds its link and its pin button only.
      const row = link.closest('li') as HTMLElement;
      expect([...row.querySelectorAll('a, button, [role="button"], [tabindex]')].map((el) => el.tagName)).toEqual(['A', 'BUTTON']);
    }
    // Nothing is drawn as an insertion line at rest.
    expect(document.querySelectorAll('[data-drop-indicator]')).toHaveLength(0);
  });

  it('control: without `onPinnedReorder` a pinned row is a plain row', () => {
    renderNav(GROUPED, { pinnedOrder: ['nav_accounts'] });
    for (const link of pinnedLinks()) {
      expect(link).not.toHaveClass('cursor-grab');
      expect(link).not.toHaveAttribute('aria-describedby');
    }
  });

  it('reorders from the keyboard: Space picks up, ArrowDown moves past the next row, Space drops', async () => {
    const onPinnedReorder = vi.fn();
    renderNav(GROUPED, { onPinnedReorder });

    const line = await keyboardMove('NAV_ACCOUNTS', ['ArrowDown']);

    // While dragging, the insertion line sat after the row it would land past,
    // and the dragged row stayed in its own place rather than covering it.
    expect(line).toEqual({ at: 'after', row: 'NAV_CONTACTS' });
    expect(draggedTransform).toBe('');
    expect(onPinnedReorder).toHaveBeenCalledTimes(1);
    expect(onPinnedReorder).toHaveBeenCalledWith(['nav_contacts', 'nav_accounts', 'nav_deals']);
    // The live region spoke about the moved row.
    expect(said()).toContain('nav_accounts');
  });

  it('moving up draws the line before the row it lands ahead of', async () => {
    const onPinnedReorder = vi.fn();
    renderNav(GROUPED, { onPinnedReorder });

    const line = await keyboardMove('NAV_DEALS', ['ArrowUp', 'ArrowUp']);

    expect(line).toEqual({ at: 'before', row: 'NAV_ACCOUNTS' });
    expect(onPinnedReorder).toHaveBeenCalledWith(['nav_deals', 'nav_accounts', 'nav_contacts']);
  });

  it('Escape cancels, and Enter never picks a row up (it follows the link)', async () => {
    const onPinnedReorder = vi.fn();
    renderNav(GROUPED, { onPinnedReorder });

    await keyboardMove('NAV_ACCOUNTS', ['ArrowDown'], 'Escape');
    expect(onPinnedReorder).not.toHaveBeenCalled();

    const link = within(pinnedSection()).getByRole('link', { name: 'NAV_ACCOUNTS' });
    link.focus();
    fireEvent.keyDown(link, { code: 'Enter', key: 'Enter' });
    await tick();
    fireEvent.keyDown(document, { code: 'ArrowDown', key: 'ArrowDown' });
    await tick();
    expect(document.querySelectorAll('[data-drop-indicator]')).toHaveLength(0);
    // Lit control: the same row does pick up with Space.
    await keyboardMove('NAV_ACCOUNTS', ['ArrowDown']);
    expect(onPinnedReorder).toHaveBeenCalledTimes(1);
  });

  it('a pointer drag released over its own link does not let the browser follow that link', () => {
    const onPinnedReorder = vi.fn();
    const items: NavigationItem[] = [
      { id: 'nav_site', type: 'url', url: 'https://example.com/', label: 'Site', pinned: true } as NavigationItem,
      pinned('nav_accounts'),
    ];
    renderNav(items, { onPinnedReorder });
    const site = within(pinnedSection()).getByRole('link', { name: 'Site' });

    // The click as the browser would deliver it after the press is released.
    // `record` sits last on its path (window, bubbling): it notes whether the
    // click got that far and stops the test DOM from following the link itself.
    let reached: { prevented: boolean } | null = null;
    const record = (event: Event) => { reached = { prevented: event.defaultPrevented }; event.preventDefault(); };
    window.addEventListener('click', record);
    try {
      // Control: a plain click reaches the window unprevented — the browser's to follow.
      fireEvent.click(site);
      expect(reached).toEqual({ prevented: false });

      // A drag: press, cross the activation distance, come back, release.
      reached = null;
      fireEvent.pointerDown(site, { isPrimary: true, button: 0, clientX: 20, clientY: 116 });
      fireEvent.pointerMove(document, { isPrimary: true, clientX: 20, clientY: 130 });
      fireEvent.pointerMove(document, { isPrimary: true, clientX: 20, clientY: 116 });
      fireEvent.pointerUp(document, { isPrimary: true, button: 0, clientX: 20, clientY: 116 });
      // `fireEvent` answers `false` when the click's default was prevented; it
      // was prevented before the click reached `record`.
      expect(fireEvent.click(site)).toBe(false);
      expect(reached).toBeNull();
    } finally {
      window.removeEventListener('click', record);
    }
    // Dropped where it started: no new order.
    expect(onPinnedReorder).not.toHaveBeenCalled();
  });
});

/** Uses the type aliases above so the `@ts-expect-error` lines are not unused-symbol noise. */
function expectTypeless<_T>(): void {}
