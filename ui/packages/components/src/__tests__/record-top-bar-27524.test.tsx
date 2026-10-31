/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27524, Target 7 — the record's top bar: ONE 40 px row of frame
 * controls above the record header, on every face. Left, what the host hands
 * (the breadcrumb, or 「← 路径」); right, in a fixed order and each only when
 * handed: the counter 「n / N」 and ↓ ↑ (a list context, the tooltip naming
 * the list), a hairline, the panel switches (⊟), the frame controls
 * (⤢ / ⤡ / ✕). The step keys belong to the latest host that holds them: a
 * pane opened over a page owns `j` / `k` until it closes.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RecordTopBar, RecordTopBarButton, useRecordStepKeys, type RecordTopBarStepper } from '../custom/record-top-bar';
import { NavigationOverlay } from '../custom/navigation-overlay';

afterEach(() => cleanup());

const order = () =>
  Array.from(document.querySelector('[data-record-top-bar-controls]')!.children).map(
    (el) =>
      el.getAttribute('data-record-top-bar-step')
      ?? (el.hasAttribute('data-record-top-bar-position') ? 'position' : null)
      ?? (el.hasAttribute('data-record-top-bar-divider') ? 'divider' : null)
      ?? el.getAttribute('data-testid'),
  );

describe('RecordTopBar (objectstack#27524, Target 7)', () => {
  it('right end in the fixed order: counter, ↓ ↑, hairline, ⊟, then the frame controls', () => {
    const onNext = vi.fn();
    render(
      <RecordTopBar
        leading={<span>Leads › Mira Costa</span>}
        stepper={{ onNext, position: { index: 2, total: 21 }, scope: 'All leads' }}
        toggles={<button type="button" data-testid="toggles">⊟</button>}
        frame={<RecordTopBarButton label="Close" data-testid="close">✕</RecordTopBarButton>}
      />,
    );
    const bar = document.querySelector('[data-record-top-bar]')!;
    expect(bar.className).toContain('h-10');
    expect(screen.getByText('Leads › Mira Costa')).toBeInTheDocument();
    expect(order()).toEqual(['position', 'next', 'previous', 'divider', 'toggles', 'close']);
    const position = document.querySelector('[data-record-top-bar-position]')!;
    expect(position.textContent).toBe('3 / 21');
    // The tooltip names the list the counter counts.
    expect(position.getAttribute('title')).toBe('3 of 21 in All leads');
    // At an end of the set its control is drawn disabled.
    expect((screen.getByRole('button', { name: 'Previous record' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next record' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('draws only what it is handed: no list context, no counter, no ↓ ↑ and no hairline', () => {
    render(<RecordTopBar leading="x" toggles={<span data-testid="toggles" />} />);
    expect(order()).toEqual(['toggles']);
    expect(screen.queryByRole('button', { name: 'Next record' })).toBeNull();
  });

  it('a set without a place in it draws the pair alone, no counter', () => {
    render(<RecordTopBar stepper={{ onPrevious: () => {} }} />);
    expect(order()).toEqual(['next', 'previous']);
  });
});

function KeyHost({ stepper, active = true, arrows }: { stepper?: RecordTopBarStepper; active?: boolean; arrows?: boolean }) {
  useRecordStepKeys(active, stepper, { arrows });
  return null;
}

describe('useRecordStepKeys — the latest host owns j / k (objectstack#27524)', () => {
  it('a page steps with j / k but not the arrows; a pane opened over it takes the keys until it closes', () => {
    const page = { onNext: vi.fn(), onPrevious: vi.fn() };
    const pane = { onNext: vi.fn(), onPrevious: vi.fn() };
    const { rerender } = render(<KeyHost stepper={page} arrows={false} />);
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(page.onNext).toHaveBeenCalledTimes(1);

    rerender(
      <>
        <KeyHost stepper={page} arrows={false} />
        <KeyHost stepper={pane} />
      </>,
    );
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    expect(pane.onNext).toHaveBeenCalledTimes(1);
    expect(pane.onPrevious).toHaveBeenCalledTimes(1);
    expect(page.onNext).toHaveBeenCalledTimes(1);

    rerender(<KeyHost stepper={page} arrows={false} />);
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(page.onPrevious).toHaveBeenCalledTimes(1);
  });

  it('a pane with no set still holds the keys from the page under it, and lets them through', () => {
    const page = { onNext: vi.fn() };
    render(
      <>
        <KeyHost stepper={page} arrows={false} />
        <KeyHost stepper={undefined} />
      </>,
    );
    const event = new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(page.onNext).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('NavigationOverlay draws the shared bar as the pane\'s (objectstack#27524)', () => {
  it('the step group, then the host\'s panel switches, then ⤢ and ✕', () => {
    render(
      <NavigationOverlay
        isOpen
        isOverlay
        mode="split"
        selectedRecord={{ id: 'r-1' }}
        close={() => {}}
        setIsOpen={() => {}}
        maximizable
        mainContent={<div>list</div>}
        stepper={{ onNext: () => {}, position: { index: 0, total: 3 } }}
        toggles={<span data-testid="pane-toggles">⊟</span>}
        trail={<span>Leads › Mira Costa</span>}
      >
        {() => <div>record</div>}
      </NavigationOverlay>,
    );
    const bar = document.querySelector('[data-record-top-bar]')!;
    expect(bar).not.toBeNull();
    expect(screen.getByTestId('record-drawer-leading').textContent).toBe('Leads › Mira Costa');
    const controls = Array.from(bar.querySelector('[data-record-top-bar-controls]')!.querySelectorAll('button, [data-testid="pane-toggles"]'));
    const names = controls.map((el) => el.getAttribute('aria-label') ?? el.getAttribute('data-testid'));
    expect(names).toEqual(['Next record', 'Previous record', 'pane-toggles', 'Maximize', 'Close panel']);
  });
});
