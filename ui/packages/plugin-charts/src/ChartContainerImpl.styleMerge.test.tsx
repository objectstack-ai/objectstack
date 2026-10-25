/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: `ChartContainer`'s min-size fallback was silently revoked by any
 * consumer-supplied `style` (objectstack#7026).
 *
 * The container used to write `style={{ minHeight: 280, minWidth: 0,
 * ...props.style }}` and then spread `{...props}` AFTER it. `props` is the rest
 * of `ComponentProps<"div">` and still carried `style`, so the later spread
 * replaced the whole style object: `minHeight`/`minWidth` vanished and the
 * `...props.style` merge inside it never ran once — it was dead code that read
 * as if the fallback were guaranteed.
 *
 * The fallback exists so Recharts' ResponsiveContainer always has a non-zero box
 * (a dashboard widget that overrides `h-[350px]` via className otherwise makes
 * Recharts measure width/height = -1 and render invisibly), so these tests pin
 * both halves of the merge that replaced it:
 *
 *  1. a consumer `style` WITHOUT a height key keeps the min-size fallback (this
 *     is the assertion that was red before the fix), and its own keys pass
 *     through untouched;
 *  2. a consumer `style` WITH an explicit height wins outright — no `minHeight:
 *     280` is injected, so an authored `height: 100` (smaller than the fallback)
 *     really renders at 100 instead of being floored to 280. This one guards the
 *     OTHER failure mode: "just spread `{...props}` first and merge
 *     unconditionally" would make the fallback beat the author's height;
 *  3. no consumer `style` at all behaves exactly as before.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// ResponsiveContainer measures 0×0 under happy-dom; a passthrough keeps these
// tests focused on the container element's own inline style.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => children,
  };
});

import { ChartContainer } from './ChartContainerImpl';

afterEach(() => {
  cleanup();
});

/** The container div ChartContainer renders (the one carrying the merged style). */
function renderContainer(props: { style?: React.CSSProperties; className?: string }) {
  const { container } = render(
    <ChartContainer config={{}} {...props}>
      <div data-testid="child" />
    </ChartContainer>,
  );
  const el = container.querySelector<HTMLElement>('[data-slot="chart"]');
  if (el == null) throw new Error('ChartContainer did not render its chart container');
  return el;
}

/** `minWidth: 0` may serialize as "0" or "0px" depending on the DOM impl. */
function expectZeroLength(value: string) {
  expect(value).not.toBe('');
  expect(parseFloat(value)).toBe(0);
}

describe('ChartContainer — min-size fallback vs. consumer style (objectstack#7026)', () => {
  it('keeps the min-size fallback when the consumer style declares no size', () => {
    const el = renderContainer({ style: { margin: 8 } });

    // The fallback the comment promises is actually on the element.
    expect(el.style.minHeight).toBe('280px');
    expectZeroLength(el.style.minWidth);
    // …and the consumer's own keys are passed through, not dropped.
    expect(el.style.margin).toBe('8px');
  });

  it('keeps the fallback when the consumer overrides the height CLASS but not the style', () => {
    // The exact shape the fallback was written for: a dashboard widget drops
    // `h-[350px]` via className and hands the container a non-size style.
    const el = renderContainer({ className: 'h-full', style: { padding: 4 } });

    expect(el.className).toContain('h-full');
    expect(el.style.minHeight).toBe('280px');
    expectZeroLength(el.style.minWidth);
  });

  it('lets an explicit consumer height win — no minHeight floor is injected', () => {
    // AdvancedChartImpl's containerProps do exactly this for `ChartConfig.height`.
    const el = renderContainer({ style: { height: 100 } });

    expect(el.style.height).toBe('100px');
    // A `min-height: 280px` here would silently render the author's 100 as 280.
    expect(el.style.minHeight).toBe('');
    // Width said nothing, so the width half of the fallback still applies.
    expectZeroLength(el.style.minWidth);
  });

  it('lets an explicit consumer minHeight win, even below the fallback', () => {
    const el = renderContainer({ style: { minHeight: 100 } });

    expect(el.style.minHeight).toBe('100px');
  });

  it('skips the minWidth fallback when the consumer declares a width', () => {
    const el = renderContainer({ style: { width: 400 } });

    expect(el.style.width).toBe('400px');
    expect(el.style.minWidth).toBe('');
    // Height said nothing, so the height half of the fallback still applies.
    expect(el.style.minHeight).toBe('280px');
  });

  it('applies the full fallback when no consumer style is supplied', () => {
    const el = renderContainer({});

    expect(el.style.minHeight).toBe('280px');
    expectZeroLength(el.style.minWidth);
  });

  it('treats an undefined size value as "not declared" and still falls back', () => {
    // `style: { height: undefined }` reaches the container from spread-built
    // prop objects; it must not count as an authored height.
    const el = renderContainer({ style: { height: undefined, margin: 2 } });

    expect(el.style.minHeight).toBe('280px');
    expect(el.style.margin).toBe('2px');
  });
});
