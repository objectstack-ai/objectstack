/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9299 — the two shell mechanisms the ruling adds, pinned where they
 * live rather than five times over in the renderers.
 *
 * - **item 3, the popover anchor.** `popover` was honoured on NO surface: the
 *   overlay falls back to a compact `Dialog` when it is given no trigger, and
 *   no renderer ever gave it one. The ruling anchors the popover to the clicked
 *   element — row, node, bar, card, event — and forbids any of the five from
 *   reaching the fallback afterwards. The carrier is `popoverAnchorRef`, and
 *   ⛔ it is NOT `popoverTrigger`: that prop MOUNTS its child inside the
 *   overlay through `PopoverTrigger asChild`, so handing it a row would draw a
 *   SECOND copy of the row instead of pointing at the first. The discriminator
 *   below is the heading ELEMENT, not its text — both branches render the same
 *   words, so a text assertion passes in both worlds.
 *
 * - **item 4, the width migration.** Two drag-resize implementations became
 *   one. A width a user had already dragged, persisted under
 *   `RecordDetailDrawer`'s retired `objectui.drawerWidth.OBJECT`, must carry
 *   over — ⛔ not be silently reset. The starting state of every case below is
 *   therefore an EXISTING persisted width; a case that only checked the new key
 *   would prove nothing about the migration.
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

describe('objectui#9299 item 3 — popover anchors to the clicked element', () => {
  it('LIT CONTROL: with NO anchor at all the compact Dialog fallback is what renders', async () => {
    // First, because every case below is "the fallback was NOT taken". Without
    // a case that takes it, a payload that rendered nothing anywhere would
    // satisfy the others vacuously — and the discriminator itself would be
    // unproven.
    renderOverlay({ mode: 'popover' });
    expect(await screen.findByTestId('payload')).toBeInTheDocument();
    // `DialogTitle` is a Radix `Title`, which is an `h2`.
    expect(screen.getByRole('heading', { level: 2, name: 'Record Detail' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 4 })).toBeNull();
  });

  it('with a `popoverAnchorRef` the real Popover renders, not the fallback', async () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    renderOverlay({ mode: 'popover', popoverAnchorRef: { current: anchor } });
    expect(await screen.findByTestId('payload')).toBeInTheDocument();
    // The Popover branch draws its heading as a plain `h4`; the fallback's
    // `DialogTitle` is an `h2`. Same words, different element — which is the
    // whole reason this reads the element.
    expect(screen.getByRole('heading', { level: 4, name: 'Record Detail' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Record Detail' })).toBeNull();
    anchor.remove();
  });

  it('an anchor whose ref is still empty does not resurrect the fallback', async () => {
    // The renderers hand the ref down before anything is clicked. The branch is
    // on the REF, not on its contents, so this must stay on the Popover path —
    // otherwise the shell would flip shells mid-session the first time a user
    // opened a record some way other than by clicking a row.
    renderOverlay({ mode: 'popover', popoverAnchorRef: { current: null } });
    expect(await screen.findByTestId('payload')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Record Detail' })).toBeInTheDocument();
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
    // The user's width is what renders — not the authored default.
    expect(readWidth()).toBe('640px');
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
    expect(readWidth()).toBe('700px');
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
    expect(readWidth()).toBe('max(min(960px, 60vw), min(60vw, 880px))');
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
    expect(readWidth()).toBe('max(min(960px, 60vw), min(60vw, 880px))');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('the two key spellings are the ones the renderers use', () => {
    // Spelled here so a rename of either helper has to come past this file
    // rather than silently orphan every width a user has already persisted.
    expect(recordOverlayWidthStorageKey('contacts')).toBe('drawer-width:contacts');
    expect(legacyRecordDrawerWidthKey('contacts')).toBe('objectui.drawerWidth.contacts');
  });
});
