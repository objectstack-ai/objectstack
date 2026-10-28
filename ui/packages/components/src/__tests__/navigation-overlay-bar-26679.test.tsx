/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record drawer's bar (objectstack#26679, maintainer rulings 2-5).
 *
 * - The left side is empty unless the host hands it a way back: no object
 *   name and no position are drawn (the title is the accessible name only).
 * - `onBack` draws `←` and takes `Esc`, so `Esc` goes back one level; without
 *   it `Esc` closes, as before.
 * - `stepper` draws `↑` `↓`, each disabled at its end of the set, and the
 *   arrow keys and `k` / `j` step — never while a text field or a composite
 *   widget owns the keyboard, never with a modifier.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NavigationOverlay, type NavigationOverlayProps } from '../custom/navigation-overlay';

afterEach(() => cleanup());

function renderBar(props: Partial<NavigationOverlayProps> = {}) {
  const setIsOpen = vi.fn();
  render(
    <NavigationOverlay
      isOpen
      isOverlay
      selectedRecord={{ id: 'L-1' }}
      mode="drawer"
      close={() => {}}
      setIsOpen={setIsOpen}
      title="Lead"
      {...props}
    >
      {() => (
        <div>
          <input aria-label="Body field" />
          <div role="grid" tabIndex={0} aria-label="Body grid" />
        </div>
      )}
    </NavigationOverlay>,
  );
  return { setIsOpen };
}

const leading = () => screen.getByTestId('record-drawer-leading');

describe('the drawer bar names no object and no position (rulings 2, 3)', () => {
  it('draws nothing on the left at the root; the title stays an accessible name', () => {
    renderBar({ onExpand: () => {} });
    expect(leading().textContent).toBe('');
    expect(leading().children).toHaveLength(0);
    // Radix still names the dialog by the host's title.
    expect(screen.getByRole('dialog', { name: 'Lead' })).toBeTruthy();
    expect(screen.getByText('Lead').className).toContain('sr-only');
  });

  it('draws ← and the host trail when the host hands it a way back', () => {
    const onBack = vi.fn();
    renderBar({ onBack, trail: <span>Lead Mira Costa › Task</span> });
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(leading().textContent).toContain('Lead Mira Costa › Task');
  });
});

describe('Esc goes back one level, and closes only at the root (ruling 5)', () => {
  it('with onBack: Esc pops and does not close', () => {
    const onBack = vi.fn();
    const { setIsOpen } = renderBar({ onBack });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(setIsOpen).not.toHaveBeenCalledWith(false);
  });

  it('control, no onBack: Esc closes, as before', () => {
    const { setIsOpen } = renderBar();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });
});

describe('↑ ↓ step through the host set (ruling 3 keeps the controls)', () => {
  it('draws the pair, disabled at the ends', () => {
    renderBar({ stepper: { onNext: () => {} } });
    expect((screen.getByRole('button', { name: 'Previous record' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Next record' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('control, no stepper: no pair is drawn', () => {
    renderBar();
    expect(screen.queryByRole('button', { name: 'Previous record' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next record' })).toBeNull();
  });

  it('ArrowUp / k and ArrowDown / j step while nothing owns the keyboard', () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    renderBar({ stepper: { onPrevious, onNext } });
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onPrevious).toHaveBeenCalledTimes(2);
  });

  it('never fires from a text field, a composite widget, or with a modifier', () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    renderBar({ stepper: { onPrevious, onNext } });
    fireEvent.keyDown(screen.getByLabelText('Body field'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByLabelText('Body field'), { key: 'j' });
    fireEvent.keyDown(screen.getByLabelText('Body grid'), { key: 'ArrowUp' });
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowDown', shiftKey: true });
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrevious).not.toHaveBeenCalled();
  });
});
