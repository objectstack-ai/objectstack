/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The dashboard date filter's "Custom…" item opens the range calendar, and
 * keeps it open, whether or not a custom range is already stored
 * (objectui#10843).
 *
 * Two defects, both measured in Chromium before the repair:
 *
 *  - With a custom range stored, the select's value already is the "Custom…"
 *    item. Radix reports a pick only when it changes the value, so picking it
 *    again did nothing and the stored range could not be reopened for editing.
 *  - From a preset, the pick did open the calendar, but the select then handed
 *    focus back to its trigger and that dismissed the calendar at once.
 *
 * Every case drives the real Radix select and popover with user-event: nothing
 * from `@object-ui/components` is mocked. A MutationObserver records every
 * calendar mount, so a calendar that opens and is dismissed straight away
 * still leaves a reading. The clock is faked for `Date` alone, in another year
 * than the stored range.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resolveDashboardFilterDefs } from '@object-ui/core';
import { DashboardFilterBar } from '../DashboardFilterBar';

/** Today, in another year than the stored range. */
const TODAY = new Date(2026, 8, 27, 12);
const STORED = { from: '2020-03-15', to: '2020-03-20' };
const PRESET = { preset: 'last_7_days' };

const defs = resolveDashboardFilterDefs({ dateRange: { field: 'created_at' } });

function captions(): string[] {
  return [...document.body.querySelectorAll('.rdp-caption_label')].map((el) => (el.textContent ?? '').trim());
}

/** Every distinct caption set the page showed, in order, from mount on. */
let seen: string[][] = [];
let observer: MutationObserver | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
  seen = [];
  observer = new MutationObserver(() => {
    const now = captions();
    if (now.length && JSON.stringify(now) !== JSON.stringify(seen[seen.length - 1])) seen.push(now);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
});

afterEach(() => {
  observer?.disconnect();
  cleanup();
  vi.useRealTimers();
});

function renderBar(value: unknown) {
  const onChange = vi.fn();
  render(<DashboardFilterBar defs={defs} values={{ dateRange: value }} onChange={onChange} />);
  return { onChange, trigger: screen.getByRole('combobox') };
}

/**
 * Let the select finish closing: its content unmounts and its focus scope
 * returns focus on a zero-delay timer, which is when a calendar opened during
 * the pick was dismissed.
 */
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
}

describe('DashboardFilterBar — "Custom…" opens the range calendar (objectui#10843)', () => {
  it('harness control: from a preset, picking "Custom…" through the real select mounts the calendar', async () => {
    const user = userEvent.setup();
    const { trigger } = renderBar(PRESET);
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Custom…' }));
    await settle();
    // Read from the observer, not the page: this proves the select drives the
    // item and the popover can mount at all, however long it then stays.
    expect(seen).toContainEqual(['September 2026', 'October 2026']);
  });

  it('with a custom range stored, picking "Custom…" shows the calendar on the stored `from` month', async () => {
    const user = userEvent.setup();
    const { trigger, onChange } = renderBar(STORED);
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Custom…' }));
    await waitFor(() => expect(captions()).toEqual(['March 2020', 'April 2020']));
    await settle();
    expect(captions()).toEqual(['March 2020', 'April 2020']);
    // Reopening commits nothing by itself.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('from a preset, the calendar stays open after the select returns focus', async () => {
    const user = userEvent.setup();
    const { trigger } = renderBar(PRESET);
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Custom…' }));
    await settle();
    expect(captions()).toEqual(['September 2026', 'October 2026']);
  });

  it('by keyboard: Enter opens the select and Enter on "Custom…" reopens the stored range', async () => {
    const user = userEvent.setup();
    const { trigger } = renderBar(STORED);
    trigger.focus();
    await user.keyboard('{Enter}');
    const custom = await screen.findByRole('option', { name: 'Custom…' });
    await waitFor(() => expect(document.activeElement).toBe(custom));
    await user.keyboard('{Enter}');
    await settle();
    expect(captions()).toEqual(['March 2020', 'April 2020']);
  });

  it('by keyboard from a preset: Enter on "Custom…" opens the calendar on today\'s month, and the Enter stays with the list', async () => {
    // The pick changes the value here, so Radix reports it while the list is
    // still open. Opening the calendar right then would hand the Enter's own
    // activation to the calendar's first button (its previous-month arrow).
    const user = userEvent.setup();
    const { trigger } = renderBar(PRESET);
    trigger.focus();
    await user.keyboard('{Enter}');
    const custom = await screen.findByRole('option', { name: 'Custom…' });
    await user.keyboard('{End}');
    await waitFor(() => expect(document.activeElement).toBe(custom));
    await user.keyboard('{Enter}');
    await settle();
    expect(captions()).toEqual(['September 2026', 'October 2026']);
    expect(seen).toEqual([['September 2026', 'October 2026']]);
  });

  it('Escape on the reopened calendar closes it and returns focus to the select', async () => {
    const user = userEvent.setup();
    const { trigger } = renderBar(STORED);
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Custom…' }));
    await settle();
    expect(captions()).toEqual(['March 2020', 'April 2020']);
    await user.keyboard('{Escape}');
    await settle();
    expect(captions()).toEqual([]);
    expect(document.activeElement).toBe(trigger);
  });

  it('type-ahead on the CLOSED select: "c" over a stored preset picks "Custom…" and the calendar opens and stays open', async () => {
    // Radix's third pick path: the closed trigger's own type-ahead changes the
    // value with no item event and no list, so nothing returns focus.
    const user = userEvent.setup();
    const { trigger, onChange } = renderBar(PRESET);
    trigger.focus();
    await user.keyboard('c');
    await settle();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(captions()).toEqual(['September 2026', 'October 2026']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('control: type-ahead "c" on the CLOSED select over a stored range names the current item, so nothing changes', async () => {
    // Radix's type-ahead skips the item that is already the value.
    const user = userEvent.setup();
    const { trigger, onChange } = renderBar(STORED);
    trigger.focus();
    await user.keyboard('c');
    await settle();
    expect(seen).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('control: closing the select with Escape, even from "Custom…", opens no calendar', async () => {
    const user = userEvent.setup();
    const { trigger } = renderBar(STORED);
    trigger.focus();
    await user.keyboard('{Enter}');
    const custom = await screen.findByRole('option', { name: 'Custom…' });
    await waitFor(() => expect(document.activeElement).toBe(custom));
    await user.keyboard('{Escape}');
    await settle();
    expect(seen).toEqual([]);
  });

  it('control: a space typed as type-ahead on "Custom…" picks nothing, so a later Escape opens no calendar', async () => {
    const user = userEvent.setup();
    const { trigger } = renderBar(STORED);
    trigger.focus();
    await user.keyboard('{Enter}');
    const custom = await screen.findByRole('option', { name: 'Custom…' });
    // "c" starts a type-ahead search that lands on "Custom…"; the space that
    // follows extends the search instead of picking the item.
    await user.keyboard('c ');
    expect(document.activeElement).toBe(custom);
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.keyboard('{Escape}');
    await settle();
    expect(seen).toEqual([]);
  });

  it('control: picking a preset over a stored range commits the preset and opens no calendar', async () => {
    const user = userEvent.setup();
    const { trigger, onChange } = renderBar(STORED);
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: /last 7 days/i }));
    await settle();
    expect(onChange).toHaveBeenCalledWith('dateRange', { preset: 'last_7_days' });
    expect(seen).toEqual([]);
  });
});
