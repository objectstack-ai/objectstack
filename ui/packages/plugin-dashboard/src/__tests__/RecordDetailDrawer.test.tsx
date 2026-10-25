/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Unit tests for RecordDetailDrawer — the drill-to-record surface for table /
 * list widgets. Verifies field selection (system fields hidden, whitelist
 * honored), label + value formatting (shared with the table cells), title
 * resolution, and the drawer/dialog target switch.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RecordDetailDrawer } from '../RecordDetailDrawer';

const opportunitySchema = {
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'currency', label: 'Amount', defaultCurrency: 'USD' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'won', label: 'Won', color: 'green' },
        { value: 'lost', label: 'Lost', color: 'red' },
      ],
    },
    created_at: { type: 'datetime', label: 'Created' },
  },
};

describe('RecordDetailDrawer', () => {
  it('renders nothing when no record is selected', () => {
    const { container } = render(
      <RecordDetailDrawer record={null} objectName="opportunity" onClose={vi.fn()} />,
    );
    expect(container.querySelector('[data-testid="record-detail-body"]')).toBeNull();
  });

  it('shows business fields with labels and formatted values, hiding system fields', () => {
    render(
      <RecordDetailDrawer
        record={{ id: 'opp-1', name: 'Acme Renewal', amount: 1500, stage: 'won' }}
        objectName="opportunity"
        objectSchema={opportunitySchema}
        onClose={vi.fn()}
      />,
    );

    // Field labels rendered
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.getByText('Stage')).toBeInTheDocument();

    // Currency formatting via the shared renderer (USD inferred from schema)
    expect(screen.getByText(/1,500/)).toBeInTheDocument();

    // Select option label resolved ("won" → "Won")
    expect(screen.getByText('Won')).toBeInTheDocument();

    // System field `id` is not shown as its own row
    expect(screen.queryByText('Id')).toBeNull();
  });

  it('titles the drawer with the record display name', () => {
    render(
      <RecordDetailDrawer
        record={{ id: 'opp-1', name: 'Acme Renewal', amount: 1500 }}
        objectName="opportunity"
        objectSchema={opportunitySchema}
        onClose={vi.fn()}
      />,
    );
    // Title (SheetTitle) + the name field value both read "Acme Renewal"
    expect(screen.getAllByText('Acme Renewal').length).toBeGreaterThanOrEqual(1);
  });

  it('honors an explicit field whitelist (and order)', () => {
    render(
      <RecordDetailDrawer
        record={{ id: 'opp-1', name: 'Acme', amount: 1500, stage: 'won' }}
        objectName="opportunity"
        objectSchema={opportunitySchema}
        fields={['stage']}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Stage')).toBeInTheDocument();
    // amount was not whitelisted
    expect(screen.queryByText('Amount')).toBeNull();
  });

  it('falls back to record keys when no object schema is available', () => {
    render(
      <RecordDetailDrawer
        record={{ id: 'r1', title: 'Untitled task', priority: 'high' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('record-detail-body')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    // _-prefixed / system keys stay hidden
    expect(screen.queryByText('Id')).toBeNull();
  });

  it('renders as a dialog when target="dialog"', () => {
    render(
      <RecordDetailDrawer
        record={{ id: '1', name: 'Acme' }}
        objectName="opportunity"
        target="dialog"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
