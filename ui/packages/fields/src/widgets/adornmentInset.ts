/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';

/**
 * The left padding a text input reserves for a symbol drawn over its start —
 * a currency adornment such as `$`, `US$`, `CHF` (objectstack#36678).
 *
 * The invariant: the input's text starts AFTER the symbol's right edge, plus a
 * gap, for every symbol `Intl` can hand back. A fixed inset holds that only
 * for symbols as narrow as `$`; `currencySymbol()` answers by currency AND
 * display locale (`US$` under zh-CN, `CA$` / `CHF` under en-US), so the width
 * is not knowable when the class is written.
 *
 * Spacing stays on static Tailwind utilities (no inline style), so the inset
 * is one rung of {@link INSET_LADDER}: the narrowest rung, at or above the
 * caller's floor, that clears the measured right edge plus the gap.
 */
export const INSET_LADDER = [
  { className: 'pl-6', rem: 1.5 },
  { className: 'pl-7', rem: 1.75 },
  { className: 'pl-8', rem: 2 },
  { className: 'pl-9', rem: 2.25 },
  { className: 'pl-10', rem: 2.5 },
  { className: 'pl-11', rem: 2.75 },
  { className: 'pl-12', rem: 3 },
  { className: 'pl-14', rem: 3.5 },
  { className: 'pl-16', rem: 4 },
  { className: 'pl-20', rem: 5 },
  { className: 'pl-24', rem: 6 },
  { className: 'pl-28', rem: 7 },
  { className: 'pl-32', rem: 8 },
] as const;

export type InsetClass = (typeof INSET_LADDER)[number]['className'];

/** The rem width of a ladder class. */
export function insetRem(className: InsetClass): number {
  return INSET_LADDER.find((r) => r.className === className)!.rem;
}

/** Before layout (or while hidden) a symbol's width is estimated per character, generously. */
const ESTIMATED_REM_PER_CHAR = 0.65;

export interface AdornmentInsetOptions {
  /** The narrowest rung: what a `$`-wide symbol has always been given at this call site. */
  floor: InsetClass;
  /** The symbol's own left offset inside the wrapper, in rem (`left-3` = 0.75). */
  startRem: number;
  /** Clear space between the symbol and the first typed character, in rem. */
  gapRem: number;
}

/**
 * The rung that clears `needRem`, never below `floor`; the widest rung when
 * nothing on the ladder does.
 */
export function pickInsetClass(needRem: number, floor: InsetClass): InsetClass {
  const floorRem = insetRem(floor);
  const rung = INSET_LADDER.find((r) => r.rem >= floorRem && r.rem >= needRem);
  return (rung ?? INSET_LADDER[INSET_LADDER.length - 1]).className;
}

/** The inset for a symbol not yet laid out: its character count stands in for its width. */
export function estimatedInsetClass(symbol: string, opts: AdornmentInsetOptions): InsetClass {
  const chars = Array.from(symbol).length;
  return pickInsetClass(opts.startRem + chars * ESTIMATED_REM_PER_CHAR + opts.gapRem, opts.floor);
}

function rootFontPx(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 16;
  const px = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(px) && px > 0 ? px : 16;
}

/**
 * Measures the adornment span (attach `ref`) against its positioned parent
 * and returns the padding class for the input beside it. Re-measures when the
 * symbol changes and when the span resizes (a web font arriving).
 */
export function useAdornmentInset(
  symbol: string,
  opts: AdornmentInsetOptions,
): { ref: React.RefObject<HTMLSpanElement | null>; insetClass: InsetClass | '' } {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const { floor, startRem, gapRem } = opts;
  const estimate = symbol ? estimatedInsetClass(symbol, { floor, startRem, gapRem }) : '';
  const [measured, setMeasured] = React.useState<{ symbol: string; insetClass: InsetClass } | null>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!symbol || !el) return;
    const read = () => {
      const span = el.getBoundingClientRect();
      // Zero width: not laid out (hidden, or no layout engine). Keep the estimate.
      if (!(span.width > 0)) return;
      const box = el.parentElement?.getBoundingClientRect();
      const rightPx = box ? span.right - box.left : span.width + startRem * rootFontPx();
      const insetClass = pickInsetClass(rightPx / rootFontPx() + gapRem, floor);
      setMeasured((prev) =>
        prev && prev.symbol === symbol && prev.insetClass === insetClass ? prev : { symbol, insetClass },
      );
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [symbol, floor, startRem, gapRem]);

  const insetClass = !symbol ? '' : measured && measured.symbol === symbol ? measured.insetClass : estimate;
  return { ref, insetClass };
}
