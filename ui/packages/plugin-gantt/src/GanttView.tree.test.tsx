/**
 * Hierarchy / summary / milestone tests for GanttView (Phase 3).
 *
 * Same geometry strategy as the links tests: assert relationships between
 * inline styles instead of absolute pixels (positions are timezone-relative).
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
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

function renderView(tasks: GanttTask[]) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={tasks}
        startDate={new Date('2024-06-01T00:00:00.000Z')}
        endDate={new Date('2024-06-30T00:00:00.000Z')}
      />
    </div>
  );
}

function geometry(el: HTMLElement) {
  return { left: parseFloat(el.style.left), width: parseFloat(el.style.width) };
}

const FAMILY = [
  makeTask('p', '2024-06-05T00:00:00.000Z', '2024-06-06T00:00:00.000Z'),
  makeTask('c1', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z', { parent: 'p', progress: 100 }),
  makeTask('c2', '2024-06-10T00:00:00.000Z', '2024-06-14T00:00:00.000Z', { parent: 'p', progress: 50 }),
  makeTask('solo', '2024-06-16T00:00:00.000Z', '2024-06-18T00:00:00.000Z'),
];

describe('GanttView task hierarchy', () => {
  it('renders parents as summary bars spanning the children rollup range', () => {
    const { container } = renderView(FAMILY);
    const summary = container.querySelector('[data-testid="gantt-summary-bar-p"]') as HTMLElement;
    expect(summary).toBeTruthy();
    const c1 = container.querySelector('[data-testid="gantt-task-bar-c1"]') as HTMLElement;
    const c2 = container.querySelector('[data-testid="gantt-task-bar-c2"]') as HTMLElement;
    const s = geometry(summary);
    const g1 = geometry(c1);
    const g2 = geometry(c2);
    // Summary spans min(child start) .. max(child end), ignoring its own dates.
    expect(s.left).toBeCloseTo(g1.left, 0);
    expect(s.left + s.width).toBeCloseTo(g2.left + g2.width, 0);
  });

  it('rolls up summary progress weighted by child duration', () => {
    const { container } = renderView(FAMILY);
    const summary = container.querySelector('[data-testid="gantt-summary-bar-p"]') as HTMLElement;
    // c1: 3 days at 100%, c2: 4 days at 50% → (3*100 + 4*50) / 7 ≈ 71.
    expect(summary.getAttribute('data-progress')).toBe('71');
  });

  it('collapsing a parent hides its child rows and their links', () => {
    const tasks = [
      ...FAMILY.slice(0, 3),
      makeTask('after', '2024-06-16T00:00:00.000Z', '2024-06-18T00:00:00.000Z', { dependencies: ['c2'] }),
    ];
    const { container } = renderView(tasks);
    expect(container.querySelector('[data-testid="gantt-task-bar-c1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-link-c2-after"]')).toBeTruthy();

    const toggle = container.querySelector('[data-testid="gantt-row-toggle-p"]') as HTMLElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);

    expect(container.querySelector('[data-testid="gantt-task-bar-c1"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-task-bar-c2"]')).toBeFalsy();
    // Link into the hidden subtree disappears with its row.
    expect(container.querySelector('[data-testid="gantt-link-c2-after"]')).toBeFalsy();
    // Summary row itself is still there.
    expect(container.querySelector('[data-testid="gantt-summary-bar-p"]')).toBeTruthy();

    fireEvent.click(toggle);
    expect(container.querySelector('[data-testid="gantt-task-bar-c1"]')).toBeTruthy();
  });

  it('children are indented relative to their parent in the task list', () => {
    const { container } = renderView(FAMILY);
    const rows = Array.from(container.querySelectorAll('.group\\/task-row')) as HTMLElement[];
    expect(rows.length).toBe(4);
    const indentOf = (row: HTMLElement) =>
      parseFloat((row.firstElementChild as HTMLElement).style.paddingLeft || '0');
    expect(indentOf(rows[0])).toBe(0); // p
    expect(indentOf(rows[1])).toBeGreaterThan(0); // c1
    expect(indentOf(rows[1])).toBe(indentOf(rows[2])); // c2 same depth
    expect(indentOf(rows[3])).toBe(0); // solo
  });

  it('renders zero-duration tasks as milestone diamonds without resize handles', () => {
    const { container } = renderView([
      makeTask('m', '2024-06-12T00:00:00.000Z', '2024-06-12T00:00:00.000Z'),
    ]);
    const diamond = container.querySelector('[data-testid="gantt-milestone-m"]') as HTMLElement;
    expect(diamond).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-task-bar-m"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-task-resize-left-m"]')).toBeFalsy();
  });

  it('respects an explicit milestone type even with a duration', () => {
    const { container } = renderView([
      makeTask('m2', '2024-06-12T00:00:00.000Z', '2024-06-14T00:00:00.000Z', { type: 'milestone' }),
    ]);
    expect(container.querySelector('[data-testid="gantt-milestone-m2"]')).toBeTruthy();
  });

  it('treats unknown parent ids as roots instead of dropping the task', () => {
    const { container } = renderView([
      makeTask('orphan', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z', { parent: 'ghost' }),
    ]);
    expect(container.querySelector('[data-testid="gantt-task-bar-orphan"]')).toBeTruthy();
  });

  it('survives parent cycles by surfacing the tasks flat', () => {
    const { container } = renderView([
      makeTask('a', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z', { parent: 'b' }),
      makeTask('b', '2024-06-10T00:00:00.000Z', '2024-06-12T00:00:00.000Z', { parent: 'a' }),
    ]);
    // Both render; a (walked first) becomes the entry point with b under it.
    const rows = container.querySelectorAll('.group\\/task-row');
    expect(rows.length).toBe(2);
  });

  it('links anchor at the milestone diamond tip, not its center', () => {
    const { container } = renderView([
      makeTask('a', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z'),
      makeTask('m', '2024-06-12T00:00:00.000Z', '2024-06-12T00:00:00.000Z', { dependencies: ['a'] }),
    ]);
    const path = container.querySelector('[data-testid="gantt-link-a-m"]') as SVGPathElement;
    expect(path).toBeTruthy();
    const diamond = container.querySelector('[data-testid="gantt-milestone-m"]') as HTMLElement;
    const size = parseFloat(diamond.style.width);
    const center = parseFloat(diamond.style.left) + size / 2;
    // The rotated square's visual tip sits half a diagonal left of center —
    // an fs arrow must stop there instead of running under the diamond.
    const leftTip = center - (size * Math.SQRT2) / 2;
    const nums = (path.getAttribute('d') || '').match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(nums[nums.length - 2]).toBeCloseTo(leftTip, 0);
  });

  it('positions task bars with explicit inline top/height centered in the row', () => {
    // calc()-based height utilities aren't emitted in the prebuilt components
    // CSS, so the bar must carry inline geometry — and the link anchors
    // assume the bar is vertically centered (rowHeight/2).
    const { container } = renderView(FAMILY);
    const bar = container.querySelector('[data-testid="gantt-task-bar-solo"]') as HTMLElement;
    const top = parseFloat(bar.style.top);
    const height = parseFloat(bar.style.height);
    expect(top).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    // Centered: inset above equals inset below, and the center is rowHeight/2.
    const row = bar.parentElement as HTMLElement;
    const rowHeight = parseFloat(row.style.height);
    expect(top + height / 2).toBeCloseTo(rowHeight / 2, 5);
  });

  it('anchors links into summary rows at the bracket, not the row center', () => {
    const { container } = renderView([
      ...FAMILY.slice(0, 3),
      makeTask('after', '2024-06-16T00:00:00.000Z', '2024-06-18T00:00:00.000Z', { dependencies: ['p'] }),
    ]);
    const path = container.querySelector('[data-testid="gantt-link-p-after"]') as SVGPathElement;
    expect(path).toBeTruthy();
    const bracket = container.querySelector('[data-testid="gantt-summary-bar-p"]') as HTMLElement;
    const bracketCenterY = parseFloat(bracket.style.top) + parseFloat(bracket.style.height) / 2;
    const nums = (path.getAttribute('d') || '').match(/-?\d+(\.\d+)?/g)!.map(Number);
    // First point: M sx sy — the summary is row 0, so sy is the bracket center.
    expect(nums[1]).toBeCloseTo(bracketCenterY, 0);
  });

  it('renders the progress fill with an explicit inline color', () => {
    const { container } = renderView(FAMILY);
    const bar = container.querySelector('[data-testid="gantt-task-bar-c2"]') as HTMLElement;
    const fill = bar.querySelector('div.pointer-events-none') as HTMLElement;
    expect(fill).toBeTruthy();
    expect(fill.style.width).toBe('50%');
    expect(fill.style.backgroundColor).toBe('rgba(0, 0, 0, 0.2)');
  });
});

// A 4-level tree: 项目(L0,group) → 产品(L1,group) → 排产计划(L2) → 派工单(L3).
function manufacturingTree(): GanttTask[] {
  return [
    makeTask('prj', '2024-06-01T00:00:00.000Z', '2024-06-30T00:00:00.000Z', { type: 'group' }),
    makeTask('prod', '2024-06-01T00:00:00.000Z', '2024-06-30T00:00:00.000Z', { parent: 'prj', type: 'group' }),
    makeTask('plan', '2024-06-03T00:00:00.000Z', '2024-06-10T00:00:00.000Z', { parent: 'prod' }),
    makeTask('wo', '2024-06-03T00:00:00.000Z', '2024-06-06T00:00:00.000Z', { parent: 'plan', locked: true }),
  ];
}

function renderViewWith(tasks: GanttTask[], extra: Record<string, unknown> = {}) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={tasks}
        startDate={new Date('2024-06-01T00:00:00.000Z')}
        endDate={new Date('2024-06-30T00:00:00.000Z')}
        {...extra}
      />
    </div>
  );
}

describe('GanttView summaryExtent (汇总条区间)', () => {
  it("'self' renders the summary bar from its OWN dates and progress, not the children rollup", () => {
    const tasks = [
      makeTask('p', '2024-06-05T00:00:00.000Z', '2024-06-06T00:00:00.000Z', { progress: 30, hasOwnDates: true }),
      makeTask('c1', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z', { parent: 'p', progress: 100 }),
      makeTask('c2', '2024-06-10T00:00:00.000Z', '2024-06-14T00:00:00.000Z', { parent: 'p', progress: 50 }),
      // Same span as p's own dates, for geometry comparison.
      makeTask('ref', '2024-06-05T00:00:00.000Z', '2024-06-06T00:00:00.000Z'),
    ];
    const { container } = renderViewWith(tasks, { summaryExtent: 'self' });
    const summary = container.querySelector('[data-testid="gantt-summary-bar-p"]') as HTMLElement;
    const ref = container.querySelector('[data-testid="gantt-task-bar-ref"]') as HTMLElement;
    const s = geometry(summary);
    const r = geometry(ref);
    // Bar sits exactly on the summary's own 06-05..06-06 window…
    expect(s.left).toBeCloseTo(r.left, 0);
    expect(s.left + s.width).toBeCloseTo(r.left + r.width, 0);
    // …and progress is the record's own, not the weighted child average (71).
    expect(summary.getAttribute('data-progress')).toBe('30');
  });

  it("'self' falls back to children rollup for summaries flagged hasOwnDates:false", () => {
    const tasks = [
      makeTask('p', '2024-06-05T00:00:00.000Z', '2024-06-05T00:00:00.000Z', { hasOwnDates: false }),
      makeTask('c1', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z', { parent: 'p' }),
      makeTask('c2', '2024-06-10T00:00:00.000Z', '2024-06-14T00:00:00.000Z', { parent: 'p' }),
    ];
    const { container } = renderViewWith(tasks, { summaryExtent: 'self' });
    const summary = container.querySelector('[data-testid="gantt-summary-bar-p"]') as HTMLElement;
    const c1 = geometry(container.querySelector('[data-testid="gantt-task-bar-c1"]') as HTMLElement);
    const c2 = geometry(container.querySelector('[data-testid="gantt-task-bar-c2"]') as HTMLElement);
    const s = geometry(summary);
    expect(s.left).toBeCloseTo(c1.left, 0);
    expect(s.left + s.width).toBeCloseTo(c2.left + c2.width, 0);
  });

  it("default ('children') keeps the rollup even when tasks carry hasOwnDates", () => {
    const tasks = [
      makeTask('p', '2024-06-05T00:00:00.000Z', '2024-06-06T00:00:00.000Z', { hasOwnDates: true }),
      makeTask('c1', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z', { parent: 'p' }),
      makeTask('c2', '2024-06-10T00:00:00.000Z', '2024-06-14T00:00:00.000Z', { parent: 'p' }),
    ];
    const { container } = renderViewWith(tasks);
    const summary = geometry(container.querySelector('[data-testid="gantt-summary-bar-p"]') as HTMLElement);
    const c2 = geometry(container.querySelector('[data-testid="gantt-task-bar-c2"]') as HTMLElement);
    expect(summary.left + summary.width).toBeCloseTo(c2.left + c2.width, 0);
  });
});

describe('GanttView group nodes (无条 tree headers)', () => {
  it('renders type:group rows with no bar but keeps the expand toggle', () => {
    const { container } = renderViewWith(manufacturingTree());
    // Group rows have neither a summary bracket nor a task bar.
    expect(container.querySelector('[data-testid="gantt-summary-bar-prj"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-task-bar-prj"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-summary-bar-prod"]')).toBeFalsy();
    // But they remain collapsible tree nodes.
    expect(container.querySelector('[data-testid="gantt-row-toggle-prj"]')).toBeTruthy();
    // The schedulable level below still draws its bar.
    expect(container.querySelector('[data-testid="gantt-summary-bar-plan"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-task-bar-wo"]')).toBeTruthy();
  });
});

describe('GanttView defaultCollapsedDepth (默认折叠)', () => {
  it('seeds the collapsed set at the given depth so deeper rows start hidden', () => {
    // depth 2 = 排产计划; its 派工单 child should start folded away.
    const { container } = renderViewWith(manufacturingTree(), { defaultCollapsedDepth: 2 });
    expect(container.querySelector('[data-testid="gantt-summary-bar-plan"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-task-bar-wo"]')).toBeFalsy();
    // The plan node is collapsed (aria-expanded=false) and expandable by the user.
    const toggle = container.querySelector('[data-testid="gantt-row-toggle-plan"]') as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(container.querySelector('[data-testid="gantt-task-bar-wo"]')).toBeTruthy();
  });

  it('leaves the tree fully expanded when the prop is omitted', () => {
    const { container } = renderViewWith(manufacturingTree());
    expect(container.querySelector('[data-testid="gantt-task-bar-wo"]')).toBeTruthy();
  });
});

describe('GanttView leaf bar labels', () => {
  it('renders the task title inside a leaf task bar (not just summary bars)', () => {
    const { container } = renderViewWith(manufacturingTree());
    const bar = container.querySelector('[data-testid="gantt-task-bar-wo"]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.textContent).toContain('Task wo');
  });
});

describe('GanttView locked nodes (仅查看)', () => {
  it('omits drag/resize/progress handles and the dependency dot on a locked bar', () => {
    const { container } = renderViewWith(manufacturingTree(), {
      onTaskUpdate: () => {},
      onDependencyCreate: () => {},
    });
    // The locked 派工单 keeps its bar but loses every write affordance.
    expect(container.querySelector('[data-testid="gantt-task-bar-wo"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gantt-task-resize-left-wo"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-task-resize-right-wo"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-link-dot-wo"]')).toBeFalsy();
  });
});
