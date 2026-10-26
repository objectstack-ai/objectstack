/**
 * objectui#7203 — the toolbar period label and its prev/next steppers.
 *
 * The label used to format `timelineRange.start`, the memo spanning the WHOLE
 * dataset, so it named the first month of the result set and could not change
 * at any scroll position — it was not a function of scroll position at all. On
 * a dataset running Jan–Dec it therefore read "January 2026" four pixels above
 * a band header correctly reading "Aug 2026". The two stepper buttons beside it
 * rendered an aria-label and an icon and carried no onClick.
 *
 * The band header (`data-testid="gantt-header-groups"`) is the REFERENCE here,
 * never the thing under test: these tests read the header cell that owns the
 * pixel at the left edge of the viewport and require the toolbar to name the
 * same month. Comparison is by month identity (`monthKey`), not by wording, so
 * the toolbar staying on the fuller "August 2026" beside the header's compact
 * "Aug 2026" is not what is being asserted either way.
 *
 * Scroll is honestly modelled in this environment: `GanttView.virtual.test.tsx`
 * already pins that `timeline.scrollLeft = N` + `fireEvent.scroll` moves the
 * column window to N (its assertion reads a rendered `style.left` back). The
 * label derives from the same `scrollPos.left`, so these readings are real.
 * Client sizes ARE 0 here, so the component falls back to a 4000px virtual
 * viewport — every fixture below is wider than that, which is what makes the
 * stepper's clamp non-trivial and the window genuinely scrollable.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';

beforeEach(() => {
  // >=1024 → columnWidth 110 (deterministic), matching the sibling suites.
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  window.localStorage.clear();
});

function toolbarLabel(container: HTMLElement): string {
  const el = container.querySelector('[data-testid="gantt-toolbar-period"]');
  expect(el, 'toolbar period label is missing').toBeTruthy();
  return el!.textContent!.trim();
}

function groupCells(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll('[data-testid="gantt-header-groups"] > div'),
  ).map((node) => {
    const el = node as HTMLElement;
    return {
      label: el.textContent!.trim(),
      left: parseFloat(el.style.left),
      width: parseFloat(el.style.width),
    };
  });
}

/** The band-header cell that owns pixel `x` — what the user reads at the left
 *  edge of the viewport, and the reference the toolbar has to agree with. */
function bandAt(container: HTMLElement, x: number) {
  const hit = groupCells(container).find((c) => c.left <= x && x < c.left + c.width);
  expect(hit, `no band-header cell owns x=${x}`).toBeTruthy();
  return hit!;
}

/** `year-monthIndex` of a rendered month label, so "August 2026" (toolbar) and
 *  "Aug 2026" (band header) compare as the same month without either one's
 *  exact wording being asserted. */
function monthKey(label: string): string {
  const d = new Date(label);
  expect(Number.isNaN(d.getTime()), `unparseable month label: "${label}"`).toBe(false);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function timelineOf(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-testid="gantt-timeline"]') as HTMLElement;
}

function scrollTo(container: HTMLElement, x: number) {
  const timeline = timelineOf(container);
  timeline.scrollLeft = x;
  fireEvent.scroll(timeline);
  return timeline;
}

function click(container: HTMLElement, testid: string) {
  const btn = container.querySelector(`[data-testid="${testid}"]`);
  expect(btn, `${testid} is missing`).toBeTruthy();
  fireEvent.click(btn!);
}

/** The reporter's shape: a year of history, no explicit window, so
 *  `timelineRange` spans the whole dataset and starts in January. */
function yearOfTasks(): GanttTask[] {
  return [
    { id: 'a', title: 'Task a', start: new Date(2026, 0, 31), end: new Date(2026, 1, 20), progress: 0 },
    { id: 'b', title: 'Task b', start: new Date(2026, 7, 26), end: new Date(2026, 8, 6), progress: 0 },
    { id: 'c', title: 'Task c', start: new Date(2026, 11, 1), end: new Date(2026, 11, 31), progress: 0 },
  ];
}

function renderView(props: Partial<React.ComponentProps<typeof GanttView>> = {}) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView tasks={yearOfTasks()} {...props} />
    </div>,
  );
}

