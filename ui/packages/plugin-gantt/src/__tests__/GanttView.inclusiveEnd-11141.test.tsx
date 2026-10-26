/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11141 — `GanttView` names a bar's END by the day the bar runs
 * through, wherever it prints or edits that end as a day.
 *
 * ── Why the view had to change ──────────────────────────────────────────────
 * A task's `end` is the EXCLUSIVE end of the half-open span `[start, end)`
 * every bar is drawn and scheduled on, and since this card `ObjectGantt` hands
 * a stored date-only end over as the next day's local midnight
 * (`toDisplayEndDate`, `@object-ui/core`), so the bar runs through the day the
 * author wrote. The view printed that instant's own day: the End cell, the row
 * sublabel, the tooltip and a drag's preview read January 16th for a stored
 * `2024-01-15`, and the inline editor was seeded with the 16th, so typing the
 * 20th stored the 19th. They now name the day through `toInclusiveEndDay`, the
 * exact inverse of the read, and the editor commits a typed day's end through
 * `toDisplayEndDate`, so Enter on an untouched row commits the end it had.
 *
 * ── What stays as it was ────────────────────────────────────────────────────
 * An end inside a day (an instant) names that day, as it did; a zero-length
 * span (a milestone) names its own day and its editor commits the typed day's
 * midnight, as every end did before.
 *
 * The suite runs in UTC (`vitest.config.mts` pins `TZ`), so a local midnight
 * here is also the UTC one; the zone pins beside this file drive the read and
 * the write through other zones.
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { GanttView, type GanttTask } from '../GanttView';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

/** The container width: >= 1280 shows the Start / End cells, below it the sublabel (objectui#7204). */
function at(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
}

function task(id: string, start: Date, end: Date): GanttTask {
  return { id, title: `Task ${id}`, start, end, progress: 0 };
}

/** January 1st to 15th, 2024, as `ObjectGantt` hands a stored `2024-01-01` → `2024-01-15` over. */
const THROUGH_15TH = task('a', new Date(2024, 0, 1), new Date(2024, 0, 16));

function renderView(tasks: GanttTask[], props: Partial<React.ComponentProps<typeof GanttView>> = {}, width = 1280) {
  at(width);
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en-US' }}>
        <div style={{ width, height: 600 }}>
          <GanttView
            tasks={tasks}
            startDate={new Date(2023, 11, 25)}
            endDate={new Date(2024, 1, 10)}
            viewMode="day"
            {...props}
          />
        </div>
      </LocalizationProvider>
    </I18nProvider>,
  );
}

const text = (container: HTMLElement, testId: string) =>
  (container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '').trim();

function hoverTooltip(container: HTMLElement, id: string): string {
  const bar = container.querySelector(`[data-testid="gantt-task-bar-${id}"]`) as HTMLElement;
  expect(bar, `no bar ${id}`).toBeTruthy();
  act(() => {
    fireEvent.mouseEnter(bar);
  });
  return text(container, `gantt-tooltip-${id}`);
}

/** Double-click row `id` open in the inline editor; hand back its date inputs. */
function openEditor(container: HTMLElement, id: string) {
  act(() => {
    fireEvent.doubleClick(container.querySelector(`[data-testid="gantt-task-row-${id}"]`)!);
  });
  const start = container.querySelector(`[data-testid="gantt-row-start-${id}"] input`) as HTMLInputElement;
  const end = container.querySelector(`[data-testid="gantt-row-end-${id}"] input`) as HTMLInputElement;
  expect(start, 'the start date input').not.toBeNull();
  expect(end, 'the end date input').not.toBeNull();
  return { start, end };
}

/** Press Enter in the inline editor's title input of row `id`. */
function commit(container: HTMLElement, id: string) {
  const title = container.querySelector(`input[value="Task ${id}"]`) as HTMLInputElement;
  act(() => {
    fireEvent.keyDown(title, { key: 'Enter' });
  });
}

