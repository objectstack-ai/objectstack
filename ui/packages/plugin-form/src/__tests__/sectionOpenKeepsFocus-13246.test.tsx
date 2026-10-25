/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13246 — opening a collapsed form group keeps keyboard focus on the
 * group's header, the first time as on every later time.
 *
 * THE PRODUCER. The field widgets `@object-ui/fields` registers are
 * `React.lazy`, and a collapsed group holds its fields out of the DOM, so the
 * keypress that opens a group is often the first render of a type
 * (`currency`, `url`…). That render suspends. The toggle was an ordinary
 * update, so the suspension took the nearest boundary that already showed
 * content — `ModalForm`'s body boundary (objectui#12559), or for `DrawerForm`
 * the host's — and React HID that content (`display: none`) behind the
 * fallback, the header holding focus included. A browser does not keep focus
 * on an element that stops being rendered: it drops it to the body, and when
 * the fallback left, the dialog's focus scope moved it to the dialog element.
 * Once the chunk is cached nothing suspends, which is why only the first
 * opening lost focus.
 *
 * THE FIX. The toggle's state update is a transition (`startTransition`), on
 * each host's `setCollapsed`. A transition that suspends at a boundary which
 * already shows content keeps that content on screen until the new rows can be
 * drawn, so the header is never hidden and keeps focus.
 *
 * HOW FOCUS IS OBSERVED. happy-dom does not implement the HTML focus fixup
 * rule: an element hidden by `display: none` stays `document.activeElement`.
 * Measured in Chromium (the browser the defect was read in): a focused element
 * whose ancestor is set to `display: none` loses focus to `<body>` on the next
 * frame, and un-hiding does not give it back. `emulateFocusFixup` restores
 * that rule here, so this file reads what a browser does; the "rendered"
 * assertions read the mechanism itself and need no emulation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { Suspense } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from '../ModalForm';
import { DrawerForm } from '../DrawerForm';

registerAllFields();

/** Replace the `currency` widget with one whose chunk lands only on `release()`. */
function deferCurrencyWidget(): { release: () => void } {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const Deferred = React.lazy(async () => {
    await gate;
    return {
      default: (props: { id?: string; value?: unknown; onChange?: (v: unknown) => void }) => (
        <input
          data-testid="deferred-currency-widget"
          id={props.id}
          value={(props.value as string) ?? ''}
          onChange={(e) => props.onChange?.(e.target.value)}
        />
      ),
    };
  });
  ComponentRegistry.register('currency', Deferred, { namespace: 'field', skipFallback: true });
  return { release: () => act(() => release()) as unknown as void };
}

/** Whether `el` is drawn: no ancestor (itself included) carries `display: none`. */
function isRendered(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if ((node as HTMLElement).style?.display === 'none') return false;
  }
  return true;
}

/**
 * The HTML focus fixup rule, which happy-dom lacks: when the focused element
 * stops being rendered, focus leaves it for the body.
 */
function emulateFocusFixup(): () => void {
  const observer = new MutationObserver(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && !isRendered(active)) active.blur();
  });
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });
  return () => observer.disconnect();
}

let stopFocusFixup: () => void = () => {};
beforeEach(() => { stopFocusFixup = emulateFocusFixup(); });
afterEach(() => { stopFocusFixup(); cleanup(); });

const DEAL = {
  name: 'deal',
  fields: {
    title: { type: 'text', label: 'Title' },
    amount: { type: 'currency', label: 'Amount' },
  },
};

const makeDataSource = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(DEAL),
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: '1' }),
    update: vi.fn(),
  }) as any;

const SECTIONS = [
  { name: 'basic', label: 'Basic', fields: ['title'] },
  { name: 'money', label: 'Money', collapsed: true, fields: ['amount'] },
];

const formNode = (formType: 'modal' | 'drawer') =>
  ({
    type: 'object-form',
    formType,
    objectName: 'deal',
    mode: 'create',
    open: true,
    title: 'Create Deal',
    sections: SECTIONS,
  }) as any;

/** Each host as the console mounts an overlay: under a boundary of its own. */
function mountHost(formType: 'modal' | 'drawer') {
  const ds = makeDataSource();
  render(
    <Suspense fallback={<div data-testid="host-fallback">loading</div>}>
      {formType === 'modal'
        ? <ModalForm schema={formNode('modal')} dataSource={ds} />
        : <DrawerForm schema={formNode('drawer')} dataSource={ds} />}
    </Suspense>,
  );
}

const moneyHeader = () =>
  [...document.body.querySelectorAll('[role="button"][aria-expanded]')].find((el) =>
    el.textContent?.includes('Money'),
  ) as HTMLElement | undefined;

async function formReady() {
  await waitFor(() => expect(document.body.querySelector('[data-field="title"] input')).not.toBeNull());
  await waitFor(() => expect(moneyHeader()).toBeDefined());
}

describe.each(['modal', 'drawer'] as const)(
  'the %s form keeps focus on a group header it opens (objectui#13246)',
  (formType) => {
    it('the first opening, while the group\'s widget loads: the header stays drawn and keeps focus', async () => {
      const { release } = deferCurrencyWidget();
      const user = userEvent.setup();
      mountHost(formType);
      await formReady();

      const header = moneyHeader()!;
      act(() => header.focus());
      expect(document.activeElement).toBe(header);
      expect(header.getAttribute('aria-expanded')).toBe('false');

      await user.keyboard('{Enter}');

      // Mid-load: nothing that holds the header was hidden behind a fallback.
      expect(header.isConnected).toBe(true);
      expect(isRendered(header)).toBe(true);
      expect(document.activeElement).toBe(header);
      expect(screen.queryByTestId('host-fallback')).toBeNull();

      release();
      const widget = await screen.findByTestId('deferred-currency-widget');

      // The group is open, focus never left the header, and the next Tab
      // reaches the group's first field.
      expect(moneyHeader()).toBe(header);
      expect(header.getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(header);
      await user.tab();
      expect(document.activeElement).toBe(widget);
    });

    it('control: once the widget is loaded, closing and re-opening keeps focus on the header', async () => {
      const { release } = deferCurrencyWidget();
      release();
      const user = userEvent.setup();
      mountHost(formType);
      await formReady();

      const header = moneyHeader()!;
      act(() => header.focus());
      // The first opening loads the chunk; where it left focus is the case above.
      await user.keyboard('{Enter}');
      await screen.findByTestId('deferred-currency-widget');
      act(() => header.focus());

      await user.keyboard(' ');
      await waitFor(() => expect(header.getAttribute('aria-expanded')).toBe('false'));
      expect(document.activeElement).toBe(header);
      await user.keyboard('{Enter}');
      const widget = await screen.findByTestId('deferred-currency-widget');

      expect(header.getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(header);
      await user.tab();
      expect(document.activeElement).toBe(widget);
    });
  },
);
