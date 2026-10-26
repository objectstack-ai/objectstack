/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12625 — a record section's controls have accessible names.
 *
 * - A COLLAPSIBLE section's header is a native button named by the section
 *   title. It carries `aria-expanded`, and a click, Enter and Space each
 *   toggle it. Before the fix `CollapsibleTrigger asChild` sat on the
 *   `CardHeader` div: the div got `aria-expanded` and a click handler but no
 *   role and no tabindex, so no button by that name existed and a keyboard
 *   user could not reach the toggle.
 * - The per-field copy-value icon button is named by `detail.copyToClipboard`
 *   (its tooltip is closed at rest, so it had no name).
 *
 * CONTROL: a titled, NON-collapsible section renders its title and no button
 * by that name — the header stays a plain heading there.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DetailViewSection } from '@object-ui/types';

import { DetailSection } from '../DetailSection';

const RECORD = { company: 'Acme', city: 'Paris' };

const section = (overrides: Record<string, unknown>) =>
  ({
    title: 'Lead Information',
    fields: [
      { name: 'company', label: 'Company' },
      { name: 'city', label: 'City' },
    ],
    ...overrides,
  }) as unknown as DetailViewSection;

afterEach(() => {
  cleanup();
});

describe('objectui#12625 — the collapsible section header is a named button', () => {
  it('is a button named by the section title, expanded at rest, toggled by a click', async () => {
    const user = userEvent.setup();
    render(<DetailSection section={section({ collapsible: true })} data={RECORD} />);
    const header = screen.getByRole('button', { name: 'Lead Information' });
    expect(header.tagName).toBe('BUTTON');
    expect(header).toHaveAttribute('type', 'button');
    expect(header).toHaveAttribute('aria-expanded', 'true');
    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('is reachable by Tab and toggled by Enter and by Space', async () => {
    const user = userEvent.setup();
    render(<DetailSection section={section({ collapsible: true })} data={RECORD} />);
    const header = screen.getByRole('button', { name: 'Lead Information' });
    await user.tab();
    expect(header).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(header).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(' ');
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('honours defaultCollapsed: the button reads collapsed', () => {
    render(<DetailSection section={section({ collapsible: true, defaultCollapsed: true })} data={RECORD} />);
    expect(screen.getByRole('button', { name: 'Lead Information' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('CONTROL: a non-collapsible titled section draws its title and no header button', () => {
    render(<DetailSection section={section({ collapsible: false })} data={RECORD} />);
    expect(screen.getByText('Lead Information')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lead Information' })).toBeNull();
    expect(document.querySelector('[aria-expanded]')).toBeNull();
  });
});

describe('objectui#12625 — the copy-value icon button is named', () => {
  it('each read-only field offers a button named "Copy to clipboard"', () => {
    render(<DetailSection section={section({ collapsible: false })} data={RECORD} />);
    expect(screen.getAllByRole('button', { name: 'Copy to clipboard' })).toHaveLength(2);
  });
});
