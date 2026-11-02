/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29107 — the shared `Dialog` Close button is a 44 px touch target
 * at phone width.
 *
 * Every modal the Console shows draws the one close button `DialogContent`
 * auto-renders, so the floor lives in the primitive. Two sites render it and
 * are named here: the declared-action param dialog (`ActionParamDialog` in
 * `@object-ui/app-shell`, e.g. a `sys_approval_request` Reject) and the
 * command palette (`CommandDialog`, rendered below).
 *
 * The test environment has no layout engine, so the target is pinned as
 * drawn: a 44 px centred box below `sm`, and from `sm` up the class list the
 * desktop had before, token for token. `src/ui/dialog.tsx` is regenerated from
 * the registry; the classes are a declared patch in
 * `scripts/shadcn-local-patches.mjs`, whose own test proves the anchor.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';
import { CommandDialog, CommandInput, CommandList } from '../ui/command';

afterEach(() => cleanup());

/** The phone-only classes `phoneCloseTouchTargetPatches` declares. */
const PHONE = [
  'max-sm:size-11',
  'max-sm:flex',
  'max-sm:items-center',
  'max-sm:justify-center',
  'max-sm:right-1',
  'max-sm:top-1',
];

/** Upstream's class list for the Close, unchanged from `sm` up. */
const DESKTOP = [
  'absolute',
  'right-4',
  'top-4',
  'rounded-sm',
  'opacity-70',
  'ring-offset-background',
  'transition-opacity',
  'hover:opacity-100',
  'focus:outline-none',
  'focus:ring-2',
  'focus:ring-ring',
  'focus:ring-offset-2',
  'disabled:pointer-events-none',
  'data-[state=open]:bg-accent',
  'data-[state=open]:text-muted-foreground',
];

function expectPhoneTarget(close: HTMLElement) {
  const cls = close.className.split(/\s+/).filter(Boolean);
  for (const c of PHONE) expect(cls).toContain(c);
  // Every phone class is `max-sm:` scoped, and nothing else was added, so the
  // desktop button (and the header around it) is exactly what it was.
  expect(cls.filter((c) => !c.startsWith('max-sm:'))).toEqual(DESKTOP);
  // The visible glyph keeps its 16 px size.
  expect(close.querySelector('svg')?.getAttribute('class')).toContain('h-4 w-4');
}

describe('#29107 — the Dialog Close button on a phone', () => {
  it('DialogContent: a 44 px box below sm, upstream classes from sm up', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Reject</DialogTitle>
          <DialogDescription>Declared-action param dialog</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expectPhoneTarget(screen.getByRole('button', { name: 'Close' }));
  });

  it('the command palette draws the same Close', () => {
    render(
      <CommandDialog open>
        <CommandInput placeholder="Search" />
        <CommandList />
      </CommandDialog>,
    );
    expectPhoneTarget(screen.getByRole('button', { name: 'Close' }));
  });
});
