// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The unsaved-edits seam (objectui#13231): a page registers the edits it holds,
 * and every departure — a link, a tab close, or a shell menu that navigates
 * from a button — asks the page's own question before dropping them.
 *
 * The seam's own contract, driven directly: what `confirmUnsavedLeave` does
 * with and without a registration, which question it asks, that registrations
 * are counted, that the listeners come and go with them, and that a departure
 * the user has already agreed to is not asked about a second time by the
 * browser's `beforeunload` prompt. The shell's menus and the pages that
 * register are pinned beside them (`AppHeader.unsavedEditsLeave-13231`,
 * `SidebarItemMenu.designAsksUnsaved-13231`,
 * `ResourceEditPage.leaveGuard-13231`, and the console's
 * `SettingsView.shellLeave-13231`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { confirmUnsavedLeave, registerUnsavedEdits, useRegisterUnsavedEdits } from './unsavedEdits';

const KEEP = 'You have unsaved changes. Are you sure you want to leave?';

/**
 * The prompt, answered by the test: Cancel unless a case says OK. Stubbed as a
 * global because happy-dom's window has no `confirm` to spy on.
 */
function stubConfirm() {
  const spy = vi.fn((_message?: string): boolean => false);
  vi.stubGlobal('confirm', spy);
  return spy;
}
let confirmSpy: ReturnType<typeof stubConfirm>;
/** Every release a case took, so a failing case cannot leak a registration. */
let releases: Array<() => void> = [];

function hold(message = KEEP): () => void {
  const release = registerUnsavedEdits(message);
  releases.push(release);
  return release;
}

/** A `beforeunload` the window receives now, and whether a listener held it. */
function unloadHeld(): boolean {
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  return unload.defaultPrevented;
}

/** Every pending promise reaction has run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  confirmSpy = stubConfirm();
});

afterEach(() => {
  cleanup();
  for (const release of releases) release();
  releases = [];
  vi.unstubAllGlobals();
});

describe('confirmUnsavedLeave (objectui#13231)', () => {
  it('with nothing registered, goes at once and asks nothing', () => {
    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('with edits registered, asks the registered question; Cancel never runs go', () => {
    hold();
    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(KEEP);
    expect(go).not.toHaveBeenCalled();
  });

  it('with edits registered, OK runs go once', () => {
    hold();
    confirmSpy.mockReturnValue(true);
    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('asks the question of the page registered last', () => {
    hold('first page');
    hold('second page');
    confirmUnsavedLeave(vi.fn());
    expect(confirmSpy).toHaveBeenCalledWith('second page');
  });

  it('counts registrations: it asks until the last one is released, then goes at once', () => {
    const releaseA = hold();
    const releaseB = hold();
    releaseA();
    releaseA(); // a second release of the same registration is a no-op
    confirmUnsavedLeave(vi.fn());
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    releaseB();
    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);
  });
});

describe('the listeners come and go with the registrations (objectui#13231)', () => {
  it('a tab close is held only while edits are registered', () => {
    expect(unloadHeld()).toBe(false);
    const release = hold();
    expect(unloadHeld()).toBe(true);
    release();
    expect(unloadHeld()).toBe(false);
  });

  it('a click on a same-origin link to another page asks only while edits are registered', () => {
    window.history.replaceState(null, '', '/settings/localization');
    const link = document.createElement('a');
    link.href = '/business-units';
    document.body.appendChild(link);
    // Cancel the document navigation last, so the harness never leaves the page.
    const stop = (e: Event) => e.preventDefault();
    window.addEventListener('click', stop);
    try {
      link.click();
      expect(confirmSpy).not.toHaveBeenCalled();

      const release = hold();
      link.click();
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy).toHaveBeenCalledWith(KEEP);

      release();
      link.click();
      expect(confirmSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('click', stop);
      link.remove();
    }
  });
});

describe('a departure the user already agreed to is not asked twice (objectui#13231)', () => {
  it('while an agreed async departure (an organization switch) is under way, a tab close is not held', async () => {
    hold();
    confirmSpy.mockReturnValue(true);
    let finish!: () => void;
    const switching = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let heldDuring: boolean | undefined;
    confirmUnsavedLeave(async () => {
      heldDuring = unloadHeld();
      await switching;
    });
    expect(heldDuring).toBe(false);
    expect(unloadHeld()).toBe(false);

    // Settled: the page still holds its edits, so a later tab close asks again.
    finish();
    await flush();
    expect(unloadHeld()).toBe(true);
  });

  it('a departure that fails hands the tab close back to the guard', async () => {
    hold();
    confirmSpy.mockReturnValue(true);
    const failing = Promise.reject(new Error('set-active refused'));
    failing.catch(() => undefined);
    confirmUnsavedLeave(() => failing);
    await flush();
    expect(unloadHeld()).toBe(true);
  });

  it('a synchronous departure that throws hands the tab close back too', () => {
    hold();
    confirmSpy.mockReturnValue(true);
    expect(() =>
      confirmUnsavedLeave(() => {
        throw new Error('navigate failed');
      }),
    ).toThrow('navigate failed');
    expect(unloadHeld()).toBe(true);
  });

  it('Cancel leaves the tab close held', () => {
    hold();
    confirmUnsavedLeave(vi.fn());
    expect(unloadHeld()).toBe(true);
  });
});

describe('useRegisterUnsavedEdits (objectui#13231)', () => {
  function Page({ dirty, message = KEEP }: { dirty: boolean; message?: string }) {
    useRegisterUnsavedEdits(dirty, message);
    return null;
  }

  it('registers while dirty, and releases when the page goes clean or unmounts', () => {
    const { rerender, unmount } = render(<Page dirty={false} />);
    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(confirmSpy).not.toHaveBeenCalled();

    rerender(<Page dirty />);
    confirmUnsavedLeave(go);
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    rerender(<Page dirty={false} />);
    confirmUnsavedLeave(go);
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    rerender(<Page dirty message="Discard your edits?" />);
    confirmUnsavedLeave(go);
    expect(confirmSpy).toHaveBeenLastCalledWith('Discard your edits?');

    unmount();
    expect(unloadHeld()).toBe(false);
    confirmUnsavedLeave(go);
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });
});
