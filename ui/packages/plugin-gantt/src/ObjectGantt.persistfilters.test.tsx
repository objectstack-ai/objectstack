/**
 * ObjectGantt-side tests for the #2460 batch: quick-filter persistence riding
 * on 保存布局 (sibling localStorage key + restore on mount), per-level tooltip
 * fields skipping empty values (悬浮分层字段).
 *
 * GanttView is mocked to a thin shell exposing what ObjectGantt feeds it.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectGantt } from './ObjectGantt';

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks, onLayoutChange }: any) => (
    <div data-testid="gantt-view" data-count={tasks.length} data-ids={tasks.map((t: any) => t.id).join(',')}>
      {tasks.map((t: any) => (
        <div key={t.id} data-testid={`gv-task-${t.id}`}>
          <span data-testid={`gv-fields-${t.id}`}>
            {(t.fields ?? []).map((f: any) => `${f.label}=${f.value}`).join('|')}
          </span>
        </div>
      ))}
      {onLayoutChange && (
        <button
          data-testid="mock-save-layout"
          onClick={() => onLayoutChange({ viewMode: 'day', columnWidth: null, taskListCollapsed: false })}
        />
      )}
    </div>
  ),
}));

const INLINE = [
  { id: '1', name: 'Alpha', start: '2024-01-01', end: '2024-01-05', status: 'todo' },
  { id: '2', name: 'Beta', start: '2024-02-01', end: '2024-02-10', status: 'doing' },
];

function schema(extra: Record<string, any> = {}) {
  return {
    type: 'gantt',
    startDateField: 'start',
    endDateField: 'end',
    titleField: 'name',
    data: { provider: 'value', items: INLINE },
    quickFilters: [{ field: 'status', label: '状态', options: ['todo', 'doing'] }],
    ...extra,
  } as any;
}

const gv = (c: HTMLElement) => c.querySelector('[data-testid="gantt-view"]') as HTMLElement;
// No objectName + value provider → persist key gantt:default.
const FILTERS_KEY = 'gantt-layout:gantt:default:filters';

beforeEach(() => window.localStorage.clear());

describe('ObjectGantt quick-filter persistence (保存布局收纳筛选)', () => {
  it('writes the active filters to the sibling key when the layout is saved', async () => {
    const { container, getByTestId } = render(<ObjectGantt schema={schema()} />);
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('2'));
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    fireEvent.click(getByTestId('quick-filter-option-status-doing'));
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('1'));

    fireEvent.click(getByTestId('mock-save-layout'));
    expect(JSON.parse(window.localStorage.getItem(FILTERS_KEY)!)).toEqual({ status: ['doing'] });
  });

  it('restores persisted filters on mount', async () => {
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify({ status: ['doing'] }));
    const { container } = render(<ObjectGantt schema={schema()} />);
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('1'));
    expect(gv(container).getAttribute('data-ids')).toBe('2');
  });

  it('ignores malformed persisted filters', async () => {
    window.localStorage.setItem(FILTERS_KEY, '{oops');
    const { container } = render(<ObjectGantt schema={schema()} />);
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('2'));
  });

  it('does not persist or restore when persistLayout is false', async () => {
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify({ status: ['doing'] }));
    const { container, queryByTestId } = render(<ObjectGantt schema={schema({ persistLayout: false })} />);
    // Snapshot ignored AND no onLayoutChange handed down (no save hook).
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('2'));
    expect(queryByTestId('mock-save-layout')).toBeNull();
  });
});

describe('ObjectGantt tooltip fields skip empty values (悬浮分层字段)', () => {
  it('drops rows whose value is null/empty instead of rendering a dash', async () => {
    const items = [
      { id: '1', name: 'Plan', start: '2024-01-01', end: '2024-01-05', category: '排产', qty: 0, owner: '' },
      { id: '2', name: 'Dispatch', start: '2024-02-01', end: '2024-02-10', owner: '张三', tags: [] },
    ];
    const s = schema({
      data: { provider: 'value', items },
      quickFilters: undefined,
      tooltipFields: ['category', 'qty', 'owner', 'tags', 'missing'],
    });
    const { container, getByTestId } = render(<ObjectGantt schema={s} />);
    await waitFor(() => expect(gv(container).getAttribute('data-count')).toBe('2'));
    // Row 1: category + qty (0 is a real value) survive; empty owner, absent
    // missing are dropped. Row 2: only owner survives (empty array dropped).
    // Labels come humanized (Title Case) from resolveFieldLabel.
    expect(getByTestId('gv-fields-1').textContent).toBe('Category=排产|Qty=0');
    expect(getByTestId('gv-fields-2').textContent).toBe('Owner=张三');
  });
});

