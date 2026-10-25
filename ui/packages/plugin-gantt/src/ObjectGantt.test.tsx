import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectGantt, normalizeDependencies, normalizeTaskType } from './ObjectGantt';
import { DataSource } from '@object-ui/types';

// Mock GanttView so we can drive create/update/delete directly via the
// callbacks ObjectGantt wires to it. Each task exposes data-testid handles
// for "Create", "View", and "Delete" so CRUD wiring can be unit-tested
// without rendering the full timeline.
vi.mock('./GanttView', () => ({
  GanttView: ({ tasks, onTaskClick, onTaskUpdate, onTaskDelete, onDependencyCreate, onDependencyDelete, rescheduleOnConflict, persistLayoutKey, mobileReadOnly, defaultCollapsedDepth, summaryExtent }: any) => {
    const byId = (id: any) => tasks.find((t: any) => String(t.id) === String(id));
    return (
      <div data-testid="gantt-view" data-reschedule-on-conflict={String(!!rescheduleOnConflict)} data-persist-layout-key={persistLayoutKey || ''} data-mobile-readonly={String(!!mobileReadOnly)} data-default-collapsed-depth={defaultCollapsedDepth == null ? '' : String(defaultCollapsedDepth)} data-summary-extent={summaryExtent ?? ''}>
        {tasks.map((t: any) => (
          <div key={t.id} data-testid="gantt-task" data-type={t.type ?? ''} data-locked={String(!!t.locked)} data-border-color={t.borderColor ?? ''} data-has-own-dates={String(t.hasOwnDates)}>
            <span>{t.title}</span>
            {t.fields ? (
              <div data-testid={`gv-fields-${t.id}`}>
                {t.fields.map((f: any, i: number) => (
                  <span key={i} data-testid={`gv-field-${t.id}-${i}`}>{f.label}={f.value}</span>
                ))}
              </div>
            ) : null}
            <button data-testid={`gv-view-${t.id}`} onClick={() => onTaskClick?.(t)}>view</button>
            {/* A bar dropped onto February 1st to 5th: its end is the EXCLUSIVE
                instant GanttView hands back, the 6th's midnight, so a
                date-only end field is written as the 5th (objectui#11141). */}
            <button data-testid={`gv-update-${t.id}`} onClick={() => onTaskUpdate?.(t, { start: new Date('2024-02-01T00:00:00.000Z'), end: new Date('2024-02-06T00:00:00.000Z') })}>update</button>
            <button data-testid={`gv-delete-${t.id}`} onClick={() => onTaskDelete?.(t)}>delete</button>
          </div>
        ))}
        {/* Dependency-edit harness: link <source> -> <target> with a chosen type,
            or remove it. Encoded in the testid as `dep-<op>-<source>-<target>-<type>`. */}
        <button data-testid="dep-create-1-2-fs" onClick={() => onDependencyCreate?.(byId('1'), byId('2'), 'fs')}>c-fs</button>
        <button data-testid="dep-create-1-2-ss" onClick={() => onDependencyCreate?.(byId('1'), byId('2'), 'ss')}>c-ss</button>
        <button data-testid="dep-delete-1-2" onClick={() => onDependencyDelete?.(byId('1'), byId('2'))}>d</button>
      </div>
    );
  },
}));

const mockData = [
  { id: '1', name: 'Task 1', start_date: '2024-01-01', end_date: '2024-01-05', progress: 50 },
  { id: '2', name: 'Task 2', start_date: '2024-01-06', end_date: '2024-01-10', progress: 0 },
];

const mockDataSource: DataSource = {
  find: vi.fn(),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({
    fields: {
       name: { type: 'text' },
       start_date: { type: 'date' },
       end_date: { type: 'date' }
    }
  }),
};