describe('GanttView toolbar period label (objectui#7203)', () => {
  it('names the month the band header names, at a scrolled position', () => {
    const { container } = renderView();
    // The dataset really does start in January — which is precisely why the old
    // `timelineRange.start` label read January at EVERY scroll position.
    expect(monthKey(toolbarLabel(container))).toBe('2026-0');

    const x = 23430; // ~7 months in at 110px/day; anywhere past January will do
    scrollTo(container, x);

    const band = bandAt(container, x);
    expect(monthKey(band.label), 'fixture did not actually leave January').not.toBe('2026-0');
    expect(monthKey(toolbarLabel(container))).toBe(monthKey(band.label));
  });

  it('changes as the chart scrolls, and comes back', () => {
    // The assertion that fails if the label is ever wired back to a whole-range
    // memo: a static string passes any single-position check.
    const { container } = renderView();
    const atStart = toolbarLabel(container);

    scrollTo(container, 23430);
    expect(toolbarLabel(container)).not.toBe(atStart);

    scrollTo(container, 0);
    expect(toolbarLabel(container)).toBe(atStart);
  });

  it('agrees with the band header at every scroll position, week view included', () => {
    // Week view is the straddle case: a week column can start in one month and
    // end in the next. The header keys such a column by the month its START
    // falls in, so the label has to snap the COLUMN, not the instant under the
    // pixel — otherwise the two disagree for part of every straddling week.
    const { container } = renderView({ viewMode: 'week' });
    for (const x of [0, 300, 777, 1234, 2000, 3111, 4200]) {
      scrollTo(container, x);
      expect(monthKey(toolbarLabel(container)), `at x=${x}`).toBe(monthKey(bandAt(container, x).label));
    }
  });

  it('still labels a single-month dataset correctly (control)', () => {
    // The fix is not "read whatever the header says": with one band and no
    // scrolling, the label is still derived, and still right.
    const { container } = render(
      <div style={{ width: 1280, height: 600 }}>
        <GanttView
          tasks={[{ id: 'a', title: 'Task a', start: new Date(2026, 5, 5), end: new Date(2026, 5, 20), progress: 0 }]}
          startDate={new Date(2026, 5, 1)}
          endDate={new Date(2026, 5, 30)}
        />
      </div>,
    );
    const bands = groupCells(container);
    expect(bands.length).toBe(1);
    expect(monthKey(toolbarLabel(container))).toBe('2026-5');
    expect(monthKey(bands[0].label)).toBe('2026-5');
  });
});

describe('GanttView toolbar period steppers (objectui#7203)', () => {
  it('steps the visible window one period per click, and the label follows', () => {
    const { container } = renderView();
    const timeline = timelineOf(container);
    expect(monthKey(toolbarLabel(container))).toBe('2026-0');
    expect(timeline.scrollLeft).toBe(0);

    click(container, 'gantt-toolbar-next-period');
    expect(monthKey(toolbarLabel(container))).toBe('2026-1');
    const afterNext = timeline.scrollLeft;
    expect(afterNext).toBeGreaterThan(0);
    expect(monthKey(bandAt(container, afterNext).label)).toBe('2026-1');

    click(container, 'gantt-toolbar-next-period');
    expect(monthKey(toolbarLabel(container))).toBe('2026-2');
    expect(timeline.scrollLeft).toBeGreaterThan(afterNext);

    click(container, 'gantt-toolbar-prev-period');
    expect(monthKey(toolbarLabel(container))).toBe('2026-1');
    expect(timeline.scrollLeft).toBe(afterNext);
  });

  it('clamps at the left edge instead of scrolling out of the range', () => {
    const { container } = renderView();
    const timeline = timelineOf(container);
    // January is the first period; the timeline itself starts on 24 Jan, so the
    // period start is off-grid to the left. Stepping back parks at 0.
    click(container, 'gantt-toolbar-prev-period');
    expect(timeline.scrollLeft).toBe(0);
    expect(monthKey(toolbarLabel(container))).toBe('2026-0');
  });

  it('bands by year in month view, and steps one year per click', () => {
    // "One unit of the current granularity" is the tier the band header groups
    // by, not the column unit: day/week band by month, month/quarter by year,
    // year by decade. Stepping a single month column in month view would leave
    // the toolbar's own label unchanged for eleven clicks out of twelve.
    const { container } = render(
      <div style={{ width: 1280, height: 600 }}>
        <GanttView
          tasks={[{ id: 'a', title: 'Task a', start: new Date(2024, 0, 10), end: new Date(2028, 11, 20), progress: 0 }]}
          startDate={new Date(2024, 0, 1)}
          endDate={new Date(2028, 11, 31)}
          viewMode="month"
        />
      </div>,
    );
    expect(toolbarLabel(container)).toBe('2024');
    expect(bandAt(container, 0).label).toBe('2024');

    const timeline = timelineOf(container);
    click(container, 'gantt-toolbar-next-period');
    expect(toolbarLabel(container)).toBe('2025');
    expect(timeline.scrollLeft).toBeGreaterThan(0);
    expect(bandAt(container, timeline.scrollLeft).label).toBe('2025');
  });
});
