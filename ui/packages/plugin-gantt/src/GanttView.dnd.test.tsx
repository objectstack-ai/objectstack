/**
 * Drag-and-drop unit tests for GanttView.
 *
 * Verifies that pointer-event-driven drag on a task bar (move + resize-left
 * + resize-right) calls onTaskUpdate with correctly snapped start/end dates.
 *
 * Strategy: render with a fixed timelineRange so columnWidth math is
 * predictable, then dispatch native PointerEvents (jsdom supports them) on
 * the bar / resize handles and on the window for move/up.
 */
import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GanttView, resolveBarDragMode, type GanttTask } from './GanttView';

// Force the container width to >=1024 so columnWidth=110 (deterministic).
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

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

const baseTask: GanttTask = {
  id: 't1',
  title: 'Demo task',
  start: new Date('2024-06-10T00:00:00.000Z'),
  end: new Date('2024-06-15T00:00:00.000Z'),
  progress: 0,
  dependencies: [],
};

function renderView(onTaskUpdate?: (task: GanttTask, changes: any) => void) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={[baseTask]}
        startDate={new Date('2024-06-01T00:00:00.000Z')}
        endDate={new Date('2024-06-30T00:00:00.000Z')}
        onTaskUpdate={onTaskUpdate}
      />
    </div>
  );
}

describe('GanttView drag-and-drop', () => {
  it('renders the bar with a stable test id and does NOT attach drag without onTaskUpdate', () => {
    const { container } = renderView(undefined);
    const bar = container.querySelector('[data-testid="gantt-task-bar-t1"]') as HTMLElement;
    expect(bar).toBeTruthy();
    // No resize handles when drag disabled
    expect(container.querySelector('[data-testid="gantt-task-resize-left-t1"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-task-resize-right-t1"]')).toBeFalsy();
  });

  it('move: dragging the bar body shifts both start AND end by the snapped day delta', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView(onTaskUpdate);
    const bar = container.querySelector('[data-testid="gantt-task-bar-t1"]') as HTMLElement;
    expect(bar).toBeTruthy();

    // columnWidth at width>=1024 = 110. Drag +330px → +3 days.
    act(() => {
      bar.dispatchEvent(pointer('pointerdown', 500));
    });
    act(() => {
      window.dispatchEvent(pointer('pointermove', 830));
    });
    act(() => {
      window.dispatchEvent(pointer('pointerup', 830));
    });

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [task, changes] = onTaskUpdate.mock.calls[0];
    expect(task.id).toBe('t1');
    expect(changes.start.toISOString()).toBe('2024-06-13T00:00:00.000Z');
    expect(changes.end.toISOString()).toBe('2024-06-18T00:00:00.000Z');
  });

  it('resize-right: dragging the right handle shifts ONLY end', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView(onTaskUpdate);
    const handle = container.querySelector('[data-testid="gantt-task-resize-right-t1"]') as HTMLElement;
    expect(handle).toBeTruthy();

    act(() => { handle.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 720)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 720)); });

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [, changes] = onTaskUpdate.mock.calls[0];
    // start unchanged
    expect(changes.start.toISOString()).toBe('2024-06-10T00:00:00.000Z');
    // end shifted +220px / 110 = +2 days
    expect(changes.end.toISOString()).toBe('2024-06-17T00:00:00.000Z');
  });

  it('resize-left: dragging the left handle shifts ONLY start', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView(onTaskUpdate);
    const handle = container.querySelector('[data-testid="gantt-task-resize-left-t1"]') as HTMLElement;
    expect(handle).toBeTruthy();

    act(() => { handle.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 280)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 280)); });

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [, changes] = onTaskUpdate.mock.calls[0];
    // start shifted -220px / 110 = -2 days
    expect(changes.start.toISOString()).toBe('2024-06-08T00:00:00.000Z');
    // end unchanged
    expect(changes.end.toISOString()).toBe('2024-06-15T00:00:00.000Z');
  });

  it('resize-left clamps so start never goes past end (min 1 day duration)', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView(onTaskUpdate);
    const handle = container.querySelector('[data-testid="gantt-task-resize-left-t1"]') as HTMLElement;
    // Try to drag start +1100px (10 days) — would put it 5 days past end.
    act(() => { handle.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 1600)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 1600)); });

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [, changes] = onTaskUpdate.mock.calls[0];
    // Clamped: start should be exactly 1 day before end (2024-06-14)
    expect(changes.start.toISOString()).toBe('2024-06-14T00:00:00.000Z');
    expect(changes.end.toISOString()).toBe('2024-06-15T00:00:00.000Z');
  });

  it('drag with zero net movement does NOT call onTaskUpdate', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView(onTaskUpdate);
    const bar = container.querySelector('[data-testid="gantt-task-bar-t1"]') as HTMLElement;
    act(() => { bar.dispatchEvent(pointer('pointerdown', 500)); });
    // Move <30px — rounds to 0 days at columnWidth=110.
    act(() => { window.dispatchEvent(pointer('pointermove', 510)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 510)); });
    expect(onTaskUpdate).not.toHaveBeenCalled();
  });
});

