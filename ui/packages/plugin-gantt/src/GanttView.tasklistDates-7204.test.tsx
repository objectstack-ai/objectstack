/**
 * #7204 / #7224 — ONE container-driven predicate for a row's dates, and a
 * task-list default sized from the container instead of capped at 320px.
 *
 * ⚠️ Every assertion here is about the DOM, never about computed style, and
 * that is deliberate. jsdom applies `@media` rules irrespective of
 * `window.innerWidth`: while the old `@media (min-width: 640px) {
 * .gantt-sm-hidden { display: none } }` rule was live, `getComputedStyle(
 * sublabel).display` read `none` at 500, 800 and 1440 alike — including at
 * widths where a real browser painted the sublabel. A computed-style assertion
 * in this file would confirm the wrong answer in the reassuring direction. The
 * predicate under test is a RENDER decision, which jsdom answers exactly; the
 * pixel readings that go with it were taken in real Chromium and are recorded
 * on the PR.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GanttView, type GanttTask } from './GanttView';

beforeEach(() => {
  window.localStorage.clear();
});

function tasks(): GanttTask[] {
  return [
    {
      id: 'a',
      title: 'Site environmental audit — Northgate',
      start: new Date('2026-08-26T00:00:00.000Z'),
      end: new Date('2026-09-02T00:00:00.000Z'),
      progress: 0,
    },
  ];
}

/**
 * `effectiveWidth = containerWidth || window.innerWidth`, and jsdom's
 * ResizeObserver reports 0, so `innerWidth` IS the container width here — the
 * same convention the rest of this suite uses.
 */
function renderAt(width: number, props: Partial<React.ComponentProps<typeof GanttView>> = {}) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  return render(
    <div style={{ width, height: 600 }}>
      <GanttView
        tasks={tasks()}
        startDate={new Date('2026-08-17T00:00:00.000Z')}
        endDate={new Date('2026-10-30T00:00:00.000Z')}
        onTaskClick={vi.fn()}
        {...props}
      />
    </div>
  );
}

function gates(container: HTMLElement) {
  const headerCells = Array.from(container.querySelectorAll('.gantt-sm-w20')).filter(
    (el) => !el.closest('[data-testid^="gantt-task-row-"]')
  );
  const panel = container.querySelector('.gantt-task-list') as HTMLElement | null;
  return {
    sublabel: !!container.querySelector('[data-testid="gantt-row-dates-a"]'),
    startCell: !!container.querySelector('[data-testid="gantt-row-start-a"]'),
    endCell: !!container.querySelector('[data-testid="gantt-row-end-a"]'),
    headerCaptions: headerCells.length,
    panelWidth: panel ? parseFloat(panel.style.width) : null,
  };
}

/**
 * The #7224 table. `columns` is what the Start/End cells do; the sublabel is
 * asserted to be its exact complement at every row, which is the property that
 * goes red the moment the two gates start reading different widths again.
 * 640–1023 is the band that showed NO dates at all before this change.
 */
const TABLE: Array<{ width: number; panelWidth: number; columns: boolean }> = [
  { width: 500, panelWidth: 0, columns: false },
  { width: 639, panelWidth: 0, columns: false },
  { width: 640, panelWidth: 220, columns: false },
  { width: 800, panelWidth: 220, columns: false },
  { width: 1024, panelWidth: 384, columns: false },
  { width: 1280, panelWidth: 480, columns: true },
  { width: 1440, panelWidth: 540, columns: true },
  { width: 1920, panelWidth: 560, columns: true },
];

