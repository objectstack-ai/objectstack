/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11026 — `NumberCellRenderer` reads the field's authored
 * `useGrouping` and hands it to `formatDisplayNumber`, so the author's hint
 * beats the scale-0 heuristic of objectui#4033 in either direction.
 *
 * Every hint row has a control on the same value with the key left out, so a
 * row cannot pass because the renderer drew the heuristic's answer by
 * accident.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider } from '@object-ui/i18n';
import { NumberCellRenderer } from '../index';

const draw = (value: number, field: Record<string, unknown>): string => {
  const { container, unmount } = render(
    <LocalizationProvider value={{ locale: 'en-US' }}>
      <NumberCellRenderer value={value} field={{ type: 'number', name: 'n', ...field } as any} />
    </LocalizationProvider>,
  );
  const text = container.textContent ?? '';
  unmount();
  return text;
};

describe('NumberCellRenderer — the authored useGrouping reaches the formatter (objectui#11026)', () => {
  it('useGrouping: false renders ungrouped, even with a non-zero scale', () => {
    expect(draw(12345.5, { scale: 2, useGrouping: false })).toBe('12345.50');
    // CONTROL: the same field without the hint groups.
    expect(draw(12345.5, { scale: 2 })).toBe('12,345.50');
  });

  it('useGrouping: true renders grouped, even at scale 0', () => {
    expect(draw(2026, { scale: 0, useGrouping: true })).toBe('2,026');
    // CONTROL: the same field without the hint is the heuristic's ordinal.
    expect(draw(2026, { scale: 0 })).toBe('2026');
  });

  it('a value that is not a boolean is not a declaration: the heuristic decides', () => {
    expect(draw(2026, { scale: 0, useGrouping: 'true' })).toBe('2026');
  });
});
