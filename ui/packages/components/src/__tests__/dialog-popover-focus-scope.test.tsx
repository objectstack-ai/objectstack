/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A lookup popover's search input inside a modal Dialog must be focusable.
 *
 * Radix's FocusScope keeps a module-level stack: when the popover's scope
 * mounts it pauses the dialog's trap, so focus may travel into the portalled
 * popover (which lives at document.body, OUTSIDE the dialog's DOM). Stock
 * @radix-ui/react-focus-scope@1.1.16 has a race that silently breaks this
 * pact: the stack-add effect's cleanup schedules
 * `focusScopesStack.remove(scope)` in a `setTimeout(0)`. When the effect
 * re-runs for a still-mounted scope (any `container`/dep flicker), the re-run
 * `add`s the scope back and THEN the stale timeout evicts it. The dialog's
 * trap listeners stay alive but its scope is gone from the stack, so a later
 * popover pauses nothing and every focus into the popover's search input is
 * yanked straight back into the dialog — an unsearchable lookup in the
 * production console (objectui#3183).
 *
 * `patches/@radix-ui__react-focus-scope.patch` fixes the race by cancelling
 * the pending eviction when the effect re-runs for a live scope. The first
 * test drives the race deterministically (child key swap → new DOM node →
 * container ref reattach → effect re-run) and fails without the patch.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, cleanup, act, screen } from '@testing-library/react';
import { FocusScope } from '@radix-ui/react-focus-scope';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';

afterEach(cleanup);

/** Flush the focus-scope cleanup timers (the `setTimeout(0)` eviction path). */
const flushEvictionTimers = () => act(() => new Promise<void>((r) => setTimeout(r, 25)));

/**
 * Minimal stand-in for "modal dialog with a portalled lookup popover":
 * a trapped outer scope (the dialog) and an optional untrapped inner scope
 * (the popover) that must pause it via the shared focus-scopes stack.
 * `contentKey` swaps the trapped scope's child element identity, forcing the
 * container ref to detach/reattach — the deterministic version of the
 * production dep flicker that re-runs the stack effect.
 */
function Harness({ contentKey, popoverOpen }: { contentKey: string; popoverOpen: boolean }) {
  return (
    <>
      <FocusScope trapped loop asChild>
        <div key={contentKey}>
          <button type="button">inside dialog</button>
        </div>
      </FocusScope>
      {popoverOpen && (
        <FocusScope asChild trapped={false}>
          <div>
            <input placeholder="search records" />
          </div>
        </FocusScope>
      )}
    </>
  );
}

describe('focus-scope stack race (patched @radix-ui/react-focus-scope)', () => {
  it('a re-run of the trapped scope effect must not evict it — the popover still pauses the dialog trap', async () => {
    const { rerender } = render(<Harness contentKey="a" popoverOpen={false} />);
    await flushEvictionTimers();

    // Swap the child key: the trapped scope's container node is replaced, its
    // ref detaches/reattaches, and the stack effect cleans up + re-runs.
    // Un-patched, the stale cleanup timeout then evicts the re-added scope
    // while its trap listeners stay active and `paused` is still false.
    rerender(<Harness contentKey="b" popoverOpen={false} />);
    await flushEvictionTimers();

    // Open the "popover". Its scope pauses the stack top — which, un-patched,
    // no longer contains the dialog scope, so the trap keeps yanking.
    rerender(<Harness contentKey="b" popoverOpen />);
    await flushEvictionTimers();

    const inside = screen.getByRole('button', { name: 'inside dialog' });
    const input = screen.getByPlaceholderText('search records');
    act(() => {
      inside.focus();
    });
    act(() => {
      input.focus();
    });
    await flushEvictionTimers();

    expect(document.activeElement).toBe(input);
  });

  it('sanity: without a popover the trapped scope still yanks outside focus back', async () => {
    render(<Harness contentKey="a" popoverOpen={false} />);
    await flushEvictionTimers();

    const inside = screen.getByRole('button', { name: 'inside dialog' });
    act(() => {
      inside.focus();
    });

    const outside = document.createElement('button');
    outside.textContent = 'outside';
    document.body.appendChild(outside);
    act(() => {
      outside.focus();
    });
    await flushEvictionTimers();

    expect(document.activeElement).not.toBe(outside);
    outside.remove();
  });
});

describe('lookup popover search inside a modal dialog (integration)', () => {
  it('the popover search input inside a Dialog receives and keeps focus', async () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>host dialog</DialogTitle>
          <Popover open>
            <PopoverTrigger asChild>
              <button type="button">pick</button>
            </PopoverTrigger>
            <PopoverContent>
              <input placeholder="search records" />
            </PopoverContent>
          </Popover>
        </DialogContent>
      </Dialog>,
    );
    await flushEvictionTimers();

    // Focus starts on an element INSIDE the dialog (the field trigger), then
    // moves into the portalled popover input — the real interaction shape.
    const trigger = screen.getByRole('button', { name: 'pick' });
    const input = screen.getByPlaceholderText('search records');
    act(() => {
      trigger.focus();
    });
    act(() => {
      input.focus();
    });
    await flushEvictionTimers();

    expect(document.activeElement).toBe(input);
  });
});
