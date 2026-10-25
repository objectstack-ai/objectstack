/**
 * ObjectGantt quick-filter (快速筛选) integration tests. These cover the wiring
 * the presentational QuickFilterBar can't: option resolution (explicit enum /
 * schema select options / lookup reference records / distinct fallback),
 * in-memory task filtering, and the auto-zoom vs pinned-range behaviour.
 *
 * GanttView is mocked to a thin shell that surfaces the tasks it receives plus
 * the (possibly pinned) start/end range as data attributes, so we can assert on
 * what ObjectGantt feeds downstream. The real QuickFilterBar renders so the
 * dropdown interactions are exercised end-to-end.
 */
import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import { normalizeSchemaReferenceKeys } from '@object-ui/core';
import { describe, it, expect, vi } from 'vitest';
import { ObjectGantt } from './ObjectGantt';
import type { DataSource } from '@object-ui/types';

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks, startDate, endDate }: any) => (
    <div
      data-testid="gantt-view"
      data-count={tasks.length}
      data-ids={tasks.map((t: any) => t.id).join(',')}
      data-start={startDate ? new Date(startDate).toISOString().slice(0, 10) : ''}
      data-end={endDate ? new Date(endDate).toISOString().slice(0, 10) : ''}
    >
      {tasks.map((t: any) => (
        <span key={t.id} data-testid={`gv-task-${t.id}`}>{t.title}</span>
      ))}
    </div>
  ),
}));

const INLINE = [
  { id: '1', name: 'Alpha task', start: '2024-01-01', end: '2024-01-05', status: 'todo', project: 'Apollo' },
  { id: '2', name: 'Beta task', start: '2024-02-01', end: '2024-02-10', status: 'doing', project: 'Apollo' },
  { id: '3', name: 'Gamma task', start: '2024-03-01', end: '2024-03-20', status: 'done', project: 'Zephyr' },
];

function inlineSchema(extra: Record<string, any> = {}) {
  return {
    type: 'gantt',
    startDateField: 'start',
    endDateField: 'end',
    titleField: 'name',
    data: { provider: 'value', items: INLINE },
    quickFilters: [
      { field: 'status', label: '状态', options: ['todo', 'doing', 'done'] },
      { field: 'project', label: '项目' },
    ],
    ...extra,
  } as any;
}

const gv = (c: HTMLElement) => c.querySelector('[data-testid="gantt-view"]') as HTMLElement;
const ids = (c: HTMLElement) => gv(c).getAttribute('data-ids');

