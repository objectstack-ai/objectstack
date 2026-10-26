/**
 * Tooltip flip on bottom rows (最后一行悬浮狂闪).
 *
 * A downward tooltip on one of the LAST rows pokes past the rows box, growing
 * the scroller's scrollHeight while shown; with the user scrolled to the
 * bottom, browser scroll clamping/anchoring re-adjusts scrollTop on every
 * mount/unmount and the tooltip flickers in a loop. Bottom rows therefore
 * flip the tooltip ABOVE the bar (upward overflow never extends the
 * scrollable area). Top rows keep the downward tooltip.
 */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

function makeTasks(n: number): GanttTask[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    title: `Task ${i}`,
    start: new Date('2024-06-10T00:00:00.000Z'),
    end: new Date('2024-06-15T00:00:00.000Z'),
    progress: 0,
    dependencies: [],
  }));
}

function hoverBar(container: HTMLElement, id: string) {
  const bar = container.querySelector(`[data-testid="gantt-task-bar-${id}"]`) as HTMLElement;
  expect(bar).toBeTruthy();
  act(() => {
    fireEvent.mouseEnter(bar);
  });
  return container.querySelector(`[data-testid="gantt-tooltip-${id}"]`) as HTMLElement | null;
}

describe('tooltip flip on bottom rows', () => {
  it('last row of a tall chart renders the tooltip ABOVE the bar (bottom set, top unset)', () => {
    const tasks = makeTasks(20);
    const { container } = render(
      <div style={{ width: 1280, height: 600 }}>
        <GanttView
          tasks={tasks}
          startDate={new Date('2024-06-01T00:00:00.000Z')}
          endDate={new Date('2024-06-30T00:00:00.000Z')}
        />
      </div>
    );
    const tip = hoverBar(container, 't19');
    expect(tip).toBeTruthy();
    expect(tip!.style.bottom).not.toBe('');
    expect(tip!.style.top).toBe('');
  });

  it('a top row keeps the downward tooltip (top set, bottom unset)', () => {
    const tasks = makeTasks(20);
    const { container } = render(
      <div style={{ width: 1280, height: 600 }}>
        <GanttView
          tasks={tasks}
          startDate={new Date('2024-06-01T00:00:00.000Z')}
          endDate={new Date('2024-06-30T00:00:00.000Z')}
        />
      </div>
    );
    const tip = hoverBar(container, 't0');
    expect(tip).toBeTruthy();
    expect(tip!.style.top).not.toBe('');
    expect(tip!.style.bottom).toBe('');
  });

  it('short charts (no room above) never flip', () => {
    const tasks = makeTasks(3);
    const { container } = render(
      <div style={{ width: 1280, height: 600 }}>
        <GanttView
          tasks={tasks}
          startDate={new Date('2024-06-01T00:00:00.000Z')}
          endDate={new Date('2024-06-30T00:00:00.000Z')}
        />
      </div>
    );
    const tip = hoverBar(container, 't2');
    expect(tip).toBeTruthy();
    expect(tip!.style.top).not.toBe('');
    expect(tip!.style.bottom).toBe('');
  });
});
