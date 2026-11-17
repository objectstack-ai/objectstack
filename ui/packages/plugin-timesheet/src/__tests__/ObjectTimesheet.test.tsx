import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { ObjectTimesheet } from '../ObjectTimesheet';

afterEach(cleanup);

// Monday 16 November 2026; the test runner's locale is en-US, whose week
// starts on Sunday 15 November.
const WEDNESDAY = new Date(2026, 10, 18);

const objectSchema = {
  name: 'time_entry',
  fields: {
    project: { name: 'project', type: 'text', label: 'Project' },
    work_date: { name: 'work_date', type: 'date', label: 'Date' },
    hours: { name: 'hours', type: 'number', label: 'Hours' },
  },
};

function makeDataSource(rows: Record<string, unknown>[]) {
  let store = rows.map((r) => ({ ...r }));
  let nextId = 100;
  return {
    getObjectSchema: vi.fn(async () => objectSchema),
    find: vi.fn(async () => ({ data: store.map((r) => ({ ...r })), total: store.length })),
    create: vi.fn(async (_object: string, data: Record<string, unknown>) => {
      const record = { id: `n${nextId++}`, ...data };
      store.push(record);
      return record;
    }),
    update: vi.fn(async (_object: string, id: string, data: Record<string, unknown>) => {
      store = store.map((r) => (r.id === id ? { ...r, ...data } : r));
      return store.find((r) => r.id === id);
    }),
    delete: vi.fn(async (_object: string, id: string) => {
      store = store.filter((r) => r.id !== id);
      return true;
    }),
  };
}

const view = {
  type: 'object-timesheet' as const,
  objectName: 'time_entry',
  timesheet: { rowFields: ['project'], dateField: 'work_date', valueField: 'hours' },
};

function renderTimesheet(ds: ReturnType<typeof makeDataSource>, schema: any = view) {
  return render(<ObjectTimesheet schema={schema} dataSource={ds as any} initialDate={WEDNESDAY} />);
}

