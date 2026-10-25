// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio right slot's shared state (objectui#12725): the handle a pillar
 * reads to host its properties in the slot, and the slot's pure rules — its
 * width, its `⌘.` chord, and which Escape keydowns are not the canvas's. The
 * chrome is `StudioRightSlot.tsx`; these live apart so that file exports
 * components only.
 */

import * as React from 'react';

export type StudioSlotMode = 'props' | 'copilot';

/**
 * The slot's width: 300 px below 1280, 360 px from 1280 up (the card's 1010 and
 * 1280 readings). Fixed — the slot is not resizable; the copilot's Live Canvas
 * is the one thing that widens it (see `wideWidth`).
 */
export const STUDIO_SLOT_WIDTH = 'w-[300px] xl:w-[360px]';

export interface StudioRightSlotHandle {
  /** The element a pillar portals its properties into; `null` until mounted. */
  propsTarget: HTMLElement | null;
  /** The mode the slot SHOWS (a missing copilot reads as `props`). */
  mode: StudioSlotMode;
  /** Claim the properties half of the slot; returns the release. */
  claimProps: () => () => void;
  /** An element was selected: show its properties. */
  showProps: () => void;
}

export const StudioRightSlotContext = React.createContext<StudioRightSlotHandle | null>(null);

/** The surface's right slot, or `null` where the pillar keeps its own aside. */
export function useStudioRightSlot(): StudioRightSlotHandle | null {
  return React.useContext(StudioRightSlotContext);
}

/**
 * Match a keydown to the slot's mode toggle — `⌘.` (macOS) / `Ctrl+.`, no Shift,
 * no Alt. Measured free in the console at objectui `4b3d6ed`: the bound chords
 * are ⌘K, ⌘B, ⌘⇧H, ⌘⇧I, ⌘⇧M, ⌘⇧O, ⌘⇧S, ⌘S and `?`. Pure + exported for tests.
 */
export function matchStudioSlotShortcut(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return false;
  return e.key === '.';
}

/**
 * Whether an Escape keydown belongs to something else than the canvas
 * selection: typing in a field, or a dialog, menu or listbox that closes on it.
 * Pure + exported for tests.
 */
export function isSlotEscapeExempt(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  return Boolean(
    el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'),
  );
}
