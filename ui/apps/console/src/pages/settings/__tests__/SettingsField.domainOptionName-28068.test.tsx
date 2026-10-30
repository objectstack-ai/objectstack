/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * SettingsField — a domain-bearing `select` shows a stored code as its
 * option's name, and still stores the code (objectstack#28068).
 *
 * Company `country` and Localization `default_country` are selects over the
 * `iso_3166_alpha2` domain whose options name each code ("Germany (DE)"). The
 * combobox showed the stored `DE` bare in the box, so the names were visible
 * only in the suggestion list. The suggest-but-allow-anything contract of the
 * domain control is unchanged: a value outside the table is still committed
 * verbatim, and the server stays the judge of the domain.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useState } from 'react';

import { SettingsField } from '../SettingsField';
import type { Specifier } from '../types';

/** Abridged `company.country` as the server declares it. */
const COUNTRY: Specifier = {
  type: 'select',
  key: 'country',
  label: 'Country',
  valueDomain: 'iso_3166_alpha2',
  options: [
    { value: 'US', label: 'United States (US)' },
    { value: 'DE', label: 'Germany (DE)' },
    { value: 'FR', label: 'France (FR)' },
  ],
};

/** A settings page's draft in one row: `value` follows what `onChange` commits. */
function Row({ initial, onCommit }: { initial: unknown; onCommit: (v: unknown) => void }) {
  const [value, setValue] = useState<unknown>(initial);
  return (
    <SettingsField
      spec={COUNTRY}
      value={value}
      onChange={(next) => {
        onCommit(next);
        setValue(next);
      }}
    />
  );
}

function renderRow(initial: unknown) {
  const onCommit = vi.fn();
  const view = render(<Row initial={initial} onCommit={onCommit} />);
  const input = view.container.querySelector('input') as HTMLInputElement;
  return { ...view, input, onCommit };
}

afterEach(cleanup);

describe('SettingsField — a domain-bearing select shows the option name for a stored code', () => {
  it('a stored DE reads as its name in the box', () => {
    const { input } = renderRow('DE');
    expect(input.value).toBe('Germany (DE)');
  });

  it('picking a named option stores its code and keeps the name in the box', () => {
    const { input, onCommit } = renderRow('US');
    // A datalist pick writes the suggestion's `value` attribute into the box.
    fireEvent.change(input, { target: { value: 'France (FR)' } });
    expect(onCommit).toHaveBeenLastCalledWith('FR');
    expect(input.value).toBe('France (FR)');
  });

  it('a code typed by hand is committed as typed and reads as its name on blur', () => {
    const { input, onCommit } = renderRow(null);
    fireEvent.change(input, { target: { value: 'DE' } });
    expect(onCommit).toHaveBeenLastCalledWith('DE');
    expect(input.value).toBe('DE');
    fireEvent.blur(input);
    expect(input.value).toBe('Germany (DE)');
  });

  it('a free-text value outside the table is still committed verbatim', () => {
    const { input, onCommit } = renderRow('DE');
    fireEvent.change(input, { target: { value: 'CH' } });
    expect(onCommit).toHaveBeenLastCalledWith('CH');
    fireEvent.change(input, { target: { value: 'Germ' } });
    expect(onCommit).toHaveBeenLastCalledWith('Germ');
    fireEvent.blur(input);
    // No option carries it, so it shows as itself.
    expect(input.value).toBe('Germ');
  });

  it('an unmatched stored value shows verbatim, and an emptied box is unset', () => {
    const { input, onCommit } = renderRow('CH');
    expect(input.value).toBe('CH');
    fireEvent.change(input, { target: { value: '' } });
    expect(onCommit).toHaveBeenLastCalledWith(null);
    expect(input.value).toBe('');
  });

  it('a value changed from outside the box shows as its name', () => {
    // A reset or a re-read after save hands the row a new value while the
    // admin's last pick is still held in the box.
    const { container, rerender } = render(
      <SettingsField spec={COUNTRY} value="US" onChange={() => {}} />,
    );
    const box = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'United States (US)' } });
    rerender(<SettingsField spec={COUNTRY} value="DE" onChange={() => {}} />);
    expect(box.value).toBe('Germany (DE)');
  });
});
