/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12518 — in a flex host, the strip's tab count follows the HOST's
 * width, not the width of the tabs the strip happens to be drawing.
 *
 * Since objectui#12440 the console hands the bar to the list toolbar's leading
 * slot, a flex row. A bar root that does not take that slot's width is sized by
 * its content, so the strip measures what it drew and the fit answers its own
 * previous answer: each fold narrows the strip, the observer re-fits, and the
 * next fold narrows it again, down to one tab and "N more".
 *
 * happy-dom lays nothing out, and with no layout every tab shows — so a test
 * that only counted seven tabs would pass with no layout at all. This file lays
 * the bar out itself: a one-line row-flex model over the utilities that decide
 * a width on this chain (`flex`, `gap-0.5`, `flex-1`, `w-full`, `min-w-0`,
 * `shrink-0`), read from the classes the component renders — it is not told
 * which element carries the fix. Every leaf (a tab, the "N more" trigger, the
 * "+" button) has a fixed width. A `ResizeObserver` stand-in delivers what a
 * browser does: an entry whenever an observed element's laid-out width moves,
 * round after round until the layout settles.
 *
 * The narrow width is 500 px, not 400: seven 90 px tabs need 4 × 92 + 80 =
 * 448 px of strip for four tabs beside the trigger's first-draw estimate, and a
 * 400 px host leaves 366 (the "+" button takes 34), which the fit answers with
 * three.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { ViewTabBar, type ViewTabItem } from '../ViewTabBar';

const SEVEN: ViewTabItem[] = Array.from({ length: 7 }, (_, i) => ({
  id: `v${i + 1}`,
  label: `View ${i + 1}`,
  type: 'grid',
}));

/** A tab's drawn width. */
const TAB_PX = 90;
/** The "N more" trigger's drawn width. */
const TRIGGER_PX = 72;
/** The "+" add-view button's drawn width. */
const ADD_PX = 32;
/** `gap-0.5`. */
const GAP_PX = 2;

/** The host: the list toolbar's leading slot, with that slot's classes. */
const HOST = '[data-testid="list-toolbar-leading"]';
let hostPx = 0;

const isRowFlex = (el: Element) =>
  (el.classList.contains('flex') || el.classList.contains('inline-flex')) && !el.classList.contains('flex-col');
const gapOf = (el: Element) => (el.classList.contains('gap-0.5') ? GAP_PX : 0);

/** A leaf's fixed width, or `null` for an element laid out from its children. */
function leafWidth(el: Element): number | null {
  if (el.hasAttribute('data-view-tab-frame')) return TAB_PX;
  const id = el.getAttribute('data-testid');
  if (id === 'view-tab-overflow') return TRIGGER_PX;
  if (id === 'view-tab-add') return ADD_PX;
  return null;
}

/** Max-content width: a leaf's own, otherwise the children side by side. */
function contentWidth(el: Element): number {
  const leaf = leafWidth(el);
  if (leaf != null) return leaf;
  const kids = Array.from(el.children);
  return kids.reduce((sum, kid) => sum + contentWidth(kid), 0) + gapOf(el) * Math.max(0, kids.length - 1);
}

/**
 * The width `el` is laid out at: the host's own, and below it one flex line —
 * each item's basis, then the free space shared by grow factor, or a deficit
 * taken back by shrink factor × basis down to the item's minimum. An item
 * without `min-w-0` keeps its content width as its minimum (on this chain every
 * such item is a leaf). Outside the host nothing is laid out: `0`.
 */
function widthOf(el: Element): number {
  if (el.matches(HOST)) return hostPx;
  if (!el.closest(HOST)) return 0;
  const leaf = leafWidth(el);
  if (leaf != null) return leaf;
  const parent = el.parentElement!;
  const container = widthOf(parent);
  if (!isRowFlex(parent)) return container; // a block box fills its container
  const items = Array.from(parent.children).map((item) => {
    const c = item.classList;
    return {
      item,
      basis: c.contains('flex-1') ? 0 : c.contains('w-full') ? container : contentWidth(item),
      grow: c.contains('flex-1') ? 1 : 0,
      shrink: c.contains('shrink-0') ? 0 : 1,
      min: c.contains('min-w-0') ? 0 : contentWidth(item),
    };
  });
  const free = container - items.reduce((s, i) => s + i.basis, 0) - gapOf(parent) * (items.length - 1);
  const self = items.find((i) => i.item === el)!;
  if (free >= 0) {
    const grow = items.reduce((s, i) => s + i.grow, 0);
    return self.basis + (grow > 0 ? (free * self.grow) / grow : 0);
  }
  const scaled = items.reduce((s, i) => s + i.shrink * i.basis, 0);
  return Math.max(self.min, self.basis + (scaled > 0 ? (free * self.shrink * self.basis) / scaled : 0));
}

