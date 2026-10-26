/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The share dialog's expiry picks with the shared `Select` (objectui#11865).
 *
 * `SharedViewLink`'s "Expires after" control was a browser-native select
 * beside the shared Radix `Select` the rest of the console picks with. The
 * card asks for one control for one kind of choice, surface by surface.
 *
 * What is pinned:
 *   - it IS the primitive (a Radix combobox trigger), lists the native
 *     control's options in its order and shows "Never" first;
 *   - every option writes what the native control wrote: the generated link's
 *     options are compared as JSON text, "Never" (the option whose value is
 *     `''`) included;
 *   - a pick leaves the share popover open;
 *   - the keyboard alone opens the picker and selects.
 *
 * The picker has no name: the native control had none either (its label has
 * no `htmlFor`, and it had no `aria-label`), so there is no name to keep. The
 * dialog has no read-only state.
 *
 * DIRECTION, observed against the native control: every pin here reads the
 * control as the primitive's trigger, so each is red there. What makes the
 * write rows guards of "the conversion changed nothing the link carries" is
 * the literal each compares against: a `change` event on the pre-conversion
 * native control, followed by "Generate Link", produced that same JSON, read
 * once on this component with this clock.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { SharedViewLink } from '../SharedViewLink';

const NOW = new Date('2026-01-01T00:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function openShare() {
  const onShare = vi.fn();
  render(<SharedViewLink objectName="account" baseUrl="https://example.test" onShare={onShare} />);
  fireEvent.click(screen.getByRole('button', { name: /share/i }));
  return { onShare, trigger: screen.getByRole('combobox') };
}

async function openPicker(trigger: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(trigger: HTMLElement, label: string): Promise<void> {
  const options = await openPicker(trigger);
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`the picker lists no "${label}": ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
}

/** The options the generated link carries, as JSON text. */
function generated(onShare: ReturnType<typeof vi.fn>): string {
  fireEvent.click(screen.getByRole('button', { name: /generate link/i }));
  expect(onShare).toHaveBeenCalledTimes(1);
  return JSON.stringify(onShare.mock.calls[0][1]);
}

/**
 * [option label, the link options it produced, the badge it showed], as a
 * `change` event on the native control produced them before the conversion.
 */
const WRITES: ReadonlyArray<readonly [string, string, string | null]> = [
  ['1 day', '{"expiresAt":"2026-01-02T00:00:00.000Z"}', 'Expires in 1 day'],
  ['7 days', '{"expiresAt":"2026-01-08T00:00:00.000Z"}', 'Expires in 7 days'],
  ['30 days', '{"expiresAt":"2026-01-31T00:00:00.000Z"}', 'Expires in 30 days'],
  ['90 days', '{"expiresAt":"2026-04-01T00:00:00.000Z"}', 'Expires in 90 days'],
];

describe('SharedViewLink — the expiry picker is the shared Select (objectui#11865)', () => {
  it('is the primitive, lists the native options in order, and shows "Never"', async () => {
    const { trigger } = openShare();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.textContent).toBe('Never');
    const options = await openPicker(trigger);
    expect(options.map((o) => o.textContent)).toEqual(['Never', '1 day', '7 days', '30 days', '90 days']);
  });

  it.each(WRITES)('picking "%s" writes what the native control wrote', async (label, json, badge) => {
    const { onShare, trigger } = openShare();
    await pick(trigger, label);
    expect(trigger.textContent).toBe(label);
    expect(generated(onShare)).toBe(json);
    expect(screen.getByText(/^Expires in/).textContent).toBe(badge);
  });

  it('picking "Never" after another option writes no expiry, as the native control did', async () => {
    const { onShare, trigger } = openShare();
    await pick(trigger, '30 days');
    await pick(trigger, 'Never');
    expect(trigger.textContent).toBe('Never');
    // The native control's '' option: both keys present, both undefined, so
    // the JSON text is '{}'.
    const json = generated(onShare);
    expect(json).toBe('{}');
    expect(onShare.mock.calls[0][1]).toStrictEqual({ password: undefined, expiresAt: undefined });
    expect(screen.queryByText(/^Expires in/)).not.toBeInTheDocument();
  });

  it('a pick leaves the share popover open', async () => {
    const { trigger } = openShare();
    await pick(trigger, '90 days');
    expect(screen.getByRole('button', { name: /generate link/i })).toBeInTheDocument();
  });

  it('Enter opens the picker and Enter on an option selects it', async () => {
    const { onShare, trigger } = openShare();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: '7 days' }), { key: 'Enter' });
    expect(trigger.textContent).toBe('7 days');
    expect(generated(onShare)).toBe('{"expiresAt":"2026-01-08T00:00:00.000Z"}');
  });
});