describe('ObjectGantt quick filters', () => {
  it('renders a filter bar with a dropdown per configured dimension', async () => {
    const { container, getByTestId } = render(<ObjectGantt schema={inlineSchema()} />);
    await waitFor(() => expect(gv(container)).toBeTruthy());
    expect(getByTestId('quick-filter-bar')).toBeTruthy();
    expect(getByTestId('quick-filter-trigger-status')).toBeTruthy();
    expect(getByTestId('quick-filter-trigger-project')).toBeTruthy();
  });

  it('resolves explicit enum options on the def', async () => {
    const { container, getByTestId } = render(<ObjectGantt schema={inlineSchema()} />);
    await waitFor(() => expect(gv(container)).toBeTruthy());
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    const panel = getByTestId('quick-filter-panel-status');
    expect(within(panel).getByTestId('quick-filter-option-status-todo')).toBeTruthy();
    expect(within(panel).getByTestId('quick-filter-option-status-done')).toBeTruthy();
  });

  it('falls back to distinct data values when no options/schema exist', async () => {
    // `project` has no explicit options and no object schema → distinct from data.
    const { container, getByTestId } = render(<ObjectGantt schema={inlineSchema()} />);
    await waitFor(() => expect(gv(container)).toBeTruthy());
    fireEvent.click(getByTestId('quick-filter-trigger-project'));
    const panel = getByTestId('quick-filter-panel-project');
    expect(within(panel).getByTestId('quick-filter-option-project-Apollo')).toBeTruthy();
    expect(within(panel).getByTestId('quick-filter-option-project-Zephyr')).toBeTruthy();
    // Apollo appears twice in data but only once as an option.
    expect(within(panel).queryAllByTestId('quick-filter-option-project-Apollo').length).toBe(1);
  });

  it('filters the task set in memory when an option is selected', async () => {
    const { container, getByTestId } = render(<ObjectGantt schema={inlineSchema()} />);
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('3'));
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    fireEvent.click(getByTestId('quick-filter-option-status-doing'));
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('1'));
    expect(ids(container)).toBe('2');
  });

  it('combines two dimensions with AND semantics', async () => {
    const { container, getByTestId } = render(<ObjectGantt schema={inlineSchema()} />);
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('3'));
    // project=Apollo → {1,2}; then status=todo → {1}.
    fireEvent.click(getByTestId('quick-filter-trigger-project'));
    fireEvent.click(getByTestId('quick-filter-option-project-Apollo'));
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('2'));
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    fireEvent.click(getByTestId('quick-filter-option-status-todo'));
    await waitFor(() => expect(ids(container)).toBe('1'));
  });

  it('clears all filters via the clear button', async () => {
    const { container, getByTestId } = render(<ObjectGantt schema={inlineSchema()} />);
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('3'));
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    fireEvent.click(getByTestId('quick-filter-option-status-done'));
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('1'));
    fireEvent.click(getByTestId('quick-filter-clear'));
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('3'));
  });

  it('auto-zooms by default: no fixed range is forced, so the axis tracks the filtered tasks', async () => {
    const { container, getByTestId } = render(<ObjectGantt schema={inlineSchema()} />);
    await waitFor(() => expect(gv(container)).toBeTruthy());
    expect(gv(container).getAttribute('data-start')).toBe('');
    expect(gv(container).getAttribute('data-end')).toBe('');
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    fireEvent.click(getByTestId('quick-filter-option-status-doing'));
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('1'));
    // Still no forced range — GanttView re-derives it from the single task.
    expect(gv(container).getAttribute('data-start')).toBe('');
  });

  it('pins the range to the full task span when autoZoomToFilter is false', async () => {
    const { container, getByTestId } = render(
      <ObjectGantt schema={inlineSchema({ autoZoomToFilter: false })} />,
    );
    await waitFor(() => expect(gv(container)).toBeTruthy());
    const startBefore = gv(container).getAttribute('data-start');
    const endBefore = gv(container).getAttribute('data-end');
    // Full span: earliest start 2024-01-01, latest end 2024-03-20.
    expect(startBefore).toBe('2024-01-01');
    expect(endBefore).toBe('2024-03-20');
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    fireEvent.click(getByTestId('quick-filter-option-status-doing'));
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('1'));
    // Range stays pinned even though only the Feb task is visible.
    expect(gv(container).getAttribute('data-start')).toBe('2024-01-01');
    expect(gv(container).getAttribute('data-end')).toBe('2024-03-20');
  });

  it('does not render a filter bar when no quickFilters are configured', async () => {
    const schema: any = {
      type: 'gantt',
      startDateField: 'start',
      endDateField: 'end',
      titleField: 'name',
      data: { provider: 'value', items: INLINE },
    };
    const { container, queryByTestId } = render(<ObjectGantt schema={schema} />);
    await waitFor(() => expect(gv(container)).toBeTruthy());
    expect(queryByTestId('quick-filter-bar')).toBeNull();
  });
});

