// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37914 — in a right-to-left language the docked sidebar sits at
 * the window's right edge (the primitive places it at the inline start), so
 * its resize edge faces left: a drag to the left and the ← key widen it, a
 * drag to the right and the → key narrow it. Left to right is unchanged and
 * is the control here. Where the edge and the shell's other sidebar anchors
 * are drawn is measured in Chromium by `e2e/sidebar-offcanvas-geometry.spec.ts`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SidebarWidthHandle, SIDEBAR_WIDTH_KEY_STEP } from '../SidebarWidthHandle';
import { isRightToLeft } from '../consoleSidebarRail';

function Harness({ initial = 256 }: { initial?: number }) {
  const [width, setWidth] = React.useState(initial);
  const [preview, setPreview] = React.useState<number | null>(null);
  return (
    <div data-testid="width" data-width={preview ?? width}>
      <SidebarWidthHandle width={preview ?? width} onPreview={setPreview} onCommit={setWidth} />
    </div>
  );
}

const handle = () => screen.getByTestId('console-sidebar-resize');
const width = () => Number(screen.getByTestId('width').getAttribute('data-width'));

function drag(dx: number) {
  fireEvent.pointerDown(handle(), { button: 0, clientX: 600, pointerId: 1 });
  fireEvent.pointerMove(handle(), { clientX: 600 + dx, pointerId: 1 });
  fireEvent.pointerUp(handle(), { clientX: 600 + dx, pointerId: 1 });
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('dir');
});

describe.each([
  { dir: 'ltr', widen: 1 },
  { dir: 'rtl', widen: -1 },
] as const)('the sidebar resize edge in a $dir document (objectstack#37914)', ({ dir, widen }) => {
  it('a drag toward the page widens the sidebar and a drag away narrows it', () => {
    document.documentElement.setAttribute('dir', dir);
    render(<Harness />);
    expect(isRightToLeft(handle())).toBe(dir === 'rtl');
    drag(widen * 40);
    expect(width()).toBe(296);
    drag(-widen * 80);
    expect(width()).toBe(216);
  });

  it('the arrow key toward the page widens the sidebar', () => {
    document.documentElement.setAttribute('dir', dir);
    render(<Harness />);
    const towardPage = widen === 1 ? 'ArrowRight' : 'ArrowLeft';
    const awayFromPage = widen === 1 ? 'ArrowLeft' : 'ArrowRight';
    fireEvent.keyDown(handle(), { key: towardPage });
    expect(width()).toBe(256 + SIDEBAR_WIDTH_KEY_STEP);
    fireEvent.keyDown(handle(), { key: awayFromPage });
    fireEvent.keyDown(handle(), { key: awayFromPage });
    expect(width()).toBe(256 - SIDEBAR_WIDTH_KEY_STEP);
  });
});