describe('resolveBarDragMode (edge-zone hit detection)', () => {
  const rect = { left: 100, width: 110 };

  it('resizes the left edge within RESIZE_EDGE_PX of the start', () => {
    expect(resolveBarDragMode(100, rect)).toBe('resize-left'); // exact edge
    expect(resolveBarDragMode(107, rect)).toBe('resize-left'); // 7px in
  });

  it('resizes the right edge within RESIZE_EDGE_PX of the end', () => {
    expect(resolveBarDragMode(210, rect)).toBe('resize-right'); // exact edge
    expect(resolveBarDragMode(203, rect)).toBe('resize-right'); // 7px from end
  });

  it('moves when the pointer is in the middle band', () => {
    expect(resolveBarDragMode(155, rect)).toBe('move');
    expect(resolveBarDragMode(120, rect)).toBe('move'); // 20px in — past the edge
  });

  it('falls back to move for an unlaid-out bar (jsdom zero rect)', () => {
    expect(resolveBarDragMode(500, { left: 0, width: 0 })).toBe('move');
  });

  it('never lets the two edge bands overlap on a very short bar', () => {
    // width 12 → edge clamps to 4px each; the middle stays grabbable.
    const tiny = { left: 0, width: 12 };
    expect(resolveBarDragMode(3, tiny)).toBe('resize-left');
    expect(resolveBarDragMode(9, tiny)).toBe('resize-right');
    expect(resolveBarDragMode(6, tiny)).toBe('move');
  });
});

describe('GanttView bar-edge resize (laid-out hit detection)', () => {
  // jsdom returns a zero-size rect for every element, so drive the layout-aware
  // path by stubbing the bar's client rect the way a real (headless) browser
  // reports it: a 110px-wide bar starting at x=100.
  function renderWithLaidOutBar(onTaskUpdate: (t: GanttTask, c: any) => void) {
    const { container } = renderView(onTaskUpdate);
    const bar = container.querySelector('[data-testid="gantt-task-bar-t1"]') as HTMLElement;
    bar.getBoundingClientRect = () =>
      ({ left: 100, right: 210, width: 110, top: 100, bottom: 127, x: 100, y: 100, height: 27, toJSON() {} }) as DOMRect;
    return { container, bar };
  }

  it('pointerdown near the left edge resizes start only (not a move)', () => {
    const onTaskUpdate = vi.fn();
    const { bar } = renderWithLaidOutBar(onTaskUpdate);

    act(() => { bar.dispatchEvent(pointer('pointerdown', 104)); }); // 4px from left edge
    act(() => { window.dispatchEvent(pointer('pointermove', -116)); }); // -220px → -2 days
    act(() => { window.dispatchEvent(pointer('pointerup', -116)); });

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [, changes] = onTaskUpdate.mock.calls[0];
    expect(changes.start.toISOString()).toBe('2024-06-08T00:00:00.000Z');
    expect(changes.end.toISOString()).toBe('2024-06-15T00:00:00.000Z'); // unchanged
  });

  it('pointerdown near the right edge resizes end only (not a move)', () => {
    const onTaskUpdate = vi.fn();
    const { bar } = renderWithLaidOutBar(onTaskUpdate);

    act(() => { bar.dispatchEvent(pointer('pointerdown', 206)); }); // 4px from right edge
    act(() => { window.dispatchEvent(pointer('pointermove', 426)); }); // +220px → +2 days
    act(() => { window.dispatchEvent(pointer('pointerup', 426)); });

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [, changes] = onTaskUpdate.mock.calls[0];
    expect(changes.start.toISOString()).toBe('2024-06-10T00:00:00.000Z'); // unchanged
    expect(changes.end.toISOString()).toBe('2024-06-17T00:00:00.000Z');
  });

  it('pointerdown in the middle still moves the whole bar', () => {
    const onTaskUpdate = vi.fn();
    const { bar } = renderWithLaidOutBar(onTaskUpdate);

    act(() => { bar.dispatchEvent(pointer('pointerdown', 155)); }); // center
    act(() => { window.dispatchEvent(pointer('pointermove', 485)); }); // +330px → +3 days
    act(() => { window.dispatchEvent(pointer('pointerup', 485)); });

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [, changes] = onTaskUpdate.mock.calls[0];
    expect(changes.start.toISOString()).toBe('2024-06-13T00:00:00.000Z');
    expect(changes.end.toISOString()).toBe('2024-06-18T00:00:00.000Z');
  });
});

