/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Width rules of the Studio pillars' own rows, measured on the row rather
 * than the window (objectui#11795). objectui#12725 retired the folded layout's
 * side-by-side threshold that lived here first (`useIsWideViewport`, ADR-0057
 * P3c, issue #2477 item 3): the right slot shows the properties OR the copilot,
 * so no window width decides between them any more.
 */
import * as React from 'react';
import { NODE_W, PADDING } from '../metadata-admin/previews/flow-canvas-layout.js';

/**
 * objectui#11795 — the narrowest Automations pillar row (its flow rail, the
 * framed flow canvas and the Configuration aside, side by side) at which the
 * aside still leaves the canvas one flow column at 100%. Narrower than this,
 * the aside would overlap the canvas, so the Configuration opens as a drawer.
 *
 * Read off the pillar's own row, never the window: the Studio right slot sits
 * OUTSIDE that row and takes 300–360px of the window when it is shown
 * (objectui#12725; the chat dock's 340–420px before it), so one window width
 * answers both ways. A one-time Chromium reading for objectui#11795
 * (historical, not re-derived by anything): at a 1024px window the canvas was
 * about 460px wide with no dock beside the pillar, and about 40px with it.
 * Where the slot hosts the pillar, the Configuration itself is in the slot
 * (objectui#12725, phase 2) and the row holds no aside, so only the classic
 * layout folds: the package-less scope and an injected `aiSlot`.
 *
 * The sum, term by term: the flow rail (`w-52`, 208px; below `md` it becomes an
 * overlay, but every row below `md` is narrower than this sum anyway); the
 * chrome between the row and the canvas viewport (the pillar's `p-4` main and
 * the framed card's `p-4` and borders: 68px, read once in Chromium for
 * objectui#11795 — nothing re-derives it, so re-read it if that chrome
 * changes); the aside (`w-72`, 288px); and one flow column at 100% (`NODE_W`
 * plus the layout's `PADDING` on both sides — the width a linear flow draws at).
 */
// objectui#12459 — the skeleton widened the rail to 240px (`w-60`) and the
// aside to 300px, and the canvas body now sits at `px-6` inside the content
// column (24px a side, plus the framed card's `p-4` and borders: 84px).
export const AUTOMATIONS_CONFIG_FOLD_WIDTH = 240 + 84 + 300 + NODE_W + 2 * PADDING;

/**
 * Is the element `ref` points at narrower than `px`? Measured before paint and
 * re-measured whenever the element resizes, so a window resize or the chat
 * dock opening beside it flips the answer in place.
 *
 * An element that measures 0 wide has not been laid out (no layout engine, or
 * `display: none`), and reads as NOT narrower: an unmeasured row keeps the
 * layout it had before this hook existed rather than guess the folded one.
 */
export function useIsNarrowerThan(ref: React.RefObject<HTMLElement | null>, px: number): boolean {
  const [narrower, setNarrower] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const width = el.getBoundingClientRect().width;
      setNarrower(width > 0 && width < px);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, px]);
  return narrower;
}