describe('ObjectGantt quick filters — tree-aware (保留祖先链)', () => {
  // 项目分组行没有可筛字段值;命中子任务时必须连同祖先一起保留,
  // 否则命中的行成孤儿、树被打散。
  const TREE = [
    { id: 'root', name: '项目', start: '2024-01-01', end: '2024-03-20' },
    { id: 'mid', name: '产品', start: '2024-01-01', end: '2024-02-10', parentId: 'root' },
    { id: 't1', name: '计划一', start: '2024-01-01', end: '2024-01-05', status: 'todo', parentId: 'mid' },
    { id: 't2', name: '计划二', start: '2024-02-01', end: '2024-02-10', status: 'doing', parentId: 'mid' },
    { id: 'other', name: '另一项目', start: '2024-03-01', end: '2024-03-20', status: 'done' },
  ];

  const treeSchema = () =>
    ({
      type: 'gantt',
      startDateField: 'start',
      endDateField: 'end',
      titleField: 'name',
      parentField: 'parentId',
      data: { provider: 'value', items: TREE },
      quickFilters: [{ field: 'status', label: '状态', options: ['todo', 'doing', 'done'] }],
    }) as any;

  it('keeps the full ancestor chain of a matched task', async () => {
    const { container, getByTestId } = render(<ObjectGantt schema={treeSchema()} />);
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('5'));
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    fireEvent.click(getByTestId('quick-filter-option-status-doing'));
    // t2 matches → root and mid ride along; t1 (sibling) and other are dropped.
    await waitFor(() => expect(ids(container)).toBe('root,mid,t2'));
  });

  it('drops an ancestor once none of its descendants match', async () => {
    const { container, getByTestId } = render(<ObjectGantt schema={treeSchema()} />);
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('5'));
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    fireEvent.click(getByTestId('quick-filter-option-status-done'));
    // Only the standalone root matches — the root/mid subtree disappears entirely.
    await waitFor(() => expect(ids(container)).toBe('other'));
  });

  it('matching several branches keeps each ancestor exactly once', async () => {
    const { container, getByTestId } = render(<ObjectGantt schema={treeSchema()} />);
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('5'));
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    fireEvent.click(getByTestId('quick-filter-option-status-todo'));
    fireEvent.click(getByTestId('quick-filter-option-status-doing'));
    // Both children of mid match; shared ancestors are not duplicated.
    await waitFor(() => expect(ids(container)).toBe('root,mid,t1,t2'));
  });
});

