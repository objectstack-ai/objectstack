/**
 * objectstack-ai/objectstack#36256 — the drill opens a centred, non-modal
 * dialog whose body is the standard list (`list-view`), with the drill's
 * conditions as the list's own chips, the record's name and the drilled
 * fields as its default columns, a read-only toolbar, and the record's name
 * opening its page through the host with the shown rows as its ↑ ↓ set. No
 * record panel is stacked over the drill.
 *
 * The registered `list-view` here is a stub that records the props it is
 * handed: what the real list does with them is pinned in app-shell
 * (`drillDialogStandardList-36256.test.tsx`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { DrillNavigationProvider } from '@object-ui/react';
import '@object-ui/components';
import { DrillDownDrawer } from '../DrillDownDrawer';

// The phone flag the drawer reads, flipped per test; the rest of the
// components package is the real one.
const viewport = vi.hoisted(() => ({ phone: false }));
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/components')>()),
  useIsMobile: () => viewport.phone,
}));

// The props each render handed the stub, read back through the spy: a
// component writes nothing outside itself during render.
const seenProps = vi.fn();
const lastProps = (): Record<string, any> | null => seenProps.mock.calls.at(-1)?.[0] ?? null;
const StubList = (props: Record<string, any>) => {
  seenProps(props);
  return (
    <button type="button" data-testid="stub-row" onClick={() => {
      props.onRowsChange?.([{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }]);
      props.onTotalChange?.(3);
      props.onRowClick?.({ id: 'o2', name: 'Acme' });
    }}>row</button>
  );
};

const dataSource = {
  find: vi.fn(async () => ({ data: [] })),
  getObjectSchema: vi.fn(async () => ({ name: 'opportunity', nameField: 'name', fields: { name: { type: 'text' } } })),
};

function renderDialog(props: Record<string, any> = {}, openRecord = vi.fn()) {
  const onClose = props.onClose ?? vi.fn();
  render(
    <DrillNavigationProvider value={{ openRecord, openRecordList: vi.fn() }}>
      <DrillDownDrawer
        open
        target="dialog"
        onClose={onClose}
        title="Technology"
        objectName="opportunity"
        filter={{ $and: [{ stage: 'closed_won' }, { industry: 'tech', amount: { $null: false } }] }}
        defaultColumns={['industry', 'amount']}
        dataSource={dataSource}
        {...props}
      />
    </DrillNavigationProvider>,
  );
  return { onClose, openRecord };
}

describe('drill dialog over the standard list (#36256)', () => {
  beforeEach(() => {
    seenProps.mockClear();
    ComponentRegistry.register('list-view', StubList as any);
  });
  afterEach(() => {
    ComponentRegistry.unregister('list-view');
  });

  it('is a centred dialog with no overlay behind it', async () => {
    renderDialog();
    const dialog = await screen.findByTestId('drill-down-dialog');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog.className).toContain('w-[70vw]');
    expect(dialog.className).toContain('h-[65vh]');
    // Radix draws its overlay only for a modal dialog.
    expect(document.querySelector('[data-state="open"].fixed.inset-0')).toBeNull();
  });

  it('mounts the standard list read-only, with the drill conditions as chips and the drilled fields as columns', async () => {
    renderDialog();
    await waitFor(() => expect(lastProps()).not.toBeNull());
    const { schema, initialFilters, showViewSwitcher } = lastProps()!;
    expect(schema).toMatchObject({
      type: 'list-view',
      dataSource: { object: 'opportunity' },
      columns: ['name', 'industry', 'amount'],
      userActions: { editInline: false, addRecordForm: false },
    });
    expect(schema.filter).toBeUndefined();
    expect(initialFilters.conditions.map((c: any) => [c.field, c.operator, c.value])).toEqual([
      ['stage', 'equals', 'closed_won'],
      ['industry', 'equals', 'tech'],
      ['amount', 'is_not_null', undefined],
    ]);
    expect(showViewSwitcher).toBe(false);
    for (const door of ['onSaveView', 'onAddRecord', 'onBulkAction', 'onEdit', 'onDelete', 'onSortChange', 'onFilterChange']) {
      expect(lastProps()![door]).toBeUndefined();
    }
  });

  it("an added column and a picked calculation stay in the dialog's own state", async () => {
    renderDialog();
    await waitFor(() => expect(lastProps()).not.toBeNull());
    React.act(() => lastProps()!.onAddedFieldsChange(['owner_id']));
    React.act(() => { lastProps()!.onColumnSummaryPick('amount', 'sum'); });
    expect(lastProps()!.schema.columns).toEqual(['name', 'industry', { field: 'amount', summary: 'sum' }, 'owner_id']);
  });

  it("the record's name opens its page with the shown rows, and closes the drill", async () => {
    const { onClose, openRecord } = renderDialog();
    fireEvent.click(await screen.findByTestId('stub-row'));
    expect(openRecord).toHaveBeenCalledWith('opportunity', 'o2', { siblings: ['o1', 'o2', 'o3'], total: 3 });
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the side drawer on a phone, with the same list', async () => {
    viewport.phone = true;
    try {
      renderDialog();
      await waitFor(() => expect(lastProps()).not.toBeNull());
      expect(screen.queryByTestId('drill-down-dialog')).toBeNull();
      expect(document.querySelector('[role="dialog"]')?.className).toContain('right-0');
    } finally {
      viewport.phone = false;
    }
  });

  it('keeps the side drawer and the same list when target is drawer', async () => {
    renderDialog({ target: 'drawer' });
    await waitFor(() => expect(lastProps()).not.toBeNull());
    expect(screen.queryByTestId('drill-down-dialog')).toBeNull();
  });
});

describe('drill dialog without the standard list registered (#36256)', () => {
  it('lists the records in the data table and stacks no record panel on a row', async () => {
    renderDialog();
    expect(await screen.findByTestId('drill-down-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('stub-row')).toBeNull();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});
