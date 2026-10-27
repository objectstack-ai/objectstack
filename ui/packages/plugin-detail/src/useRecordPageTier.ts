/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { recordPageTierFor, type RecordPageTier } from './synth/recordPageColumns';

/**
 * `useLayoutEffect` where there is a DOM, so the first measurement lands
 * before the browser paints; `useEffect` on the server, where a layout effect
 * warns and there is nothing to measure.
 */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

export interface UseRecordPageTierOptions {
  /** The page is embedded (drawer / split pane): always the tabs. */
  embedded?: boolean;
  /**
   * The page can take the column tiers at all. `false` for a page the column
   * layout does not describe (an authored full page, an authored tab strip):
   * the answer is the tabs at once and nothing is measured.
   */
  enabled?: boolean;
}

/**
 * The record page tier (`recordPageTierFor`) for the container `element`,
 * measured on it now and again on every resize (objectstack#26678).
 *
 * Answers `null` while the tier is not known yet — the element has not
 * mounted, or its first reading has not landed — so a host can hold the page
 * body for that one commit instead of mounting the tabbed tree and replacing
 * it before the first paint. The first reading is taken in a layout effect, so
 * in a browser that commit is never painted. Without a layout engine (a test
 * environment) the width reads 0 and the answer is the tabs.
 *
 * Re-renders only when the tier flips, not on every resize. ⛔ Not a viewport
 * breakpoint: the same page in a drawer is narrow on a wide screen.
 */
export function useRecordPageTier(
  element: Element | null,
  options: UseRecordPageTierOptions = {},
): RecordPageTier | null {
  const { embedded = false, enabled = true } = options;
  const measures = enabled && !embedded;
  const [measured, setMeasured] = React.useState<{ element: Element; tier: RecordPageTier } | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!measures || !element) return undefined;
    const judge = () => {
      const tier = recordPageTierFor(element.getBoundingClientRect().width);
      setMeasured((prev) => (prev && prev.element === element && prev.tier === tier ? prev : { element, tier }));
    };
    judge();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(judge);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measures, element]);

  if (!measures) return 'tabs';
  if (!element || !measured || measured.element !== element) return null;
  return measured.tier;
}
