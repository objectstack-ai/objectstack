/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35853 (figure 40) — the record's top bar in two rows, the page
 * and the drawer alike:
 *
 * 1. the navigation row: ✕ first (objectstack#36557), then the host's left
 *    end, ↑ ↓ and 「第 N 条，共 M 条 · 视图名」 (the view's name returns to the
 *    list), and the frame controls (⤢) at its right; no record name and no
 *    actions;
 * 2. the record row: the record's name, then its button group and ⊟.
 *
 * Without a record row it stays the one row it was (the phone's), its counter
 * still 「n / N」 and ✕ still its last control.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { RecordTopBar, RecordTopBarButton, type RecordTopBarStepper } from '../custom/record-top-bar';
import { NavigationOverlay } from '../custom/navigation-overlay';

afterEach(() => cleanup());

const close = <RecordTopBarButton label="Close" data-testid="close">✕</RecordTopBarButton>;
const expand = <RecordTopBarButton label="Open as full page" data-testid="expand">⤢</RecordTopBarButton>;
const nav = () => document.querySelector('[data-record-top-bar-nav]') as HTMLElement;
/** The navigation row's controls, in DOM (and Tab) order, by accessible name. */
const navButtons = () => Array.from(nav().querySelectorAll('button')).map((el) => el.getAttribute('aria-label') ?? el.textContent);
const recordRow = () => document.querySelector('[data-record-top-bar-record]') as HTMLElement;

function Bar({ stepper, leading }: { stepper?: RecordTopBarStepper; leading?: React.ReactNode }) {
  const [, setSlot] = React.useState<HTMLElement | null>(null);
  return (
    <RecordTopBar
      leading={leading}
      stepper={stepper}
      record={<span data-testid="record-name">Wayne Enterprise License</span>}
      actionSlotRef={setSlot}
      toggles={<span data-testid="toggles">⊟</span>}
      frame={expand}
      close={close}
    />
  );
}

describe('the two-row bar', () => {
  it('from a list: ✕, then ↑ ↓ and 「N of M · view」 on the left of the navigation row, ⤢ at its right, the record below', () => {
    const onScope = vi.fn();
    const onNext = vi.fn();
    render(<Bar stepper={{ onNext, position: { index: 1, total: 10 }, scope: 'Open deals', onScope }} />);
    expect(document.querySelector('[data-record-top-bar]')?.getAttribute('data-record-top-bar-rows')).toBe('2');
    const steps = Array.from(nav().querySelectorAll('[data-record-top-bar-step]')).map((el) => el.getAttribute('data-record-top-bar-step'));
    expect(steps).toEqual(['previous', 'next']);
    expect((screen.getByRole('button', { name: 'Previous record' }) as HTMLButtonElement).disabled).toBe(true);
    const position = nav().querySelector('[data-record-top-bar-position]')!;
    expect(position.textContent).toBe('2 of 10');
    expect(position.getAttribute('title')).toBe('2 of 10 in Open deals');
    fireEvent.click(nav().querySelector('[data-record-top-bar-scope]') as HTMLElement);
    expect(onScope).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Next record' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    // ✕ is the navigation row's first control, ⤢ its last; the row holds no name and no action.
    expect(nav().firstElementChild!.contains(screen.getByTestId('close'))).toBe(true);
    expect(navButtons()).toEqual(['Close', 'Previous record', 'Next record', 'Open deals', 'Open as full page']);
    expect(nav().querySelector('[data-record-top-bar-frame]')!.lastElementChild).toBe(screen.getByTestId('expand'));
    expect(nav().contains(screen.getByTestId('record-name'))).toBe(false);
    expect(nav().querySelector('[data-record-top-bar-actions]')).toBeNull();
    // The record row: the name, then the actions and ⊟.
    expect(recordRow().contains(screen.getByTestId('record-name'))).toBe(true);
    expect(recordRow().querySelector('[data-record-top-bar-actions]')).not.toBeNull();
    expect(recordRow().contains(screen.getByTestId('toggles'))).toBe(true);
  });

  it('from no list: ✕ first, then the object\'s name, no ↑ ↓', () => {
    render(<Bar leading={<button type="button" data-testid="object">Deals</button>} />);
    expect(nav().contains(screen.getByTestId('object'))).toBe(true);
    expect(nav().querySelector('[data-record-top-bar-step]')).toBeNull();
    expect(nav().querySelector('[data-record-top-bar-position]')).toBeNull();
    expect(navButtons()).toEqual(['Close', 'Deals', 'Open as full page']);
  });

  it('in Chinese the count reads 「第 N 条，共 M 条」', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <Bar stepper={{ position: { index: 1, total: 10 }, scope: '进行中商机' }} />
      </I18nProvider>,
    );
    expect((await screen.findByText('第 2 条，共 10 条')).hasAttribute('data-record-top-bar-position')).toBe(true);
    expect(nav().querySelector('[data-record-top-bar-scope]')?.textContent).toBe('进行中商机');
  });

  it('CONTROL: without a record row it is one row, the counter 「n / N」, ✕ still last at the right end', () => {
    render(<RecordTopBar leading={<span data-testid="lead">Deals</span>} stepper={{ position: { index: 1, total: 10 } }} frame={expand} close={close} />);
    expect(document.querySelector('[data-record-top-bar-nav]')).toBeNull();
    expect(document.querySelector('[data-record-top-bar-close]')).toBeNull();
    expect(document.querySelector('[data-record-top-bar-position]')?.textContent).toBe('2 / 10');
    const controls = document.querySelector('[data-record-top-bar-controls]')!;
    expect(controls.lastElementChild).toBe(screen.getByTestId('close'));
    expect(screen.getByTestId('expand').nextElementSibling).toBe(screen.getByTestId('close'));
  });
});

describe('the drawer draws the two-row bar', () => {
  it('✕ first in the navigation row, ⤢ at its right; ✕ keeps its name and closes; the record row holds the name and the button group', () => {
    const onClose = vi.fn();
    function Drawer() {
      const [, setSlot] = React.useState<HTMLElement | null>(null);
      return (
        <NavigationOverlay
          isOpen
          isOverlay
          mode="drawer"
          selectedRecord={{ id: 'r-1' }}
          close={onClose}
          setIsOpen={() => {}}
          onExpand={() => {}}
          mainContent={<div>list</div>}
          stepper={{ onNext: () => {}, position: { index: 0, total: 3 }, scope: 'All leads' }}
          actionSlotRef={setSlot}
          recordRow={<span data-testid="record-name">Mira Costa</span>}
        >
          {() => <div>record</div>}
        </NavigationOverlay>
      );
    }
    render(<Drawer />);
    const frame = Array.from(nav().querySelector('[data-record-top-bar-frame]')!.querySelectorAll('button'));
    expect(frame.map((el) => el.getAttribute('aria-label'))).toEqual(['Open as full page']);
    const buttons = navButtons();
    expect(buttons[0]).toBe('Close');
    expect(buttons[buttons.length - 1]).toBe('Open as full page');
    fireEvent.click(nav().querySelector('button') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(nav().querySelector('[data-record-top-bar-position]')?.textContent).toBe('1 of 3');
    expect(recordRow().contains(screen.getByTestId('record-name'))).toBe(true);
    expect(recordRow().querySelector('[data-record-top-bar-actions]')).not.toBeNull();
  });
});
