/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useAppShellBranding` gives `document.title` back when the shell goes away
 * (objectui#8637).
 *
 * ## Why the restore is part of the contract, not a nicety
 *
 * The hook assigns `title` wholesale while the shell is mounted — that half is
 * pinned next door in `app-shell-branding-title-assignment.test.tsx`, and this
 * file deliberately does not restate it. What was missing is the other end of
 * the lifecycle. A host mounts a shell for part of its route tree (the console
 * mounts `ConsoleLayout` under `/apps/*` and nothing outside it), so a title
 * this hook writes has to come back off the tab when the shell unmounts. Before
 * this, it did not, and the console compensated with a SECOND writer keyed on
 * the route — which reset the tab correctly on the way out and also clobbered
 * the composed title on every in-app navigation. Removing that writer is only
 * safe because the restore below exists, so the two are pinned as one change.
 *
 * ## Shape
 *
 * Every test starts from a known sentinel, mounts the hook alone (it is the
 * writer; the shell chrome is irrelevant), and reads `document.title` back
 * after an unmount or a `title` change. The first test is an environment
 * control — without it a DOM with a no-op `title` setter would make the rest
 * vacuously green.
 *
 * ⚠️ The restore is a REPLAY of whatever the tab said at write time, not a
 * memory of who owned it. That is exactly the guarantee a host needs to reason
 * about, and its cost is the case the last test pins: a surface that writes the
 * title from INSIDE a mounted shell has its value overwritten on unmount. The
 * console keeps its auth surfaces outside the shell for this reason.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { useAppShellBranding, type AppShellBranding } from '../AppShell';

const SENTINEL = 'sentinel — document.title before the shell mounted';

/** Mounts only the hook — the actual `document.title` writer — with no shell chrome. */
function HookOnly({ branding, title }: { branding?: AppShellBranding; title?: string }) {
  useAppShellBranding(branding, title);
  return null;
}

beforeEach(() => {
  document.title = SENTINEL;
});

afterEach(() => {
  cleanup();
});

describe('environment control', () => {
  it('happy-dom lets `document.title` be written and read back', () => {
    document.title = 'probe';
    expect(document.title).toBe('probe');
    document.title = SENTINEL;
    expect(document.title).toBe(SENTINEL);
  });
});

describe('`useAppShellBranding` restores the title it replaced', () => {
  it('unmounting puts back the title that was there before the shell mounted', () => {
    const view = render(<HookOnly title="Sales CRM — ObjectStack" />);
    expect(document.title).toBe('Sales CRM — ObjectStack');

    view.unmount();

    expect(
      document.title,
      [
        'The shell unmounted and left its own title on the tab. A host that mounts a shell',
        'for part of its route tree now has to reset the title itself on the way out — and',
        'the only writer positioned to do that is one keyed on the ROUTE, which is the',
        'second writer objectui#8637 removed. The restore here is what makes one writer',
        'enough.',
      ].join('\n'),
    ).toBe(SENTINEL);
  });

  it('changing `title` restores once and writes once — no accumulation', () => {
    const view = render(<HookOnly title="Sales CRM — ObjectStack" />);
    view.rerender(<HookOnly title="Support Desk — ObjectStack" />);
    expect(document.title).toBe('Support Desk — ObjectStack');

    view.unmount();

    // The restore replays the string captured before the FIRST write, not the
    // one the shell itself put up a moment ago.
    expect(document.title).toBe(SENTINEL);
  });

  it('a shell with no `title` restores nothing, because it wrote nothing', () => {
    // The mirror of "no `title` leaves `document.title` untouched": an absent
    // title must not turn the cleanup into a writer either. Something else
    // changes the tab while this shell is mounted, and the shell leaves it be.
    const view = render(<HookOnly branding={{ primaryColor: '#3B82F6' }} />);
    expect(document.title).toBe(SENTINEL);

    document.title = 'written by someone else';
    view.unmount();

    expect(document.title).toBe('written by someone else');
  });

  it('a title written from inside a mounted shell is overwritten on unmount', () => {
    // Documented cost, pinned so it is a known property rather than a surprise:
    // the restore replays the captured string unconditionally.
    const view = render(<HookOnly title="Sales CRM — ObjectStack" />);
    document.title = 'written while the shell was mounted';

    view.unmount();

    expect(document.title).toBe(SENTINEL);
  });
});
