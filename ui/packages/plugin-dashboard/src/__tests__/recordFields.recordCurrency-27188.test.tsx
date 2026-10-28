/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D2 on the dashboard's table cells and record drawer: a `record`-mode
 * amount is drawn in its own row's currency, and with no row code as a plain
 * number — never the tenant default.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, cleanup } from '@testing-library/react';
import { buildFieldMeta, renderFieldValue } from '../recordFields';

afterEach(cleanup);

const DEF = { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } };
const text = (node: React.ReactNode) => {
  const { container, unmount } = render(<>{node}</>);
  const out = (container.textContent ?? '').replace(/\u00a0/g, ' ');
  unmount();
  return out;
};

describe('dashboard record cells — record mode', () => {
  const meta = buildFieldMeta({ accessorKey: 'amount', label: 'Amount', def: DEF });

  it('carries the record-mode config and no field-level currency', () => {
    expect(meta.currency).toBeUndefined();
    expect(meta.currencyConfig).toEqual(DEF.currencyConfig);
  });

  it('draws each row in its own currency', () => {
    expect(text(renderFieldValue(1234.5, meta, 'CNY', 'en-US', { currency_code: 'EUR' }))).toBe('€1,234.50');
    expect(text(renderFieldValue(1234, meta, 'CNY', 'en-US', { currency_code: 'JPY' }))).toBe('¥1,234');
  });

  it('no row code: a plain number, not CN¥', () => {
    expect(text(renderFieldValue(1234.5, meta, 'CNY', 'en-US', {}))).toBe('1,234.50');
    expect(text(renderFieldValue(1234.5, meta, 'CNY', 'en-US'))).toBe('1,234.50');
  });

  it('a dynamic amount is untouched: the tenant currency', () => {
    const home = buildFieldMeta({ accessorKey: 'amount_home', label: 'Home', def: { type: 'currency', currencyConfig: { currencyMode: 'dynamic' } } });
    expect(home.currencyConfig).toBeUndefined();
  });
});
