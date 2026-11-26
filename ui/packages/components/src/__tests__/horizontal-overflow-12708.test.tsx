/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12708 — the shared horizontal-overflow affordance: a box wider
 * content than itself shows a right-edge shadow while it can scroll further
 * right, and none at the right end. The geometry is stubbed the way
 * `data-table-scroll-shadow-12463` stubs it.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { HorizontalOverflowBox } from '../custom/horizontal-overflow';
import { hasOverflowRight, PINNED_RIGHT_SEAM_SHADOW_CLASSES } from '../custom/use-horizontal-overflow';

function setGeometry(box: HTMLElement, g: { scrollLeft: number; scrollWidth: number; clientWidth: number }) {
  Object.defineProperty(box, 'scrollWidth', { configurable: true, value: g.scrollWidth });
  Object.defineProperty(box, 'clientWidth', { configurable: true, value: g.clientWidth });
  box.scrollLeft = g.scrollLeft;
  act(() => { fireEvent.scroll(box); });
}

function renderBox(seam?: 'edge' | 'pinned') {
  return render(
    <HorizontalOverflowBox seam={seam} data-testid="box">
      <table><tbody><tr><td>wide</td></tr></tbody></table>
    </HorizontalOverflowBox>,
  );
}

describe('HorizontalOverflowBox (objectui#12708)', () => {
  it('shows the shadow while scrollWidth > clientWidth, and drops it at the right end', () => {
    const { getByTestId, queryByTestId } = renderBox();
    const box = getByTestId('box');
    expect(queryByTestId('horizontal-overflow-shadow')).toBeNull();
    expect(box).not.toHaveAttribute('data-overflow-right');

    setGeometry(box, { scrollLeft: 0, scrollWidth: 1071, clientWidth: 718 });
    const shadow = getByTestId('horizontal-overflow-shadow');
    expect(shadow).toHaveClass('pointer-events-none', 'absolute', 'right-0');
    expect(shadow).toHaveAttribute('aria-hidden', 'true');
    // A sibling of the scrolling box, so it never scrolls away with the content.
    expect(shadow.parentElement).toBe(box.parentElement);
    expect(box).toHaveAttribute('data-overflow-right', 'true');

    setGeometry(box, { scrollLeft: 200, scrollWidth: 1071, clientWidth: 718 });
    expect(queryByTestId('horizontal-overflow-shadow')).not.toBeNull();

    setGeometry(box, { scrollLeft: 353, scrollWidth: 1071, clientWidth: 718 });
    expect(queryByTestId('horizontal-overflow-shadow')).toBeNull();
    expect(box).not.toHaveAttribute('data-overflow-right');
  });

  it('no overflow, no shadow', () => {
    const { getByTestId, queryByTestId } = renderBox();
    setGeometry(getByTestId('box'), { scrollLeft: 0, scrollWidth: 700, clientWidth: 718 });
    expect(queryByTestId('horizontal-overflow-shadow')).toBeNull();
  });

  it('with seam="pinned" it draws no edge overlay and leaves the shadow to the pinned cells', () => {
    const { getByTestId, queryByTestId } = renderBox('pinned');
    const box = getByTestId('box');
    setGeometry(box, { scrollLeft: 0, scrollWidth: 1400, clientWidth: 700 });
    expect(queryByTestId('horizontal-overflow-shadow')).toBeNull();
    // The flag the pinned cells' seam classes key on.
    expect(box).toHaveAttribute('data-overflow-right', 'true');
    expect(box).toHaveClass('group/hscroll');
    expect(PINNED_RIGHT_SEAM_SHADOW_CLASSES).toContain('group-data-[overflow-right=true]/hscroll:before:opacity-100');
  });

  it('shows its scrollbar on hover or focus only', () => {
    const { getByTestId } = renderBox();
    expect(getByTestId('box')).toHaveClass('[scrollbar-color:transparent_transparent]!', 'hover:[scrollbar-color:var(--color-muted-foreground)_transparent]!');
  });

  it('hasOverflowRight keeps one pixel of slack', () => {
    expect(hasOverflowRight({ scrollLeft: 0, clientWidth: 700, scrollWidth: 701 })).toBe(false);
    expect(hasOverflowRight({ scrollLeft: 0, clientWidth: 700, scrollWidth: 702 })).toBe(true);
  });
});

/**
 * objectstack#37239 — a `<table>` inside a full-width wrapper (the shadcn
 * `Table`'s container, `overflow-visible`, as the approvals inbox mounts it)
 * widens past the box while the wrapper and the box keep their size. The box
 * re-reads its overflow when that table resizes. jsdom's `ResizeObserver` is an
 * inert polyfill, so a recording one stands in: `resize(el)` calls back only
 * the observers watching `el`, as a browser does when only `el` changed size.
 */
describe('HorizontalOverflowBox follows a table that widens inside a wrapper (objectstack#37239)', () => {
  const observed = new Map<Element, Set<ResizeObserverCallback>>();
  class RecordingResizeObserver {
    private readonly targets = new Set<Element>();
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(el: Element) {
      this.targets.add(el);
      if (!observed.has(el)) observed.set(el, new Set());
      observed.get(el)!.add(this.callback);
    }
    unobserve(el: Element) {
      this.targets.delete(el);
      observed.get(el)?.delete(this.callback);
    }
    disconnect() {
      for (const el of this.targets) observed.get(el)?.delete(this.callback);
      this.targets.clear();
    }
  }
  function resize(el: Element) {
    act(() => {
      for (const callback of Array.from(observed.get(el) ?? [])) callback([], {} as ResizeObserver);
    });
  }
  function setWidths(box: HTMLElement, scrollWidth: number, clientWidth: number) {
    Object.defineProperty(box, 'scrollWidth', { configurable: true, value: scrollWidth });
    Object.defineProperty(box, 'clientWidth', { configurable: true, value: clientWidth });
  }
  function renderWrapped() {
    return render(
      <HorizontalOverflowBox data-testid="box">
        <div className="relative w-full overflow-visible" data-testid="wrapper">
          <table><tbody><tr><td>wide</td></tr></tbody></table>
        </div>
      </HorizontalOverflowBox>,
    );
  }

  beforeAll(() => { vi.stubGlobal('ResizeObserver', RecordingResizeObserver); });
  afterEach(() => { observed.clear(); });
  afterAll(() => { vi.unstubAllGlobals(); });

  it('shows the shadow once the wrapped table alone grows past the box', () => {
    const { getByTestId, queryByTestId, container } = renderWrapped();
    const box = getByTestId('box');
    const table = container.querySelector('table')!;
    setWidths(box, 718, 718);
    resize(table);
    expect(queryByTestId('horizontal-overflow-shadow')).toBeNull();

    setWidths(box, 1071, 718);
    resize(table);
    expect(getByTestId('horizontal-overflow-shadow')).toBeInTheDocument();
    expect(box).toHaveAttribute('data-overflow-right', 'true');
  });

  it('CONTROL: a resize of the wrapper itself still re-reads, as it did before', () => {
    const { getByTestId, queryByTestId } = renderWrapped();
    const box = getByTestId('box');
    setWidths(box, 1071, 718);
    // The wrapper was watched before this fix; the pin above is about the table.
    resize(getByTestId('wrapper'));
    expect(queryByTestId('horizontal-overflow-shadow')).not.toBeNull();
  });
});
