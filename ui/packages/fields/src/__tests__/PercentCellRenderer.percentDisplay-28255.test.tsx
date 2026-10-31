/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28255: the percent cell reads the field's `percentDisplay`
 * (`FieldSchema.percentDisplay` in `@objectstack/spec`).
 *
 * `plain` is a rate or a probability rather than progress, so the cell prints
 * the percentage alone, with no `progressbar`. Absent or `bar` keeps the bar
 * beside the number. Every read-only host (grid cell, detail field, header
 * chip) draws this one renderer; the relay sites that carry the key to it are
 * pinned in their own packages.
 *
 * ── Directions with the read removed (the ablation this file exists for) ──
 *   `plain`: no progressbar          RED   (the bar is drawn)
 *   `plain`: the number is the text  GREEN (the bar's text is the same number)
 *   `bar` / absent: a progressbar    GREEN (the default face either way)
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PercentCellRenderer } from '../index';

afterEach(cleanup);

function renderCell(value: unknown, field: Record<string, unknown>) {
  return render(<PercentCellRenderer value={value as any} field={{ type: 'percent', name: 'probability', ...field } as any} />);
}

describe('PercentCellRenderer reads percentDisplay (objectstack#28255)', () => {
  it('`plain` prints the percentage alone, with no progress bar', () => {
    const { container } = renderCell(0.25, { percentDisplay: 'plain' });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(container.textContent).toBe('25%');
  });

  it('`plain` keeps the declared width and storage: a whole-stored value at scale 1', () => {
    const { container } = renderCell(33.3, { percentDisplay: 'plain', max: 100, scale: 1 });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(container.textContent).toBe('33.3%');
  });

  it('`bar` pins the progress bar', () => {
    renderCell(0.25, { percentDisplay: 'bar' });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  });

  it('CONTROL: an absent key keeps the renderer default, the bar', () => {
    const { container } = renderCell(0.25, {});
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(container.textContent).toBe('25%');
  });

  it('a blank value is still the empty face under `plain`', () => {
    const { container } = renderCell(null, { percentDisplay: 'plain' });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(container.textContent).not.toContain('%');
  });
});