describe('GanttView row dates — one predicate, container-driven (#7224)', () => {
  it.each(TABLE)(
    'at a $width px container the sublabel renders on exactly the complement of the Start/End columns',
    ({ width, panelWidth, columns }) => {
      const { container } = renderAt(width);
      const g = gates(container);
      expect(g.panelWidth).toBe(panelWidth);
      expect(g.startCell).toBe(columns);
      expect(g.endCell).toBe(columns);
      // The complement — not "both off" (the 640–1023 hole) and not "both on".
      expect(g.sublabel).toBe(!columns);
      // The header captions follow the same single predicate as the cells they
      // caption, so a row can never be captioned by a column it does not have.
      expect(g.headerCaptions).toBe(columns ? 2 : 0);
    }
  );

  it('never leaves a row with no dates at any width in the table', () => {
    for (const { width } of TABLE) {
      const { container, unmount } = renderAt(width);
      const g = gates(container);
      expect(
        g.sublabel !== g.startCell,
        `width ${width}: sublabel=${g.sublabel} startCell=${g.startCell}`
      ).toBe(true);
      unmount();
    }
  });

  it('a splitter drag under the threshold moves the dates to the sublabel, at a desktop width too', () => {
    // The #7224 second hole: a persisted drag below the threshold at 1440,
    // where the old viewport rule kept the sublabel hidden as well.
    window.localStorage.setItem(
      'gantt-layout:drag-narrow',
      JSON.stringify({ viewMode: 'day', columnWidth: null, taskListCollapsed: false, taskListWidth: 200 })
    );
    const { container } = renderAt(1440, { persistLayoutKey: 'drag-narrow' });
    const g = gates(container);
    expect(g.panelWidth).toBe(200);
    expect(g.startCell).toBe(false);
    expect(g.sublabel).toBe(true);
  });

  it('carries no viewport rule in its own stylesheet that can hide a row date', () => {
    const { container } = renderAt(1440);
    const css = Array.from(container.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');
    expect(css.length).toBeGreaterThan(0);
    // The class the media rule used to hide is gone from the component entirely.
    expect(css).not.toContain('gantt-sm-hidden');
    expect(container.querySelector('.gantt-sm-hidden')).toBeNull();
    // And no surviving media block hides anything — re-adding a viewport gate
    // on a row's dates has to fail here, whatever it gets called next time.
    const mediaBlocks = css.match(/@media[^{]*\{[\s\S]*?\}\s*\}/g) ?? [];
    expect(mediaBlocks.length).toBeGreaterThan(0);
    for (const block of mediaBlocks) expect(block).not.toMatch(/display:\s*none/);
  });
});

describe('GanttView task-list default sized from the container (#7204)', () => {
  it('spends the extra desktop width on the task list, clearing the 412px threshold', () => {
    // 412 = 32 padding + 160 columns + 28 open-details slot + 32 title
    // furniture + 160 minimum title. Each of 1280 / 1440 / 1920 must clear it,
    // otherwise the threshold would only ever be reached by a manual drag.
    for (const [width, expected] of [[1280, 480], [1440, 540], [1920, 560]] as const) {
      const { container, unmount } = renderAt(width);
      const g = gates(container);
      expect(g.panelWidth, `container ${width}`).toBe(expected);
      expect(g.panelWidth!, `container ${width} clears 412`).toBeGreaterThanOrEqual(412);
      expect(g.startCell).toBe(true);
      unmount();
    }
  });

  it('pins the exact width at which the Start/End columns switch on', () => {
    const below = renderAt(1097);
    expect(gates(below.container).panelWidth).toBe(411);
    expect(gates(below.container).startCell).toBe(false);
    expect(gates(below.container).sublabel).toBe(true);
    below.unmount();

    const at = renderAt(1098);
    expect(gates(at.container).panelWidth).toBe(412);
    expect(gates(at.container).startCell).toBe(true);
    expect(gates(at.container).sublabel).toBe(false);
  });

  it('clamps the share to the 320px floor and the 560px ceiling', () => {
    // Floor: the share is 3/8, so it cannot bind above 1024 — the floor guards
    // the bottom of the branch and keeps the old default as the minimum.
    const floor = renderAt(1024);
    expect(gates(floor.container).panelWidth).toBe(384);
    floor.unmount();

    const wide = renderAt(3000);
    expect(gates(wide.container).panelWidth).toBe(560);
    wide.unmount();

    const ultra = renderAt(5120);
    expect(gates(ultra.container).panelWidth).toBe(560);
  });
});
