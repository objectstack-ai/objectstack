/**
 * dependencyTypes:false — data sources that store bare predecessor ids have
 * no slot for a link TYPE, so the link menu must hide the fs/ss/ff/sf
 * switcher (a switch would be silently reverted on refetch) while keeping
 * remove-dependency available.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

const tasks: GanttTask[] = [
  { id: 'a', title: 'Task a', start: new Date('2024-06-05'), end: new Date('2024-06-08'), progress: 0 },
  { id: 'b', title: 'Task b', start: new Date('2024-06-10'), end: new Date('2024-06-12'), progress: 0, dependencies: ['a'] },
];

function openMenu(dependencyTypes: boolean | undefined) {
  const utils = render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={tasks}
        startDate={new Date('2024-06-01')}
        endDate={new Date('2024-06-30')}
        onDependencyCreate={vi.fn()}
        onDependencyDelete={vi.fn()}
        dependencyTypes={dependencyTypes}
      />
    </div>,
  );
  const path = utils.container.querySelector('[data-testid="gantt-link-hit-a-b"]') as SVGPathElement;
  expect(path).toBeTruthy();
  fireEvent.contextMenu(path);
  const menu = utils.container.ownerDocument.querySelector('[data-testid="gantt-link-context-menu"]') as HTMLElement;
  expect(menu).toBeTruthy();
  return menu;
}

describe('dependencyTypes switch', () => {
  it('default: the four type entries render', () => {
    const menu = openMenu(undefined);
    expect(menu.querySelector('[data-testid="gantt-link-menu-type-fs"]')).toBeTruthy();
    expect(menu.querySelector('[data-testid="gantt-link-menu-type-sf"]')).toBeTruthy();
  });

  it('false: type switcher hidden, remove-dependency stays', () => {
    const menu = openMenu(false);
    expect(menu.querySelector('[data-testid="gantt-link-menu-type-fs"]')).toBeFalsy();
    expect(menu.querySelector('[data-testid="gantt-link-menu-type-ss"]')).toBeFalsy();
    expect(menu.querySelector('[data-testid="gantt-link-menu-remove"]')).toBeTruthy();
  });
});