describe('ObjectGantt quick filters — schema-driven options', () => {
  const RECORDS = [
    { id: '1', name: 'A', start: '2024-01-01', end: '2024-01-05', status: 'todo', project: { id: 'p1', name: 'Apollo' } },
    { id: '2', name: 'B', start: '2024-02-01', end: '2024-02-05', status: 'doing', project: { id: 'p2', name: 'Zephyr' } },
  ];

  function makeDataSource(): DataSource {
    return {
      find: vi.fn((resource: string) => {
        if (resource === 'projects') {
          return Promise.resolve({
            data: [
              { id: 'p1', name: 'Apollo' },
              { id: 'p2', name: 'Zephyr' },
              { id: 'p3', name: 'Orion (no tasks)' },
            ],
          });
        }
        return Promise.resolve({ data: RECORDS });
      }) as any,
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({
        fields: {
          name: { type: 'text' },
          start: { type: 'date' },
          end: { type: 'date' },
          status: {
            type: 'select',
            options: [
              { value: 'todo', label: '待开始' },
              { value: 'doing', label: '进行中' },
              { value: 'done', label: '已完成' },
            ],
          },
          project: { type: 'lookup', reference: 'projects' },
        },
      }),
    };
  }

  const objSchema = (extra: Record<string, any> = {}) =>
    ({
      type: 'gantt',
      objectName: 'task',
      startDateField: 'start',
      endDateField: 'end',
      titleField: 'name',
      quickFilters: [
        { field: 'status', label: '状态' },
        { field: 'project', label: '项目' },
      ],
      ...extra,
    }) as any;

  it('resolves select field options (full domain) from the object schema', async () => {
    const ds = makeDataSource();
    const { container, getByTestId } = render(<ObjectGantt schema={objSchema()} dataSource={ds} />);
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('2'));
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    const panel = getByTestId('quick-filter-panel-status');
    // The schema lists three options even though data only has todo+doing.
    expect(within(panel).getByText('待开始')).toBeTruthy();
    expect(within(panel).getByText('进行中')).toBeTruthy();
    expect(within(panel).getByText('已完成')).toBeTruthy();
  });

  it('pulls the full lookup domain from the referenced object', async () => {
    const ds = makeDataSource();
    const { container, getByTestId } = render(<ObjectGantt schema={objSchema()} dataSource={ds} />);
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('2'));
    // Wait for the async lookup fetch to populate options.
    await waitFor(() => {
      fireEvent.click(getByTestId('quick-filter-trigger-project'));
      const panel = getByTestId('quick-filter-panel-project');
      expect(within(panel).getByTestId('quick-filter-option-project-p3')).toBeTruthy();
    });
    expect((ds.find as any).mock.calls.some((c: any[]) => c[0] === 'projects')).toBe(true);
  });

  it('does NOT pull the lookup domain when the schema keys the target as `reference_to` (objectui#6837 half 2)', async () => {
    // This test used to assert the MIRROR of the one above, back when the
    // option fetch read `reference_to ?? reference`. objectui#6837 half 2
    // deleted the `reference_to` arm — maintainer 2026-08-31: protocol
    // normalization belongs on the SERVER, the front end just executes the
    // protocol — so the assertion is inverted rather than deleted, and the
    // fixture above now carries the spelling `FieldSchema` actually declares.
    //
    // ⚠️ The degradation is asserted POSITIVELY (p1/p2 present, p3 absent), not
    // as a bare absence: a gantt that rendered no quick filter at all would
    // satisfy `queryByTestId(...p3) === null` and measure nothing.
    const ds = makeDataSource();
    (ds.getObjectSchema as any).mockResolvedValue({
      fields: {
        name: { type: 'text' },
        start: { type: 'date' },
        end: { type: 'date' },
        project: { type: 'lookup', reference_to: 'projects' },
      },
    });
    const { container, getByTestId } = render(<ObjectGantt schema={objSchema()} dataSource={ds} />);
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('2'));
    fireEvent.click(getByTestId('quick-filter-trigger-project'));
    const panel = getByTestId('quick-filter-panel-project');
    // Falls back to the distinct values present in the loaded rows.
    expect(within(panel).getByTestId('quick-filter-option-project-p1')).toBeTruthy();
    expect(within(panel).getByTestId('quick-filter-option-project-p2')).toBeTruthy();
    // `p3` lives only in the referenced object's domain, which was never fetched.
    expect(within(panel).queryByTestId('quick-filter-option-project-p3')).toBeNull();
    expect((ds.find as any).mock.calls.some((c: any[]) => c[0] === 'projects')).toBe(false);
  });

  it('a `reference_to`-only def that came through the ingestion choke point STILL resolves', async () => {
    // What bounds the break: `normalizeSchemaReferenceKeys` folds onto `reference`
    // from whichever spelling arrived, so every def that entered through
    // `MetadataProvider` or `ObjectStackAdapter.getObjectSchema` is unaffected.
    // Only a def that bypassed that door reaches this reader raw.
    const ds = makeDataSource();
    const served = {
      fields: {
        name: { type: 'text' },
        start: { type: 'date' },
        end: { type: 'date' },
        project: { type: 'lookup', reference_to: 'projects' },
      },
    };
    normalizeSchemaReferenceKeys(served);
    (ds.getObjectSchema as any).mockResolvedValue(served);
    const { container, getByTestId } = render(<ObjectGantt schema={objSchema()} dataSource={ds} />);
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('2'));
    await waitFor(() => {
      fireEvent.click(getByTestId('quick-filter-trigger-project'));
      const panel = getByTestId('quick-filter-panel-project');
      expect(within(panel).getByTestId('quick-filter-option-project-p3')).toBeTruthy();
    });
    expect((ds.find as any).mock.calls.some((c: any[]) => c[0] === 'projects')).toBe(true);
  });

  it('filters by a lookup value resolved to the embedded record id', async () => {
    const ds = makeDataSource();
    const { container, getByTestId } = render(<ObjectGantt schema={objSchema()} dataSource={ds} />);
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('2'));
    await waitFor(() => {
      fireEvent.click(getByTestId('quick-filter-trigger-project'));
      expect(getByTestId('quick-filter-option-project-p1')).toBeTruthy();
    });
    fireEvent.click(getByTestId('quick-filter-option-project-p1'));
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('1'));
    expect(ids(container)).toBe('1');
  });
});
