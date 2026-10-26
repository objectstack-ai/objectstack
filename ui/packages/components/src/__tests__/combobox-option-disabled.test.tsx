/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7687 — `options[].disabled` on a `combobox` node must be READ.
 *
 * The member was declared (`@object-ui/types` `ComboboxOption.disabled`),
 * validated (`ComboboxOptionSchema` in the zod mirror, pinned as `boolean` on
 * both faces by `disabled-twin-symmetry-7087.test.ts`) and never read: the
 * component mapped each option to a `CommandItem` with `key` / `value` /
 * `onSelect` only, so an option authored `disabled: true` passed validation,
 * type-checked against the published `ComboboxSchema`, and rendered as an
 * ordinary selectable option — a declared key with no read site behind it.
 *
 * ⛔ An attribute-only pin is not enough here: it passes on "styled disabled
 * but still clickable", which is the exact defect this card is about. So the
 * behaviour is pinned too — a disabled option must not fire `onValueChange`.
 * The third test is the CONTROL that keeps that negative from being vacuous:
 * without it, a popover that never opened would satisfy "not called".
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Combobox } from '../custom/combobox';

const OPTIONS = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta', disabled: true },
  { value: 'gamma', label: 'Gamma', disabled: false },
];

function openDropdown() {
  fireEvent.click(screen.getByRole('combobox'));
}

describe('Combobox honours options[].disabled (objectui#7687)', () => {
  it('marks an option authored `disabled: true` as disabled in the DOM', () => {
    render(<Combobox options={OPTIONS} value="" onValueChange={vi.fn()} />);
    openDropdown();

    const beta = screen.getByRole('option', { name: /Beta/ });
    // `data-disabled` is what the CommandItem wrapper's className already
    // styles (`data-[disabled=true]:opacity-50 …:pointer-events-none`);
    // `aria-disabled` is what assistive tech and cmdk's own valid-item
    // selector read.
    expect(beta).toHaveAttribute('data-disabled', 'true');
    expect(beta).toHaveAttribute('aria-disabled', 'true');
  });

  it('refuses to select a disabled option — no onValueChange', () => {
    const onValueChange = vi.fn();
    render(<Combobox options={OPTIONS} value="" onValueChange={onValueChange} />);
    openDropdown();

    fireEvent.click(screen.getByRole('option', { name: /Beta/ }));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('refuses the keyboard path too — Enter on a search narrowed to the disabled option selects nothing', () => {
    const onValueChange = vi.fn();
    render(<Combobox options={OPTIONS} value="" onValueChange={onValueChange} />);
    openDropdown();

    // A separate code path from the click above: cmdk keeps disabled items out
    // of the valid-item selector its arrow keys and its auto-select walk, and
    // never registers the `cmdk-item-select` listener Enter dispatches. With
    // the list narrowed to `Beta` alone there is nothing left to select.
    const search = screen.getByPlaceholderText('Search...');
    fireEvent.change(search, { target: { value: 'bet' } });
    expect(screen.getByRole('option', { name: /Beta/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Alpha/ })).toBeNull();

    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('CONTROL — options without `disabled: true` stay selectable', () => {
    const onValueChange = vi.fn();
    render(<Combobox options={OPTIONS} value="" onValueChange={onValueChange} />);
    openDropdown();

    // Omitted (`alpha`) and explicitly `false` (`gamma`) are both enabled.
    const alpha = screen.getByRole('option', { name: /Alpha/ });
    const gamma = screen.getByRole('option', { name: /Gamma/ });
    expect(alpha).toHaveAttribute('data-disabled', 'false');
    expect(gamma).toHaveAttribute('data-disabled', 'false');

    fireEvent.click(alpha);
    expect(onValueChange).toHaveBeenCalledWith('alpha');
  });

  it('CONTROL — the keyboard path still selects an enabled option', () => {
    const onValueChange = vi.fn();
    render(<Combobox options={OPTIONS} value="" onValueChange={onValueChange} />);
    openDropdown();

    const search = screen.getByPlaceholderText('Search...');
    fireEvent.change(search, { target: { value: 'gam' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledWith('gamma');
  });
});
