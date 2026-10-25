/**
 * computeProjectRescheduleDetailed — self-extent summaries, locked skipping,
 * child cascade and shift-band snapping (自主日期汇总条参与顺延).
 */
import { describe, it, expect } from 'vitest';
import { computeProjectReschedule, computeProjectRescheduleDetailed, type SchedulableTask } from './scheduling';

const D = (s: string) => new Date(s);

/** A(summary, own dates, children c1 locked + c2 free) ← fs — P(pred). */
function makeTree(): SchedulableTask[] {
  return [
    { id: 'P', start: D('2024-06-01'), end: D('2024-06-10') },
    {
      id: 'A',
      start: D('2024-06-05'),
      end: D('2024-06-12'),
      dependencies: ['P'],
      hasOwnDates: true,
    },
    { id: 'c1', start: D('2024-06-05'), end: D('2024-06-07'), parent: 'A', locked: true },
    { id: 'c2', start: D('2024-06-07'), end: D('2024-06-09'), parent: 'A' },
  ];
}

describe('self-extent summary participation', () => {
  it("default ('children') semantics: a violated summary stays put (back-compat)", () => {
    const changes = computeProjectReschedule(makeTree());
    expect(changes.find((c) => c.id === 'A')).toBeUndefined();
  });

  it("'self': a violated own-dates summary is pushed to its predecessor's end", () => {
    const { changes } = computeProjectRescheduleDetailed(makeTree(), undefined, { summaryExtent: 'self' });
    const a = changes.find((c) => c.id === 'A');
    expect(a).toBeTruthy();
    // FS: A.start >= P.end (06-10); duration 7d preserved.
    expect(a!.start.toISOString()).toBe(D('2024-06-10').toISOString());
    expect(a!.end.toISOString()).toBe(D('2024-06-17').toISOString());
  });

  it('unlocked descendants ride along by the same delta; locked ones stay', () => {
    const { changes } = computeProjectRescheduleDetailed(makeTree(), undefined, { summaryExtent: 'self' });
    // delta = +5 days.
    const c2 = changes.find((c) => c.id === 'c2');
    expect(c2).toBeTruthy();
    expect(c2!.start.toISOString()).toBe(D('2024-06-12').toISOString());
    expect(c2!.end.toISOString()).toBe(D('2024-06-14').toISOString());
    expect(changes.find((c) => c.id === 'c1')).toBeUndefined();
  });

  it('a descendant already pushed further by its own links keeps the later position', () => {
    const tasks = makeTree();
    // Late external predecessor forces c2 to 06-20 — beyond the +5d cascade.
    tasks.push({ id: 'X', start: D('2024-06-15'), end: D('2024-06-20') });
    (tasks.find((t) => t.id === 'c2') as SchedulableTask).dependencies = ['X'];
    const { changes } = computeProjectRescheduleDetailed(tasks, undefined, { summaryExtent: 'self' });
    const c2 = changes.find((c) => c.id === 'c2');
    expect(c2!.start.toISOString()).toBe(D('2024-06-20').toISOString());
  });

  it("a date-less grouping summary (hasOwnDates false) still never moves in 'self' mode", () => {
    const tasks = makeTree();
    (tasks.find((t) => t.id === 'A') as SchedulableTask).hasOwnDates = false;
    const { changes } = computeProjectRescheduleDetailed(tasks, undefined, { summaryExtent: 'self' });
    expect(changes.find((c) => c.id === 'A')).toBeUndefined();
  });

  it('a locked violated task is reported in skippedLocked and left in place', () => {
    const tasks: SchedulableTask[] = [
      { id: 'P', start: D('2024-06-01'), end: D('2024-06-10') },
      { id: 'B', start: D('2024-06-05'), end: D('2024-06-08'), dependencies: ['P'], locked: true },
    ];
    const { changes, skippedLocked } = computeProjectRescheduleDetailed(tasks);
    expect(changes).toHaveLength(0);
    expect(skippedLocked).toEqual(['B']);
  });

  it('a satisfied locked task is NOT reported', () => {
    const tasks: SchedulableTask[] = [
      { id: 'P', start: D('2024-06-01'), end: D('2024-06-03') },
      { id: 'B', start: D('2024-06-05'), end: D('2024-06-08'), dependencies: ['P'], locked: true },
    ];
    const { skippedLocked } = computeProjectRescheduleDetailed(tasks);
    expect(skippedLocked).toHaveLength(0);
  });

  it('snapStart pushes a moved task onto the grid but never touches satisfied tasks', () => {
    const tasks: SchedulableTask[] = [
      { id: 'P', start: D('2024-06-01T00:00:00Z'), end: D('2024-06-10T17:00:00Z') },
      { id: 'B', start: D('2024-06-05T08:00:00Z'), end: D('2024-06-08T08:00:00Z'), dependencies: ['P'] },
      { id: 'C', start: D('2024-06-02T09:30:00Z'), end: D('2024-06-03T09:30:00Z') },
    ];
    // Snap to the next whole hour divisible by 12h.
    const TWELVE_H = 12 * 3600 * 1000;
    const snap = (ms: number) => Math.ceil(ms / TWELVE_H) * TWELVE_H;
    const { changes } = computeProjectRescheduleDetailed(tasks, undefined, { snapStart: snap });
    const b = changes.find((c) => c.id === 'B');
    // Required 06-10T17:00 → snapped to 06-11T00:00.
    expect(b!.start.toISOString()).toBe(D('2024-06-11T00:00:00Z').toISOString());
    // C is satisfied: not moved, not snapped.
    expect(changes.find((c) => c.id === 'C')).toBeUndefined();
  });
});
