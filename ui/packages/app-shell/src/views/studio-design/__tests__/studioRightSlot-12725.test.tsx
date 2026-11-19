/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12725 — the right slot's own rules, without mounting the surface:
 * its width (objectstack#34725: the console drawer's 420 px, resizable), its `⌘.` chord, which Escape keydowns
 * are not the canvas's, and the chrome's three shapes (a switch when both
 * halves exist, a title when one does, nothing when none does). The surface's
 * wiring is pinned in `StudioDesignSurface.rightSlot-12725.test.tsx`.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StudioRightSlot } from '../StudioRightSlot';
import {
  STUDIO_SLOT_DEFAULT_WIDTHS,
  STUDIO_SLOT_MAX_WIDTH,
  STUDIO_SLOT_MIN_WIDTH,
  STUDIO_SLOT_SHARED_WIDTH_STORAGE_KEY,
  STUDIO_SLOT_WIDTH_STORAGE_KEYS,
  clampStudioSlotWidth,
  isSlotEscapeExempt,
  matchStudioSlotShortcut,
} from '../studioRightSlotState';
import { DOCK_DEFAULT_WIDTH, DOCK_KEYBOARD_STEP, DOCK_WIDTH_STORAGE_KEY } from '../../../layout/chatDockState';
import { t } from '../../metadata-admin/i18n';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';

// The zh studio catalogue loads on demand; the zh case below reads it.
await loadStudioCatalogue('zh');

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
  const onModeChange = vi.fn();
  render(
    <StudioRightSlot
      open
      mode="copilot"
      onModeChange={onModeChange}
      hasProps
      copilotAvailable
      planPendingCount={0}
      copilot={<div data-testid="copilot-body" />}
      propsTargetRef={() => {}}
      locale="en"
      {...props}
    />,
  );
  return { onModeChange, slot: screen.getByTestId('studio-right-slot') };
}

describe('StudioRightSlot', () => {
  // objectstack#34725 — the console drawer's default width, dragged or keyed
  // wider from its left edge, remembered under the slot's own key.
  it('is 420 px wide by default and resizes from its left edge, under its own key', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    const { slot } = renderSlot();
    expect(DOCK_DEFAULT_WIDTH).toBe(420);
    expect(slot).toHaveStyle({ width: '420px' });
    const handle = screen.getByTestId('studio-slot-resize');
    expect(handle).toHaveAttribute('role', 'separator');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(slot).toHaveStyle({ width: `${420 + DOCK_KEYBOARD_STEP}px` });
    expect(window.localStorage.getItem(STUDIO_SLOT_WIDTH_STORAGE_KEYS.copilot)).toBe(String(420 + DOCK_KEYBOARD_STEP));
    expect(window.localStorage.getItem(DOCK_WIDTH_STORAGE_KEY)).toBeNull();
    fireEvent.pointerDown(handle, { clientX: 1000 });
    fireEvent.pointerMove(window, { clientX: 900 });
    fireEvent.pointerUp(window, { clientX: 900 });
    expect(slot).toHaveStyle({ width: `${420 + DOCK_KEYBOARD_STEP + 100}px` });
    cleanup();

    // Read back on the next mount; never so wide the canvas drops under 520 px.
    renderSlot();
    expect(screen.getByTestId('studio-right-slot')).toHaveStyle({ width: `${420 + DOCK_KEYBOARD_STEP + 100}px` });
    cleanup();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    window.localStorage.setItem(STUDIO_SLOT_WIDTH_STORAGE_KEYS.copilot, '2000');
    renderSlot();
    expect(screen.getByTestId('studio-right-slot')).toHaveStyle({ width: `${1000 - 520}px` });
  });

  it('switches with its segmented header when both halves exist', () => {
    const { onModeChange, slot } = renderSlot();
    const [props, chat] = within(slot).getAllByRole('tab');
    expect(chat).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(props);
    expect(onModeChange).toHaveBeenLastCalledWith('props');
  });

  it('hides the copilot while the properties show; the header switch leads back, with no strip at the foot', () => {
    const { onModeChange } = renderSlot({ mode: 'props' });
    expect(screen.getByTestId('studio-slot-props')).toBeVisible();
    expect(screen.getByTestId('studio-slot-copilot')).not.toBeVisible();
    // Still mounted: a turn in flight survives a look at the properties.
    expect(screen.getByTestId('copilot-body')).toBeInTheDocument();
    // objectstack#35018 — the 「AI 助手 / 回到对话 →」 strip repeated the switch; it is gone.
    expect(screen.queryByTestId('studio-slot-copilot-strip')).toBeNull();
    expect(screen.queryByText(t('engine.studio.slot.backToChat', 'en'))).toBeNull();
    fireEvent.click(screen.getByTestId('studio-slot-tab-copilot'));
    expect(onModeChange).toHaveBeenLastCalledWith('copilot');
  });

  it('with one half, a title and no switch, no strip; with none, nothing shows', () => {
    renderSlot({ hasProps: false });
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByTestId('studio-slot-title')).toHaveTextContent(t('engine.studio.aiCopilot', 'en'));
    cleanup();

    renderSlot({ mode: 'props', copilotAvailable: false });
    expect(screen.getByTestId('studio-slot-title')).toHaveTextContent(t('engine.studio.inspector.props', 'en'));
    expect(screen.queryByTestId('studio-slot-copilot-strip')).toBeNull();
    cleanup();

    const { slot } = renderSlot({ hasProps: false, copilotAvailable: false });
    expect(slot).not.toBeVisible();
  });

  it('hidden from the top bar, it keeps both halves mounted', () => {
    const { slot } = renderSlot({ open: false });
    expect(slot).not.toBeVisible();
    expect(screen.getByTestId('copilot-body')).toBeInTheDocument();
  });

  it('on a phone it overlays the page, and a tap beside it dismisses it', () => {
    const onOverlayDismiss = vi.fn();
    const { slot } = renderSlot({ overlay: true, onOverlayDismiss });
    expect(slot).toHaveClass('fixed', 'w-[min(420px,100vw)]');
    expect(screen.queryByTestId('studio-slot-resize')).toBeNull();
    fireEvent.click(slot.previousElementSibling as HTMLElement);
    expect(onOverlayDismiss).toHaveBeenCalledTimes(1);
  });

  // objectstack#25943 — 「N 项待确认」 on the copilot tab (objectstack#34725 named
  // the panel 「AI 助手」; objectstack#35018 dropped the strip that repeated it).
  it('zh: while the properties show, the copilot tab carries the 3 and no strip repeats it', () => {
    renderSlot({ mode: 'props', planPendingCount: 3, locale: 'zh-CN' });
    expect(screen.queryByTestId('studio-slot-copilot-strip')).toBeNull();
    const copilotTab = screen.getAllByRole('tab')[1];
    expect(within(copilotTab).getByTestId('studio-slot-plan-pending')).toHaveTextContent('3');
    expect(copilotTab).toHaveAccessibleDescription('3 项待确认');
  });
});