describe('ObjectTimesheet', () => {
  it('shows the missing-binding screen for a view with no timesheet block', () => {
    renderTimesheet(makeDataSource([]), { type: 'object-timesheet', objectName: 'time_entry' });
    expect(screen.getByTestId('timesheet-missing-binding').textContent).toContain('Timesheet configuration required');
  });

  it('queries the displayed week on the date field, joined with the view filter', async () => {
    const ds = makeDataSource([]);
    renderTimesheet(ds, { ...view, filter: [['project', '=', 'Apollo']] });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const [object, params] = ds.find.mock.calls[0] as any[];
    expect(object).toBe('time_entry');
    const filter = JSON.stringify(params.$filter);
    expect(filter).toContain('["work_date",">=","2026-11-15"]');
    expect(filter).toContain('["work_date","<","2026-11-22"]');
    expect(filter).toContain('Apollo');
  });

  it('bounds a date-time date field by local-midnight instants, not day keys', async () => {
    const ds = makeDataSource([]);
    ds.getObjectSchema.mockResolvedValue({
      ...objectSchema,
      fields: { ...objectSchema.fields, work_date: { name: 'work_date', type: 'datetime', label: 'Date' } },
    } as any);
    renderTimesheet(ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const filter = JSON.stringify((ds.find.mock.calls[0] as any[])[1].$filter);
    expect(filter).toContain(`["work_date",">=","${new Date(2026, 10, 15).toISOString()}"]`);
    expect(filter).toContain(`["work_date","<","${new Date(2026, 10, 22).toISOString()}"]`);
  });

  it('shows a value of a thousand or more without grouping, so it edits back', async () => {
    const ds = makeDataSource([{ id: 'r1', project: 'Apollo', work_date: '2026-11-16', hours: 1234.5 }]);
    renderTimesheet(ds);
    await waitFor(() => expect(screen.getAllByTestId('timesheet-row')).toHaveLength(1));
    const monday = screen.getAllByTestId('timesheet-cell')[1] as HTMLInputElement;
    expect(monday.value).toBe('1234.5');
    fireEvent.change(monday, { target: { value: '1234.6' } });
    fireEvent.blur(monday);
    await waitFor(() => expect(ds.update).toHaveBeenCalledWith('time_entry', 'r1', { hours: 1234.6 }));
  });

  it('pivots records into rows and days with row, day and week totals', async () => {
    const ds = makeDataSource([
      { id: 'r1', project: 'Apollo', work_date: '2026-11-16', hours: 2 },
      { id: 'r2', project: 'Apollo', work_date: '2026-11-17', hours: 3 },
      { id: 'r3', project: 'Hermes', work_date: '2026-11-17', hours: 1 },
    ]);
    renderTimesheet(ds);
    await waitFor(() => expect(screen.getAllByTestId('timesheet-row')).toHaveLength(2));
    const totals = screen.getAllByTestId('timesheet-row-total').map((el) => el.textContent);
    expect(totals).toEqual(['5', '1']);
    const dayTotals = screen.getAllByTestId('timesheet-day-total').map((el) => el.textContent);
    expect(dayTotals).toEqual(['0', '2', '4', '0', '0', '0', '0']);
    expect(screen.getByTestId('timesheet-week-total').textContent).toBe('6');
  });

  it('shows a cell holding two records as a read-only sum', async () => {
    const ds = makeDataSource([
      { id: 'r1', project: 'Apollo', work_date: '2026-11-17', hours: 2 },
      { id: 'r2', project: 'Apollo', work_date: '2026-11-17', hours: 1.5 },
    ]);
    renderTimesheet(ds);
    const cell = await screen.findByTestId('timesheet-cell-readonly');
    expect(cell.textContent).toBe('3.5');
    expect(cell.getAttribute('title')).toContain('more than one record');
  });

  it('updates a one-record cell through the record door', async () => {
    const ds = makeDataSource([{ id: 'r1', project: 'Apollo', work_date: '2026-11-16', hours: 2 }]);
    renderTimesheet(ds);
    await waitFor(() => expect(screen.getAllByTestId('timesheet-row')).toHaveLength(1));
    const cells = screen.getAllByTestId('timesheet-cell');
    // Sunday first: Monday is the second day column.
    const monday = cells[1] as HTMLInputElement;
    expect(monday.value).toBe('2');
    fireEvent.change(monday, { target: { value: '6' } });
    fireEvent.blur(monday);
    await waitFor(() => expect(ds.update).toHaveBeenCalledWith('time_entry', 'r1', { hours: 6 }));
    await waitFor(() => expect(screen.getByTestId('timesheet-week-total').textContent).toBe('6'));
  });

  it('creates a record when an empty cell is typed into, and deletes it when cleared', async () => {
    const ds = makeDataSource([{ id: 'r1', project: 'Apollo', work_date: '2026-11-16', hours: 2 }]);
    renderTimesheet(ds);
    await waitFor(() => expect(screen.getAllByTestId('timesheet-row')).toHaveLength(1));
    const tuesday = screen.getAllByTestId('timesheet-cell')[2] as HTMLInputElement;
    fireEvent.change(tuesday, { target: { value: '4' } });
    fireEvent.keyDown(tuesday, { key: 'Enter' });
    await waitFor(() =>
      expect(ds.create).toHaveBeenCalledWith('time_entry', { project: 'Apollo', work_date: '2026-11-17', hours: 4 }),
    );
    await waitFor(() => expect(screen.getByTestId('timesheet-week-total').textContent).toBe('6'));

    const monday = screen.getAllByTestId('timesheet-cell')[1] as HTMLInputElement;
    fireEvent.change(monday, { target: { value: '' } });
    fireEvent.blur(monday);
    await waitFor(() => expect(ds.delete).toHaveBeenCalledWith('time_entry', 'r1'));
  });

  it('keeps a refused write on its cell with the server message', async () => {
    const ds = makeDataSource([{ id: 'r1', project: 'Apollo', work_date: '2026-11-16', hours: 2 }]);
    ds.update.mockRejectedValueOnce(new Error('Hours must be 24 or less'));
    renderTimesheet(ds);
    await waitFor(() => expect(screen.getAllByTestId('timesheet-row')).toHaveLength(1));
    const monday = screen.getAllByTestId('timesheet-cell')[1] as HTMLInputElement;
    fireEvent.change(monday, { target: { value: '30' } });
    fireEvent.blur(monday);
    const alert = await screen.findByTestId('timesheet-cell-error');
    expect(alert.textContent).toBe('Not saved: Hours must be 24 or less');
    expect(monday.getAttribute('aria-invalid')).toBe('true');
    expect(monday.value).toBe('30');
  });

  it('refuses text that is not a number without writing', async () => {
    const ds = makeDataSource([]);
    renderTimesheet(ds, view);
    await screen.findByTestId('timesheet-empty');
    fireEvent.click(screen.getByTestId('timesheet-add-row'));
    const dialog = await screen.findByTestId('timesheet-add-row-dialog');
    fireEvent.click(within(dialog).getByTestId('timesheet-add-row-confirm'));
    expect(within(dialog).getByTestId('timesheet-row-incomplete')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Zeus' } });
    fireEvent.click(within(dialog).getByTestId('timesheet-add-row-confirm'));
    await waitFor(() => expect(screen.getAllByTestId('timesheet-row')).toHaveLength(1));

    const cell = screen.getAllByTestId('timesheet-cell')[3] as HTMLInputElement;
    fireEvent.change(cell, { target: { value: 'lots' } });
    fireEvent.blur(cell);
    expect((await screen.findByTestId('timesheet-cell-error')).textContent).toBe('Enter a number');
    expect(ds.create).not.toHaveBeenCalled();

    fireEvent.change(cell, { target: { value: '5' } });
    fireEvent.keyDown(cell, { key: 'Enter' });
    await waitFor(() =>
      expect(ds.create).toHaveBeenCalledWith('time_entry', { project: 'Zeus', work_date: '2026-11-18', hours: 5 }),
    );
  });

  it('moves between weeks', async () => {
    const ds = makeDataSource([]);
    renderTimesheet(ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('timesheet-next-week'));
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    expect(JSON.stringify((ds.find.mock.calls[1] as any[])[1].$filter)).toContain('"2026-11-22"');
    fireEvent.click(screen.getByTestId('timesheet-prev-week'));
    fireEvent.click(screen.getByTestId('timesheet-prev-week'));
    await waitFor(() =>
      expect(JSON.stringify((ds.find.mock.calls.at(-1) as any[])[1].$filter)).toContain('"2026-11-08"'),
    );
  });
});

/**
 * #34382 — the timesheet's three cell writes read the affordance-to-grant map
 * (objectui#12082), asked of the object the grid writes:
 *
 * - typing into an empty cell creates a record inline: `gridAddRow`, which also
 *   gates Add row;
 * - retyping a one-record cell updates its value field: `listInlineEdit`, with
 *   that field's write question;
 * - clearing a one-record cell deletes its record: `rowDelete`.
 *
 * A cell that no granted write can change renders read-only. A write the caller
 * may not make (clearing with update but no delete) is refused on its cell
 * before it goes out. With no permission provider every row reads open, which
 * is what the `ObjectTimesheet` describe above exercises.
 */
const OBJECT = 'time_entry';

const GRANT_SCHEMA = {
  type: 'object-timesheet' as const,
  objectName: OBJECT,
  timesheet: { rowFields: ['project'], dateField: 'work_date', valueField: 'hours' },
};

function makeGrantDataSource() {
  return {
    getObjectSchema: vi.fn(async () => ({
      name: OBJECT,
      fields: {
        project: { name: 'project', type: 'text', label: 'Project' },
        work_date: { name: 'work_date', type: 'date', label: 'Date' },
        hours: { name: 'hours', type: 'number', label: 'Hours' },
      },
    })),
    // One row: Monday holds one record, every other day is empty.
    find: vi.fn(async () => ({ data: [{ id: 'r1', project: 'Apollo', work_date: '2026-11-16', hours: 2 }], total: 1 })),
    create: vi.fn(async (_o: string, data: Record<string, unknown>) => ({ id: 'n1', ...data })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => true),
  };
}

const envelope = (
  bits: Record<string, boolean>,
  fields: Record<string, { readable: boolean; editable: boolean }> = {},
): MePermissionsAuthenticatedResponse => ({
  authenticated: true,
  userId: 'u-pin',
  tenantId: null,
  hasAnyQueue: false,
  objectsUsingQueues: [],
  positions: ['member'],
  permissionSets: ['member'],
  objects: { [OBJECT]: bits as never },
  fields,
});

async function mountGranted(perms: MePermissionsAuthenticatedResponse) {
  const ds = makeGrantDataSource();
  render(
    <MePermissionsProvider initialPermissions={perms}>
      <ObjectTimesheet schema={GRANT_SCHEMA} dataSource={ds as any} initialDate={WEDNESDAY} />
    </MePermissionsProvider>,
  );
  await waitFor(() => expect(screen.getAllByTestId('timesheet-row')).toHaveLength(1));
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  return ds;
}

/** Sunday..Saturday: whether each day's cell is an input. Monday (index 1) holds the record. */
const inputDays = (): boolean[] => {
  const row = screen.getByTestId('timesheet-row');
  return Array.from(row.querySelectorAll('td'))
    .slice(1, 8)
    .map((td) => td.querySelector('[data-testid="timesheet-cell"]') !== null);
};

const R = { allowRead: true };

describe('ObjectTimesheet cell writes under each grant (#34382)', () => {
  it('read-only: every cell is read-only, Add row is not offered, and the filled cell still shows its value', async () => {
    await mountGranted(envelope({ ...R, allowCreate: false, allowEdit: false, allowDelete: false }));
    expect(inputDays()).toEqual([false, false, false, false, false, false, false]);
    expect(screen.queryByTestId('timesheet-add-row')).toBeNull();
    const readonly = screen.getAllByTestId('timesheet-cell-readonly');
    expect(readonly.map((el) => el.textContent)).toEqual(['', '2', '', '', '', '', '']);
  });

  it('create-only: empty cells take input and create, the filled cell is read-only, Add row is offered', async () => {
    const ds = await mountGranted(envelope({ ...R, allowCreate: true, allowEdit: false, allowDelete: false }));
    expect(inputDays()).toEqual([true, false, true, true, true, true, true]);
    expect(screen.getByTestId('timesheet-add-row')).toBeTruthy();
    const tuesday = screen.getAllByTestId('timesheet-cell')[1] as HTMLInputElement;
    fireEvent.change(tuesday, { target: { value: '3' } });
    fireEvent.blur(tuesday);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(ds.update).not.toHaveBeenCalled();
  });

  it('edit-only: the filled cell updates, empty cells are read-only, and clearing it is refused before it goes out', async () => {
    const ds = await mountGranted(envelope({ ...R, allowCreate: false, allowEdit: true, allowDelete: false }));
    expect(inputDays()).toEqual([false, true, false, false, false, false, false]);
    expect(screen.queryByTestId('timesheet-add-row')).toBeNull();
    const monday = screen.getByTestId('timesheet-cell') as HTMLInputElement;
    fireEvent.change(monday, { target: { value: '4' } });
    fireEvent.blur(monday);
    await waitFor(() => expect(ds.update).toHaveBeenCalledWith(OBJECT, 'r1', { hours: 4 }));
    fireEvent.change(monday, { target: { value: '' } });
    fireEvent.blur(monday);
    expect(await screen.findByText("You don't have permission to make this change.")).toBeTruthy();
    expect(ds.delete).not.toHaveBeenCalled();
  });

  it('delete-only: the filled cell can be cleared, but a new value is refused', async () => {
    const ds = await mountGranted(envelope({ ...R, allowCreate: false, allowEdit: false, allowDelete: true }));
    expect(inputDays()).toEqual([false, true, false, false, false, false, false]);
    const monday = screen.getByTestId('timesheet-cell') as HTMLInputElement;
    fireEvent.change(monday, { target: { value: '5' } });
    fireEvent.blur(monday);
    expect(await screen.findByText("You don't have permission to make this change.")).toBeTruthy();
    expect(ds.update).not.toHaveBeenCalled();
    fireEvent.change(monday, { target: { value: '' } });
    fireEvent.blur(monday);
    await waitFor(() => expect(ds.delete).toHaveBeenCalledWith(OBJECT, 'r1'));
  });

  it('the value field marked not editable closes the update even with the edit grant', async () => {
    const ds = await mountGranted(
      envelope(
        { ...R, allowCreate: false, allowEdit: true, allowDelete: false },
        { [`${OBJECT}.hours`]: { readable: true, editable: false } },
      ),
    );
    expect(inputDays()).toEqual([false, false, false, false, false, false, false]);
    expect(ds.update).not.toHaveBeenCalled();
  });

  it('full: every cell takes input and Add row is offered', async () => {
    await mountGranted(envelope({ ...R, allowCreate: true, allowEdit: true, allowDelete: true }));
    expect(inputDays()).toEqual([true, true, true, true, true, true, true]);
    expect(screen.getByTestId('timesheet-add-row')).toBeTruthy();
  });
});
