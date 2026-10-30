/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9299 — the shell mechanisms the ruling added, pinned where they
 * live rather than five times over in the renderers.
 *
 * - **item 3, the popover anchor — RETIRED with its face (objectstack#26677).**
 *   `popover` (and `modal`) left the spec's `NavigationModeSchema`: an object
 *   opens its records in the drawer, which expands to the full page, or as the
 *   full page where it declares `page`. With the values gone from metadata no
 *   caller could reach the Popover face, its anchor (`popoverAnchorRef`,
 *   `useOverlayAnchor`) or the Dialog face, so all three were deleted. The pins
 *   below flip with them: a retired string reaching the shell at runtime draws
 *   NO surface — neither the Dialog fallback the popover once fell back to nor
 *   a modal — against a drawer lit control.
 *
 * - **item 4, the width migration.** Two drag-resize implementations became
 *   one. A width a user had already dragged, persisted under
 *   `RecordDetailDrawer`'s retired `objectui.drawerWidth.OBJECT`, must carry
 *   over — ⛔ not be silently reset. The starting state of every case below is
 *   therefore an EXISTING persisted width; a case that only checked the new key
 *   would prove nothing about the migration. Since objectstack#27545 a
 *   remembered width draws inside the drag range (`min(Npx, 60vw)`), and an
 *   authored width is no longer floored at `min(60vw, 880px)`: the pane's
 *   default is 720 and the reader drags it.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  NavigationOverlay,
  legacyRecordDrawerWidthKey,
  recordOverlayWidthStorageKey,
} from '../custom/navigation-overlay';

const RECORD = { id: '1', name: 'Ada' };

/** A compile-time assertion: `Assert<false>` fails `tsc`. */
type Assert<T extends true> = T;

/**
 * `any` on the overrides bag, deliberately: each case varies a different
 * subset of the shell's props (a mode, a ref, two storage keys), and a
 * `Record<string, unknown>` cannot be spread into JSX at all (TS2698).
 */
function renderOverlay(props: Record<string, any>) {
  return render(
    <NavigationOverlay
      isOpen
      isOverlay
      selectedRecord={RECORD}
      mode="drawer"
      close={() => {}}
      setIsOpen={() => {}}
      title="Record Detail"
      {...props}
    >
      {(record) => <div data-testid="payload">{String((record as { name: string }).name)}</div>}
    </NavigationOverlay>,
  );
}

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => cleanup());

describe('objectstack#26677 — the retired modal and popover faces are gone', () => {
  // Compile-time half: neither retired string is a mode the shell types.
  type Mode = React.ComponentProps<typeof NavigationOverlay>['mode'];
  type _NoModal = Assert<'modal' extends Mode ? false : true>;
  type _NoPopover = Assert<'popover' extends Mode ? false : true>;

  it('LIT CONTROL: the drawer draws the payload inside a dialog-role panel', async () => {
    // First, because the cases below assert ABSENCE: without a mode that does
    // render, a payload that rendered nowhere would satisfy them vacuously.
    renderOverlay({ mode: 'drawer' });
    expect(await screen.findByTestId('payload')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it.each(['modal', 'popover'])('a retired `%s` reaching the shell at runtime draws no surface at all', (mode) => {
    // A stored row is converted before it reaches a renderer and an authored one
    // is refused at parse, so this string arrives only past a cast. What it
    // must not do is resurrect the Dialog face, or the Dialog fallback the
    // popover face used to take with no anchor.
    renderOverlay({ mode, popoverAnchorRef: { current: document.createElement('div') } });
    expect(screen.queryByTestId('payload')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Record Detail' })).toBeNull();
  });
});

describe('objectui#9299 item 4 — the persisted width carries over, it is not reset', () => {
  const OBJECT = 'contacts';
  const KEY = `ov:${recordOverlayWidthStorageKey(OBJECT)}`;
  const LEGACY = legacyRecordDrawerWidthKey(OBJECT);

  /** The resolved width the shell publishes for the panel to be capped by. */
  function readWidth(): string {
    const panel = document.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(panel, 'overlay panel').not.toBeNull();
    return panel!.style.getPropertyValue('--ov-w').trim();
  }

  it('⭐ starts from an EXISTING persisted width and shows it surviving', async () => {
    // The state this card is about: a user who had already dragged their
    // gantt/kanban/calendar drawer to 640px, under the key the OLD
    // implementation wrote. ⛔ A case that seeded the NEW key would prove
    // nothing about the migration.
    window.localStorage.setItem(LEGACY, '640');
    renderOverlay({
      mode: 'drawer',
      width: 'min(960px, 60vw)',
      storageKey: recordOverlayWidthStorageKey(OBJECT),
      legacyStorageKey: LEGACY,
    });
    expect(await screen.findByTestId('payload')).toBeInTheDocument();
    // The user's width is what renders — not the authored default — bounded
    // by the drag range (objectstack#27545).
    expect(readWidth()).toBe('min(640px, 60vw)');
    // … and it has MOVED, so this is a migration and not a permanent second
    // read: the new key holds it and the retired one is gone.
    expect(window.localStorage.getItem(KEY)).toBe('640');
    expect(window.localStorage.getItem(LEGACY)).toBeNull();
  });

  it('a width already under the new key wins outright over a stale legacy one', async () => {
    window.localStorage.setItem(KEY, '700');
    window.localStorage.setItem(LEGACY, '640');
    renderOverlay({
      mode: 'drawer',
      storageKey: recordOverlayWidthStorageKey(OBJECT),
      legacyStorageKey: LEGACY,
    });
    expect(await screen.findByTestId('payload')).toBeInTheDocument();
    expect(readWidth()).toBe('min(700px, 60vw)');
  });

  it('CONTROL: with no persisted width at all the authored width is what applies', async () => {
    // Without this the two cases above could both be passing because the
    // resolved width is always whatever was last written.
    renderOverlay({
      mode: 'drawer',
      width: 'min(960px, 60vw)',
      storageKey: recordOverlayWidthStorageKey(OBJECT),
      legacyStorageKey: LEGACY,
    });
    expect(await screen.findByTestId('payload')).toBeInTheDocument();
    expect(readWidth()).toBe('min(960px, 60vw)');
  });

  it('a legacy width below the shared floor is not adopted', async () => {
    // The two implementations had different floors (360 vs 480). The surviving
    // one is the LOWER of the two, so every width either of them could have
    // written is carried over; a value below even that is not a width this
    // shell will render, so it is left rather than forced.
    window.localStorage.setItem(LEGACY, '120');
    renderOverlay({
      mode: 'drawer',
      width: 'min(960px, 60vw)',
      storageKey: recordOverlayWidthStorageKey(OBJECT),
      legacyStorageKey: LEGACY,
    });
    expect(await screen.findByTestId('payload')).toBeInTheDocument();
    expect(readWidth()).toBe('min(960px, 60vw)');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('the two key spellings are the ones the renderers use', () => {
    // Spelled here so a rename of either helper has to come past this file
    // rather than silently orphan every width a user has already persisted.
    expect(recordOverlayWidthStorageKey('contacts')).toBe('drawer-width:contacts');
    expect(legacyRecordDrawerWidthKey('contacts')).toBe('objectui.drawerWidth.contacts');
  });
});
