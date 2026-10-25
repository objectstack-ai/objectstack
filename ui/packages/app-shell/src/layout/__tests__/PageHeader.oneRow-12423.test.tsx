/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12423 — the console page header is ONE row from the `sm`
 * breakpoint up: icon, title, then the description behind a hairline divider,
 * actions on the right. Nothing is drawn beneath the title.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { PageHeader } from '../PageHeader';

describe('PageHeader is one row (objectui#12423)', () => {
  it('the title and the description are siblings in one flex row, with no block under the title', () => {
    render(
      <PageHeader
        title="Leads"
        subtitle="People who may buy"
        icon={<svg data-testid="icon" />}
        actions={<button type="button">New</button>}
      />,
    );
    const header = screen.getByTestId('page-header');
    const headings = header.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    const h1 = headings[0];
    const description = screen.getByText('People who may buy');

    const row = h1.parentElement!;
    expect(description.parentElement).toBe(row);
    expect(row.className.split(/\s+/)).toContain('flex');
    expect(row.className.split(/\s+/)).toContain('items-center');
    // The icon chip opens the same row; the description comes after the title.
    expect(row.contains(screen.getByTestId('icon'))).toBe(true);
    expect(Boolean(h1.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    // Nothing nests inside the heading's row slot: the h1 holds the title alone.
    expect(h1.children).toHaveLength(0);
    expect(h1).toHaveTextContent('Leads');
    // A hairline divider sits between them, hidden from assistive tech.
    const divider = description.previousElementSibling as HTMLElement;
    expect(divider).not.toBe(h1);
    expect(divider).toHaveAttribute('aria-hidden', 'true');
    // Truncated to the row, and hidden below `sm` as before.
    expect(description.className).toContain('truncate');
    expect(description.className).toContain('hidden');
    expect(description.className).toContain('sm:block');
    // Actions sit on the right, outside the title row.
    expect(row.contains(screen.getByRole('button', { name: 'New' }))).toBe(false);
  });

  it('without a description there is no divider either', () => {
    render(<PageHeader title="Leads" />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.nextElementSibling).toBeNull();
  });
});
