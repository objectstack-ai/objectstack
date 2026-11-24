/**
 * objectstack-ai/objectstack#36256 — a page block (`object-metric`) mounts the
 * drill with no DrillNavigationProvider, so the host offers no record page.
 * A drilled row then opens its record in a dialog, as these hosts did before
 * the drill moved to the standard list; a host that offers a page is pinned in
 * `DrillDownDialog-36256.test.tsx`.
 *
 * Both drill bodies are covered: the standard list (`list-view`, a stub here
 * that clicks a row) and the data table used when no list is registered.
 *
 * The standard list reads only the fields it lists (`$select`), so the row it
 * hands back holds only those. The dialog draws exactly those fields, each
 * with its value: a field the list did not read is not drawn as empty.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import '../index';

const StubList = (props: Record<string, any>) => (
  <button type="button" data-testid="stub-row" onClick={() => props.onRowClick?.({ id: '1', name: 'Acme Renewal' })}>
    row
  </button>
);

/** The record as stored: more fields than the drill lists. */
const DEAL = { id: '1', name: 'Acme Renewal', stage: 'won', amount: 120, owner: 'Dana', description: 'Three-year renewal' };

/** Answers with the record projected to the listed columns, as the list's `$select` read does. */
interface ListProps {
  schema?: { columns?: Array<string | { field: string }> };
  onRowClick?: (row: Record<string, unknown>) => void;
}
const ProjectingList = (props: ListProps) => {
  const listed = (props.schema?.columns ?? []).map((c) => (typeof c === 'string' ? c : c.field));
  const row = Object.fromEntries(Object.entries(DEAL).filter(([k]) => k === 'id' || listed.includes(k)));
  return <button type="button" data-testid="stub-row" onClick={() => props.onRowClick?.(row)}>row</button>;
};

afterEach(() => {
  cleanup();
  ComponentRegistry.unregister('list-view');
});

const adapter = () => ({
  aggregate: vi.fn(async () => [{ amount_sum: 120 }]),
  find: vi.fn(async () => ({ data: [{ id: '1', name: 'Acme Renewal' }] })),
  getObjectSchema: vi.fn(async () => ({
    name: 'deal',
    nameField: 'name',
    fields: {
      name: { type: 'text', label: 'Name' },
      stage: { type: 'text', label: 'Stage' },
      amount: { type: 'number', label: 'Amount' },
      owner: { type: 'text', label: 'Owner' },
      description: { type: 'text', label: 'Description' },
    },
  })),
});

const mount = (drillDown: Record<string, unknown> = { enabled: true, target: 'dialog' }) =>
  render(
    <SchemaRendererProvider dataSource={adapter() as never}>
      <SchemaRenderer
        schema={{
          type: 'object-metric',
          objectName: 'deal',
          label: 'Revenue',
          aggregate: { field: 'amount', function: 'sum' },
          drillDown,
        } as never}
      />
    </SchemaRendererProvider>,
  );

describe('a page block with no record page opens the drilled record in a dialog (#36256)', () => {
  it('from the standard list', async () => {
    ComponentRegistry.register('list-view', StubList as any);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /revenue|120/i }));
    fireEvent.click(await screen.findByTestId('stub-row'));
    const body = await screen.findByTestId('record-detail-body');
    expect(within(body).getByText('Acme Renewal')).toBeTruthy();
    expect(body.closest('[role="dialog"]')).not.toBeNull();
  });

  it('draws the fields the list read, each with its value, and no field it did not read', async () => {
    ComponentRegistry.register('list-view', ProjectingList as never);
    mount({ enabled: true, target: 'dialog', columns: ['name', 'stage', 'amount'] });
    fireEvent.click(await screen.findByRole('button', { name: /revenue|120/i }));
    fireEvent.click(await screen.findByTestId('stub-row'));
    const body = await screen.findByTestId('record-detail-body');
    // The values are masked until the field types are in; wait for them.
    await waitFor(() => expect(within(body).getByText('Acme Renewal')).toBeTruthy());
    const labels = Array.from(body.querySelectorAll('dt')).map((dt) => dt.textContent);
    expect(labels).toEqual(['Name', 'Stage', 'Amount']);
    for (const dd of Array.from(body.querySelectorAll('dd'))) {
      expect(dd.textContent?.trim()).not.toMatch(/^(—|No value)?$/);
    }
  });

  it('from the data table when no list is registered', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /revenue|120/i }));
    fireEvent.click(await screen.findByText('Acme Renewal'));
    const body = await screen.findByTestId('record-detail-body');
    expect(within(body).getByText('Acme Renewal')).toBeTruthy();
    expect(body.closest('[role="dialog"]')).not.toBeNull();
  });
});