describe('GanttView read-only mode', () => {
  function renderReadOnly(onTaskUpdate: (task: GanttTask, changes: any) => void) {
    return render(
      <div style={{ width: 1280, height: 600 }}>
        <GanttView
          tasks={[baseTask]}
          startDate={new Date('2024-06-01T00:00:00.000Z')}
          endDate={new Date('2024-06-30T00:00:00.000Z')}
          onTaskUpdate={onTaskUpdate}
          onTaskDelete={() => {}}
          inlineEdit
          autoSchedule
          readOnly
        />
      </div>
    );
  }

  it('renders the bar but attaches NO drag affordances even though onTaskUpdate is passed', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderReadOnly(onTaskUpdate);
    expect(container.querySelector('[data-testid="gantt-task-bar-t1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-task-resize-left-t1"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-task-resize-right-t1"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-progress-handle-t1"]')).toBeFalsy();
  });

  it('dragging the bar body does NOT emit updates in read-only mode', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderReadOnly(onTaskUpdate);
    const bar = container.querySelector('[data-testid="gantt-task-bar-t1"]') as HTMLElement;
    act(() => { bar.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 680)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 680)); });
    expect(onTaskUpdate).not.toHaveBeenCalled();
  });

  it('hides the Undo / Redo and auto-schedule toolbar buttons', () => {
    const { container } = renderReadOnly(vi.fn());
    expect(container.querySelector('[data-testid="gantt-undo"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-redo"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-auto-schedule"]')).toBeFalsy();
  });
});

