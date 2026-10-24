/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12725 — the right slot's own rules, without mounting the surface:
 * its width (300 px, 360 px from 1280), its `⌘.` chord, which Escape keydowns
 * are not the canvas's, and the chrome's three shapes (a switch when both
 * halves exist, a title when one does, nothing when none does). The surface's
 * wiring is pinned in `StudioDesignSurface.rightSlot-12725.test.tsx`.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StudioRightSlot } from '../StudioRightSlot';
import { STUDIO_SLOT_WIDTH, isSlotEscapeExempt, matchStudioSlotShortcut } from '../studioRightSlotState';
import { t } from '../../metadata-admin/i18n';

afterEach(cleanup);

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
      planPending={false}
      copilot={<div data-testid="copilot-body" />}
      propsTargetRef={() => {}}
      locale="en"
      {...props}
    />,
  );
  return { onModeChange, slot: screen.getByTestId('studio-right-slot') };
}

describe('StudioRightSlot', () => {
  it('is 300 px wide, 360 px from 1280', () => {
    expect(STUDIO_SLOT_WIDTH).toBe('w-[300px] xl:w-[360px]');
    const { slot } = renderSlot();
    expect(slot).toHaveClass('w-[300px]', 'xl:w-[360px]');
  });

  it('switches with its segmented header when both halves exist', () => {
    const { onModeChange, slot } = renderSlot();
    const [props, chat] = within(slot).getAllByRole('tab');
    expect(chat).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(props);
    expect(onModeChange).toHaveBeenLastCalledWith('props');
  });

  it('folds the copilot into a strip while the properties show; the strip leads back', () => {
    const { onModeChange } = renderSlot({ mode: 'props' });
    expect(screen.getByTestId('studio-slot-props')).toBeVisible();
    expect(screen.getByTestId('studio-slot-copilot')).not.toBeVisible();
    // Still mounted: a turn in flight survives a look at the properties.
    expect(screen.getByTestId('copilot-body')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('studio-slot-copilot-strip'));
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
    expect(slot).toHaveClass('fixed');
    expect(slot).not.toHaveClass('w-[300px]');
    fireEvent.click(slot.previousElementSibling as HTMLElement);
    expect(onOverlayDismiss).toHaveBeenCalledTimes(1);
  });
});
