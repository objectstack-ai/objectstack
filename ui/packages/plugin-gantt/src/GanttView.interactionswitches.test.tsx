/**
 * Interaction switches (交互开关) + onBeforeTaskUpdate veto unit tests.
 *
 * `interactions: { move / resize / progress / link }` — the DHTMLX
 * drag_move/drag_resize/drag_progress/drag_links model: each switch hides one
 * affordance while the others keep working, and only ever narrows what
 * readOnly / row locks already allow. `onBeforeTaskUpdate` is the
 * MS-Project/Bryntum beforeTaskEdit veto on the central commit path.
 */
import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GanttView, type GanttInteractions, type GanttTask } from './GanttView';

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
  progress: 40,
  dependencies: [],
};

function renderView(opts: {
  interactions?: GanttInteractions;
  onTaskUpdate?: (task: GanttTask, changes: any) => void;
  onBeforeTaskUpdate?: (task: GanttTask, changes: any) => boolean | Promise<boolean>;
  onDependencyCreate?: (s: GanttTask, t: GanttTask, ty: any) => void;
}) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={[baseTask]}
        startDate={new Date('2024-06-01T00:00:00.000Z')}
        endDate={new Date('2024-06-30T00:00:00.000Z')}
        onTaskUpdate={opts.onTaskUpdate ?? vi.fn()}
        onBeforeTaskUpdate={opts.onBeforeTaskUpdate}
        onDependencyCreate={opts.onDependencyCreate}
        interactions={opts.interactions}
      />
    </div>
  );
}

describe('interaction switches', () => {
  it('default (no interactions prop): every affordance renders', () => {
    const { container } = renderView({ onDependencyCreate: vi.fn() });
    expect(container.querySelector('[data-testid="gantt-task-resize-left-t1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-progress-handle-t1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-link-dot-end-t1"]')).toBeTruthy();
  });

  it('resize:false hides the grips but the bar still moves', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView({ interactions: { resize: false }, onTaskUpdate });
    expect(container.querySelector('[data-testid="gantt-task-resize-left-t1"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-task-resize-right-t1"]')).toBeFalsy();

    const bar = container.querySelector('[data-testid="gantt-task-bar-t1"]') as HTMLElement;
    act(() => { bar.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 830)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 830)); });
    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [, changes] = onTaskUpdate.mock.calls[0];
    expect(changes.start.toISOString()).toBe('2024-06-13T00:00:00.000Z');
  });

  it('move:false kills body drag but the resize grips still work', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView({ interactions: { move: false }, onTaskUpdate });

    const bar = container.querySelector('[data-testid="gantt-task-bar-t1"]') as HTMLElement;
    act(() => { bar.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 830)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 830)); });
    expect(onTaskUpdate).not.toHaveBeenCalled();

    const handle = container.querySelector('[data-testid="gantt-task-resize-right-t1"]') as HTMLElement;
    expect(handle).toBeTruthy();
    act(() => { handle.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 720)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 720)); });
    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [, changes] = onTaskUpdate.mock.calls[0];
    expect(changes.start.toISOString()).toBe('2024-06-10T00:00:00.000Z');
    expect(changes.end.toISOString()).toBe('2024-06-17T00:00:00.000Z');
  });

  it('progress:false hides the progress handle only', () => {
    const { container } = renderView({ interactions: { progress: false } });
    expect(container.querySelector('[data-testid="gantt-progress-handle-t1"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-task-resize-left-t1"]')).toBeTruthy();
  });

  it('link:false removes the connector dots even with onDependencyCreate', () => {
    const { container } = renderView({
      interactions: { link: false },
      onDependencyCreate: vi.fn(),
    });
    expect(container.querySelector('[data-testid="gantt-link-dot-start-t1"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-link-dot-end-t1"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-task-resize-left-t1"]')).toBeTruthy();
  });
});

describe('onBeforeTaskUpdate veto', () => {
  it('a false veto cancels the update before it reaches onTaskUpdate', async () => {
    const onTaskUpdate = vi.fn();
    const veto = vi.fn().mockResolvedValue(false);
    const { container } = renderView({ onTaskUpdate, onBeforeTaskUpdate: veto });

    const bar = container.querySelector('[data-testid="gantt-task-bar-t1"]') as HTMLElement;
    act(() => { bar.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 830)); });
    await act(async () => { window.dispatchEvent(pointer('pointerup', 830)); });

    expect(veto).toHaveBeenCalledTimes(1);
    expect(veto.mock.calls[0][0].id).toBe('t1');
    expect(onTaskUpdate).not.toHaveBeenCalled();
  });

  it('a true veto lets the update through unchanged', async () => {
    const onTaskUpdate = vi.fn();
    const veto = vi.fn().mockResolvedValue(true);
    const { container } = renderView({ onTaskUpdate, onBeforeTaskUpdate: veto });

    const bar = container.querySelector('[data-testid="gantt-task-bar-t1"]') as HTMLElement;
    act(() => { bar.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 830)); });
    await act(async () => { window.dispatchEvent(pointer('pointerup', 830)); });

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [, changes] = onTaskUpdate.mock.calls[0];
    expect(changes.start.toISOString()).toBe('2024-06-13T00:00:00.000Z');
  });

  it('a throwing veto is treated as false (fail-closed)', async () => {
    const onTaskUpdate = vi.fn();
    const veto = vi.fn().mockRejectedValue(new Error('boom'));
    const { container } = renderView({ onTaskUpdate, onBeforeTaskUpdate: veto });

    const bar = container.querySelector('[data-testid="gantt-task-bar-t1"]') as HTMLElement;
    act(() => { bar.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 830)); });
    await act(async () => { window.dispatchEvent(pointer('pointerup', 830)); });

    expect(onTaskUpdate).not.toHaveBeenCalled();
  });
});