// objectstack#34725 — one header row, the console drawer's: the switch on the
// left; History, widen and Close on the right while the AI assistant shows.
describe('StudioRightSlot header (objectstack#34725)', () => {
  it('zh: one row — 属性 | AI 助手, then 历史, widen and close', () => {
    const onHistoryOpenChange = vi.fn();
    const onWideChange = vi.fn();
    const onClose = vi.fn();
    renderSlot({ locale: 'zh-CN', onHistoryOpenChange, onWideChange, onClose });
    const header = screen.getByTestId('studio-slot-header');
    const [props, chat] = within(header).getAllByRole('tab');
    expect(props).toHaveTextContent('属性');
    expect(chat).toHaveTextContent('AI 助手');
    const history = within(header).getByTestId('studio-slot-history');
    expect(history).toHaveTextContent('历史');
    expect(history).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(history);
    expect(onHistoryOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(within(header).getByTestId('studio-copilot-maximize'));
    expect(onWideChange).toHaveBeenLastCalledWith(true);
    const close = within(header).getByTestId('studio-slot-close');
    expect(close).toHaveAccessibleName(t('engine.studio.slot.collapse', 'zh-CN'));
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an open history reads as pressed and leads back to the chat', () => {
    renderSlot({ historyOpen: true, onHistoryOpenChange: vi.fn() });
    const history = screen.getByTestId('studio-slot-history');
    expect(history).toHaveAttribute('aria-pressed', 'true');
    expect(history).toHaveAccessibleName(t('engine.studio.slot.backToChat', 'en'));
  });

  it('while the properties show, only Close; on a phone, no widen', () => {
    renderSlot({ mode: 'props', onHistoryOpenChange: vi.fn(), onWideChange: vi.fn(), onClose: vi.fn() });
    expect(screen.queryByTestId('studio-slot-history')).toBeNull();
    expect(screen.queryByTestId('studio-copilot-maximize')).toBeNull();
    expect(screen.getByTestId('studio-slot-close')).toBeInTheDocument();
    cleanup();

    renderSlot({ overlay: true, onHistoryOpenChange: vi.fn(), onWideChange: vi.fn() });
    expect(screen.getByTestId('studio-slot-history')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-copilot-maximize')).toBeNull();
  });

  it('widened, it takes the wide width and drops the resize handle', () => {
    const { slot } = renderSlot({ wide: true, wideWidth: 900, onWideChange: vi.fn() });
    expect(slot).toHaveStyle({ width: '900px' });
    expect(screen.queryByTestId('studio-slot-resize')).toBeNull();
    expect(screen.getByTestId('studio-copilot-maximize')).toHaveAttribute('aria-pressed', 'true');
  });
});

// objectstack#35061 item 4 — each pane keeps its own width, within 320–560.
describe('StudioRightSlot pane widths (objectstack#35061)', () => {
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

  it('defaults the properties to 360 px and the copilot to 420 px', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    expect(STUDIO_SLOT_DEFAULT_WIDTHS).toEqual({ props: 360, copilot: 420 });
    renderSlot({ mode: 'props' });
    expect(screen.getByTestId('studio-right-slot')).toHaveStyle({ width: '360px' });
    cleanup();
    renderSlot({ mode: 'copilot' });
    expect(screen.getByTestId('studio-right-slot')).toHaveStyle({ width: '420px' });
  });

  it('remembers each pane apart across a remount, and a switch shows the other pane’s width', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    const view = render(
      <StudioRightSlot open mode="props" onModeChange={vi.fn()} hasProps copilotAvailable planPendingCount={0}
        copilot={<div />} propsTargetRef={() => {}} locale="en" />,
    );
    const slot = () => screen.getByTestId('studio-right-slot');
    const handle = screen.getByTestId('studio-slot-resize');
    expect(handle).toHaveAttribute('aria-valuemin', '320');
    expect(handle).toHaveAttribute('aria-valuemax', '560');
    fireEvent.pointerDown(handle, { clientX: 1000 });
    fireEvent.pointerMove(window, { clientX: 900 });
    fireEvent.pointerUp(window, { clientX: 900 });
    expect(slot()).toHaveStyle({ width: '460px' });
    expect(window.localStorage.getItem(STUDIO_SLOT_WIDTH_STORAGE_KEYS.props)).toBe('460');
    expect(window.localStorage.getItem(STUDIO_SLOT_WIDTH_STORAGE_KEYS.copilot)).toBeNull();

    // The copilot keeps its own width; dragging it far right stops at 320.
    view.rerender(
      <StudioRightSlot open mode="copilot" onModeChange={vi.fn()} hasProps copilotAvailable planPendingCount={0}
        copilot={<div />} propsTargetRef={() => {}} locale="en" />,
    );
    expect(slot()).toHaveStyle({ width: '420px' });
    fireEvent.pointerDown(screen.getByTestId('studio-slot-resize'), { clientX: 1000 });
    fireEvent.pointerUp(window, { clientX: 1400 });
    expect(slot()).toHaveStyle({ width: '320px' });
    expect(window.localStorage.getItem(STUDIO_SLOT_WIDTH_STORAGE_KEYS.copilot)).toBe('320');
    cleanup();

    // A reload reads both back.
    renderSlot({ mode: 'props' });
    expect(slot()).toHaveStyle({ width: '460px' });
    cleanup();
    renderSlot({ mode: 'copilot' });
    expect(slot()).toHaveStyle({ width: '320px' });
  });

  it('drops the width both panes used to share', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    window.localStorage.setItem(STUDIO_SLOT_SHARED_WIDTH_STORAGE_KEY, '500');
    renderSlot({ mode: 'props' });
    expect(screen.getByTestId('studio-right-slot')).toHaveStyle({ width: '360px' });
    expect(window.localStorage.getItem(STUDIO_SLOT_SHARED_WIDTH_STORAGE_KEY)).toBeNull();
  });

  it('leaves the in-place widen and the phone overlay outside the range', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    renderSlot({ mode: 'copilot', wide: true, wideWidth: 900, onWideChange: vi.fn() });
    expect(screen.getByTestId('studio-right-slot')).toHaveStyle({ width: '900px' });
    expect(screen.queryByTestId('studio-slot-resize')).toBeNull();
    cleanup();
    renderSlot({ mode: 'props', overlay: true });
    expect(screen.getByTestId('studio-right-slot').getAttribute('style')).toBeNull();
    expect(screen.queryByTestId('studio-slot-resize')).toBeNull();
  });
});
