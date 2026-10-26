/**
 * Dependency-link rendering tests for GanttView.
 *
 * Geometry strategy: positions depend on the local timezone (timelineRange
 * normalizes to local midnight), so instead of asserting absolute pixels we
 * read the bars' inline left/width styles and check the link path's endpoints
 * against them. Path is all M/L commands, so endpoints are the first and last
 * coordinate pairs in the `d` attribute.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { GanttView, type GanttTask, type GanttDependency } from './GanttView';

// Force the container width to >=1024 so columnWidth=110 (deterministic).
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

function makeTask(
  id: string,
  start: string,
  end: string,
  dependencies: GanttDependency[] = [],
): GanttTask {
  return {
    id,
    title: `Task ${id}`,
    start: new Date(start),
    end: new Date(end),
    progress: 0,
    dependencies,
  };
}

function renderView(tasks: GanttTask[]) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={tasks}
        startDate={new Date('2024-06-01T00:00:00.000Z')}
        endDate={new Date('2024-06-30T00:00:00.000Z')}
      />
    </div>
  );
}

function barGeometry(container: HTMLElement, id: string) {
  const bar = container.querySelector(`[data-testid="gantt-task-bar-${id}"]`) as HTMLElement;
  expect(bar).toBeTruthy();
  return {
    left: parseFloat(bar.style.left),
    width: parseFloat(bar.style.width),
  };
}

function pathEndpoints(path: SVGPathElement) {
  const nums = (path.getAttribute('d') || '').match(/-?\d+(\.\d+)?/g)!.map(Number);
  return {
    start: { x: nums[0], y: nums[1] },
    end: { x: nums[nums.length - 2], y: nums[nums.length - 1] },
  };
}

function pointer(type: string, clientX: number) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY: 100,
    pointerType: 'mouse',
    button: 0,
    isPrimary: true,
  } as PointerEventInit);
}

describe('GanttView dependency links', () => {
  it('renders no SVG overlay when no task has dependencies', () => {
    const { container } = renderView([
      makeTask('a', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z'),
      makeTask('b', '2024-06-10T00:00:00.000Z', '2024-06-12T00:00:00.000Z'),
    ]);
    expect(container.querySelector('[data-testid="gantt-links"]')).toBeFalsy();
  });

  it('fs (default): arrow runs from predecessor bar end to dependent bar start', () => {
    const { container } = renderView([
      makeTask('a', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z'),
      makeTask('b', '2024-06-10T00:00:00.000Z', '2024-06-12T00:00:00.000Z', ['a']),
    ]);
    const path = container.querySelector('[data-testid="gantt-link-a-b"]') as SVGPathElement;
    expect(path).toBeTruthy();
    expect(path.getAttribute('data-link-type')).toBe('fs');

    const a = barGeometry(container, 'a');
    const b = barGeometry(container, 'b');
    const { start, end } = pathEndpoints(path);
    // Source anchor: end of bar a, vertical center of row 0 (rowHeight 40).
    expect(start.x).toBeCloseTo(a.left + a.width, 0);
    expect(start.y).toBe(20);
    // Target anchor: start of bar b, vertical center of row 1.
    expect(end.x).toBeCloseTo(b.left, 0);
    expect(end.y).toBe(60);
  });

  it('supports object-form dependencies with explicit link types (ss anchors at starts)', () => {
    const { container } = renderView([
      makeTask('a', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z'),
      makeTask('b', '2024-06-10T00:00:00.000Z', '2024-06-12T00:00:00.000Z', [{ id: 'a', type: 'ss' }]),
    ]);
    const path = container.querySelector('[data-testid="gantt-link-a-b"]') as SVGPathElement;
    expect(path).toBeTruthy();
    expect(path.getAttribute('data-link-type')).toBe('ss');

    const a = barGeometry(container, 'a');
    const b = barGeometry(container, 'b');
    const { start, end } = pathEndpoints(path);
    expect(start.x).toBeCloseTo(a.left, 0);
    expect(end.x).toBeCloseTo(b.left, 0);
  });

  it('ff anchors at both bar ends', () => {
    const { container } = renderView([
      makeTask('a', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z'),
      makeTask('b', '2024-06-10T00:00:00.000Z', '2024-06-12T00:00:00.000Z', [{ id: 'a', type: 'ff' }]),
    ]);
    const path = container.querySelector('[data-testid="gantt-link-a-b"]') as SVGPathElement;
    const a = barGeometry(container, 'a');
    const b = barGeometry(container, 'b');
    const { start, end } = pathEndpoints(path);
    expect(start.x).toBeCloseTo(a.left + a.width, 0);
    expect(end.x).toBeCloseTo(b.left + b.width, 0);
  });

  it('skips dependencies whose id matches no task (and self references)', () => {
    const { container } = renderView([
      makeTask('a', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z', ['a', 'ghost']),
      makeTask('b', '2024-06-10T00:00:00.000Z', '2024-06-12T00:00:00.000Z', ['missing']),
    ]);
    expect(container.querySelector('[data-testid="gantt-links"]')).toBeFalsy();
  });

  it('highlights links attached to the hovered bar', () => {
    const { container } = renderView([
      makeTask('a', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z'),
      makeTask('b', '2024-06-10T00:00:00.000Z', '2024-06-12T00:00:00.000Z', ['a']),
      makeTask('c', '2024-06-14T00:00:00.000Z', '2024-06-16T00:00:00.000Z'),
    ]);
    const link = container.querySelector('[data-testid="gantt-link-a-b"]') as SVGPathElement;
    expect(link.getAttribute('data-active')).toBe('false');

    const barB = container.querySelector('[data-testid="gantt-task-bar-b"]') as HTMLElement;
    fireEvent.mouseEnter(barB);
    expect(link.getAttribute('data-active')).toBe('true');

    fireEvent.mouseLeave(barB);
    expect(link.getAttribute('data-active')).toBe('false');

    // Hovering an unrelated bar must not activate the link.
    const barC = container.querySelector('[data-testid="gantt-task-bar-c"]') as HTMLElement;
    fireEvent.mouseEnter(barC);
    expect(link.getAttribute('data-active')).toBe('false');
  });

  it('recomputes the path live while the dependent bar is dragged', () => {
    const tasks = [
      makeTask('a', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z'),
      makeTask('b', '2024-06-10T00:00:00.000Z', '2024-06-12T00:00:00.000Z', ['a']),
    ];
    const { container } = render(
      <div style={{ width: 1280, height: 600 }}>
        <GanttView
          tasks={tasks}
          startDate={new Date('2024-06-01T00:00:00.000Z')}
          endDate={new Date('2024-06-30T00:00:00.000Z')}
          onTaskUpdate={() => {}}
        />
      </div>
    );
    const path = container.querySelector('[data-testid="gantt-link-a-b"]') as SVGPathElement;
    const before = pathEndpoints(path);

    // Drag bar b +220px = +2 days at columnWidth 110 (don't release yet).
    const barB = container.querySelector('[data-testid="gantt-task-bar-b"]') as HTMLElement;
    act(() => { barB.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 720)); });

    const during = pathEndpoints(
      container.querySelector('[data-testid="gantt-link-a-b"]') as SVGPathElement,
    );
    // Source bar untouched, target anchor follows the drag preview.
    expect(during.start.x).toBeCloseTo(before.start.x, 0);
    expect(during.end.x).toBeCloseTo(before.end.x + 220, 0);

    act(() => { window.dispatchEvent(pointer('pointerup', 720)); });
  });

  it('renders a backward fs link (dependent starts before predecessor ends) without crashing', () => {
    const { container } = renderView([
      makeTask('a', '2024-06-10T00:00:00.000Z', '2024-06-20T00:00:00.000Z'),
      makeTask('b', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z', ['a']),
    ]);
    const path = container.querySelector('[data-testid="gantt-link-a-b"]') as SVGPathElement;
    expect(path).toBeTruthy();
    const a = barGeometry(container, 'a');
    const b = barGeometry(container, 'b');
    const { start, end } = pathEndpoints(path);
    expect(start.x).toBeCloseTo(a.left + a.width, 0);
    expect(end.x).toBeCloseTo(b.left, 0);
    // Detour path has more than the 4 direct-route points.
    const nums = (path.getAttribute('d') || '').match(/-?\d+(\.\d+)?/g)!;
    expect(nums.length).toBeGreaterThan(8);
  });
});
