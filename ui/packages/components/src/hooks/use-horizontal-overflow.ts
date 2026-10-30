/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';

/** Which edges of a horizontal scroller hide content past them. */
export type HorizontalOverflow = 'none' | 'start' | 'end' | 'both';

/**
 * Where a horizontally scrolling element has content out of view, re-read on
 * scroll and on resize, so the element can draw a cue at each edge that hides
 * something. Measured in the element's own box: `scrollLeft` against
 * `scrollWidth - clientWidth`, with a one-pixel tolerance for sub-pixel
 * widths. Returns a callback ref and the current answer.
 */
export function useHorizontalOverflow<T extends HTMLElement>(): [
  (node: T | null) => void,
  HorizontalOverflow,
] {
  const [node, setNode] = React.useState<T | null>(null);
  const [overflow, setOverflow] = React.useState<HorizontalOverflow>('none');

  React.useEffect(() => {
    if (!node) return;
    const measure = () => {
      const max = node.scrollWidth - node.clientWidth;
      const start = node.scrollLeft > 1;
      const end = max - node.scrollLeft > 1;
      setOverflow(start && end ? 'both' : start ? 'start' : end ? 'end' : 'none');
    };
    measure();
    node.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      node.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [node]);

  return [setNode, overflow];
}