describe('ObjectGantt', () => {
  it('renders with static value provider', async () => {
    const schema: any = {
      type: 'gantt',
      gantt: {
        titleField: 'name',
        startDateField: 'start_date',
        endDateField: 'end_date',
      },
      data: {
        provider: 'value',
        items: mockData,
      },
    };

    render(<ObjectGantt schema={schema} />);
    
    // Check loading first if needed, or wait for tasks
    await waitFor(() => {
        expect(screen.getByTestId('gantt-view')).toBeDefined();
    });
    
    expect(screen.getAllByTestId('gantt-task')).toHaveLength(2);
    expect(screen.getByText('Task 1')).toBeDefined();
  });

  it('resolves and formats tooltipFields per record (label override, schema label, select option, date)', async () => {
    const ttData = [
      {
        id: '1', name: 'Task 1', start_date: '2024-01-01', end_date: '2024-01-05',
        owner: { name: 'Priya N.' }, status: 'in_progress', due_date: '2024-01-05', effort: 12,
      },
    ];
    const ds: DataSource = {
      ...mockDataSource,
      find: vi.fn().mockResolvedValue({ data: ttData }),
      getObjectSchema: vi.fn().mockResolvedValue({
        fields: {
          name: { type: 'text' },
          start_date: { type: 'date' },
          end_date: { type: 'date' },
          owner: { type: 'lookup', label: 'Assignee' },
          status: {
            type: 'select', label: 'Status',
            options: [
              { value: 'todo', label: 'To Do' },
              { value: 'in_progress', label: 'In Progress' },
            ],
          },
          due_date: { type: 'date' },
          effort: { type: 'number' },
        },
      }),
    };
    const schema: any = {
      type: 'gantt',
      gantt: {
        titleField: 'name', startDateField: 'start_date', endDateField: 'end_date',
        tooltipFields: [
          { field: 'owner', label: 'Owner' }, // explicit label override
          'status',                            // schema label + select option
          'due_date',                          // date formatting
          'effort',                            // number formatting
        ],
      },
      data: { provider: 'object', object: 'tasks' },
    };
    render(<ObjectGantt schema={schema} dataSource={ds} />);

    await waitFor(() => expect(screen.getByTestId('gv-fields-1')).toBeDefined());

    // Explicit label wins; lookup resolves to the embedded record name.
    expect(screen.getByTestId('gv-field-1-0').textContent).toBe('Owner=Priya N.');
    // Schema label + select option label.
    expect(screen.getByTestId('gv-field-1-1').textContent).toBe('Status=In Progress');
    // Date field formatted (not the raw ISO string).
    expect(screen.getByTestId('gv-field-1-2').textContent).not.toContain('2024-01-05');
    // Number field formatted. MOVED by objectui#11254: `effort` declares no
    // `scale`, and under ruling A′ (objectstack-ai/objectstack#19628) an
    // undeclared `number` has no fixed width, so the stored `12` reads `12`
    // (as the list cell reads it), not the `12.00` a constant two-place
    // default padded it to.
    expect(screen.getByTestId('gv-field-1-3').textContent).toBe('Effort=12');
  });

  it('formats a multi-value lookup (array of records) by joining display names', async () => {
    const ttData = [
      {
        id: '1', name: 'Task 1', start_date: '2024-01-01', end_date: '2024-01-05',
        // Multi-value lookup populated to an array of records.
        executors: [{ name: '班组长-测' }, { name: '操作工-测' }],
        tags: ['a', 'b'],
      },
    ];
    const ds: DataSource = {
      ...mockDataSource,
      find: vi.fn().mockResolvedValue({ data: ttData }),
      getObjectSchema: vi.fn().mockResolvedValue({
        fields: {
          name: { type: 'text' },
          start_date: { type: 'date' },
          end_date: { type: 'date' },
          executors: { type: 'lookup', label: '执行责任人', multiple: true },
          tags: { type: 'text', label: 'Tags', multiple: true },
        },
      }),
    };
    const schema: any = {
      type: 'gantt',
      gantt: {
        titleField: 'name', startDateField: 'start_date', endDateField: 'end_date',
        tooltipFields: ['executors', 'tags'],
      },
      data: { provider: 'object', object: 'tasks' },
    };
    render(<ObjectGantt schema={schema} dataSource={ds} />);

    await waitFor(() => expect(screen.getByTestId('gv-fields-1')).toBeDefined());

    // Array of records → joined display names (not the '—' empty fallback).
    expect(screen.getByTestId('gv-field-1-0').textContent).toBe('执行责任人=班组长-测, 操作工-测');
    // Array of scalars → joined as-is.
    expect(screen.getByTestId('gv-field-1-1').textContent).toBe('Tags=a, b');
  });

  it('falls back to quickFilters labels + ISO date sniffing when there is no object schema (inline value rows)', async () => {
    // Inline `value` rows come with no object schema, so tooltip fields
    // have no defs: machine values and raw ISO strings used to leak through.
    const schema: any = {
      type: 'gantt',
      gantt: {
        titleField: 'name', startDateField: 'start_date', endDateField: 'end_date',
        tooltipFields: [
          { field: 'node_type', label: '层级' },
          { field: 'status', label: '状态' },
          { field: 'start_date', label: '计划开始' },
          { field: 'due_day', label: '截止日' },
        ],
        quickFilters: [
          { field: 'node_type', options: [{ value: 'dispatch', label: '派工单' }, { value: 'plan', label: '排班计划' }] },
          { field: 'status', options: [{ value: 'completed', label: '已完成' }, { value: 'in_progress', label: '进行中' }] },
        ],
      },
      data: {
        provider: 'value',
        items: [{
          id: '1', name: 'D1', node_type: 'dispatch', status: 'completed',
          start_date: '2026-08-14T08:00:00.000Z', end_date: '2026-08-16T20:00:00.000Z',
          due_day: '2026-08-20',
        }],
      },
    };
    render(<ObjectGantt schema={schema} />);
    await waitFor(() => expect(screen.getByTestId('gv-fields-1')).toBeDefined());

    // Quick-filter options double as the value→label map.
    expect(screen.getByTestId('gv-field-1-0').textContent).toBe('层级=派工单');
    expect(screen.getByTestId('gv-field-1-1').textContent).toBe('状态=已完成');
    // ISO datetime string is formatted, not echoed raw.
    const startText = screen.getByTestId('gv-field-1-2').textContent!;
    expect(startText).not.toContain('T08:00');
    expect(startText).not.toContain('Z');
    expect(startText).toContain('2026');
    // ISO date-only string formats through the date formatter.
    expect(screen.getByTestId('gv-field-1-3').textContent).not.toContain('2026-08-20T');
  });

  it('marks tasks with hasOwnDates and forwards summaryExtent to GanttView', async () => {
    const schema: any = {
      type: 'gantt',
      gantt: {
        titleField: 'name', startDateField: 'start_date', endDateField: 'end_date',
        typeField: 'gantt_type', summaryExtent: 'self',
      },
      data: {
        provider: 'value',
        items: [
          { id: 'grp', name: 'Project', gantt_type: 'group' }, // date-less grouping level
          { id: 'plan', name: 'Plan', gantt_type: 'summary', parent: 'grp', start_date: '2024-01-01', end_date: '2024-01-05' },
        ],
      },
    };
    render(<ObjectGantt schema={schema} />);
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeDefined());

    expect(screen.getByTestId('gantt-view').getAttribute('data-summary-extent')).toBe('self');
    const [grp, plan] = screen.getAllByTestId('gantt-task');
    expect(grp.getAttribute('data-has-own-dates')).toBe('false');
    expect(plan.getAttribute('data-has-own-dates')).toBe('true');
  });

  it('forwards summaryExtent from top-level (flattened ListView) config too', async () => {
    // The console's ListView spreads view.gantt keys at the TOP level of the
    // object-gantt schema, which getGanttConfig re-picks key by key — a new
    // key missing from that pick list silently vanishes on the console path.
    const schema: any = {
      type: 'object-gantt',
      titleField: 'name', startDateField: 'start_date', endDateField: 'end_date',
      summaryExtent: 'self',
      data: { provider: 'value', items: [{ id: '1', name: 'T', start_date: '2024-01-01', end_date: '2024-01-02' }] },
    };
    render(<ObjectGantt schema={schema} />);
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeDefined());
    expect(screen.getByTestId('gantt-view').getAttribute('data-summary-extent')).toBe('self');
  });

  it('omits tooltip fields when none configured', async () => {
    const ds: DataSource = { ...mockDataSource, find: vi.fn().mockResolvedValue({ data: mockData }) };
    const schema: any = {
      type: 'gantt',
      gantt: { titleField: 'name', startDateField: 'start_date', endDateField: 'end_date' },
      data: { provider: 'object', object: 'tasks' },
    };
    render(<ObjectGantt schema={schema} dataSource={ds} />);
    await waitFor(() => expect(screen.getAllByTestId('gantt-task')).toHaveLength(2));
    expect(screen.queryByTestId('gv-fields-1')).toBeNull();
  });

  it('renders with object provider', async () => {
    (mockDataSource.find as any).mockResolvedValue({ data: mockData });

    const schema: any = {
      type: 'gantt',
      gantt: {
        titleField: 'name',
        startDateField: 'start_date',
        endDateField: 'end_date',
      },
      data: {
        provider: 'object',
        object: 'tasks',
      },
    };

    render(<ObjectGantt schema={schema} dataSource={mockDataSource} />);

    await waitFor(() => {
      expect(mockDataSource.find).toHaveBeenCalledWith('tasks', expect.any(Object));
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('gantt-task')).toHaveLength(2);
    });
  });

  it('persists drag-driven task update via dataSource.update', async () => {
    const update = vi.fn().mockResolvedValue({});
    const ds: DataSource = {
      ...mockDataSource,
      find: vi.fn().mockResolvedValue({ data: mockData }),
      update,
    };
    const schema: any = {
      type: 'gantt',
      gantt: { titleField: 'name', startDateField: 'start_date', endDateField: 'end_date' },
      data: { provider: 'object', object: 'tasks' },
    };
    render(<ObjectGantt schema={schema} dataSource={ds} />);

    await waitFor(() => {
      expect(screen.getAllByTestId('gantt-task')).toHaveLength(2);
    });

    fireEvent.click(screen.getByTestId('gv-update-1'));

    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
    expect(update.mock.calls[0][0]).toBe('tasks');
    expect(update.mock.calls[0][1]).toBe('1');
    // `start_date` / `end_date` are declared `date`: the write is the calendar
    // day, never a UTC instant (objectui#10866). This case used to expect the
    // `toISOString()` spelling, i.e. it pinned the defect.
    expect(update.mock.calls[0][2]).toMatchObject({
      start_date: '2024-02-01',
      end_date: '2024-02-05',
    });
  });

  it('delete: opens AlertDialog and calls dataSource.delete on confirm', async () => {
    const del = vi.fn().mockResolvedValue({});
    const ds: DataSource = {
      ...mockDataSource,
      find: vi.fn().mockResolvedValue({ data: mockData }),
      delete: del,
    };
    const schema: any = {
      type: 'gantt',
      gantt: { titleField: 'name', startDateField: 'start_date', endDateField: 'end_date' },
      data: { provider: 'object', object: 'tasks' },
    };
    render(<ObjectGantt schema={schema} dataSource={ds} />);

    await waitFor(() => expect(screen.getAllByTestId('gantt-task')).toHaveLength(2));

    // Request deletion for task id=1 — should open confirmation dialog.
    fireEvent.click(screen.getByTestId('gv-delete-1'));
    const confirm = await screen.findByTestId('gantt-delete-confirm');
    // i18n: dialog copy resolves through useGanttTranslation (host dictionary
    // first, bundled fallback here) and the body interpolates the task title —
    // the raw {{title}} placeholder must never surface.
    const dialogText = document.body.textContent || '';
    expect(dialogText).toContain('Delete this task?');
    expect(dialogText).not.toContain('{{title}}');
    fireEvent.click(confirm);

    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(del.mock.calls[0][0]).toBe('tasks');
    expect(del.mock.calls[0][1]).toBe('1');
  });

  // --- No API provider (objectui#12325) ----------------------------------------
  // A case here used to pin that `data: {provider:'api', read, write}` read
  // over fetch and persisted a drag through the write config. The view-level
  // `api` data source is retired in @objectstack/spec (objectstack#23082), and
  // ObjectGantt builds no adapter from it: the new meaning is pinned in
  // `ObjectGantt.retiredApiProvider-12325.test.tsx`.

  // --- Dependency edit writeback (依赖增删 + 类型选择) -----------------------
  const depData = [
    { id: '1', name: 'Task 1', start_date: '2024-01-01', end_date: '2024-01-05', deps: '' },
    { id: '2', name: 'Task 2', start_date: '2024-01-06', end_date: '2024-01-10', deps: '' },
  ];
  const depSchema = {
    type: 'gantt',
    gantt: { titleField: 'name', startDateField: 'start_date', endDateField: 'end_date', dependenciesField: 'deps' },
    data: { provider: 'object', object: 'tasks' },
  } as any;

  it('create FS dependency appends the predecessor id (CSV shape preserved)', async () => {
    const update = vi.fn().mockResolvedValue({});
    const ds: DataSource = { ...mockDataSource, find: vi.fn().mockResolvedValue({ data: depData }), update };
    render(<ObjectGantt schema={depSchema} dataSource={ds} />);
    await waitFor(() => expect(screen.getAllByTestId('gantt-task')).toHaveLength(2));

    fireEvent.click(screen.getByTestId('dep-create-1-2-fs'));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0]).toBe('tasks');
    expect(update.mock.calls[0][1]).toBe('2'); // target record carries the dep
    expect(update.mock.calls[0][2]).toEqual({ deps: '1' }); // CSV, bare id
  });

  it('create a non-FS dependency promotes the field to object-array form', async () => {
    const update = vi.fn().mockResolvedValue({});
    const ds: DataSource = { ...mockDataSource, find: vi.fn().mockResolvedValue({ data: depData }), update };
    render(<ObjectGantt schema={depSchema} dataSource={ds} />);
    await waitFor(() => expect(screen.getAllByTestId('gantt-task')).toHaveLength(2));

    fireEvent.click(screen.getByTestId('dep-create-1-2-ss'));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][2]).toEqual({ deps: [{ id: '1', type: 'ss' }] });
  });

  it('re-creating an existing link with a new type updates that link in place', async () => {
    const update = vi.fn().mockResolvedValue({});
    const seeded = [depData[0], { ...depData[1], deps: '1' }]; // 2 already depends on 1 (FS)
    const ds: DataSource = { ...mockDataSource, find: vi.fn().mockResolvedValue({ data: seeded }), update };
    render(<ObjectGantt schema={depSchema} dataSource={ds} />);
    await waitFor(() => expect(screen.getAllByTestId('gantt-task')).toHaveLength(2));

    fireEvent.click(screen.getByTestId('dep-create-1-2-ss')); // change FS -> SS
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][2]).toEqual({ deps: [{ id: '1', type: 'ss' }] });
  });

  it('re-creating an existing FS link with FS is a no-op (no update call)', async () => {
    const update = vi.fn().mockResolvedValue({});
    const seeded = [depData[0], { ...depData[1], deps: '1' }];
    const ds: DataSource = { ...mockDataSource, find: vi.fn().mockResolvedValue({ data: seeded }), update };
    render(<ObjectGantt schema={depSchema} dataSource={ds} />);
    await waitFor(() => expect(screen.getAllByTestId('gantt-task')).toHaveLength(2));

    fireEvent.click(screen.getByTestId('dep-create-1-2-fs'));
    await new Promise((r) => setTimeout(r, 0));
    expect(update).not.toHaveBeenCalled();
  });

  it('delete dependency removes the predecessor id from the target', async () => {
    const update = vi.fn().mockResolvedValue({});
    const seeded = [depData[0], { ...depData[1], deps: '1' }];
    const ds: DataSource = { ...mockDataSource, find: vi.fn().mockResolvedValue({ data: seeded }), update };
    render(<ObjectGantt schema={depSchema} dataSource={ds} />);
    await waitFor(() => expect(screen.getAllByTestId('gantt-task')).toHaveLength(2));

    fireEvent.click(screen.getByTestId('dep-delete-1-2'));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1]).toBe('2');
    expect(update.mock.calls[0][2]).toEqual({ deps: '' }); // CSV emptied
  });

  it('delete reverts the optimistic patch when the update fails', async () => {
    const update = vi.fn().mockRejectedValue(new Error('boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seeded = [depData[0], { ...depData[1], deps: '1' }];
    const ds: DataSource = { ...mockDataSource, find: vi.fn().mockResolvedValue({ data: seeded }), update };
    render(<ObjectGantt schema={depSchema} dataSource={ds} />);
    await waitFor(() => expect(screen.getAllByTestId('gantt-task')).toHaveLength(2));

    fireEvent.click(screen.getByTestId('dep-delete-1-2'));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    errSpy.mockRestore();
  });

  it('enables rescheduleOnConflict (拖拽冲突校验) when dependenciesField is set', async () => {
    const ds: DataSource = { ...mockDataSource, find: vi.fn().mockResolvedValue({ data: depData }) };
    render(<ObjectGantt schema={depSchema} dataSource={ds} />);
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeDefined());
    expect(screen.getByTestId('gantt-view').getAttribute('data-reschedule-on-conflict')).toBe('true');
  });

  it('leaves rescheduleOnConflict off when there is no dependenciesField', async () => {
    const noDep = { ...depSchema, gantt: { ...depSchema.gantt, dependenciesField: undefined } } as any;
    const ds: DataSource = { ...mockDataSource, find: vi.fn().mockResolvedValue({ data: depData }) };
    render(<ObjectGantt schema={noDep} dataSource={ds} />);
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeDefined());
    expect(screen.getByTestId('gantt-view').getAttribute('data-reschedule-on-conflict')).toBe('false');
  });

  it('derives a persistLayoutKey from the data object (保存布局)', async () => {
    const ds: DataSource = { ...mockDataSource, find: vi.fn().mockResolvedValue({ data: depData }) };
    render(<ObjectGantt schema={depSchema} dataSource={ds} />);
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeDefined());
    expect(screen.getByTestId('gantt-view').getAttribute('data-persist-layout-key')).toBe('tasks:default');
  });

  it('disables layout persistence when persistLayout is false', async () => {
    const noPersist = { ...depSchema, persistLayout: false } as any;
    const ds: DataSource = { ...mockDataSource, find: vi.fn().mockResolvedValue({ data: depData }) };
    render(<ObjectGantt schema={noPersist} dataSource={ds} />);
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeDefined());
    expect(screen.getByTestId('gantt-view').getAttribute('data-persist-layout-key')).toBe('');
  });

  it('enables mobileReadOnly by default (移动端只读缩略)', async () => {
    const ds: DataSource = { ...mockDataSource, find: vi.fn().mockResolvedValue({ data: depData }) };
    render(<ObjectGantt schema={depSchema} dataSource={ds} />);
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeDefined());
    expect(screen.getByTestId('gantt-view').getAttribute('data-mobile-readonly')).toBe('true');
  });

  it('opts out of mobileReadOnly when schema.mobileReadOnly is false', async () => {
    const noMobile = { ...depSchema, mobileReadOnly: false } as any;
    const ds: DataSource = { ...mockDataSource, find: vi.fn().mockResolvedValue({ data: depData }) };
    render(<ObjectGantt schema={noMobile} dataSource={ds} />);
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeDefined());
    expect(screen.getByTestId('gantt-view').getAttribute('data-mobile-readonly')).toBe('false');
  });

  it('maps lockField onto task.locked and forwards defaultCollapsedDepth (config-driven, not hardcoded)', async () => {
    const treeData = [
      { id: 'p', name: 'Project', start_date: '2024-01-01', end_date: '2024-01-31', kind: 'group' },
      { id: 'plan', name: 'Plan', start_date: '2024-01-02', end_date: '2024-01-10', kind: 'task', parent: 'p', frozen: false },
      { id: 'wo', name: 'Work order', start_date: '2024-01-02', end_date: '2024-01-05', kind: 'task', parent: 'plan', frozen: true },
    ];
    const schema: any = {
      type: 'gantt',
      gantt: {
        titleField: 'name', startDateField: 'start_date', endDateField: 'end_date',
        parentField: 'parent', typeField: 'kind', lockField: 'frozen', defaultCollapsedDepth: 2,
      },
      data: { provider: 'object', object: 'tasks' },
    };
    const ds: DataSource = { ...mockDataSource, find: vi.fn().mockResolvedValue({ data: treeData }) };
    render(<ObjectGantt schema={schema} dataSource={ds} />);
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeDefined());

    // defaultCollapsedDepth is forwarded verbatim to GanttView.
    expect(screen.getByTestId('gantt-view').getAttribute('data-default-collapsed-depth')).toBe('2');
    // typeField 'group' → group node (无条); lockField truthiness → task.locked.
    const byTitle = (title: string) =>
      screen.getByText(title).closest('[data-testid="gantt-task"]') as HTMLElement;
    expect(byTitle('Project').getAttribute('data-type')).toBe('group');
    expect(byTitle('Plan').getAttribute('data-locked')).toBe('false');
    expect(byTitle('Work order').getAttribute('data-locked')).toBe('true');
  });

  it('maps borderColorField onto task.borderColor (预警描边): semantic names → hex, css colors pass through', async () => {
    const alertData = [
      { id: '1', name: 'Overdue', start_date: '2024-01-01', end_date: '2024-01-05', alert: 'red' },
      { id: '2', name: 'Custom', start_date: '2024-01-06', end_date: '2024-01-10', alert: '#123456' },
      { id: '3', name: 'Normal', start_date: '2024-01-11', end_date: '2024-01-15', alert: null },
    ];
    const schema: any = {
      type: 'gantt',
      gantt: {
        titleField: 'name', startDateField: 'start_date', endDateField: 'end_date',
        borderColorField: 'alert',
      },
      data: { provider: 'object', object: 'tasks' },
    };
    const ds: DataSource = { ...mockDataSource, find: vi.fn().mockResolvedValue({ data: alertData }) };
    render(<ObjectGantt schema={schema} dataSource={ds} />);
    await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeDefined());

    const byTitle = (title: string) =>
      screen.getByText(title).closest('[data-testid="gantt-task"]') as HTMLElement;
    expect(byTitle('Overdue').getAttribute('data-border-color')).toBe('#ef4444'); // semantic 'red'
    expect(byTitle('Custom').getAttribute('data-border-color')).toBe('#123456'); // raw passthrough
    expect(byTitle('Normal').getAttribute('data-border-color')).toBe(''); // empty → no stroke
  });
});

