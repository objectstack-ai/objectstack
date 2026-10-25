/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11723 — with the record drawer open, a toast's Undo ran (once the
 * toast could take the click at all) and the same click closed the drawer.
 *
 * The drawer is a Radix modal, and Radix closes a modal on a `pointerdown`
 * outside its content, heard by a listener on `document`. A toast is outside
 * the drawer's content, so every press on it read as an outside click. The fix
 * stops a toast's `pointerdown` at `ConsoleToaster`, before it can reach
 * `document`. This file pins that half with dispatched events and the real
 * record drawer host (`NavigationOverlay` in drawer mode, on the Shadcn
 * `Sheet`), so it runs in the unit lane.
 *
 * ⚠️ What it cannot pin is the other half: whether the click reaches the toast
 * at all. That is a hit-test question (the modal sets `pointer-events: none` on
 * `<body>`), and happy-dom has no hit testing: an event dispatched at an
 * element arrives there whatever its computed `pointer-events`. The real-pointer
 * reading lives in `e2e/toast-under-modal.spec.ts`, in Chromium. The class
 * assertion at the end is only the cheap echo of it.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, act, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { NavigationOverlay } from '@object-ui/components';
import { ConsoleToaster } from './ConsoleToaster.js';
import { ThemeProvider } from './ThemeProvider.js';

const outside: HTMLElement[] = [];

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
  for (const el of outside.splice(0)) el.remove();
});

/** The record drawer, open, with the console toaster beside it. */
async function openDrawer() {
  const onClose = vi.fn();
  function Harness() {
    const [open, setOpen] = React.useState(true);
    return (
      <ThemeProvider>
        <NavigationOverlay
          mode="drawer"
          isOverlay
          isOpen={open}
          selectedRecord={open ? { id: 'widget-42' } : null}
          close={() => setOpen(false)}
          setIsOpen={(next) => {
            if (!next) onClose();
            setOpen(next);
          }}
          title="Product"
        >
          {() => <p>Widget 42</p>}
        </NavigationOverlay>
        <ConsoleToaster />
      </ThemeProvider>
    );
  }
  render(<Harness />);
  await screen.findByRole('dialog');
  // Radix arms its document `pointerdown` listener on a zero-delay timer after
  // the layer mounts; a press before that would prove nothing either way.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  return { onClose };
}

/** A press as the browser delivers it: down, up, then the click. */
function press(el: Element) {
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, pointerType: 'mouse' });
  fireEvent.pointerUp(el, { button: 0, pointerId: 1, pointerType: 'mouse' });
  fireEvent.click(el, { button: 0 });
}

async function raiseWithUndo(title: string) {
  const undo = vi.fn();
  act(() => {
    toast.success(title, { action: { label: 'Undo', onClick: undo } });
  });
  await screen.findByText(title);
  return { undo };
}

describe('a toast under the open record drawer keeps its click (objectui#11723)', () => {
  it('the control: a press outside both the drawer and the toaster closes the drawer', async () => {
    // Non-vacuity. Without it, "the drawer stayed open" below could only mean
    // that no outside-click listener was armed in this environment at all.
    const { onClose } = await openDrawer();
    const elsewhere = document.createElement('div');
    document.body.append(elsewhere);
    outside.push(elsewhere);
    press(elsewhere);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Undo runs, and the drawer stays open', async () => {
    const { onClose } = await openDrawer();
    const { undo } = await raiseWithUndo('Approved');
    press(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
    // Past the zero-delay timer Radix's deferred verdict waits on.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('the close button dismisses the toast, and the drawer stays open', async () => {
    const { onClose } = await openDrawer();
    await raiseWithUndo('Saved');
    press(screen.getByRole('button', { name: 'Close toast' }));
    await waitFor(() => expect(screen.queryByText('Saved')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('a press on the toast body reaches no outside-click handler', async () => {
    const { onClose } = await openDrawer();
    const { undo } = await raiseWithUndo('Updated');
    press(screen.getByText('Updated'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(undo).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('each toast asks for pointer events, the echo of the Chromium pin', async () => {
    await openDrawer();
    await raiseWithUndo('Approved');
    const li = screen.getByText('Approved').closest('[data-sonner-toast]');
    // The plain utility, not a `group-[…]:` form: that one would outrank
    // sonner's `pointer-events: none` on a toast hidden beyond `visibleToasts`.
    expect(li).toHaveClass('pointer-events-auto');
  });
});
