/**
 * Phase 4 interaction tests: progress drag handle, hover tooltip, context
 * menu, keyboard navigation, drag-to-create dependency, row reorder.
 *
 * Conventions match the links/tree tests: innerWidth=1280 → columnWidth 110,
 * rowHeight 40; geometry asserted via inline styles (timezone-safe); window
 * pointer events dispatched inside act().
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

function makeTask(id: string, start: string, end: string, extra: Partial<GanttTask> = {}): GanttTask {
  return {
    id,
    title: `Task ${id}`,
    start: new Date(start),
    end: new Date(end),
    progress: 0,
    ...extra,
  };
}

const A = () => makeTask('a', '2024-06-03T00:00:00.000Z', '2024-06-13T00:00:00.000Z', { progress: 50 });
const B = () => makeTask('b', '2024-06-17T00:00:00.000Z', '2024-06-21T00:00:00.000Z');

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

function pointer(type: string, clientX: number, clientY = 100) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    pointerType: 'mouse',
    button: 0,
    isPrimary: true,
  } as PointerEventInit);
}

describe('GanttView progress drag handle', () => {
  it('dragging the handle commits a snapped progress update', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView([A()], { onTaskUpdate });
    const handle = container.querySelector('[data-testid="gantt-progress-handle-a"]') as HTMLElement;
    expect(handle).toBeTruthy();

    // Bar is 10 days * 110px = 1100px wide; +220px = +20% → 70.
    fireEvent.pointerDown(handle, { button: 0, clientX: 300, clientY: 100 });
    act(() => { window.dispatchEvent(pointer('pointermove', 520)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 520)); });

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [task, changes] = onTaskUpdate.mock.calls[0];
    expect(task.id).toBe('a');
    expect(changes).toEqual({ progress: 70 });
  });

  it('clamps the dragged progress to [0, 100]', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView([A()], { onTaskUpdate });
    const handle = container.querySelector('[data-testid="gantt-progress-handle-a"]') as HTMLElement;

    fireEvent.pointerDown(handle, { button: 0, clientX: 300, clientY: 100 });
    act(() => { window.dispatchEvent(pointer('pointermove', 3000)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 3000)); });

    expect(onTaskUpdate.mock.calls[0][1]).toEqual({ progress: 100 });
  });
});

describe('GanttView hover tooltip', () => {
  it('shows title, duration and progress on bar hover', () => {
    const { container } = renderView([A()]);
    const bar = container.querySelector('[data-testid="gantt-task-bar-a"]') as HTMLElement;
    expect(container.querySelector('[data-testid="gantt-tooltip-a"]')).toBeFalsy();

    fireEvent.mouseEnter(bar);
    const tooltip = container.querySelector('[data-testid="gantt-tooltip-a"]') as HTMLElement;
    expect(tooltip).toBeTruthy();
    expect(tooltip.textContent).toContain('Task a');
    expect(tooltip.textContent).toContain('10d');
    expect(tooltip.textContent).toContain('50%');

    fireEvent.mouseLeave(bar);
    expect(container.querySelector('[data-testid="gantt-tooltip-a"]')).toBeFalsy();
  });
});

describe('GanttView context menu', () => {
  it('opens on right-click and routes Delete / View details', () => {
    const onTaskDelete = vi.fn();
    const onTaskClick = vi.fn();
    const { container } = renderView([A()], { onTaskDelete, onTaskClick });
    const bar = container.querySelector('[data-testid="gantt-task-bar-a"]') as HTMLElement;

    fireEvent.contextMenu(bar, { clientX: 200, clientY: 150 });
    const menu = document.querySelector('[data-testid="gantt-context-menu"]') as HTMLElement;
    expect(menu).toBeTruthy();

    fireEvent.click(menu.querySelector('[data-testid="gantt-context-menu-delete"]')!);
    expect(onTaskDelete).toHaveBeenCalledTimes(1);
    expect(onTaskDelete.mock.calls[0][0].id).toBe('a');
    expect(document.querySelector('[data-testid="gantt-context-menu"]')).toBeFalsy();

    fireEvent.contextMenu(bar, { clientX: 200, clientY: 150 });
    fireEvent.click(document.querySelector('[data-testid="gantt-context-menu-view"]')!);
    expect(onTaskClick).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape without firing actions', () => {
    const onTaskDelete = vi.fn();
    const { container } = renderView([A()], { onTaskDelete });
    fireEvent.contextMenu(container.querySelector('[data-testid="gantt-task-bar-a"]')!, { clientX: 10, clientY: 10 });
    expect(document.querySelector('[data-testid="gantt-context-menu"]')).toBeTruthy();
    // Dispatch through RTL's fireEvent (not a raw synthetic KeyboardEvent) —
    // the Escape listener is on window; mirrors the existing pattern below.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('[data-testid="gantt-context-menu"]')).toBeFalsy();
    expect(onTaskDelete).not.toHaveBeenCalled();
  });
});

describe('GanttView keyboard navigation', () => {
  it('arrows move the selection; Enter opens; Delete deletes', () => {
    const onTaskClick = vi.fn();
    const onTaskDelete = vi.fn();
    const { container } = renderView([A(), B()], { onTaskClick, onTaskDelete });
    const body = container.querySelector('[data-testid="gantt-body"]') as HTMLElement;
    const rowA = container.querySelector('[role="treeitem"][aria-level="1"]') as HTMLElement;
    expect(rowA.getAttribute('aria-selected')).toBe('false');

    fireEvent.keyDown(body, { key: 'ArrowDown' });
    const rows = Array.from(container.querySelectorAll('[role="treeitem"]')) as HTMLElement[];
    expect(rows[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(body, { key: 'ArrowDown' });
    expect(rows[0].getAttribute('aria-selected')).toBe('false');
    expect(rows[1].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(body, { key: 'Enter' });
    expect(onTaskClick).toHaveBeenCalledTimes(1);
    expect(onTaskClick.mock.calls[0][0].id).toBe('b');

    fireEvent.keyDown(body, { key: 'Delete' });
    expect(onTaskDelete).toHaveBeenCalledTimes(1);
    expect(onTaskDelete.mock.calls[0][0].id).toBe('b');
  });

  it('Left/Right arrows collapse and expand a summary row', () => {
    const tasks = [
      makeTask('p', '2024-06-03T00:00:00.000Z', '2024-06-05T00:00:00.000Z'),
      makeTask('c', '2024-06-04T00:00:00.000Z', '2024-06-08T00:00:00.000Z', { parent: 'p' }),
    ];
    const { container } = renderView(tasks);
    const body = container.querySelector('[data-testid="gantt-body"]') as HTMLElement;

    fireEvent.keyDown(body, { key: 'ArrowDown' }); // select p
    expect(container.querySelector('[data-testid="gantt-task-bar-c"]')).toBeTruthy();
    fireEvent.keyDown(body, { key: 'ArrowLeft' }); // collapse
    expect(container.querySelector('[data-testid="gantt-task-bar-c"]')).toBeFalsy();
    fireEvent.keyDown(body, { key: 'ArrowRight' }); // expand
    expect(container.querySelector('[data-testid="gantt-task-bar-c"]')).toBeTruthy();
  });
});

describe('GanttView drag-to-create dependency', () => {
  it('dragging the connector dot onto another bar fires onDependencyCreate', () => {
    const onDependencyCreate = vi.fn();
    const { container } = renderView([A(), B()], { onDependencyCreate });

    const dot = container.querySelector('[data-testid="gantt-link-dot-end-a"]') as HTMLElement;
    expect(dot).toBeTruthy();
    fireEvent.pointerDown(dot, { button: 0, clientX: 600, clientY: 20 });

    // Rubber band renders while dragging.
    act(() => { window.dispatchEvent(pointer('pointermove', 700, 60)); });
    expect(container.querySelector('[data-testid="gantt-link-draft"]')).toBeTruthy();

    // Moving over the target bar registers it as the drop target.
    const barB = container.querySelector('[data-testid="gantt-task-bar-b"]') as HTMLElement;
    fireEvent.pointerMove(barB, { clientX: 980, clientY: 60 });
    act(() => { window.dispatchEvent(pointer('pointerup', 980, 60)); });

    expect(onDependencyCreate).toHaveBeenCalledTimes(1);
    const [source, target, type] = onDependencyCreate.mock.calls[0];
    expect(source.id).toBe('a');
    expect(target.id).toBe('b');
    expect(type).toBe('fs');
    expect(container.querySelector('[data-testid="gantt-link-draft"]')).toBeFalsy();
  });

  it('dragging from the start dot derives a Start-anchored link type', () => {
    const onDependencyCreate = vi.fn();
    const { container } = renderView([A(), B()], { onDependencyCreate });

    const dot = container.querySelector('[data-testid="gantt-link-dot-start-a"]') as HTMLElement;
    expect(dot).toBeTruthy();
    fireEvent.pointerDown(dot, { button: 0, clientX: 600, clientY: 20 });
    act(() => { window.dispatchEvent(pointer('pointermove', 700, 60)); });

    const barB = container.querySelector('[data-testid="gantt-task-bar-b"]') as HTMLElement;
    fireEvent.pointerMove(barB, { clientX: 980, clientY: 60 });
    act(() => { window.dispatchEvent(pointer('pointerup', 980, 60)); });

    expect(onDependencyCreate).toHaveBeenCalledTimes(1);
    const [source, target, type] = onDependencyCreate.mock.calls[0];
    expect(source.id).toBe('a');
    expect(target.id).toBe('b');
    // start source + start target (jsdom rects collapse to zero-width → left half) = ss
    expect(type).toBe('ss');
  });

  it('releasing over empty space creates nothing', () => {
    const onDependencyCreate = vi.fn();
    const { container } = renderView([A(), B()], { onDependencyCreate });
    const dot = container.querySelector('[data-testid="gantt-link-dot-end-a"]') as HTMLElement;

    fireEvent.pointerDown(dot, { button: 0, clientX: 600, clientY: 20 });
    act(() => { window.dispatchEvent(pointer('pointermove', 1100, 30)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 1100, 30)); });

    expect(onDependencyCreate).not.toHaveBeenCalled();
  });
});

describe('GanttView dependency creation guards', () => {
  function dragLink(container: HTMLElement, fromDot: string, toBar: string) {
    const dot = container.querySelector(`[data-testid="${fromDot}"]`) as HTMLElement;
    expect(dot).toBeTruthy();
    fireEvent.pointerDown(dot, { button: 0, clientX: 600, clientY: 20 });
    act(() => { window.dispatchEvent(pointer('pointermove', 700, 60)); });
    const bar = container.querySelector(`[data-testid="${toBar}"]`) as HTMLElement;
    expect(bar).toBeTruthy();
    fireEvent.pointerMove(bar, { clientX: 980, clientY: 60 });
    act(() => { window.dispatchEvent(pointer('pointerup', 980, 60)); });
  }

  it('rejects dropping onto a locked row', () => {
    const onDependencyCreate = vi.fn();
    const lockedB = makeTask('b', '2024-06-17T00:00:00.000Z', '2024-06-21T00:00:00.000Z', { locked: true });
    const { container } = renderView([A(), lockedB], { onDependencyCreate });

    dragLink(container, 'gantt-link-dot-end-a', 'gantt-task-bar-b');
    expect(onDependencyCreate).not.toHaveBeenCalled();
  });

  it('rejects a link that would close a dependency cycle', () => {
    // a already depends on b (edge b→a); dragging a→b would close the loop.
    const onDependencyCreate = vi.fn();
    const a = makeTask('a', '2024-06-03T00:00:00.000Z', '2024-06-13T00:00:00.000Z', { dependencies: ['b'] });
    const { container } = renderView([a, B()], { onDependencyCreate });

    dragLink(container, 'gantt-link-dot-end-a', 'gantt-task-bar-b');
    expect(onDependencyCreate).not.toHaveBeenCalled();
  });

  it('rejects a transitive cycle even when the middle of the chain is collapsed', () => {
    // Chain a→c→d where c lives inside collapsed group p. The rendered links
    // derive from visible rows only, so the a→c and c→d edges vanish from the
    // view — the guard must still block dragging d→a using the full task set.
    const onDependencyCreate = vi.fn();
    const a = makeTask('a', '2024-06-03T00:00:00.000Z', '2024-06-06T00:00:00.000Z');
    const p = makeTask('p', '2024-06-07T00:00:00.000Z', '2024-06-12T00:00:00.000Z');
    const c = makeTask('c', '2024-06-08T00:00:00.000Z', '2024-06-11T00:00:00.000Z', { parent: 'p', dependencies: ['a'] });
    const dTask = makeTask('d', '2024-06-13T00:00:00.000Z', '2024-06-15T00:00:00.000Z', { dependencies: ['c'] });
    const { container } = renderView([a, p, c, dTask], { onDependencyCreate });

    // Collapse p (rows: a, p, c, d → two ArrowDowns select p).
    const body = container.querySelector('[data-testid="gantt-body"]') as HTMLElement;
    fireEvent.keyDown(body, { key: 'ArrowDown' });
    fireEvent.keyDown(body, { key: 'ArrowDown' });
    fireEvent.keyDown(body, { key: 'ArrowLeft' });
    expect(container.querySelector('[data-testid="gantt-task-bar-c"]')).toBeFalsy();

    dragLink(container, 'gantt-link-dot-end-d', 'gantt-task-bar-a');
    expect(onDependencyCreate).not.toHaveBeenCalled();
  });

  it('onBeforeDependencyCreate can veto the link', () => {
    const onDependencyCreate = vi.fn();
    const onBeforeDependencyCreate = vi.fn().mockReturnValue(false);
    const { container } = renderView([A(), B()], { onDependencyCreate, onBeforeDependencyCreate });

    dragLink(container, 'gantt-link-dot-end-a', 'gantt-task-bar-b');
    expect(onBeforeDependencyCreate).toHaveBeenCalledTimes(1);
    const [source, target, type] = onBeforeDependencyCreate.mock.calls[0];
    expect(source.id).toBe('a');
    expect(target.id).toBe('b');
    expect(type).toBe('fs');
    expect(onDependencyCreate).not.toHaveBeenCalled();
  });

  it('onBeforeDependencyCreate returning true lets the link through', () => {
    const onDependencyCreate = vi.fn();
    const onBeforeDependencyCreate = vi.fn().mockReturnValue(true);
    const { container } = renderView([A(), B()], { onDependencyCreate, onBeforeDependencyCreate });

    dragLink(container, 'gantt-link-dot-end-a', 'gantt-task-bar-b');
    expect(onDependencyCreate).toHaveBeenCalledTimes(1);
  });
});

describe('GanttView row drag-to-reorder', () => {
  function makeDataTransfer() {
    const store: Record<string, string> = {};
    return {
      setData: (k: string, v: string) => { store[k] = v; },
      getData: (k: string) => store[k] ?? '',
      effectAllowed: '',
      dropEffect: '',
    };
  }

  it('dropping a row on a sibling fires onTaskReorder', () => {
    const onTaskReorder = vi.fn();
    const { container } = renderView([A(), B()], { onTaskReorder });
    const rows = Array.from(container.querySelectorAll('[role="treeitem"]')) as HTMLElement[];
    expect(rows[0].getAttribute('draggable')).toBe('true');

    const dt = makeDataTransfer();
    fireEvent.dragStart(rows[1], { dataTransfer: dt });
    fireEvent.dragOver(rows[0], { dataTransfer: dt });
    fireEvent.drop(rows[0], { dataTransfer: dt });

    expect(onTaskReorder).toHaveBeenCalledTimes(1);
    const [moved, before] = onTaskReorder.mock.calls[0];
    expect(moved.id).toBe('b');
    expect(before.id).toBe('a');
  });

  it('ignores drops across different parents', () => {
    const onTaskReorder = vi.fn();
    const tasks = [
      makeTask('p', '2024-06-03T00:00:00.000Z', '2024-06-05T00:00:00.000Z'),
      makeTask('c', '2024-06-04T00:00:00.000Z', '2024-06-08T00:00:00.000Z', { parent: 'p' }),
      makeTask('solo', '2024-06-10T00:00:00.000Z', '2024-06-12T00:00:00.000Z'),
    ];
    const { container } = renderView(tasks, { onTaskReorder });
    const rows = Array.from(container.querySelectorAll('[role="treeitem"]')) as HTMLElement[];

    const dt = makeDataTransfer();
    fireEvent.dragStart(rows[1], { dataTransfer: dt }); // c (child of p)
    fireEvent.dragOver(rows[2], { dataTransfer: dt });
    fireEvent.drop(rows[2], { dataTransfer: dt }); // solo (root)

    expect(onTaskReorder).not.toHaveBeenCalled();
  });
});

describe('GanttView dependency link edit (依赖增删 + 类型选择)', () => {
  // B depends on A (a -> b), so a single FS link renders between them.
  const linked = () => [A(), makeTask('b', '2024-06-17T00:00:00.000Z', '2024-06-21T00:00:00.000Z', {
    dependencies: [{ id: 'a', type: 'fs' }],
  })];

  it('renders a clickable hit-path over each link only when editing is enabled', () => {
    const ro = renderView(linked(), {});
    expect(ro.container.querySelector('[data-testid="gantt-link-hit-a-b"]')).toBeFalsy();
    ro.unmount();

    const { container } = renderView(linked(), { onDependencyDelete: vi.fn() });
    expect(container.querySelector('[data-testid="gantt-link-hit-a-b"]')).toBeTruthy();
  });

  it('right-clicking a link opens a menu; 移除依赖 fires onDependencyDelete(source, target)', () => {
    const onDependencyDelete = vi.fn();
    const { container } = renderView(linked(), { onDependencyDelete });

    const hit = container.querySelector('[data-testid="gantt-link-hit-a-b"]')!;
    fireEvent.contextMenu(hit, { clientX: 300, clientY: 120 });
    expect(document.querySelector('[data-testid="gantt-link-context-menu"]')).toBeTruthy();

    fireEvent.click(document.querySelector('[data-testid="gantt-link-menu-remove"]')!);
    expect(onDependencyDelete).toHaveBeenCalledTimes(1);
    const [source, target] = onDependencyDelete.mock.calls[0];
    expect(source.id).toBe('a');
    expect(target.id).toBe('b');
  });

  it('choosing a different link type fires onDependencyCreate with the new type', () => {
    const onDependencyCreate = vi.fn();
    const { container } = renderView(linked(), { onDependencyCreate });

    fireEvent.contextMenu(container.querySelector('[data-testid="gantt-link-hit-a-b"]')!, { clientX: 300, clientY: 120 });
    fireEvent.click(document.querySelector('[data-testid="gantt-link-menu-type-ss"]')!);

    expect(onDependencyCreate).toHaveBeenCalledTimes(1);
    const [source, target, type] = onDependencyCreate.mock.calls[0];
    expect(source.id).toBe('a');
    expect(target.id).toBe('b');
    expect(type).toBe('ss');
  });

  it('re-selecting the current link type is a no-op', () => {
    const onDependencyCreate = vi.fn();
    const { container } = renderView(linked(), { onDependencyCreate });
    fireEvent.contextMenu(container.querySelector('[data-testid="gantt-link-hit-a-b"]')!, { clientX: 300, clientY: 120 });
    fireEvent.click(document.querySelector('[data-testid="gantt-link-menu-type-fs"]')!); // already FS
    expect(onDependencyCreate).not.toHaveBeenCalled();
  });

  it('readOnly hides the link hit-paths and removal entirely', () => {
    const onDependencyDelete = vi.fn();
    const { container } = renderView(linked(), { onDependencyDelete, readOnly: true });
    expect(container.querySelector('[data-testid="gantt-link-hit-a-b"]')).toBeFalsy();
  });
});

describe('GanttView add predecessor/successor (添加紧前/紧后)', () => {
  it('the task menu offers 添加紧前/紧后; picking a candidate links in the right direction', () => {
    const onDependencyCreate = vi.fn();
    const { container } = renderView([A(), B()], { onDependencyCreate });

    // Add-predecessor on B → picked task A becomes a predecessor: a -> b.
    fireEvent.contextMenu(container.querySelector('[data-testid="gantt-task-bar-b"]')!, { clientX: 50, clientY: 50 });
    fireEvent.click(document.querySelector('[data-testid="gantt-context-menu-add-predecessor"]')!);
    expect(document.querySelector('[data-testid="gantt-dep-picker"]')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-testid="gantt-dep-picker-option-a"]')!);

    expect(onDependencyCreate).toHaveBeenCalledTimes(1);
    const [source, target, type] = onDependencyCreate.mock.calls[0];
    expect(source.id).toBe('a'); // predecessor
    expect(target.id).toBe('b');
    expect(type).toBe('fs');
  });

  it('add-successor links the anchor as the predecessor of the picked task', () => {
    const onDependencyCreate = vi.fn();
    const { container } = renderView([A(), B()], { onDependencyCreate });

    fireEvent.contextMenu(container.querySelector('[data-testid="gantt-task-bar-a"]')!, { clientX: 50, clientY: 50 });
    fireEvent.click(document.querySelector('[data-testid="gantt-context-menu-add-successor"]')!);
    fireEvent.click(document.querySelector('[data-testid="gantt-dep-picker-option-b"]')!);

    const [source, target] = onDependencyCreate.mock.calls[0];
    expect(source.id).toBe('a'); // anchor is the predecessor
    expect(target.id).toBe('b');
  });

  it('the picker hides tasks already linked in that direction', () => {
    const onDependencyCreate = vi.fn();
    // b already depends on a; add-predecessor on b must not re-offer a.
    const tasks = [A(), makeTask('b', '2024-06-17T00:00:00.000Z', '2024-06-21T00:00:00.000Z', {
      dependencies: [{ id: 'a', type: 'fs' }],
    })];
    const { container } = renderView(tasks, { onDependencyCreate });
    fireEvent.contextMenu(container.querySelector('[data-testid="gantt-task-bar-b"]')!, { clientX: 50, clientY: 50 });
    fireEvent.click(document.querySelector('[data-testid="gantt-context-menu-add-predecessor"]')!);
    expect(document.querySelector('[data-testid="gantt-dep-picker-option-a"]')).toBeFalsy();
  });

  it('candidates exclude group headers and locked rows but INCLUDE summary rows', () => {
    const onDependencyCreate = vi.fn();
    // Parent-child model (排班计划 → 锁定派工单): the summary parent is the
    // linkable record; the group header and the locked leaf are not.
    const tasks = [
      B(),
      makeTask('s', '2024-06-03T00:00:00.000Z', '2024-06-13T00:00:00.000Z', { type: 'summary' }),
      makeTask('g', '2024-06-03T00:00:00.000Z', '2024-06-13T00:00:00.000Z', { type: 'group' }),
      makeTask('l', '2024-06-03T00:00:00.000Z', '2024-06-13T00:00:00.000Z', { locked: true }),
    ];
    const { container } = renderView(tasks, { onDependencyCreate });
    fireEvent.contextMenu(container.querySelector('[data-testid="gantt-task-bar-b"]')!, { clientX: 50, clientY: 50 });
    fireEvent.click(document.querySelector('[data-testid="gantt-context-menu-add-predecessor"]')!);
    expect(document.querySelector('[data-testid="gantt-dep-picker-option-s"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="gantt-dep-picker-option-g"]')).toBeFalsy();
    expect(document.querySelector('[data-testid="gantt-dep-picker-option-l"]')).toBeFalsy();
  });

  it('the search box filters candidates by title, case-insensitively', () => {
    const onDependencyCreate = vi.fn();
    const tasks = [
      A(), // title 'Task a'
      B(),
      makeTask('c', '2024-06-03T00:00:00.000Z', '2024-06-13T00:00:00.000Z', { title: 'Alpha 质检' }),
    ];
    const { container } = renderView(tasks, { onDependencyCreate });
    fireEvent.contextMenu(container.querySelector('[data-testid="gantt-task-bar-b"]')!, { clientX: 50, clientY: 50 });
    fireEvent.click(document.querySelector('[data-testid="gantt-context-menu-add-predecessor"]')!);

    const search = document.querySelector('[data-testid="gantt-dep-picker-search"]') as HTMLInputElement;
    expect(search).toBeTruthy();
    fireEvent.change(search, { target: { value: 'alpha' } });
    expect(document.querySelector('[data-testid="gantt-dep-picker-option-c"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="gantt-dep-picker-option-a"]')).toBeFalsy();

    // No match → the empty-state row, and picking is still possible after clearing.
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(document.querySelector('[data-testid="gantt-dep-picker-option-c"]')).toBeFalsy();
    fireEvent.change(search, { target: { value: '质检' } });
    fireEvent.click(document.querySelector('[data-testid="gantt-dep-picker-option-c"]')!);
    expect(onDependencyCreate).toHaveBeenCalledTimes(1);
    expect(onDependencyCreate.mock.calls[0][0].id).toBe('c');
  });

  it('a stale search query does not leak into the next picker invocation', () => {
    const onDependencyCreate = vi.fn();
    const { container } = renderView([A(), B()], { onDependencyCreate });
    fireEvent.contextMenu(container.querySelector('[data-testid="gantt-task-bar-b"]')!, { clientX: 50, clientY: 50 });
    fireEvent.click(document.querySelector('[data-testid="gantt-context-menu-add-predecessor"]')!);
    fireEvent.change(document.querySelector('[data-testid="gantt-dep-picker-search"]')!, { target: { value: 'zzz' } });
    expect(document.querySelector('[data-testid="gantt-dep-picker-option-a"]')).toBeFalsy();
    // Close (Escape) and reopen: the full candidate list must be back.
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.contextMenu(container.querySelector('[data-testid="gantt-task-bar-b"]')!, { clientX: 50, clientY: 50 });
    fireEvent.click(document.querySelector('[data-testid="gantt-context-menu-add-predecessor"]')!);
    expect(document.querySelector('[data-testid="gantt-dep-picker-option-a"]')).toBeTruthy();
  });
});

describe('GanttView drag conflict reschedule (拖拽冲突校验 + 顺延确认)', () => {
  // B depends on A (FS): A ends 06-13, B starts 06-17 with a 4-day slack gap.
  const linked = () => [
    A(), // 06-03 → 06-13
    makeTask('b', '2024-06-17T00:00:00.000Z', '2024-06-21T00:00:00.000Z', {
      dependencies: [{ id: 'a', type: 'fs' }],
    }),
  ];

  // Drag a task bar horizontally by whole day-columns (columnWidth=110 at
  // innerWidth=1280). Positive = later, negative = earlier.
  function dragBar(container: HTMLElement, id: string, deltaCols: number) {
    const bar = container.querySelector(`[data-testid="gantt-task-bar-${id}"]`) as HTMLElement;
    const originX = 800;
    fireEvent.pointerDown(bar, { button: 0, clientX: originX, clientY: 100 });
    act(() => { window.dispatchEvent(pointer('pointermove', originX + deltaCols * 110, 100)); });
    act(() => { window.dispatchEvent(pointer('pointerup', originX + deltaCols * 110, 100)); });
  }

  it('dragging a successor before its predecessor finishes prompts 顺延 confirmation', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView(linked(), { onTaskUpdate, rescheduleOnConflict: true });

    // Drag B 6 days earlier → 06-11, which violates the FS link (A ends 06-13).
    dragBar(container, 'b', -6);

    const dialog = container.querySelector('[data-testid="gantt-conflict-dialog"]');
    expect(dialog).toBeTruthy();
    // Exactly one task (B) needs to shift; the body interpolates the count.
    expect(container.querySelector('[data-testid="gantt-conflict-dialog"]')!.textContent).toContain('1');
  });

  it('自动顺延 pushes the dragged task back to satisfy the link', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView(linked(), { onTaskUpdate, rescheduleOnConflict: true });

    dragBar(container, 'b', -6);
    onTaskUpdate.mockClear(); // ignore the drag commit; assert only the reschedule
    fireEvent.click(container.querySelector('[data-testid="gantt-conflict-confirm"]')!);

    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const [task, changes] = onTaskUpdate.mock.calls[0];
    expect(task.id).toBe('b');
    // FS: B must start no earlier than A's finish (06-13).
    expect((changes.start as Date).getTime()).toBe(new Date('2024-06-13T00:00:00.000Z').getTime());
    expect(container.querySelector('[data-testid="gantt-conflict-dialog"]')).toBeFalsy();
  });

  it('取消保留 keeps the manual placement and dismisses the dialog', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView(linked(), { onTaskUpdate, rescheduleOnConflict: true });

    dragBar(container, 'b', -6);
    onTaskUpdate.mockClear();
    fireEvent.click(container.querySelector('[data-testid="gantt-conflict-cancel"]')!);

    expect(onTaskUpdate).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="gantt-conflict-dialog"]')).toBeFalsy();
  });

  it('a move that respects the link does not prompt', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView(linked(), { onTaskUpdate, rescheduleOnConflict: true });

    // Drag B 2 days later → 06-19, still after A's finish: no conflict.
    dragBar(container, 'b', 2);
    expect(container.querySelector('[data-testid="gantt-conflict-dialog"]')).toBeFalsy();
  });

  it('rescheduleOnConflict defaults off → never prompts', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView(linked(), { onTaskUpdate });

    dragBar(container, 'b', -6);
    expect(container.querySelector('[data-testid="gantt-conflict-dialog"]')).toBeFalsy();
  });

  it('readOnly suppresses conflict prompting', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView(linked(), { onTaskUpdate, rescheduleOnConflict: true, readOnly: true });

    dragBar(container, 'b', -6);
    expect(container.querySelector('[data-testid="gantt-conflict-dialog"]')).toBeFalsy();
  });
});
