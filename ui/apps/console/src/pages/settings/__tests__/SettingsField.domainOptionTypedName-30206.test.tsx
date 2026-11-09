// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SettingsField: a name typed into a domain-bearing select commits that
 * option's code (objectstack#30206).
 *
 * The country picker shows each option as its name and code, 「中国 (CN)」. A
 * Chinese administrator typed 「中国」 into 默认国家 and the combobox committed
 * the text as typed, so the server's `^[A-Za-z]{2}$` pattern refused it. A
 * name that exactly one option carries is now committed as that option's code;
 * anything else is still committed verbatim, and the server stays the judge
 * of the domain.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useState } from 'react';

import { SettingsField } from '../SettingsField';
import type { Specifier } from '../types';

/** `localization.default_country` as the server declares it in `zh` (abridged). */
const COUNTRY: Specifier = {
  type: 'select',
  key: 'default_country',
  label: '默认国家',
  pattern: '^[A-Za-z]{2}$',
  valueDomain: 'iso_3166_alpha2',
  options: [
    { value: 'US', label: '美国 (US)' },
    { value: 'CN', label: '中国 (CN)' },
    { value: 'DE', label: 'Germany（DE）' },
    { value: 'GB', label: 'United Kingdom (GB)' },
    { value: 'UM', label: 'United Kingdom (UM)' },
  ],
};

/** `localization.currency`, whose suggestions read `CODE — Name`. */
const CURRENCY: Specifier = {
  type: 'select',
  key: 'currency',
  label: '默认货币',
  valueDomain: 'iso_4217_currency',
  options: [
    { value: 'CNY', label: 'CNY — 人民币' },
    { value: 'USD', label: 'USD — 美元' },
  ],
};

function Row({ spec, onCommit }: { spec: Specifier; onCommit: (v: unknown) => void }) {
  const [value, setValue] = useState<unknown>(null);
  return (
    <SettingsField
      spec={spec}
      value={value}
      onChange={(next) => {
        onCommit(next);
        setValue(next);
      }}
    />
  );
}

function renderRow(spec: Specifier) {
  const onCommit = vi.fn();
  const view = render(<Row spec={spec} onCommit={onCommit} />);
  const input = view.container.querySelector('input') as HTMLInputElement;
  return { ...view, input, onCommit };
}

afterEach(cleanup);

describe('SettingsField: a typed option name commits the option code (objectstack#30206)', () => {
  it('「中国」 typed into 默认国家 commits CN, and reads as its option on blur', () => {
    const { input, onCommit } = renderRow(COUNTRY);
    fireEvent.change(input, { target: { value: '中国' } });
    expect(onCommit).toHaveBeenLastCalledWith('CN');
    fireEvent.blur(input);
    expect(input.value).toBe('中国 (CN)');
  });

  it('matches trimmed and case-insensitively, with full-width brackets too', () => {
    const { input, onCommit } = renderRow(COUNTRY);
    fireEvent.change(input, { target: { value: '  germany ' } });
    expect(onCommit).toHaveBeenLastCalledWith('DE');
  });

  it('a name two options carry is not a pick: it is committed verbatim', () => {
    const { input, onCommit } = renderRow(COUNTRY);
    fireEvent.change(input, { target: { value: 'United Kingdom' } });
    expect(onCommit).toHaveBeenLastCalledWith('United Kingdom');
  });

  it('part of a name is not a name: it is committed verbatim, as before', () => {
    const { input, onCommit } = renderRow(COUNTRY);
    fireEvent.change(input, { target: { value: '中' } });
    expect(onCommit).toHaveBeenLastCalledWith('中');
  });

  it('a currency name commits its code when the label leads with the code', () => {
    const { input, onCommit } = renderRow(CURRENCY);
    fireEvent.change(input, { target: { value: '人民币' } });
    expect(onCommit).toHaveBeenLastCalledWith('CNY');
  });
});
