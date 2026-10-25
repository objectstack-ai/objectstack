/**
 * Drawer must show the real record, not the composed row (#2473 第 1 项).
 *
 * Rows can be render payloads (bar colors, sort keys, node types…) rather
 * than business records, and with `objectField` a row can belong to a
 * different object than the bound one, for which no schema is loaded. Rendering that raw payload in the drawer
 * degrades every field to a humanized English label. When a context
 * DataSource is available, ObjectGantt must fetch the actual record (and the
 * foreign object's schema) and hand THAT to the drawer; the raw row stays as
 * fallback so inline `value` data keeps working without a DataSource.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectGantt } from './ObjectGantt';
import { DataSource } from '@object-ui/types';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks, onTaskClick }: any) => (
    <div data-testid="gantt-view">
      {tasks.map((t: any) => (
        <button key={t.id} data-testid={`gv-view-${t.id}`} onClick={() => onTaskClick?.(t)}>
          {t.title}
        </button>
      ))}
    </div>
  ),
}));

// objectui#9299 moved the payload out of `RecordDetailDrawer`'s `Sheet`:
// `ObjectGantt` now mounts `RecordDetailPanel` through the shared
// `NavigationOverlay`, so the props this file reads arrive at the PANEL. The
// prop names it asserts on (`record`, `objectSchema`, `onFieldSave`) are
// unchanged — only the component that receives them moved.
let drawerProps: any = null;
vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailPanel: (props: any) => {
    drawerProps = props;
    return (
      <div
        data-testid="drawer-probe"
        data-record-name={String(props.record?.name ?? '')}
        data-has-schema={String(!!props.objectSchema)}
      />
    );
  },
  deriveRecordPageHref: () => null,
}));

// Composed rows: render-only keys, and
// row 1 belongs to a foreign object (`object_name` ≠ bound object). Row
// `grp_1` is a synthetic group header — no object_name, its id is not a real
// record id.
const COMPOSED_ROWS = [
  {
    id: '1', name: 'Composed row', object_name: 'work_orders',
    start_date: '2024-01-01', end_date: '2024-01-05',
    bar_color: '#f00', node_type: 'task', sort_key: '001',
  },
  {
    id: 'grp_1', name: 'Synthetic group', object_name: '',
    start_date: '2024-01-01', end_date: '2024-01-05',
    node_type: 'group', sort_key: '000',
  },
];

const REAL_RECORD = { id: '1', name: 'Real record', priority: 'high' };
const FOREIGN_SCHEMA = { name: 'work_orders', fields: { name: { type: 'text' }, priority: { type: 'text' } } };

function makeSchema(): any {
  return {
    type: 'gantt',
    objectName: 'tasks',
    gantt: {
      titleField: 'name',
      startDateField: 'start_date',
      endDateField: 'end_date',
      objectField: 'object_name',
    },
    data: { provider: 'value', items: COMPOSED_ROWS },
  };
}

function makeContextDS(overrides: Partial<DataSource> = {}): DataSource {
  return {
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn().mockResolvedValue(REAL_RECORD),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(FOREIGN_SCHEMA),
    ...overrides,
  } as DataSource;
}

async function openDrawer(ds?: DataSource) {
  render(<ObjectGantt schema={makeSchema()} dataSource={ds} />);
  await waitFor(() => expect(screen.getByTestId('gv-view-1')).toBeDefined());
  fireEvent.click(screen.getByTestId('gv-view-1'));
  return waitFor(() => screen.getByTestId('drawer-probe'));
}

describe('ObjectGantt drawer record fetch', () => {
  beforeEach(() => {
    drawerProps = null;
  });

  it('fetches the real record + schema for a foreign-object row', async () => {
    const ds = makeContextDS();
    const probe = await openDrawer(ds);

    await waitFor(() => expect(probe.getAttribute('data-record-name')).toBe('Real record'));
    expect(probe.getAttribute('data-has-schema')).toBe('true');
    expect(ds.findOne).toHaveBeenCalledWith('work_orders', '1');
    expect(ds.getObjectSchema).toHaveBeenCalledWith('work_orders');
    expect(drawerProps.objectSchema).toEqual(FOREIGN_SCHEMA);
  });

  it('falls back to the raw row when the fetch fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ds = makeContextDS({ findOne: vi.fn().mockRejectedValue(new Error('boom')) });
    const probe = await openDrawer(ds);

    await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
    expect(probe.getAttribute('data-record-name')).toBe('Composed row');
    errSpy.mockRestore();
  });

  it('falls back to the raw row without a context DataSource', async () => {
    const probe = await openDrawer(undefined);
    expect(probe.getAttribute('data-record-name')).toBe('Composed row');
  });

  it('routes field saves through the context DataSource for fetched records', async () => {
    const ds = makeContextDS();
    const probe = await openDrawer(ds);
    await waitFor(() => expect(probe.getAttribute('data-record-name')).toBe('Real record'));

    await drawerProps.onFieldSave('priority', 'low');
    expect(ds.update).toHaveBeenCalledWith('work_orders', '1', { priority: 'low' });
  });

  it('does not open the drawer for a synthetic group row', async () => {
    // A row without an objectField value is an endpoint-composed group header
    // (e.g. id `grp_1`): there is no record to fetch, and rendering the raw
    // payload would leak humanized render-only keys (#2473 第 1 项).
    const ds = makeContextDS();
    render(<ObjectGantt schema={makeSchema()} dataSource={ds} />);
    await waitFor(() => expect(screen.getByTestId('gv-view-grp_1')).toBeDefined());
    fireEvent.click(screen.getByTestId('gv-view-grp_1'));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('drawer-probe')).toBeNull();
    expect(ds.findOne).not.toHaveBeenCalled();
  });

  it('rethrows a cleaned server message when the save is rejected', async () => {
    const ds = makeContextDS({
      update: vi.fn().mockRejectedValue(new Error(
        'ApiDataSource: HTTP 403 Forbidden — {"error":"not_manager","message":"仅管理责任人可修改该排班计划"}',
      )),
    });
    const probe = await openDrawer(ds);
    await waitFor(() => expect(probe.getAttribute('data-record-name')).toBe('Real record'));

    await expect(drawerProps.onFieldSave('priority', 'low'))
      .rejects.toThrow('仅管理责任人可修改该排班计划');
  });
});