describe('normalizeDependencies', () => {
  it('returns [] for null/undefined/empty', () => {
    expect(normalizeDependencies(null)).toEqual([]);
    expect(normalizeDependencies(undefined)).toEqual([]);
    expect(normalizeDependencies('')).toEqual([]);
    expect(normalizeDependencies({})).toEqual([]);
  });

  it('splits CSV strings and trims whitespace', () => {
    expect(normalizeDependencies('t1, t2 ,t3,')).toEqual(['t1', 't2', 't3']);
  });

  it('wraps a bare number id', () => {
    expect(normalizeDependencies(42)).toEqual([42]);
  });

  it('passes through arrays of ids, dropping null/empty entries', () => {
    expect(normalizeDependencies(['t1', null, '', 7])).toEqual(['t1', 7]);
  });

  it('normalizes object entries with id aliases and link-type aliases', () => {
    expect(normalizeDependencies([
      { id: 't1', type: 'ss' },
      { task: 't2', type: 'finish-to-start' },
      { target: 't3', type: 'END_TO_END' },
      { _id: 't4' },
      { type: 'fs' }, // no id → dropped
    ])).toEqual([
      { id: 't1', type: 'ss' },
      { id: 't2', type: 'fs' },
      { id: 't3', type: 'ff' },
      { id: 't4' },
    ]);
  });

  it('drops unknown link types but keeps the id', () => {
    expect(normalizeDependencies([{ id: 't1', type: 'banana' }])).toEqual([{ id: 't1' }]);
  });
});

describe('normalizeTaskType', () => {
  it('maps group/folder to the no-bar group header (case/space-insensitive)', () => {
    expect(normalizeTaskType('group')).toBe('group');
    expect(normalizeTaskType('Folder')).toBe('group');
    expect(normalizeTaskType('  GROUP ')).toBe('group');
  });

  it('keeps summary/project/phase as bar-carrying summaries', () => {
    expect(normalizeTaskType('summary')).toBe('summary');
    expect(normalizeTaskType('project')).toBe('summary');
    expect(normalizeTaskType('phase')).toBe('summary');
  });

  it('maps milestone and task, and infers (undefined) for unknown/empty', () => {
    expect(normalizeTaskType('milestone')).toBe('milestone');
    expect(normalizeTaskType('task')).toBe('task');
    expect(normalizeTaskType('banana')).toBeUndefined();
    expect(normalizeTaskType(null)).toBeUndefined();
  });
});
