/**
 * Toolbar auto-schedule confirmation flow (自动排程确认弹窗): compute first,
 * ask before the bulk write, transient notice when nothing violates.
 */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';

const D = (s: string) => new Date(s);

function makeTasks(violating: boolean): GanttTask[] {
  return [
    { id: 'P', title: 'Pred', start: D('2024-06-01'), end: D('2024-06-10'), progress: 0, dependencies: [] },
    {
      id: 'B',
      title: 'Succ',
      // Violating: starts before P ends. Clean: starts after.
      start: violating ? D('2024-06-05') : D('2024-06-11'),
      end: violating ? D('2024-06-08') : D('2024-06-14'),
      progress: 0,
      dependencies: ['P'],
    },
  ];
}

function renderView(opts: { violating: boolean; onTaskUpdate: (t: GanttTask, c: any) => void }) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={makeTasks(opts.violating)}
        startDate={D('2024-06-01')}
        endDate={D('2024-06-30')}
        onTaskUpdate={opts.onTaskUpdate}
        autoSchedule
      />
    </div>
  );
}

const clickWand = (container: HTMLElement) => {
  const btn = container.querySelector('[data-testid="gantt-auto-schedule"]') as HTMLElement;
  expect(btn).toBeTruthy();
  act(() => { fireEvent.click(btn); });
};

describe('auto-schedule confirmation dialog', () => {
  it('computes first and asks — nothing is written before confirm', () => {
    const onTaskUpdate = vi.fn();
    const { container, baseElement } = renderView({ violating: true, onTaskUpdate });
    clickWand(container);
    const dlg = baseElement.querySelector('[data-testid="gantt-autoschedule-dialog"]');
    expect(dlg).toBeTruthy();
    expect(dlg!.textContent).toContain('1');
    expect(onTaskUpdate).not.toHaveBeenCalled();
  });

  it('confirm applies the shift', async () => {
    const onTaskUpdate = vi.fn();
    const { container, baseElement } = renderView({ violating: true, onTaskUpdate });
    clickWand(container);
    await act(async () => {
      fireEvent.click(baseElement.querySelector('[data-testid="gantt-autoschedule-confirm"]') as HTMLElement);
    });
    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [task, changes] = onTaskUpdate.mock.calls[0];
    expect(task.id).toBe('B');
    expect(changes.start.toISOString()).toBe(D('2024-06-10').toISOString());
    expect(baseElement.querySelector('[data-testid="gantt-autoschedule-dialog"]')).toBeFalsy();
  });

  it('cancel discards without writing', () => {
    const onTaskUpdate = vi.fn();
    const { container, baseElement } = renderView({ violating: true, onTaskUpdate });
    clickWand(container);
    act(() => {
      fireEvent.click(baseElement.querySelector('[data-testid="gantt-autoschedule-cancel"]') as HTMLElement);
    });
    expect(onTaskUpdate).not.toHaveBeenCalled();
    expect(baseElement.querySelector('[data-testid="gantt-autoschedule-dialog"]')).toBeFalsy();
  });

  it('a clean graph shows the transient notice instead of the dialog', () => {
    const onTaskUpdate = vi.fn();
    const { container, baseElement } = renderView({ violating: false, onTaskUpdate });
    clickWand(container);
    expect(baseElement.querySelector('[data-testid="gantt-autoschedule-dialog"]')).toBeFalsy();
    expect(baseElement.querySelector('[data-testid="gantt-autoschedule-clean"]')).toBeTruthy();
    expect(onTaskUpdate).not.toHaveBeenCalled();
  });
});