/** Delivers an entry whenever an observed element's laid-out width moves. */
class LayoutResizeObserver {
  static live = new Set<LayoutResizeObserver>();
  private readonly seen = new Map<Element, number>();
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(el: Element) {
    this.seen.set(el, Number.NaN); // a browser delivers once on observe
    LayoutResizeObserver.live.add(this);
  }
  unobserve(el: Element) {
    this.seen.delete(el);
  }
  disconnect() {
    this.seen.clear();
    LayoutResizeObserver.live.delete(this);
  }
  deliver(): boolean {
    const moved = [...this.seen].filter(([el, w]) => widthOf(el) !== w).map(([el]) => el);
    if (moved.length === 0) return false;
    for (const el of moved) this.seen.set(el, widthOf(el));
    this.callback(
      moved.map((target) => ({ target }) as unknown as ResizeObserverEntry),
      this as unknown as ResizeObserver,
    );
    return true;
  }
}

/** Run the observers until no observed width moves. */
function settle() {
  for (let round = 0; round < 50; round++) {
    let delivered = false;
    act(() => {
      for (const observer of [...LayoutResizeObserver.live]) delivered = observer.deliver() || delivered;
    });
    if (!delivered) return;
  }
  throw new Error('the layout never settled');
}

function mountInHost(px: number) {
  hostPx = px;
  render(
    <div data-testid="list-toolbar-leading" className="flex min-w-0 flex-1 items-center">
      <ViewTabBar views={SEVEN} activeViewId="v1" onViewChange={vi.fn()} onAddView={vi.fn()} />
    </div>,
  );
  settle();
}

function resizeHost(px: number) {
  hostPx = px;
  settle();
}

/** The tabs on the strip, by view id, in order. */
const shownTabs = () =>
  Array.from(document.querySelectorAll('[data-view-tab-frame]')).map((el) => el.getAttribute('data-view-tab-frame'));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', LayoutResizeObserver);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const width = widthOf(this);
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  LayoutResizeObserver.live.clear();
});

describe('ViewTabBar in a flex host fits its tabs to the host, not to what it drew (objectui#12518)', () => {
  it('at an 852 px host all seven 90 px tabs show, with no "more" trigger', () => {
    mountInHost(852);
    // The layout is live: the strip has the host's width less the "+" button.
    expect(screen.getByTestId('view-tab-strip').getBoundingClientRect().width).toBe(852 - ADD_PX - GAP_PX);
    expect(shownTabs()).toEqual(['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7']);
    expect(screen.queryByTestId('view-tab-overflow')).toBeNull();
  });

  it('narrowed to 500 px, four tabs show and "3 more"; widened back to 852 px, all seven show again', () => {
    mountInHost(852);
    resizeHost(500);
    expect(shownTabs()).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(screen.getByTestId('view-tab-overflow')).toHaveTextContent('3 more');
    resizeHost(852);
    expect(shownTabs()).toHaveLength(7);
    expect(screen.queryByTestId('view-tab-overflow')).toBeNull();
  });

  it('first measured while one tab is drawn, the strip still re-fits to the host: 200 → 852 → 851 → 852 px ends at seven', () => {
    mountInHost(200);
    expect(shownTabs()).toEqual(['v1']);
    expect(screen.getByTestId('view-tab-overflow')).toHaveTextContent('6 more');
    resizeHost(852);
    expect(shownTabs()).toHaveLength(7);
    resizeHost(851);
    expect(shownTabs()).toHaveLength(7);
    resizeHost(852);
    expect(shownTabs()).toHaveLength(7);
    expect(screen.queryByTestId('view-tab-overflow')).toBeNull();
  });
});
