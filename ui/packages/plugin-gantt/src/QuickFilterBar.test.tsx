/**
 * QuickFilterBar (快速筛选栏) presentational tests. The bar is fully controlled,
 * so these assert the open/close + checkbox interaction emits the right
 * onChange/onClear payloads — no filtering logic lives here.
 */
import React from 'react';
import { render, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QuickFilterBar, type QuickFilterField } from './QuickFilterBar';

const FILTERS: QuickFilterField[] = [
  {
    field: 'status',
    label: '状态',
    options: [
      { value: 'todo', label: '待开始' },
      { value: 'doing', label: '进行中' },
      { value: 'done', label: '已完成' },
    ],
  },
  {
    field: 'dispatch_type',
    label: '派工类别',
    options: [
      { value: '生产派工单', label: '生产派工单' },
      { value: '质检派工单', label: '质检派工单' },
    ],
  },
];

function setup(value: Record<string, string[]> = {}, extra: Partial<React.ComponentProps<typeof QuickFilterBar>> = {}) {
  const onChange = vi.fn();
  const onClear = vi.fn();
  const utils = render(
    <QuickFilterBar
      filters={FILTERS}
      value={value}
      onChange={onChange}
      onClear={onClear}
      labels={{ all: '全部', clear: '清除筛选', resultSummary: (s, t) => `显示 ${s} / ${t}` }}
      resultCount={5}
      totalCount={9}
      {...extra}
    />,
  );
  return { onChange, onClear, ...utils };
}

describe('QuickFilterBar', () => {
  it('renders one trigger per dimension', () => {
    const { getByTestId } = setup();
    expect(getByTestId('quick-filter-bar')).toBeTruthy();
    expect(getByTestId('quick-filter-trigger-status')).toBeTruthy();
    expect(getByTestId('quick-filter-trigger-dispatch_type')).toBeTruthy();
  });

  it('opens the panel on trigger click and lists every option', () => {
    const { getByTestId, queryByTestId } = setup();
    expect(queryByTestId('quick-filter-panel-status')).toBeNull();
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    const panel = getByTestId('quick-filter-panel-status');
    expect(within(panel).getByTestId('quick-filter-option-status-todo')).toBeTruthy();
    expect(within(panel).getByTestId('quick-filter-option-status-doing')).toBeTruthy();
    expect(within(panel).getByTestId('quick-filter-option-status-done')).toBeTruthy();
  });

  it('emits the selected value when an option is checked', () => {
    const { getByTestId, onChange } = setup();
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    fireEvent.click(getByTestId('quick-filter-option-status-doing'));
    expect(onChange).toHaveBeenCalledWith('status', ['doing']);
  });

  it('removes a value when an already-checked option is clicked', () => {
    const { getByTestId, onChange } = setup({ status: ['todo', 'doing'] });
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    fireEvent.click(getByTestId('quick-filter-option-status-todo'));
    expect(onChange).toHaveBeenCalledWith('status', ['doing']);
  });

  it('collapses to "no constraint" (empty) when the last option completes the full set', () => {
    // todo + doing already selected; checking done = all 3 → equivalent to All.
    const { getByTestId, onChange } = setup({ status: ['todo', 'doing'] });
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    fireEvent.click(getByTestId('quick-filter-option-status-done'));
    expect(onChange).toHaveBeenCalledWith('status', []);
  });

  it('select-all toggles between every value and empty', () => {
    const { getByTestId, onChange } = setup();
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    fireEvent.click(getByTestId('quick-filter-all-status'));
    expect(onChange).toHaveBeenCalledWith('status', ['todo', 'doing', 'done']);
  });

  it('select-all clears when something is already selected', () => {
    const { getByTestId, onChange } = setup({ status: ['todo'] });
    fireEvent.click(getByTestId('quick-filter-trigger-status'));
    fireEvent.click(getByTestId('quick-filter-all-status'));
    expect(onChange).toHaveBeenCalledWith('status', []);
  });

  it('shows the clear button only when a filter is active, and calls onClear', () => {
    const { queryByTestId } = setup();
    expect(queryByTestId('quick-filter-clear')).toBeNull();

    const active = setup({ status: ['todo'] });
    expect(active.queryByTestId('quick-filter-clear')).toBeTruthy();
    fireEvent.click(active.getByTestId('quick-filter-clear'));
    expect(active.onClear).toHaveBeenCalledTimes(1);
  });

  it('renders the result summary from the provided counts', () => {
    const { getByTestId } = setup({ status: ['todo'] });
    expect(getByTestId('quick-filter-summary').textContent).toBe('显示 5 / 9');
  });

  it('renders nothing when there are no filters', () => {
    const { container } = render(
      <QuickFilterBar filters={[]} value={{}} onChange={() => {}} onClear={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
