/**
 * objectstack-ai/objectstack#36256 — a page block (`object-metric`) mounts the
 * drill with no DrillNavigationProvider, so the host offers no record page.
 * A drilled row then opens its record in a dialog, as these hosts did before
 * the drill moved to the standard list; a host that offers a page is pinned in
 * `DrillDownDialog-36256.test.tsx`.
 *
 * Both drill bodies are covered: the standard list (`list-view`, a stub here
 * that clicks a row) and the data table used when no list is registered.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import '../index';

const StubList = (props: Record<string, any>) => (
  <button type="button" data-testid="stub-row" onClick={() => props.onRowClick?.({ id: '1', name: 'Acme Renewal' })}>
    row
  </button>
);

afterEach(() => {
  cleanup();
  ComponentRegistry.unregister('list-view');
});

const adapter = () => ({
  aggregate: vi.fn(async () => [{ amount_sum: 120 }]),
  find: vi.fn(async () => ({ data: [{ id: '1', name: 'Acme Renewal' }] })),
  getObjectSchema: vi.fn(async () => ({ name: 'deal', nameField: 'name', fields: { name: { type: 'text', label: 'Name' } } })),
});

const mount = () =>
  render(
    <SchemaRendererProvider dataSource={adapter() as never}>
      <SchemaRenderer
        schema={{
          type: 'object-metric',
          objectName: 'deal',
          label: 'Revenue',
          aggregate: { field: 'amount', function: 'sum' },
          drillDown: { enabled: true, target: 'dialog' },
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

  it('from the data table when no list is registered', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /revenue|120/i }));
    fireEvent.click(await screen.findByText('Acme Renewal'));
    const body = await screen.findByTestId('record-detail-body');
    expect(within(body).getByText('Acme Renewal')).toBeTruthy();
    expect(body.closest('[role="dialog"]')).not.toBeNull();
  });
});
