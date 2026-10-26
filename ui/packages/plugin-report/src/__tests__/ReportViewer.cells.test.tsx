/**
 * Type-aware cell rendering smoke tests.
 *
 * Verifies that ReportViewer delegates to the shared `<FieldValue>` /
 * `getCellRenderer` registry from `@object-ui/fields` so that select,
 * lookup, boolean, email, url, phone, image, etc. columns render the
 * appropriate component instead of `String(value)`.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ReportViewer } from '../ReportViewer';

const baseSchema: any = {
  type: 'report-viewer',
  showToolbar: false,
  allowExport: false,
  allowPrint: false,
  data: [],
  report: {
    title: 'T',
    fields: [],
    sections: [],
  },
};

function withRow(field: any, row: Record<string, any>) {
  return {
    ...baseSchema,
    data: [row],
    report: {
      ...baseSchema.report,
      fields: [field],
      sections: [
        {
          type: 'table',
          title: 'Details',
          columns: [field],
        },
      ],
    },
  };
}

describe('ReportViewer type-aware cells', () => {
  it('renders select values as a Badge with the option label', () => {
    const schema = withRow(
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        options: [
          { value: 'open', label: 'Open', color: 'green' },
          { value: 'closed', label: 'Closed', color: 'gray' },
        ],
      },
      { status: 'open' },
    );
    render(<ReportViewer schema={schema} />);
    // Label, not raw key
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.queryByText('open')).not.toBeInTheDocument();
  });

  it('renders boolean as ✓ / ✗ rather than "true"/"false" string', () => {
    const schema = withRow(
      { name: 'active', label: 'Active', type: 'boolean' },
      { active: true },
    );
    const { container } = render(<ReportViewer schema={schema} />);
    expect(container.textContent).not.toContain('true');
  });

  it('renders email as a mailto link', () => {
    const schema = withRow(
      { name: 'email', label: 'Email', type: 'email' },
      { email: 'a@b.com' },
    );
    render(<ReportViewer schema={schema} />);
    const link = screen.getByRole('link', { name: /a@b\.com/ });
    expect(link).toHaveAttribute('href', 'mailto:a@b.com');
  });

  it('renders url as an external link', () => {
    const schema = withRow(
      { name: 'site', label: 'Site', type: 'url' },
      { site: 'https://example.com' },
    );
    render(<ReportViewer schema={schema} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('renders phone as a tel: link', () => {
    const schema = withRow(
      { name: 'phone', label: 'Phone', type: 'phone' },
      { phone: '+1-555-1234' },
    );
    render(<ReportViewer schema={schema} />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toMatch(/^tel:/);
  });

  it('still honours legacy renderAs:badge for plain strings', () => {
    const schema = withRow(
      {
        name: 'tier',
        label: 'Tier',
        renderAs: 'badge',
        colorMap: { gold: 'bg-yellow-100' },
      },
      { tier: 'gold' },
    );
    render(<ReportViewer schema={schema} />);
    expect(screen.getByText('gold')).toBeInTheDocument();
  });

  it('falls back to numeric formatting for aggregation results regardless of base type', () => {
    const schema = withRow(
      { name: 'amount', label: 'Total', type: 'currency', aggregation: 'sum' },
      { amount: 1234.5 },
    );
    render(<ReportViewer schema={schema} />);
    // Aggregation path uses numeric formatting (no symbol) — the assertion
    // is that we get a formatted number, not a thrown error or "[object]".
    expect(screen.getByText(/1,?234/)).toBeInTheDocument();
  });
});
