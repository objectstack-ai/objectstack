/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * useIsViewportBelow — the first answer is the window's width at the first
 * render, and the answer follows the window as it crosses the breakpoint
 * (objectstack#27593).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useIsViewportBelow } from '../use-viewport-below';

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function resizeTo(width: number) {
  act(() => {
    setViewportWidth(width);
    window.dispatchEvent(new Event('resize'));
  });
}

/** Records every answer it renders, so a first frame at the wrong width shows up. */
function Probe({ breakpoint, seen }: { breakpoint: number; seen: boolean[] }) {
  const below = useIsViewportBelow(breakpoint);
  seen.push(below);
  return <div data-testid="below">{String(below)}</div>;
}

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
});

describe('useIsViewportBelow', () => {
  it('answers from the first render, with no frame at the wrong width', () => {
    setViewportWidth(1280);
    const seen: boolean[] = [];
    render(<Probe breakpoint={1416} seen={seen} />);
    expect(screen.getByTestId('below')).toHaveTextContent('true');
    expect(seen.every(Boolean)).toBe(true);

    cleanup();
    setViewportWidth(1440);
    const wide: boolean[] = [];
    render(<Probe breakpoint={1416} seen={wide} />);
    expect(screen.getByTestId('below')).toHaveTextContent('false');
    expect(wide.some(Boolean)).toBe(false);
  });

  it('is below at one pixel under the breakpoint and not at the breakpoint', () => {
    setViewportWidth(1415);
    render(<Probe breakpoint={1416} seen={[]} />);
    expect(screen.getByTestId('below')).toHaveTextContent('true');
    cleanup();

    setViewportWidth(1416);
    render(<Probe breakpoint={1416} seen={[]} />);
    expect(screen.getByTestId('below')).toHaveTextContent('false');
  });

  it('follows the window across the breakpoint', () => {
    setViewportWidth(1440);
    render(<Probe breakpoint={1416} seen={[]} />);
    expect(screen.getByTestId('below')).toHaveTextContent('false');

    resizeTo(1280);
    expect(screen.getByTestId('below')).toHaveTextContent('true');

    resizeTo(1500);
    expect(screen.getByTestId('below')).toHaveTextContent('false');
  });
});
