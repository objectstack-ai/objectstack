/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NumberCellRenderer } from '../index';

const renderNumber = (value: unknown, field: Record<string, unknown> = {}) =>
  render(<NumberCellRenderer value={value as any} field={{ type: 'number', ...field } as any} />);

describe('NumberCellRenderer', () => {
  it('does not pad trailing zeros using `precision` (total digits, not decimal places)', () => {
    // Regression: a decimal(10, 0) column exposes precision: 10, which used to
    // render `1` as "1.0000000000".
    renderNumber(1, { precision: 10 });
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders an integer without decimals when no scale is declared', () => {
    renderNumber(16);
    expect(screen.getByText('16')).toBeInTheDocument();
  });

  it('preserves the value\'s natural decimals when no scale is declared', () => {
    renderNumber(16.5);
    expect(screen.getByText('16.5')).toBeInTheDocument();
  });

  it('pads to a fixed number of decimals when `scale` is declared', () => {
    renderNumber(16, { scale: 2 });
    expect(screen.getByText('16.00')).toBeInTheDocument();
  });

  it('honours a scale of 3 with zero padding', () => {
    renderNumber(3.14, { scale: 3 });
    expect(screen.getByText('3.140')).toBeInTheDocument();
  });

  it('rounds to the declared scale', () => {
    renderNumber(3.14159, { scale: 2 });
    expect(screen.getByText('3.14')).toBeInTheDocument();
  });

  it('treats scale: 0 as an integer display', () => {
    renderNumber(2, { scale: 0 });
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders an empty indicator for nullish values', () => {
    const { container } = renderNumber(null);
    expect(container.textContent).not.toContain('0');
  });
});
