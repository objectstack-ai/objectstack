/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12725 — the right slot's own rules, without mounting the surface:
 * its width (360 px by default, resizable), its `⌘.` chord, which Escape
 * keydowns are not the canvas's, and its chrome (the properties' title and
 * Close; nothing while no pillar claims it). The surface's wiring is pinned in
 * `StudioDesignSurface.pillarsClaimSlot-12725.test.tsx`.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StudioRightSlot } from '../StudioRightSlot';
import {
  STUDIO_SLOT_DEFAULT_WIDTH,
  STUDIO_SLOT_MAX_WIDTH,
  STUDIO_SLOT_MIN_WIDTH,
  STUDIO_SLOT_RETIRED_WIDTH_STORAGE_KEYS,
  STUDIO_SLOT_WIDTH_STORAGE_KEY,
  clampStudioSlotWidth,
  isSlotEscapeExempt,
  matchStudioSlotShortcut,
} from '../studioRightSlotState';
import { DOCK_KEYBOARD_STEP, DOCK_WIDTH_STORAGE_KEY } from '../../../layout/chatDockState';
import { t } from '../../metadata-admin/i18n';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const key = { key: '.', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

describe('matchStudioSlotShortcut', () => {
  it('is ⌘. or Ctrl+., nothing else', () => {
    expect(matchStudioSlotShortcut({ ...key, metaKey: true })).toBe(true);
    expect(matchStudioSlotShortcut({ ...key, ctrlKey: true })).toBe(true);
    expect(matchStudioSlotShortcut({ ...key })).toBe(false);
    expect(matchStudioSlotShortcut({ ...key, metaKey: true, shiftKey: true })).toBe(false);
    expect(matchStudioSlotShortcut({ ...key, metaKey: true, altKey: true })).toBe(false);
    expect(matchStudioSlotShortcut({ ...key, key: ',', metaKey: true })).toBe(false);
  });
});

describe('isSlotEscapeExempt', () => {
  it('leaves Escape to a field, a dialog or a menu; the rest is the canvas’s', () => {
    document.body.innerHTML = `
      <input id="field" />
      <div role="dialog"><button id="in-dialog">x</button></div>
      <div role="menu"><div id="in-menu">x</div></div>
      <button id="plain">x</button>`;
    expect(isSlotEscapeExempt(document.getElementById('field'))).toBe(true);
    expect(isSlotEscapeExempt(document.getElementById('in-dialog'))).toBe(true);
    expect(isSlotEscapeExempt(document.getElementById('in-menu'))).toBe(true);
    expect(isSlotEscapeExempt(document.getElementById('plain'))).toBe(false);
    expect(isSlotEscapeExempt(document.body)).toBe(false);
    expect(isSlotEscapeExempt(null)).toBe(false);
    document.body.innerHTML = '';
  });
});

function renderSlot(props: Partial<React.ComponentProps<typeof StudioRightSlot>> = {}) {
  render(<StudioRightSlot open hasProps propsTargetRef={() => {}} locale="en" {...props} />);
  return { slot: screen.getByTestId('studio-right-slot') };
}

describe('StudioRightSlot', () => {
  it('is 360 px wide by default and resizes from its left edge, under its own key', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    const { slot } = renderSlot();
    expect(STUDIO_SLOT_DEFAULT_WIDTH).toBe(360);
    expect(slot).toHaveStyle({ width: '360px' });
    const handle = screen.getByTestId('studio-slot-resize');
    expect(handle).toHaveAttribute('role', 'separator');
    expect(handle).toHaveAttribute('aria-valuemin', '320');
    expect(handle).toHaveAttribute('aria-valuemax', '560');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(slot).toHaveStyle({ width: `${360 + DOCK_KEYBOARD_STEP}px` });
    expect(window.localStorage.getItem(STUDIO_SLOT_WIDTH_STORAGE_KEY)).toBe(String(360 + DOCK_KEYBOARD_STEP));
    expect(window.localStorage.getItem(DOCK_WIDTH_STORAGE_KEY)).toBeNull();
    fireEvent.pointerDown(handle, { clientX: 1000 });
    fireEvent.pointerMove(window, { clientX: 900 });
    fireEvent.pointerUp(window, { clientX: 900 });
    expect(slot).toHaveStyle({ width: `${360 + DOCK_KEYBOARD_STEP + 100}px` });
    cleanup();

    // Read back on the next mount; never so wide the canvas drops under 520 px.
    renderSlot();
    expect(screen.getByTestId('studio-right-slot')).toHaveStyle({ width: `${360 + DOCK_KEYBOARD_STEP + 100}px` });
    cleanup();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    window.localStorage.setItem(STUDIO_SLOT_WIDTH_STORAGE_KEY, '2000');
    renderSlot();
    expect(screen.getByTestId('studio-right-slot')).toHaveStyle({ width: `${1000 - 520}px` });
  });

  it('shows the properties under their title, with Close; with nothing claimed, nothing shows', () => {
    const onClose = vi.fn();
    const { slot } = renderSlot({ onClose });
    expect(slot).toBeVisible();
    expect(screen.getByTestId('studio-slot-title')).toHaveTextContent(t('engine.studio.inspector.props', 'en'));
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('studio-slot-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();

    expect(renderSlot({ hasProps: false }).slot).not.toBeVisible();
  });

  it('hidden from the title row, it keeps the properties target mounted', () => {
    const { slot } = renderSlot({ open: false });
    expect(slot).not.toBeVisible();
    expect(screen.getByTestId('studio-slot-props')).toBeInTheDocument();
  });

  it('on a phone it overlays the page outside the width range, and a tap beside it dismisses it', () => {
    const onOverlayDismiss = vi.fn();
    const { slot } = renderSlot({ overlay: true, onOverlayDismiss });
    expect(slot).toHaveClass('fixed', 'w-[min(420px,100vw)]');
    expect(slot.getAttribute('style')).toBeNull();
    expect(screen.queryByTestId('studio-slot-resize')).toBeNull();
    fireEvent.click(slot.previousElementSibling as HTMLElement);
    expect(onOverlayDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('StudioRightSlot width (objectstack#35061)', () => {
  it('clamps into 320–560 and keeps the canvas at least 520 px wide', () => {
    expect(STUDIO_SLOT_MIN_WIDTH).toBe(320);
    expect(STUDIO_SLOT_MAX_WIDTH).toBe(560);
    expect(clampStudioSlotWidth(100, 1600)).toBe(320);
    expect(clampStudioSlotWidth(900, 1600)).toBe(560);
    expect(clampStudioSlotWidth(450, 1600)).toBe(450);
    expect(clampStudioSlotWidth(560, 1000)).toBe(480);
    expect(clampStudioSlotWidth(560, 700)).toBe(320);
    expect(clampStudioSlotWidth(900, 0)).toBe(560);
  });

  it('drops the width keys it used before it held the properties alone', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    for (const retired of STUDIO_SLOT_RETIRED_WIDTH_STORAGE_KEYS) window.localStorage.setItem(retired, '500');
    renderSlot();
    expect(screen.getByTestId('studio-right-slot')).toHaveStyle({ width: '360px' });
    for (const retired of STUDIO_SLOT_RETIRED_WIDTH_STORAGE_KEYS) expect(window.localStorage.getItem(retired)).toBeNull();
  });
});