describe('GanttView names an end by the day the bar runs through (objectui#11141)', () => {
  it('the End cell names the 15th for a bar that runs through it, where it read the 16th', () => {
    const { container } = renderView([THROUGH_15TH]);
    // 2024 is not the current year, so each face names it (objectui#12110 item 5).
    expect(text(container, 'gantt-row-start-a')).toBe('1/1/24');
    expect(text(container, 'gantt-row-end-a')).toBe('1/15/24');
  });

  it('the row sublabel does too, below the Start / End threshold', () => {
    const { container } = renderView([THROUGH_15TH], {}, 800);
    expect(text(container, 'gantt-row-dates-a')).toBe('1/1/24 → 1/15/24');
  });

  it('the tooltip names the 15th and counts the fifteen days the bar runs through', () => {
    const { container } = renderView([THROUGH_15TH]);
    const tip = hoverTooltip(container, 'a');
    expect(tip).toContain('Jan 1, 2024 → Jan 15, 2024');
    expect(tip).toContain('· 15');
    expect(tip).not.toContain('Jan 16');
  });

  it('a drag preview names the day the dragged end will be written as', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView([THROUGH_15TH], { onTaskUpdate });
    const bar = container.querySelector('[data-testid="gantt-task-bar-a"]') as HTMLElement;
    const handle = container.querySelector('[data-testid="gantt-task-resize-right-a"]') as HTMLElement;
    const pxPerDay = parseFloat(bar.style.width) / 15;
    const pointer = (type: string, clientX: number) =>
      new PointerEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 100, pointerType: 'mouse', button: 0, isPrimary: true } as PointerEventInit);
    act(() => { handle.dispatchEvent(pointer('pointerdown', 500)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 500 + 2 * pxPerDay)); });
    // Two days on: the bar runs through the 17th, its end is the 18th's midnight.
    expect(bar.textContent).toContain('1/1/24 → 1/17/24');
    act(() => { window.dispatchEvent(pointer('pointerup', 500 + 2 * pxPerDay)); });
    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    expect(onTaskUpdate.mock.calls[0][1].end.getTime()).toBe(new Date(2024, 0, 18).getTime());
  });

  it('control: an end inside a day names that day, as it did', () => {
    const { container } = renderView([task('b', new Date(2024, 0, 1), new Date(2024, 0, 15, 17))]);
    expect(text(container, 'gantt-row-end-b')).toBe('1/15/24');
  });

  it('control: a zero-length span names its own day, not the day before', () => {
    const { container } = renderView([task('m', new Date(2024, 0, 15), new Date(2024, 0, 15))]);
    expect(text(container, 'gantt-row-start-m')).toBe('1/15/24');
    expect(text(container, 'gantt-row-end-m')).toBe('1/15/24');
  });
});

describe('the inline editor edits the day the bar runs through (objectui#11141)', () => {
  it('is seeded with the 15th, and Enter on the untouched row commits the end it had', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView([THROUGH_15TH], { inlineEdit: true, onTaskUpdate });
    const inputs = openEditor(container, 'a');
    expect(inputs.start.value).toBe('2024-01-01');
    expect(inputs.end.value).toBe('2024-01-15');
    commit(container, 'a');
    expect(onTaskUpdate).toHaveBeenCalledTimes(1);
    const changes = onTaskUpdate.mock.calls[0][1];
    expect(changes.start.getTime()).toBe(THROUGH_15TH.start.getTime());
    expect(changes.end.getTime()).toBe(THROUGH_15TH.end.getTime());
  });

  it('typing the 20th commits a bar that runs through the 20th', () => {
    const onTaskUpdate = vi.fn();
    const { container } = renderView([THROUGH_15TH], { inlineEdit: true, onTaskUpdate });
    const inputs = openEditor(container, 'a');
    act(() => {
      fireEvent.change(inputs.end, { target: { value: '2024-01-20' } });
    });
    commit(container, 'a');
    expect(onTaskUpdate.mock.calls[0][1].end.getTime()).toBe(new Date(2024, 0, 21).getTime());
  });

  it('control: a zero-length span is seeded with its own day and commits it unchanged', () => {
    const onTaskUpdate = vi.fn();
    const point = task('m', new Date(2024, 0, 15), new Date(2024, 0, 15));
    const { container } = renderView([point], { inlineEdit: true, onTaskUpdate });
    const inputs = openEditor(container, 'm');
    expect(inputs.end.value).toBe('2024-01-15');
    commit(container, 'm');
    expect(onTaskUpdate.mock.calls[0][1].end.getTime()).toBe(point.end.getTime());
  });
});
