/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12553 — the console page header has ONE height whatever it holds.
 *
 * The row's height came from its tallest child: the 36 px icon chip, or a
 * `size="sm"` action. A header with neither (a console page that draws no icon
 * and has no header action) collapsed to its title's line box, so it read
 * shorter than every other page's header. The title row now carries `min-h-9`,
 * the chip's own `h-9`, as its floor.
 *
 * jsdom applies no stylesheet and does no layout, so the class is what is
 * pinned, beside the chip class it matches. The heights themselves are a
 * browser reading (53 px at 1440 for a header with and without a chip).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { PageHeader } from '../PageHeader';

/** The flex row that holds the chip, the title and the subtitle. */
function titleRow(): HTMLElement {
  return screen.getByRole('heading', { level: 1 }).parentElement!;
}

describe('the page header row has the chip height as its floor (objectui#12553)', () => {
  it('a header with no icon and no actions still carries the floor', () => {
    render(<PageHeader title="Profile" subtitle="Manage your account settings" />);
    const header = screen.getByTestId('page-header');
    expect(header.querySelector('svg')).toBeNull();
    expect(header.querySelector('button')).toBeNull();
    expect(titleRow().className.split(/\s+/)).toContain('min-h-9');
  });

  it('the floor matches the chip: a header with an icon carries both', () => {
    render(<PageHeader title="Leads" icon={<svg data-testid="icon" />} />);
    const chip = screen.getByTestId('icon').parentElement!;
    expect(chip.className.split(/\s+/)).toContain('h-9');
    expect(chip.parentElement).toBe(titleRow());
    expect(titleRow().className.split(/\s+/)).toContain('min-h-9');
  });
});
