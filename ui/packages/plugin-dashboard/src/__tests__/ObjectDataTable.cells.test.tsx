/**
 * Smoke tests for type-aware cell rendering in dashboard list (table) widgets.
 * Verifies ObjectDataTable resolves each column's `type` / `options` / `format`
 * from the bound object schema and provides a `cell` render function delegating
 * to the shared `getCellRenderer` registry from `@object-ui/fields`.
 *
 * ⚠️ That resolution reaches the CELL, not the column (objectui#6373). The
 * `FieldMeta` those values live on is captured by the `cell` closure; it used to
 * be spread onto the column object as well, writing six keys `TableColumn` does
 * not declare and nothing reads. The assertions below were always about the
 * rendered output and are unchanged by that retirement — the emitted column's
 * own key set is pinned in `ObjectDataTable.emitBoundary-6373.test.tsx`.
 *
 * The underlying `data-table` renderer is mocked so the test focuses on
 * column enrichment without pulling the full component registry.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider } from '@object-ui/i18n';

let lastTableSchema: any = null;

vi.mock('@object-ui/react', async () => {
  const actual: any = await vi.importActual('@object-ui/react');
  return {
    ...actual,
    SchemaRenderer: ({ schema }: any) => {
      lastTableSchema = schema;
      const cols = schema.columns || [];
      const rows = schema.data || [];
      return (
        <table>
          <thead>
            <tr>{cols.map((c: any) => <th key={c.accessorKey}>{c.header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row: any, i: number) => (
              <tr key={i}>
                {cols.map((c: any) => (
                  <td key={c.accessorKey}>
                    {typeof c.cell === 'function' ? c.cell(row[c.accessorKey], row) : String(row[c.accessorKey] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    },
    useDataScope: () => undefined,
    // `vi.importActual` answers `unknown` unless the module's type is named, so
    // the `.createContext` read was unchecked — it would have survived the
    // export being renamed or removed (objectui#4040).
    SchemaRendererContext:
      actual.SchemaRendererContext ||
      (await vi.importActual<typeof import('react')>('react')).createContext({}),
  };
});

import { ObjectDataTable } from '../ObjectDataTable';

const accountFieldsSchema = {
  fields: {
    name: { type: 'text', label: 'Name' },
    industry: {
      type: 'select',
      label: 'Industry',
      options: [
        { value: 'tech', label: 'Technology', color: 'blue' },
        { value: 'finance', label: 'Finance', color: 'green' },
      ],
    },
    is_active: { type: 'boolean', label: 'Active' },
    contact_email: { type: 'email', label: 'Email' },
  },
};

function makeDataSource(data: any[], fieldsSchema: any = accountFieldsSchema) {
  return {
    find: async () => ({ data }),
    getObjectSchema: async () => fieldsSchema,
  };
}

describe('ObjectDataTable type-aware cells', () => {
  it('renders select column as Badge label and email column as mailto link', async () => {
    const schema: any = {
      type: 'object-data-table',
      objectName: 'account',
      columns: [
        { header: 'Name', accessorKey: 'name' },
        { header: 'Industry', accessorKey: 'industry' },
        { header: 'Email', accessorKey: 'contact_email' },
        { header: 'Active', accessorKey: 'is_active' },
      ],
    };

    render(
      <ObjectDataTable
        schema={schema}
        dataSource={makeDataSource([
          { name: 'Acme', industry: 'tech', is_active: true, contact_email: 'hi@acme.com' },
        ])}
      />,
    );
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument(), { timeout: 2000 });

    expect(screen.getByText('Technology')).toBeInTheDocument();
    expect(screen.queryByText('tech')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: /hi@acme\.com/ });
    expect(link).toHaveAttribute('href', 'mailto:hi@acme.com');
    expect(document.body.textContent).not.toContain('true');
  });

  it('honours per-column $0,0 currency format and 0% percent format', async () => {
    const ds = makeDataSource(
      [{ amount: 150000, probability: 60 }],
      {
        fields: {
          amount: { type: 'number' },
          // objectui#11475 — `60` means 60%, so the field is declared the way
          // CRM declares `probability`: a percent storing whole points
          // (`max: 100`). A plain `number` carries no percent storage, and a
          // `%` pattern alone states a fraction (numeral's reading), so this
          // fixture used to pass only because the storage was guessed from the
          // value's size.
          probability: { type: 'percent', min: 0, max: 100 },
        },
      },
    );
    const schema: any = {
      type: 'object-data-table',
      objectName: 'opportunity',
      columns: [
        { header: 'Amount', accessorKey: 'amount', format: '$0,0' },
        { header: 'Probability', accessorKey: 'probability', format: '0%' },
      ],
    };

    render(<ObjectDataTable schema={schema} dataSource={ds} />);
    await waitFor(() => expect(screen.getByText(/150,000/)).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText(/\$150,000/)).toBeInTheDocument();
    expect(screen.getByText(/60%/)).toBeInTheDocument();
  });

  it('renders a currency-type column with the tenant default currency (ADR-0053)', async () => {
    const ds = makeDataSource(
      [{ amount: 1000 }],
      { fields: { amount: { type: 'currency', label: 'Amount' } } },
    );
    const schema: any = {
      type: 'object-data-table',
      objectName: 'opportunity',
      columns: [{ header: 'Amount', accessorKey: 'amount' }],
    };

    // The field declares no currency of its own; the tenant default (CNY)
    // flows through CurrencyCellRenderer via useLocalization.
    render(
      <LocalizationProvider value={{ currency: 'CNY' }}>
        <ObjectDataTable schema={schema} dataSource={ds} />
      </LocalizationProvider>,
    );
    await waitFor(() => expect(screen.getByText(/1,000/)).toBeInTheDocument(), { timeout: 2000 });
    // A yuan/yen glyph appears — never a bare number or a wrong-currency $.
    expect(screen.getByText(/[¥]/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$1,000/);
  });
});

