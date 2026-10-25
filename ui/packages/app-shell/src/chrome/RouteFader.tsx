/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RouteFader` — light-touch fade-in animation that replays whenever
 * the route pathname changes.
 *
 * Why this implementation choice:
 *   The textbook approach (`<div key={pathname}>`) would remount every
 *   page on navigation. That breaks scroll position, loses form state,
 *   and re-fetches data that didn't need to refetch.
 *
 *   Instead we keep the wrapper stable and replay the CSS animation by
 *   manipulating className directly via a layout effect: strip the
 *   animation classes, force a reflow, then re-add them. The browser
 *   restarts the animation against the same DOM node. React's VDOM
 *   doesn't see the temporary class swap — it's pure DOM choreography
 *   — so children are never remounted.
 *
 *   The animation is gated on `motion-safe:` so users with
 *   `prefers-reduced-motion: reduce` see hard page swaps.
 */

import * as React from 'react';
import { useLocation } from 'react-router-dom';

export interface RouteFaderProps {
  children: React.ReactNode;
  className?: string;
}

const ANIM_CLASSES = ['motion-safe:animate-in', 'motion-safe:fade-in-0', 'motion-safe:duration-150'];

export function RouteFader({ children, className }: RouteFaderProps) {
  const location = useLocation();
  const ref = React.useRef<HTMLDivElement>(null);
  const prevPath = React.useRef(location.pathname);

  React.useLayoutEffect(() => {
    if (prevPath.current === location.pathname) return;
    prevPath.current = location.pathname;
    const el = ref.current;
    if (!el) return;
    // Drop the animation classes, force a reflow read, then re-add
    // them. This is the canonical CSS "restart animation" trick.
    el.classList.remove(...ANIM_CLASSES);
    // Reading `offsetWidth` forces layout, which is what tells the
    // browser to flush the previous animation state.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    el.offsetWidth;
    el.classList.add(...ANIM_CLASSES);
  }, [location.pathname]);

  return (
    <div
      ref={ref}
      className={[...ANIM_CLASSES, className ?? ''].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}

