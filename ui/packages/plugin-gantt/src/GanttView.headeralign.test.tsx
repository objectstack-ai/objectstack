/**
 * Task-list header ↔ row column alignment.
 *
 * Every data row reserves a trailing w-6 (+4px gap) slot for the 「→」
 * open-details button whenever `onTaskClick` is live. The header row must
 * mirror that slot, otherwise the 开始/结束 header labels sit 28px to the
 * right of the date values they caption.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  window.localStorage.clear();
});

function makeTask(id: string): GanttTask {
  return {
    id,
    title: `Task ${id}`,
    start: new Date('2024-06-10T00:00:00.000Z'),
    end: new Date('2024-06-15T00:00:00.000Z'),
    progress: 0,
  };
}

function renderView(props: Partial<React.ComponentProps<typeof GanttView>> = {}) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={[makeTask('a')]}
        startDate={new Date('2024-06-01T00:00:00.000Z')}
        endDate={new Date('2024-06-30T00:00:00.000Z')}
        {...props}
      />
    </div>
  );
}

describe('GanttView task-list header mirrors the row 「→」 slot', () => {
  it('renders the header spacer when onTaskClick is live (rows reserve the slot)', () => {
    const { container } = renderView({ onTaskClick: vi.fn() });
    expect(container.querySelector('[data-testid="gantt-header-open-spacer"]')).toBeTruthy();
    // Sanity: the rows do reserve the slot this spacer mirrors.
    expect(container.querySelector('[data-testid="gantt-row-open-a"]')).toBeTruthy();
  });

  it('renders no header spacer when onTaskClick is absent (rows have no slot)', () => {
    const { container } = renderView();
    expect(container.querySelector('[data-testid="gantt-header-open-spacer"]')).toBeNull();
    expect(container.querySelector('[data-testid="gantt-row-open-a"]')).toBeNull();
  });
});
