/**
 * objectui#7228 — the timeline column width is a FLAT FLOOR, not a
 * container-width curve.
 *
 * `columnWidthForContainer` was a three-arm breakpoint table whose three arms
 * all returned 110. It read as a live responsive policy — its siblings
 * `taskListWidthForContainer` and `showStartEndColumns` branch on the SAME
 * breakpoints and really do vary — and it was inert. The arms are gone; the
 * value every one of them returned is now the module constant `BASE_COLUMN_W`.
 *
 * Nothing pinned that before. Every sibling suite that reads a column width
 * first forces `innerWidth` to 1280 "so columnWidth=110 (deterministic)",
 * which pins the widest arm only — so neither direction of drift would have
 * been caught: re-curving the width per container, or moving the floor.
 *
 * These pins read the rendered day-column width on BOTH SIDES of the two
 * retired breakpoints (640 and 1024) and require a single value across all of
 * them. Assertions are about the DOM, never about computed style.
 *
 * Conventions match the sibling suites: the container width is jsdom's
 * `window.innerWidth` (`useResizeObserver` measures 0 without layout, so
 * `effectiveWidth` falls back to it), and an explicit `endDate` keeps the
 * fit-stretch out of the reading — `fitColumnWidth` returns null outright for
 * a caller-pinned window, so the rendered width is exactly the base.
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';

/** The floor, as the source states it. */
const BASE_COLUMN_W = 110;

/**
 * Both sides of each retired breakpoint. 639/640 and 1023/1024 are the exact
 * pairs the old table branched on, so a restored curve cannot pass here.
 */
const CONTAINER_WIDTHS = [320, 500, 639, 640, 800, 1023, 1024, 1280, 1920];

const TASKS: GanttTask[] = [
  {
    id: 'a',
    title: 'Task a',
    start: new Date('2024-06-03T00:00:00.000Z'),
    end: new Date('2024-06-13T00:00:00.000Z'),
    progress: 0,
  },
];

function renderAt(containerWidth: number) {
  Object.defineProperty(window, 'innerWidth', { value: containerWidth, configurable: true });
  return render(
    <div style={{ width: containerWidth, height: 600 }}>
      <GanttView
        tasks={TASKS}
        startDate={new Date('2024-06-01T00:00:00.000Z')}
        endDate={new Date('2024-06-30T00:00:00.000Z')}
      />
    </div>
  );
}

/** Width of the first day column, read off the header's unit cells. */
function firstUnitWidth(container: HTMLElement): number {
  const units = Array.from(
    container.querySelectorAll('[data-testid="gantt-header-units"] > div'),
  ) as HTMLElement[];
  expect(units.length).toBeGreaterThan(0);
  return parseFloat(units[0].style.width);
}

afterEach(() => {
  cleanup();
});

describe('GanttView timeline column width (objectui#7228)', () => {
  for (const width of CONTAINER_WIDTHS) {
    it(`renders a ${BASE_COLUMN_W}px day column in a ${width}px container`, () => {
      const { container } = renderAt(width);
      expect(firstUnitWidth(container)).toBeCloseTo(BASE_COLUMN_W, 5);
    });
  }

  it('does not vary with the container width — one value across every tier', () => {
    const widths = CONTAINER_WIDTHS.map((w) => {
      const { container } = renderAt(w);
      const read = firstUnitWidth(container);
      cleanup();
      return read;
    });
    // A restored curve shows up here as more than one distinct value, whatever
    // the individual numbers are.
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBeCloseTo(BASE_COLUMN_W, 5);
  });
});
