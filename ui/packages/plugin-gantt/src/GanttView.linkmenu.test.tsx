/**
 * Dependency-link context menu vs locked rows (#2473 第 3 项).
 *
 * Every action in the link menu (change type / remove) rewrites the TARGET
 * (successor) record's dependencies field. When that record is locked the
 * server rejects the write anyway — the menu must render read-only up front:
 * lock hint shown, all items disabled, callbacks never invoked.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

function makeTasks(targetLocked: boolean): GanttTask[] {
  return [
    {
      id: 'a',
      title: 'Task a',
      start: new Date('2024-06-05T00:00:00.000Z'),
      end: new Date('2024-06-08T00:00:00.000Z'),
      progress: 0,
    },
    {
      id: 'b',
      title: 'Task b',
      start: new Date('2024-06-10T00:00:00.000Z'),
      end: new Date('2024-06-12T00:00:00.000Z'),
      progress: 0,
      dependencies: ['a'],
      locked: targetLocked,
    },
  ];
}

function openLinkMenu(targetLocked: boolean) {
  const onDependencyCreate = vi.fn();
  const onDependencyDelete = vi.fn();
  const utils = render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={makeTasks(targetLocked)}
        startDate={new Date('2024-06-01T00:00:00.000Z')}
        endDate={new Date('2024-06-30T00:00:00.000Z')}
        onDependencyCreate={onDependencyCreate}
        onDependencyDelete={onDependencyDelete}
      />
    </div>,
  );
  // The context menu handler lives on the invisible wide hit-path, not the
  // visible stroke (see the `gantt-link-hit-*` overlay in GanttView).
  const path = utils.container.querySelector('[data-testid="gantt-link-hit-a-b"]') as SVGPathElement;
  expect(path).toBeTruthy();
  fireEvent.contextMenu(path);
  const menu = utils.container.ownerDocument.querySelector('[data-testid="gantt-link-context-menu"]') as HTMLElement;
  expect(menu).toBeTruthy();
  return { ...utils, menu, onDependencyCreate, onDependencyDelete };
}

describe('GanttView link context menu vs locked target', () => {
  it('unlocked target: no lock hint, items enabled, callbacks fire', () => {
    const { menu, onDependencyCreate, onDependencyDelete } = openLinkMenu(false);

    expect(menu.querySelector('[data-testid="gantt-link-menu-locked"]')).toBeFalsy();

    const ssBtn = menu.querySelector('[data-testid="gantt-link-menu-type-ss"]') as HTMLButtonElement;
    expect(ssBtn.disabled).toBe(false);
    fireEvent.click(ssBtn);
    expect(onDependencyCreate).toHaveBeenCalledTimes(1);
    expect(onDependencyCreate.mock.calls[0][2]).toBe('ss');

    // Menu closed after the click — reopen for the remove action.
    const { menu: menu2, onDependencyDelete: del2 } = openLinkMenu(false);
    const removeBtn = menu2.querySelector('[data-testid="gantt-link-menu-remove"]') as HTMLButtonElement;
    expect(removeBtn.disabled).toBe(false);
    fireEvent.click(removeBtn);
    expect(del2).toHaveBeenCalledTimes(1);
    void onDependencyDelete;
  });

  it('locked target: lock hint shown, every item disabled, no callback fires', () => {
    const { menu, onDependencyCreate, onDependencyDelete } = openLinkMenu(true);

    expect(menu.querySelector('[data-testid="gantt-link-menu-locked"]')).toBeTruthy();

    for (const lt of ['fs', 'ss', 'ff', 'sf']) {
      const btn = menu.querySelector(`[data-testid="gantt-link-menu-type-${lt}"]`) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      fireEvent.click(btn);
    }
    const removeBtn = menu.querySelector('[data-testid="gantt-link-menu-remove"]') as HTMLButtonElement;
    expect(removeBtn.disabled).toBe(true);
    fireEvent.click(removeBtn);

    expect(onDependencyCreate).not.toHaveBeenCalled();
    expect(onDependencyDelete).not.toHaveBeenCalled();
  });
});
