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

import { describe, it, expect } from 'vitest';
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
