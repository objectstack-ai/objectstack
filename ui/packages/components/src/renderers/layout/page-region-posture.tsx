/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';

/**
 * How a block in a page region should present itself, judged by the region's
 * MEASURED width against the page's (objectui#12703).
 *
 *  - `'compact'`: the region is narrower than half the page — the `aside` rail
 *    beside `main`, a sidebar, a third of a three-column body. A list block
 *    there draws a short list (title, count, two-line rows) instead of the
 *    object list's own chrome.
 *  - `'full'`: the region is half the page or wider.
 *
 * `null` — the answer outside any page region, and inside one whose width is
 * not known yet (no layout: server render, jsdom, the first render before the
 * measurement lands). A block reads `null` exactly as `'full'`: an unknown
 * width keeps today's full rendering.
 *
 * ⭐ DERIVED, never authored. `@objectstack/spec` declares no posture or
 * `compact` key on a page, a region or a block, and this adds none: the page
 * renderer measures, and a block reads the answer through
 * {@link usePageRegionPosture}. ⛔ Not a viewport breakpoint: a region's
 * width relative to its page is what decides, so the same `aside` is compact
 * on a wide screen and full once the layout stacks it under `main`.
 */
export type PageRegionPosture = 'compact' | 'full';

/**
 * The gap the page templates put between regions laid side by side (`gap-6`).
 * Two regions sharing a row half and half (the `dashboard` template's cells)
 * are each `(page − gap) / 2` wide, which is "half the page", so the cut sits
 * there and not at `page / 2`.
 */
const REGION_GAP_PX = 24;

/** Sub-pixel slack, so a half-and-half region rounding down is still half. */
const ROUNDING_SLACK_PX = 0.5;

/**
 * The posture a region `regionWidth` wide takes on a page `pageWidth` wide.
 * `null` when either width is unknown (zero, negative or not a number): the
 * caller then keeps the full rendering.
 */
export function pageRegionPostureFor(regionWidth: number, pageWidth: number): PageRegionPosture | null {
  if (!(regionWidth > 0) || !(pageWidth > 0)) return null;
  return regionWidth < (pageWidth - REGION_GAP_PX) / 2 - ROUNDING_SLACK_PX ? 'compact' : 'full';
}

/**
 * The page body's width, as a store a region subscribes to rather than a
 * context VALUE: a value that changed on every resize would re-render every
 * region and the whole block tree under it, while a subscription re-renders a
 * region only when its posture flips.
 */
export interface PageWidthStore {
  get(): number;
  set(width: number): void;
  subscribe(listener: () => void): () => void;
}

function createPageWidthStore(): PageWidthStore {
  let width = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => width,
    set: (next) => {
      if (next === width) return;
      width = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const PageWidthContext = React.createContext<PageWidthStore | null>(null);

const PageRegionPostureContext = React.createContext<PageRegionPosture | null>(null);

/**
 * `useLayoutEffect` where there is a DOM, so the first measurement lands
 * before the browser paints and a compact block does not flash the full list
 * first; `useEffect` on the server, where a layout effect warns and there is
 * nothing to measure anyway.
 */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/**
 * Watches `element`'s width: once now (`getBoundingClientRect`), then on every
 * resize. No `ResizeObserver` (an old browser, a test environment without
 * one) ⇒ the one reading only. Returns the cleanup.
 */
function watchWidth(element: Element, onWidth: (width: number) => void): () => void {
  onWidth(element.getBoundingClientRect().width);
  if (typeof ResizeObserver === 'undefined') return () => {};
  const observer = new ResizeObserver((entries) => {
    const width = entries[entries.length - 1]?.contentRect?.width;
    if (typeof width === 'number') onWidth(width);
  });
  observer.observe(element);
  return () => observer.disconnect();
}

/**
 * The page's width store, watching the page body `bodyRef` points at — the
 * element the page's regions are laid out in. Called by `PageRenderer`, the
 * component that RENDERS that element, and handed to {@link PageWidthProvider}.
 *
 * ⚠️ The watch has to run in the component that renders the body element, not
 * in a provider nested inside it: React attaches a host element's ref after
 * the layout effects of the components below it have run, so a provider
 * inside the body would find the ref still empty.
 */
export function usePageWidthStore(bodyRef: React.RefObject<HTMLElement | null>): PageWidthStore {
  // One store for the life of the page: a `useState` initializer, which React
  // runs once, not a memo whose identity it may discard (AGENTS.md #10).
  const [store] = React.useState(createPageWidthStore);
  useIsomorphicLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return undefined;
    return watchWidth(body, (width) => store.set(width));
  }, [bodyRef, store]);
  return store;
}

/** Publishes the page's width store to every region under it. Rendered by `PageRenderer`. */
export const PageWidthProvider: React.FC<{
  store: PageWidthStore;
  children: React.ReactNode;
}> = ({ store, children }) => <PageWidthContext.Provider value={store}>{children}</PageWidthContext.Provider>;

/**
 * Measures the region `regionRef` points at against the page width published
 * above it and tells the region's blocks their posture. Rendered by the page
 * renderer's `RegionContent`. It re-renders when the posture flips and at no
 * other resize, and its `children` element is the same one each time, so a
 * flip reaches the blocks that read the posture and nothing else.
 */
export const PageRegionPostureProvider: React.FC<{
  regionRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}> = ({ regionRef, children }) => {
  const store = React.useContext(PageWidthContext);
  const [posture, setPosture] = React.useState<PageRegionPosture | null>(null);
  useIsomorphicLayoutEffect(() => {
    const region = regionRef.current;
    if (!region || !store) return undefined;
    let regionWidth = 0;
    const judge = () => setPosture(pageRegionPostureFor(regionWidth, store.get()));
    // Subscribed BEFORE the page measures: a child's layout effect runs ahead
    // of its parent's, so the page body's first reading arrives through this
    // subscription.
    const unsubscribe = store.subscribe(judge);
    const unwatch = watchWidth(region, (width) => {
      regionWidth = width;
      judge();
    });
    return () => {
      unsubscribe();
      unwatch();
    };
  }, [regionRef, store]);
  return <PageRegionPostureContext.Provider value={posture}>{children}</PageRegionPostureContext.Provider>;
};

/**
 * The posture of the page region this block renders in: `'compact'` when the
 * region is narrower than half the page, `'full'` when it is not, `null`
 * outside a page region or before the width is known — read `null` as
 * `'full'`. Safe outside any provider.
 */
export function usePageRegionPosture(): PageRegionPosture | null {
  return React.useContext(PageRegionPostureContext);
}
