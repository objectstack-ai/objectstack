/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12732 — on a page that declares `print`, a collapsible detail
 * section's header prints as a plain heading.
 *
 * objectui#11958 opened a collapsible section on paper but left its header
 * as the screen control: a native disclosure button with `aria-expanded`, a
 * chevron, and the `cursor-pointer` / hover classes of a clickable header.
 * Paper cannot toggle anything, so under a `PrintPageProvider` the section
 * takes the same render as a non-collapsible one: the title, the icon, the
 * header colour and the description, and the content always shown. Off a
 * print page the disclosure header is unchanged.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { SchemaRenderer, PrintPageProvider } from '@object-ui/react';
// Module scope: importing the package index runs the registrations under test.
import '../index';

const collapsibleSection = {
  type: 'detail-section',
  title: 'Billing Address',
  description: 'Where invoices are sent',
  icon: 'map-pin',
  headerColor: 'primary/10',
  collapsible: true,
  defaultCollapsed: true,
  fields: [
    { name: 'street', label: 'Street' },
    { name: 'city', label: 'City' },
  ],
} as never;

const RECORD = { street: '1 Market St', city: 'San Francisco' };

/** The header element: the `CardHeader` holding the section title. */
function headerOf(title: string): HTMLElement {
  const header = screen.getByText(title).closest('.py-3');
  expect(header).not.toBeNull();
  return header as HTMLElement;
}

afterEach(() => cleanup());

describe('a collapsible detail section prints a plain heading (objectui#12732)', () => {
  it('under a print page the header has no button, no chevron and no clickable-header classes', async () => {
    render(
      <PrintPageProvider value={{ paperSize: 'A4' }}>
        <SchemaRenderer schema={collapsibleSection} data={RECORD} />
      </PrintPageProvider>,
    );
    const header = headerOf('Billing Address');

    expect(header.querySelector('button')).toBeNull();
    expect(document.querySelector('[aria-expanded]')).toBeNull();
    expect(header.querySelector('svg.lucide-chevron-down, svg.lucide-chevron-right')).toBeNull();
    expect(header.className).not.toMatch(/cursor-pointer/);
    expect(header.className).not.toMatch(/hover:/);

    // What paper keeps: the title, the icon, the header colour, the
    // description, and the content.
    // The icon is lazy-loaded, so it lands after the first paint.
    await waitFor(() => expect(header.querySelector('svg.lucide-map-pin')).not.toBeNull());
    expect(header.className).toMatch(/bg-primary\/10/);
    expect(screen.getByText('Where invoices are sent')).toBeTruthy();
    expect(screen.getByText('1 Market St')).toBeTruthy();
  });

  it('CONTROL — off a print page the disclosure header is unchanged and toggles', () => {
    render(<SchemaRenderer schema={collapsibleSection} data={RECORD} />);
    const header = headerOf('Billing Address');

    const button = screen.getByRole('button', { name: /Billing Address/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(header.querySelector('svg.lucide-chevron-right')).not.toBeNull();
    expect(header.className).toMatch(/cursor-pointer/);
    expect(header.className).toMatch(/hover:bg-muted\/50/);
    expect(screen.queryByText('Where invoices are sent')).toBeNull();
    expect(screen.queryByText('1 Market St')).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(header.querySelector('svg.lucide-chevron-down')).not.toBeNull();
    expect(screen.getByText('Where invoices are sent')).toBeTruthy();
    expect(screen.getByText('1 Market St')).toBeTruthy();
  });
});
