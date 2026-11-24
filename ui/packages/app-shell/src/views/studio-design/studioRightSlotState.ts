// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio right slot's shared state (objectui#12725): the handle a pillar
 * reads to host its properties in the slot, its resizable width, and the
 * slot's pure rules — its `⌘.` chord, and which Escape keydowns are not the canvas's. The
 * chrome is `StudioRightSlot.tsx`; these live apart so that file exports
 * components only.
 */

import * as React from 'react';
import { DOCK_CONTENT_MIN_WIDTH, DOCK_KEYBOARD_STEP } from '../../layout/chatDockState.js';

export type StudioSlotMode = 'props' | 'copilot';

/**
 * objectstack#34725 — the slot's width, resizable from its left edge and
 * remembered per browser under the slot's own keys, so a width dragged here
 * never moves the console drawer's. objectstack#35061 — each pane keeps its
 * own width (properties 360 px, the copilot 420 px by default, `STUDIO_SLOT_DEFAULT_WIDTHS`),
 * within the slot's range (`clampStudioSlotWidth`), never so wide that the
 * canvas drops under `DOCK_CONTENT_MIN_WIDTH`. The widened copilot is the one
 * other width (`wideWidth`), outside that range.
 */
export const STUDIO_SLOT_WIDTH_STORAGE_KEYS: Readonly<Record<StudioSlotMode, string>> = {
  props: 'studio-right-slot-width-props',
  copilot: 'studio-right-slot-width-copilot',
};

/**
 * The one width both panes shared before each kept its own. Not read: it is
 * removed on first use, and each pane starts from its default.
 */
export const STUDIO_SLOT_SHARED_WIDTH_STORAGE_KEY = 'studio-right-slot-width';

/** objectstack#35061 — each pane's width until the author drags it. */
export const STUDIO_SLOT_DEFAULT_WIDTHS: Readonly<Record<StudioSlotMode, number>> = {
  props: 360,
  copilot: 420,
};

/** objectstack#35061 — the slot is never narrower than this. */
export const STUDIO_SLOT_MIN_WIDTH = 320;
/** objectstack#35061 — the slot is never wider than this (the in-place widen aside). */
export const STUDIO_SLOT_MAX_WIDTH = 560;

/**
 * Clamp a desired slot width into {@link STUDIO_SLOT_MIN_WIDTH}–{@link STUDIO_SLOT_MAX_WIDTH},
 * and never so wide that the canvas drops under `DOCK_CONTENT_MIN_WIDTH`; the lower
 * bound wins when the two meet. `viewportWidth <= 0` (unmeasured) skips the canvas
 * bound. Pure + exported for tests.
 */
export function clampStudioSlotWidth(desired: number, viewportWidth: number): number {
  const canvasBound =
    viewportWidth > 0 ? viewportWidth - DOCK_CONTENT_MIN_WIDTH : Number.POSITIVE_INFINITY;
  const upper = Math.max(STUDIO_SLOT_MIN_WIDTH, Math.min(STUDIO_SLOT_MAX_WIDTH, canvasBound));
  return Math.min(Math.max(desired, STUDIO_SLOT_MIN_WIDTH), upper);
}

type StudioSlotWidths = Record<StudioSlotMode, number>;

function readStoredSlotWidth(mode: StudioSlotMode): number {
  try {
    const raw = window.localStorage.getItem(STUDIO_SLOT_WIDTH_STORAGE_KEYS[mode]);
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : STUDIO_SLOT_DEFAULT_WIDTHS[mode];
  } catch {
    return STUDIO_SLOT_DEFAULT_WIDTHS[mode];
  }
}

function readStoredSlotWidths(): StudioSlotWidths {
  try {
    window.localStorage.removeItem(STUDIO_SLOT_SHARED_WIDTH_STORAGE_KEY);
  } catch {
    /* private mode: nothing was stored */
  }
  return { props: readStoredSlotWidth('props'), copilot: readStoredSlotWidth('copilot') };
}

function writeStoredSlotWidth(mode: StudioSlotMode, width: number): void {
  try {
    window.localStorage.setItem(STUDIO_SLOT_WIDTH_STORAGE_KEYS[mode], String(Math.round(width)));
  } catch {
    /* private mode: the width just is not remembered */
  }
}

export interface StudioSlotWidth {
  /** The shown pane's width to draw, already clamped to the window. */
  width: number;
  dragging: boolean;
  /** Pointer-down on the left-edge handle: dragging left widens the shown pane. */
  onResizePointerDown: (e: React.PointerEvent) => void;
  /** Arrow keys on the focused handle: Left widens, Right narrows. */
  onResizeKeyDown: (e: React.KeyboardEvent) => void;
}

/**
 * The slot's resizable width for the pane it shows; see
 * {@link STUDIO_SLOT_WIDTH_STORAGE_KEYS}. A resize moves only that pane's width.
 */
export function useStudioSlotWidth(mode: StudioSlotMode): StudioSlotWidth {
  const [stored, setStored] = React.useState<StudioSlotWidths>(readStoredSlotWidths);
  const [dragging, setDragging] = React.useState(false);
  const current = stored[mode];
  const onResizePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = clampStudioSlotWidth(current, window.innerWidth);
      const widthAt = (x: number) => clampStudioSlotWidth(startWidth + (startX - x), window.innerWidth);
      setDragging(true);
      const onMove = (ev: PointerEvent) => {
        const next = widthAt(ev.clientX);
        setStored((prev) => ({ ...prev, [mode]: next }));
      };
      const onUp = (ev: PointerEvent) => {
        const final = widthAt(ev.clientX);
        setStored((prev) => ({ ...prev, [mode]: final }));
        writeStoredSlotWidth(mode, final);
        setDragging(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [current, mode],
  );
  const onResizeKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const step = e.key === 'ArrowLeft' ? DOCK_KEYBOARD_STEP : -DOCK_KEYBOARD_STEP;
      const next = clampStudioSlotWidth(clampStudioSlotWidth(current, window.innerWidth) + step, window.innerWidth);
      setStored((prev) => ({ ...prev, [mode]: next }));
      writeStoredSlotWidth(mode, next);
    },
    [current, mode],
  );
  const width = typeof window === 'undefined' ? current : clampStudioSlotWidth(current, window.innerWidth);
  return { width, dragging, onResizePointerDown, onResizeKeyDown };
}

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
