/**
 * Spike step (f): a gantt view over an external object served by a plugin
 * driver — `parentField`, `lockField` and `dependenciesField` — renders the
 * tree, and a drag issues the update.
 *
 * The server half is `packages/runtime/src/plugin-driver-external-object.spike.test.ts`:
 * there the same `spike_node` object is booted on a plugin driver, its list
 * read reaches the driver, and `PATCH /data/spike_node/:id` reaches the
 * `beforeUpdate` hook and then `driver.update`. This file starts from the
 * records that read serves (the formula `locked` already computed per caller)
 * and ends at the `dataSource.update` call the console's adapter turns into
 * that PATCH (`ObjectStackAdapter.update` → `client.data.update`, whose
 * `PATCH /data/:object/:id` is pinned in `packages/client/src/client.test.ts`).
 *
 * The real `GanttView`, not a probe: what is asserted is the rendered tree,
 * the lock on the rendered bar, and the write a pointer drag produces.
 */
import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectGantt, type ObjectGanttHandoff } from './ObjectGantt';
import type { DataSource } from '@object-ui/types';

// Force the container width to >=1024 so the day column is 110px (deterministic).
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

/** The plan as `GET /data/spike_node` serves it to the planner: `locked` is the per-caller formula. */
const RECORDS = [
  { id: 'n_root', name: 'Line A', parent: null, start_date: '2026-11-02', end_date: '2026-11-20', depends_on: null, plan_locked: false, locked: false },
  { id: 'n_cut', name: 'Cut', parent: 'n_root', start_date: '2026-11-02', end_date: '2026-11-06', depends_on: null, plan_locked: false, locked: false },
  { id: 'n_weld', name: 'Weld', parent: 'n_root', start_date: '2026-11-09', end_date: '2026-11-13', depends_on: 'n_cut', plan_locked: true, locked: true },
];

const SCHEMA: ObjectGanttHandoff = {
  type: 'object-gantt',
  objectName: 'spike_node',
  gantt: {
    titleField: 'name',
    startDateField: 'start_date',
    endDateField: 'end_date',
    parentField: 'parent',
    lockField: 'locked',
    dependenciesField: 'depends_on',
  },
  data: { provider: 'object', object: 'spike_node' },
};

function makeDataSource(): DataSource {
  return {
    find: vi.fn().mockResolvedValue({ data: RECORDS }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'spike_node',
      fields: {
        name: { type: 'text' },
        parent: { type: 'lookup', reference: 'spike_node' },
        start_date: { type: 'date' },
        end_date: { type: 'date' },
        depends_on: { type: 'text' },
        plan_locked: { type: 'boolean' },
        locked: { type: 'formula' },
      },
    }),
  } as unknown as DataSource;
}

async function renderPlan() {
  const ds = makeDataSource();
  const view = render(
    <div style={{ width: 1280, height: 600 }}>
      <ObjectGantt schema={SCHEMA} dataSource={ds} />
    </div>,
  );
  await waitFor(() => expect(view.container.querySelector('[data-testid="gantt-task-bar-n_cut"]')).toBeTruthy());
  return { ds, container: view.container };
}

describe('spike (f) — a gantt over an external object: tree, lock, drag', () => {
  it('reads the plan from the object and renders the tree: the parent as a summary bar, the children as task bars, the dependency as a link', async () => {
    const { ds, container } = await renderPlan();
    expect(ds.find).toHaveBeenCalledWith('spike_node', expect.anything());
    expect(container.querySelector('[data-testid="gantt-summary-bar-n_root"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-task-bar-n_cut"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-task-bar-n_weld"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-link-n_cut-n_weld"]')).toBeTruthy();
  });

  it('a node the formula locks offers no resize grips; an unlocked one does', async () => {
    const { container } = await renderPlan();
    expect(container.querySelector('[data-testid="gantt-task-resize-right-n_cut"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-task-resize-right-n_weld"]')).toBeFalsy();
  });

  it('dragging an unlocked bar writes the new dates through `dataSource.update` on the object, by record id', async () => {
    const { ds, container } = await renderPlan();
    const bar = container.querySelector('[data-testid="gantt-task-bar-n_cut"]') as HTMLElement;

    // +330px at 110px a day → +3 days.
    act(() => { bar.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 830)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 830)); });

    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update).toHaveBeenCalledWith('spike_node', 'n_cut', { start_date: '2026-11-05', end_date: '2026-11-09' });
  });

  it('dragging a locked bar writes nothing', async () => {
    const { ds, container } = await renderPlan();
    const bar = container.querySelector('[data-testid="gantt-task-bar-n_weld"]') as HTMLElement;

    act(() => { bar.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 830)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 830)); });

    // Give a write that should not happen the same chance to land.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ds.update).not.toHaveBeenCalled();
  });
});
