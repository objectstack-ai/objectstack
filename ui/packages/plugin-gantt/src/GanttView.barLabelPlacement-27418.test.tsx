/**
 * #27418 — at phone width a gantt bar carries its title.
 *
 * Measured in Chromium at 390x844 before the fix: a month-view bar is 18px
 * wide, its in-bar title got 0px of room after the bar's `px-2`, and drew
 * nothing — not even an ellipsis; a 31–63px week bar showed an ellipsis and a
 * letter or two. A phone opens with the task list collapsed, so the bar was
 * the only place the title could appear. Now a bar too narrow for its title
 * draws it beside its end, whole; a bar with room keeps the in-bar label.
 *
 * jsdom does no layout, but the bar's width is an inline style computed from
 * the view's column width (`window.innerWidth` stands in for the container),
 * so placement is readable here without a browser.
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';

const LONG_TITLE = 'Q4 Enterprise Product Launch Webinar Series — APAC Region';

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

function makeTask(id: string, title: string, start: string, end: string, extra: Partial<GanttTask> = {}): GanttTask {
  return { id, title, start: new Date(start), end: new Date(end), progress: 0, ...extra };
}

function renderView(tasks: GanttTask[], viewMode: 'day' | 'week' | 'month') {
  return render(
    <div style={{ width: window.innerWidth, height: 600 }}>
      <GanttView
        tasks={tasks}
        viewMode={viewMode}
        startDate={new Date('2026-10-01T00:00:00.000Z')}
        endDate={new Date('2026-12-31T00:00:00.000Z')}
      />
    </div>,
  );
}

function barWidth(container: HTMLElement, id: string) {
  const bar = container.querySelector<HTMLElement>(`[data-testid="gantt-task-bar-${id}"], [data-testid="gantt-summary-bar-${id}"]`);
  return parseFloat(bar?.style.width ?? 'NaN');
}

function label(container: HTMLElement, id: string) {
  const el = container.querySelector<HTMLElement>(`[data-testid="gantt-bar-label-${id}"]`);
  expect(el, `bar ${id} draws a label`).not.toBeNull();
  return el!;
}

describe('a gantt bar carries its title at phone width (#27418)', () => {
  it('draws a narrow bar’s title beside it, whole', () => {
    setWidth(390);
    const { container } = renderView([makeTask('c1', LONG_TITLE, '2026-10-05T00:00:00', '2026-10-09T00:00:00')], 'month');
    // The fixture really is the measured narrow bar, not a wide one.
    expect(barWidth(container, 'c1')).toBeLessThan(40);
    const el = label(container, 'c1');
    expect(el.dataset.placement).toBe('beside');
    expect(el.textContent).toBe(LONG_TITLE);
    // Beside the bar it is never cut: no truncation, one line.
    expect(el.className).not.toMatch(/\btruncate\b/);
    expect(el.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(el.className).toMatch(/\bleft-full\b/);
  });

  it('keeps a short title inside a narrow bar it fits in', () => {
    setWidth(1280);
    const { container } = renderView([makeTask('s', 'QA', '2026-10-05T00:00:00', '2026-10-09T00:00:00')], 'week');
    expect(barWidth(container, 's')).toBeLessThan(16 + 96);
    expect(label(container, 's').dataset.placement).toBe('inside');
  });

  it('keeps a long title inside a bar with room, ending in an ellipsis', () => {
    setWidth(1280);
    const { container } = renderView([makeTask('w', LONG_TITLE, '2026-10-05T00:00:00', '2026-10-09T00:00:00')], 'day');
    expect(barWidth(container, 'w')).toBeGreaterThanOrEqual(16 + 96);
    const el = label(container, 'w');
    expect(el.dataset.placement).toBe('inside');
    expect(el.className).toMatch(/\btruncate\b/);
  });

  it('draws a narrow summary bar’s title beside it too', () => {
    setWidth(390);
    const { container } = renderView(
      [
        makeTask('p', LONG_TITLE, '2026-10-05T00:00:00', '2026-10-06T00:00:00'),
        makeTask('k', 'Child', '2026-10-05T00:00:00', '2026-10-07T00:00:00', { parent: 'p' }),
      ],
      'month',
    );
    const el = label(container, 'p');
    expect(el.dataset.placement).toBe('beside');
    expect(el.textContent).toBe(LONG_TITLE);
  });

  it('ellipsizes a long title in the task list (measured in Chromium, unchanged)', () => {
    // At 390px the title cell measured text-overflow: ellipsis with
    // scrollWidth 356 over clientWidth 91: the cell already ellipsizes. This
    // pins the two classes that reading rests on.
    setWidth(390);
    const { getByTestId } = renderView([makeTask('c1', LONG_TITLE, '2026-10-05T00:00:00', '2026-10-09T00:00:00')], 'month');
    const title = getByTestId('gantt-row-title-c1');
    expect(title.className).toMatch(/\btruncate\b/);
    expect(title.parentElement!.className).toMatch(/\bmin-w-0\b/);
  });
});