describe('GanttView summary group drag', () => {
  const FAMILY: GanttTask[] = [
    {
      id: 'p',
      title: 'Parent',
      start: new Date('2024-06-10T00:00:00.000Z'),
      end: new Date('2024-06-15T00:00:00.000Z'),
      progress: 0,
    },
    {
      id: 'c1',
      title: 'Child 1',
      start: new Date('2024-06-10T00:00:00.000Z'),
      end: new Date('2024-06-12T00:00:00.000Z'),
      progress: 0,
      parent: 'p',
    },
    {
      id: 'c2',
      title: 'Child 2',
      start: new Date('2024-06-13T00:00:00.000Z'),
      end: new Date('2024-06-15T00:00:00.000Z'),
      progress: 0,
      parent: 'p',
    },
    {
      id: 'gc',
      title: 'Grandchild milestone',
      start: new Date('2024-06-14T00:00:00.000Z'),
      end: new Date('2024-06-14T00:00:00.000Z'),
      progress: 0,
      parent: 'c2',
    },
  ];

  function renderFamily(onTaskUpdate: (task: GanttTask, changes: any) => void) {
    return render(
      <div style={{ width: 1280, height: 600 }}>
        <GanttView
          tasks={FAMILY}
          startDate={new Date('2024-06-01T00:00:00.000Z')}
          endDate={new Date('2024-06-30T00:00:00.000Z')}
          onTaskUpdate={onTaskUpdate}
        />
      </div>
    );
  }

  it('dragging the summary bracket shifts the summary AND every descendant by the same delta', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderFamily(onTaskUpdate);
    const bracket = container.querySelector('[data-testid="gantt-summary-bar-p"]') as HTMLElement;
    expect(bracket).toBeTruthy();

    // +220px → +2 days at columnWidth 110.
    act(() => { bracket.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 720)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 720)); });

    // Summary + c1 + c2 + grandchild — one update each, all shifted +2 days
    // with durations preserved.
    expect(onTaskUpdate).toHaveBeenCalledTimes(4);
    const byId = new Map(
      onTaskUpdate.mock.calls.map(([task, changes]) => [String(task.id), changes])
    );
    expect([...byId.keys()].sort()).toEqual(['c1', 'c2', 'gc', 'p']);
    expect(byId.get('c1').start.toISOString()).toBe('2024-06-12T00:00:00.000Z');
    expect(byId.get('c1').end.toISOString()).toBe('2024-06-14T00:00:00.000Z');
    expect(byId.get('c2').start.toISOString()).toBe('2024-06-15T00:00:00.000Z');
    expect(byId.get('c2').end.toISOString()).toBe('2024-06-17T00:00:00.000Z');
    expect(byId.get('gc').start.toISOString()).toBe('2024-06-16T00:00:00.000Z');
    expect(byId.get('gc').end.toISOString()).toBe('2024-06-16T00:00:00.000Z');
    expect(byId.get('p').start.toISOString()).toBe('2024-06-12T00:00:00.000Z');
    expect(byId.get('p').end.toISOString()).toBe('2024-06-17T00:00:00.000Z');
  });

  it('summary drag skips locked descendants — they are neither previewed nor committed', () => {
    const onTaskUpdate = vi.fn();
    const family = FAMILY.map((t) => (t.id === 'c1' ? { ...t, locked: true } : t));
    const { container } = render(
      <div style={{ width: 1280, height: 600 }}>
        <GanttView
          tasks={family}
          startDate={new Date('2024-06-01T00:00:00.000Z')}
          endDate={new Date('2024-06-30T00:00:00.000Z')}
          onTaskUpdate={onTaskUpdate}
        />
      </div>
    );
    const bracket = container.querySelector('[data-testid="gantt-summary-bar-p"]') as HTMLElement;

    // +220px → +2 days at columnWidth 110.
    act(() => { bracket.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 720)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 720)); });

    // Summary + c2 + grandchild shift; locked c1 gets NO update at all.
    expect(onTaskUpdate).toHaveBeenCalledTimes(3);
    const ids = onTaskUpdate.mock.calls.map(([task]) => String(task.id)).sort();
    expect(ids).toEqual(['c2', 'gc', 'p']);
  });

  it('summary drag with zero net movement does not emit updates', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderFamily(onTaskUpdate);
    const bracket = container.querySelector('[data-testid="gantt-summary-bar-p"]') as HTMLElement;
    act(() => { bracket.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 510)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 510)); });
    expect(onTaskUpdate).not.toHaveBeenCalled();
  });

  it('moving a child past the parent edge widens the summary bracket via rollup', () => {
    // Stateful wrapper: apply updates so the rollup recomputes like a real
    // app. No grandchild here — c2 must stay a leaf bar to be draggable.
    const FLAT_FAMILY = FAMILY.slice(0, 3);
    function Stateful() {
      const [tasks, setTasks] = React.useState(FLAT_FAMILY);
      return (
        <div style={{ width: 1280, height: 600 }}>
          <GanttView
            tasks={tasks}
            startDate={new Date('2024-06-01T00:00:00.000Z')}
            endDate={new Date('2024-06-30T00:00:00.000Z')}
            onTaskUpdate={(task, changes) =>
              setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...changes } : t)))
            }
          />
        </div>
      );
    }
    const { container } = render(<Stateful />);
    const bracket = () => container.querySelector('[data-testid="gantt-summary-bar-p"]') as HTMLElement;
    const before = {
      left: parseFloat(bracket().style.left),
      width: parseFloat(bracket().style.width),
    };

    // Drag c2 (the latest child) +330px → +3 days past the parent's end.
    const bar = container.querySelector('[data-testid="gantt-task-bar-c2"]') as HTMLElement;
    act(() => { bar.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 830)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 830)); });

    const after = {
      left: parseFloat(bracket().style.left),
      width: parseFloat(bracket().style.width),
    };
    // Parent start is still c1's start; parent end follows c2 → +3 days wider.
    expect(after.left).toBeCloseTo(before.left, 0);
    expect(after.width).toBeCloseTo(before.width + 3 * 110, 0);
  });
});
