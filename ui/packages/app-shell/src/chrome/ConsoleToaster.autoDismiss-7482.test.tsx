/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7482 — 「客户更新成功」 was still on screen 90 seconds after a record
 * save, sitting exactly on the assistant rail's send button; only the × closed
 * it.
 *
 * Two facts, and the second explains the first. The toaster has always carried
 * a 4s default and `crud_success` passes no duration of its own, so nothing
 * about the DURATION was wrong. What was wrong is where the toaster was
 * anchored: `apps/console` overrode it to `bottom-right`, the corner ADR-0057
 * later gave to the ChatDock composer and its FAB. Sonner pauses a toast's
 * dismiss timer whenever the pointer is inside the toaster region —
 *
 *     if (expanded || interacting || isDocumentHidden) pauseTimer();
 *     else startTimer();                        (sonner 2.0.8, Toast effect)
 *
 * — and `expanded` is set by the region's own `onMouseEnter`/`onMouseMove`. A
 * pointer resting on the composer underneath therefore held the timer at zero
 * for as long as it stayed there. Covering the button and never dismissing were
 * one defect, not two.
 *
 * So this file pins the two properties the fix rests on: the default anchor is
 * at the top, away from the assistant's corner, and a success toast really
 * does dismiss itself inside the 3–5s band the card asked for. The top anchor
 * is top-centre since objectui#13340: the top-right corner, chosen here
 * first, turned out to hold every page header's actions.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { ConsoleToaster } from './ConsoleToaster.js';
import { ThemeProvider } from './ThemeProvider.js';

const renderToaster = (props: Record<string, unknown> = {}) =>
  render(
    <ThemeProvider>
      <ConsoleToaster {...props} />
    </ThemeProvider>,
  );

afterEach(() => {
  cleanup();
});

/** Sonner only mounts the positioned `<ol>` once there is a toast in it. */
async function anchorOf(props: Record<string, unknown> = {}): Promise<[string | null, string | null]> {
  renderToaster(props);
  act(() => {
    toast.success('anchor probe');
  });
  const region = await waitFor(() => {
    const el = document.querySelector('[data-sonner-toaster]');
    expect(el, 'sonner did not mount its toaster region').toBeTruthy();
    return el as HTMLElement;
  });
  return [region.getAttribute('data-y-position'), region.getAttribute('data-x-position')];
}

describe('ConsoleToaster anchor (objectui#7482)', () => {
  it('defaults to the top edge, away from the assistant composer', async () => {
    // Top-centre (objectui#13340), not top-right: see `DEFAULT_OFFSET` in `ConsoleToaster`.
    expect(await anchorOf()).toEqual(['top', 'center']);
  });

  it('is still overridable — the default is a default, not a lock', async () => {
    // The component's contract has always been "spread `{...props}` wins".
    // Losing that would be a different regression from the one above.
    expect(await anchorOf({ position: 'bottom-left' })).toEqual(['bottom', 'left']);
  });
});

describe('ConsoleToaster success toasts dismiss themselves (objectui#7482)', () => {
  beforeEach(() => {
    // Real timers advance sonner's own `setTimeout`; fake ones let this run in
    // milliseconds instead of seconds.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('the card`s own toast is gone within the 3–5s band', async () => {
    renderToaster();
    act(() => {
      toast.success('客户更新成功');
    });
    expect(await screen.findByText('客户更新成功')).toBeInTheDocument();

    // Still there just before the band closes…
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(screen.queryByText('客户更新成功')).toBeInTheDocument();

    // …and gone after it (plus sonner's unmount delay).
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    await waitFor(() => expect(screen.queryByText('客户更新成功')).not.toBeInTheDocument());
  });
});
