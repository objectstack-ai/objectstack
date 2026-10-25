/**
 * Phase 5 tests: row/column virtualization, fullscreen toggle, custom markers.
 *
 * Conventions match the other suites: innerWidth=1280 → columnWidth 110,
 * rowHeight 40. jsdom reports clientWidth/Height of 0, so GanttView falls
 * back to a 4000×600 virtual viewport — large enough that the small fixtures
 * in the other suites render fully, small enough that big fixtures window.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

const ROW_HEIGHT = 40;
const VIEWPORT_H = 600; // jsdom fallback height
const ROW_OVERSCAN = 6;

function manyTasks(n: number): GanttTask[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    title: `Task t${i}`,
    start: new Date('2024-06-03T00:00:00.000Z'),
    end: new Date('2024-06-13T00:00:00.000Z'),
    progress: 25,
  }));
}

function renderView(tasks: GanttTask[], props: Partial<React.ComponentProps<typeof GanttView>> = {}) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={tasks}
        startDate={new Date('2024-06-01T00:00:00.000Z')}
        endDate={new Date('2024-06-30T00:00:00.000Z')}
        {...props}
      />
    </div>
  );
}

describe('GanttView row virtualization', () => {
  it('renders only the visible window of a 1000-task list, padded by spacers', () => {
    const { container } = renderView(manyTasks(1000));

    const treeitems = container.querySelectorAll('[role="treeitem"]');
    const expected = Math.ceil(VIEWPORT_H / ROW_HEIGHT) + ROW_OVERSCAN; // 21 at the top
    expect(treeitems.length).toBe(expected);
    expect(treeitems[0].textContent).toContain('Task t0');

    // Timeline bars window identically.
    const bars = container.querySelectorAll('[data-testid^="gantt-task-bar-"]');
    expect(bars.length).toBe(expected);

    // Bottom spacer keeps the scroll height honest (no top spacer at 0).
    const tree = container.querySelector('[role="tree"]') as HTMLElement;
    const spacers = tree.querySelectorAll(':scope > div[aria-hidden="true"]');
    expect(spacers.length).toBe(1);
    expect((spacers[0] as HTMLElement).style.height).toBe(`${(1000 - expected) * ROW_HEIGHT}px`);
  });

  it('shifts the window on scroll and pads the top', () => {
    const { container } = renderView(manyTasks(1000));
    const timeline = container.querySelector('[data-testid="gantt-timeline"]') as HTMLElement;

    timeline.scrollTop = 4000; // 100 rows down
    fireEvent.scroll(timeline);

    const startIdx = Math.floor(4000 / ROW_HEIGHT) - ROW_OVERSCAN; // 94
    const endIdx = Math.ceil((4000 + VIEWPORT_H) / ROW_HEIGHT) + ROW_OVERSCAN; // 121
    const treeitems = container.querySelectorAll('[role="treeitem"]');
    expect(treeitems.length).toBe(endIdx - startIdx);
    expect(treeitems[0].textContent).toContain(`Task t${startIdx}`);

    const tree = container.querySelector('[role="tree"]') as HTMLElement;
    const spacers = tree.querySelectorAll(':scope > div[aria-hidden="true"]');
    expect(spacers.length).toBe(2);
    expect((spacers[0] as HTMLElement).style.height).toBe(`${startIdx * ROW_HEIGHT}px`);
    expect((spacers[1] as HTMLElement).style.height).toBe(`${(1000 - endIdx) * ROW_HEIGHT}px`);
  });

  it('keeps dependency links anchored at absolute row positions while windowed', () => {
    const tasks = manyTasks(1000);
    tasks[100].dependencies = ['t99'];
    const { container } = renderView(tasks);

    // Link is far below the initial window → skipped entirely.
    expect(container.querySelector('[data-testid="gantt-link-t99-t100"]')).toBeFalsy();

    const timeline = container.querySelector('[data-testid="gantt-timeline"]') as HTMLElement;
    timeline.scrollTop = 4000; // rows 94..121 visible
    fireEvent.scroll(timeline);

    const link = container.querySelector('[data-testid="gantt-link-t99-t100"]');
    expect(link).toBeTruthy();
    // Path coordinates use absolute indices: row 99 centre = 99*40+20 = 3980.
    expect(link!.getAttribute('d')).toContain('3980');
  });
});

describe('GanttView column virtualization', () => {
  it('windows day columns across a multi-year range', () => {
    const { container } = render(
      <div style={{ width: 1280, height: 600 }}>
        <GanttView
          tasks={manyTasks(3)}
          startDate={new Date('2024-01-01T00:00:00.000Z')}
          endDate={new Date('2025-12-30T00:00:00.000Z')}
        />
      </div>
    );

    // ~730 day columns exist; only the ~4.2k px window (+overscan) renders.
    const units = container.querySelector('[data-testid="gantt-header-units"]') as HTMLElement;
    expect(units.children.length).toBeGreaterThan(30);
    expect(units.children.length).toBeLessThan(130);
    expect((units.children[0] as HTMLElement).style.left).toBe('0px');

    const timeline = container.querySelector('[data-testid="gantt-timeline"]') as HTMLElement;
    timeline.scrollLeft = 20000;
    fireEvent.scroll(timeline);

    const after = container.querySelector('[data-testid="gantt-header-units"]') as HTMLElement;
    expect(after.children.length).toBeLessThan(130);
    const firstLeft = parseFloat((after.children[0] as HTMLElement).style.left);
    expect(firstLeft).toBeGreaterThan(15000);
    expect(firstLeft).toBeLessThanOrEqual(20000);
  });
});

describe('GanttView fullscreen toggle', () => {
  afterEach(() => {
    delete (HTMLElement.prototype as any).requestFullscreen;
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });

  it('requests fullscreen on the container', () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    (HTMLElement.prototype as any).requestFullscreen = requestFullscreen;
    const { container } = renderView(manyTasks(2));

    fireEvent.click(container.querySelector('[data-testid="gantt-fullscreen"]')!);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('exits when already fullscreen', () => {
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    (document as any).exitFullscreen = exitFullscreen;
    const { container } = renderView(manyTasks(2));
    Object.defineProperty(document, 'fullscreenElement', {
      value: container.firstChild,
      configurable: true,
    });

    fireEvent.click(container.querySelector('[data-testid="gantt-fullscreen"]')!);
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe('GanttView custom markers', () => {
  it('renders in-range markers at the bar mapping, drops out-of-range ones', () => {
    const tasks: GanttTask[] = [{
      id: 'a',
      title: 'Task a',
      start: new Date('2024-06-11T00:00:00.000Z'),
      end: new Date('2024-06-15T00:00:00.000Z'),
      progress: 0,
    }];
    const { container } = renderView(tasks, {
      markers: [
        { date: new Date('2024-06-11T00:00:00.000Z'), label: 'Code freeze', color: '#ef4444' },
        { date: new Date('2030-01-01T00:00:00.000Z'), label: 'Out of range' },
      ],
    });

    const marker = container.querySelector('[data-testid="gantt-marker-0"]') as HTMLElement;
    expect(marker).toBeTruthy();
    expect(marker.textContent).toContain('Code freeze');
    expect(marker.style.backgroundColor).toBe('#ef4444');

    // Same instant as the bar start → same horizontal mapping (±1px rounding).
    const bar = container.querySelector('[data-testid="gantt-task-bar-a"]') as HTMLElement;
    const barLeft = parseFloat(bar.style.left);
    const markerLeft = parseFloat(marker.style.left);
    expect(Math.abs(markerLeft - barLeft)).toBeLessThanOrEqual(1);

    expect(container.querySelector('[data-testid="gantt-marker-1"]')).toBeFalsy();
  });

  it('falls back to the primary theme color', () => {
    const { container } = renderView(manyTasks(1), {
      markers: [{ date: new Date('2024-06-10T00:00:00.000Z') }],
    });
    const marker = container.querySelector('[data-testid="gantt-marker-0"]') as HTMLElement;
    expect(marker.style.backgroundColor).toBe('hsl(var(--primary))');
  });
});
