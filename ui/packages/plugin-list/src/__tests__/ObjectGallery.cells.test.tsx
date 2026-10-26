/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Regression test: gallery cards must format visible fields with the
 * shared `getCellRenderer` pipeline so card output matches the record
 * detail page (status → Badge, currency → formatted, phone → tel:
 * link, etc.). Previously the gallery rendered values via a string-only
 * `formatFieldValue` helper which dropped all rich semantics.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ObjectGallery } from '../ObjectGallery';
import { SchemaRendererProvider } from '@object-ui/react';

const objectSchema = {
  fields: {
    name: { type: 'text', label: 'Name' },
    status: {
      type: 'status',
      label: 'Status',
      options: [
        { value: 'active', label: 'Active', color: 'green' },
        { value: 'inactive', label: 'Inactive', color: 'gray' },
      ],
    },
    annual_revenue: { type: 'currency', label: 'Revenue', currency: 'USD' },
    phone: { type: 'phone', label: 'Phone' },
    website: { type: 'url', label: 'Website' },
  },
};

const data = [
  {
    id: 'a1',
    name: 'Acme Corp',
    status: 'active',
    annual_revenue: 5000000,
    phone: '+1-555-0100',
    website: 'https://acme.example.com',
  },
];

const mockDataSource = {
  find: vi.fn().mockResolvedValue(data),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
};

const renderGallery = (visibleFields: string[]) =>
  render(
    <SchemaRendererProvider dataSource={mockDataSource as any}>
      <ObjectGallery
        schema={{
          type: 'object-gallery',
          objectName: 'account',
          gallery: {
            titleField: 'name',
            visibleFields,
          },
        }}
      />
    </SchemaRendererProvider>,
  );

describe('ObjectGallery — shared cell renderers', () => {
  it('renders status as a Badge (not plain text)', async () => {
    renderGallery(['status']);
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    const label = await screen.findByText('Active');
    // SelectCellRenderer wraps the option label in a <Badge>-flavored
    // span carrying the configured option color class. Since #2548 the
    // text sits in an inner `truncate` span (ellipsis for overlong
    // labels), so the Badge chrome lives on the closest wrapper.
    const badge =
      label.closest('[class*="rounded"], [class*="inline-flex"], [class*="border"]') ?? label;
    const cls = (badge as HTMLElement).className || '';
    expect(cls.length).toBeGreaterThan(0);
    // We don't pin the exact tailwind tokens, but the Badge always
    // applies rounded + inline-flex utilities.
    expect(cls).toMatch(/rounded|inline-flex|border/);
  });

  it('formats currency values with locale formatting', async () => {
    renderGallery(['annual_revenue']);
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    // CurrencyCellRenderer outputs e.g. "$5,000,000.00".
    expect(await screen.findByText(/\$\s?5[,\u00A0]000[,\u00A0]000/)).toBeInTheDocument();
  });

  it('renders phone values as a tel: link', async () => {
    renderGallery(['phone']);
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    const link = await screen.findByRole('link', { name: /555-0100/ });
    expect(link.getAttribute('href')).toMatch(/^tel:/);
  });

  it('renders url values as an anchor', async () => {
    renderGallery(['website']);
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    const link = await screen.findByRole('link', { name: /acme/i });
    expect(link.getAttribute('href')).toBe('https://acme.example.com');
  });
});
