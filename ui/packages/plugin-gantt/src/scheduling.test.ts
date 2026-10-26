import { describe, it, expect } from 'vitest';
import {
  computeCriticalPath,
  computeProjectReschedule,
  wouldCreateDependencyCycle,
  type SchedulableTask,
  type WorkingCalendar,
} from './scheduling';

const d = (iso: string) => new Date(iso + 'T00:00:00.000Z');

// A → B → D is the long chain (4+3+5 = 12d); A → C → D is shorter (4+1+5).
// D depends on both B and C, so the critical path is A,B,D.
const diamond: SchedulableTask[] = [
  { id: 'A', start: d('2024-01-01'), end: d('2024-01-05') }, // 4d
  { id: 'B', start: d('2024-01-05'), end: d('2024-01-08'), dependencies: ['A'] }, // 3d
  { id: 'C', start: d('2024-01-05'), end: d('2024-01-06'), dependencies: ['A'] }, // 1d
  { id: 'D', start: d('2024-01-08'), end: d('2024-01-13'), dependencies: ['B', 'C'] }, // 5d
];

describe('computeCriticalPath', () => {
  it('finds the longest dependency chain as critical', () => {
    const { criticalIds, criticalEdges } = computeCriticalPath(diamond);
    expect([...criticalIds].sort()).toEqual(['A', 'B', 'D']);
    expect(criticalIds.has('C')).toBe(false);
    expect(criticalEdges.has('A->B')).toBe(true);
    expect(criticalEdges.has('B->D')).toBe(true);
    // The short leg A→C and C→D are not critical.
    expect(criticalEdges.has('A->C')).toBe(false);
    expect(criticalEdges.has('C->D')).toBe(false);
  });

  it('returns empty for an empty task list', () => {
    const { criticalIds, criticalEdges } = computeCriticalPath([]);
    expect(criticalIds.size).toBe(0);
    expect(criticalEdges.size).toBe(0);
  });

  it('bails (empty) on a dependency cycle', () => {
    const cyclic: SchedulableTask[] = [
      { id: 'X', start: d('2024-01-01'), end: d('2024-01-03'), dependencies: ['Y'] },
      { id: 'Y', start: d('2024-01-03'), end: d('2024-01-05'), dependencies: ['X'] },
    ];
    expect(computeCriticalPath(cyclic).criticalIds.size).toBe(0);
  });

  it('ignores dependencies on unknown ids', () => {
    const tasks: SchedulableTask[] = [
      { id: 'A', start: d('2024-01-01'), end: d('2024-01-05') },
      { id: 'B', start: d('2024-01-05'), end: d('2024-01-08'), dependencies: ['A', 'ghost'] },
    ];
    const { criticalIds } = computeCriticalPath(tasks);
    expect([...criticalIds].sort()).toEqual(['A', 'B']);
  });

  it('treats a single linear chain as fully critical', () => {
    const chain: SchedulableTask[] = [
      { id: 'A', start: d('2024-01-01'), end: d('2024-01-03') },
      { id: 'B', start: d('2024-01-03'), end: d('2024-01-05'), dependencies: ['A'] },
      { id: 'C', start: d('2024-01-05'), end: d('2024-01-07'), dependencies: ['B'] },
    ];
    expect([...computeCriticalPath(chain).criticalIds].sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('computeProjectReschedule', () => {
  it('pushes a successor that overlaps its predecessor (fs)', () => {
    // B starts before A finishes — should shift to A.end, keeping its 2d span.
    const tasks: SchedulableTask[] = [
      { id: 'A', start: d('2024-01-01'), end: d('2024-01-10') },
      { id: 'B', start: d('2024-01-05'), end: d('2024-01-07'), dependencies: ['A'] },
    ];
    const changes = computeProjectReschedule(tasks);
    expect(changes).toHaveLength(1);
    expect(changes[0].id).toBe('B');
    expect(changes[0].start.toISOString()).toBe(d('2024-01-10').toISOString());
    expect(changes[0].end.toISOString()).toBe(d('2024-01-12').toISOString()); // duration preserved (2d)
  });

  it('cascades a shift down a chain', () => {
    const tasks: SchedulableTask[] = [
      { id: 'A', start: d('2024-01-01'), end: d('2024-01-10') },
      { id: 'B', start: d('2024-01-05'), end: d('2024-01-08'), dependencies: ['A'] }, // 3d
      { id: 'C', start: d('2024-01-08'), end: d('2024-01-09'), dependencies: ['B'] }, // 1d
    ];
    const changes = computeProjectReschedule(tasks);
    const byId = Object.fromEntries(changes.map((c) => [c.id, c]));
    expect(byId.B.start.toISOString()).toBe(d('2024-01-10').toISOString());
    expect(byId.B.end.toISOString()).toBe(d('2024-01-13').toISOString());
    // C cascades after the shifted B (Jan 13) keeping its 1d span.
    expect(byId.C.start.toISOString()).toBe(d('2024-01-13').toISOString());
    expect(byId.C.end.toISOString()).toBe(d('2024-01-14').toISOString());
  });

  it('does not move tasks that already satisfy their constraints', () => {
    const tasks: SchedulableTask[] = [
      { id: 'A', start: d('2024-01-01'), end: d('2024-01-05') },
      { id: 'B', start: d('2024-01-06'), end: d('2024-01-08'), dependencies: ['A'] },
    ];
    expect(computeProjectReschedule(tasks)).toEqual([]);
  });

  it('never pulls a task earlier than its current start (顺延 only)', () => {
    // B already starts well after A ends — a gap is fine, leave it.
    const tasks: SchedulableTask[] = [
      { id: 'A', start: d('2024-01-01'), end: d('2024-01-05') },
      { id: 'B', start: d('2024-01-20'), end: d('2024-01-22'), dependencies: ['A'] },
    ];
    expect(computeProjectReschedule(tasks)).toEqual([]);
  });

  it('honors ss / ff link semantics', () => {
    const ss: SchedulableTask[] = [
      { id: 'A', start: d('2024-01-10'), end: d('2024-01-15') },
      { id: 'B', start: d('2024-01-05'), end: d('2024-01-08'), dependencies: [{ id: 'A', type: 'ss' }] },
    ];
    const out = computeProjectReschedule(ss);
    expect(out[0].start.toISOString()).toBe(d('2024-01-10').toISOString()); // start aligns to A.start
    expect(out[0].end.toISOString()).toBe(d('2024-01-13').toISOString()); // 3d preserved
  });

  it('does not move summary (parent) tasks', () => {
    const tasks: SchedulableTask[] = [
      { id: 'P', start: d('2024-01-01'), end: d('2024-01-20') }, // summary (parent of L)
      { id: 'A', start: d('2024-01-01'), end: d('2024-01-10') },
      { id: 'L', start: d('2024-01-02'), end: d('2024-01-04'), parent: 'P', dependencies: ['A'] },
    ];
    const changes = computeProjectReschedule(tasks);
    expect(changes.find((c) => c.id === 'P')).toBeUndefined(); // summary untouched
    expect(changes.find((c) => c.id === 'L')?.start.toISOString()).toBe(d('2024-01-10').toISOString());
  });

  it('returns [] on a cycle', () => {
    const cyclic: SchedulableTask[] = [
      { id: 'X', start: d('2024-01-01'), end: d('2024-01-03'), dependencies: ['Y'] },
      { id: 'Y', start: d('2024-01-03'), end: d('2024-01-05'), dependencies: ['X'] },
    ];
    expect(computeProjectReschedule(cyclic)).toEqual([]);
  });
});

// 2024-01-01 is a Monday, so the weekends fall on Jan 6/7, 13/14, 20/21.
const weekdaysOnly: WorkingCalendar = { skipWeekends: true };

describe('working calendar', () => {
  it('snaps a rescheduled successor to the next working day (fs over a weekend)', () => {
    // A finishes Sat Jan 6; B (2 working days) must start Mon Jan 8, end Jan 10.
    const tasks: SchedulableTask[] = [
      { id: 'A', start: d('2024-01-01'), end: d('2024-01-06') }, // ends on a Saturday
      { id: 'B', start: d('2024-01-04'), end: d('2024-01-06'), dependencies: ['A'] }, // 2 working days
    ];
    const out = computeProjectReschedule(tasks, weekdaysOnly);
    const b = out.find((c) => c.id === 'B')!;
    expect(b.start.toISOString()).toBe(d('2024-01-08').toISOString()); // Monday, skipped Sat/Sun
    expect(b.end.toISOString()).toBe(d('2024-01-10').toISOString()); // 2 working days later
  });

  it('without a calendar the same fixture lands on the weekend (calendar-day math)', () => {
    const tasks: SchedulableTask[] = [
      { id: 'A', start: d('2024-01-01'), end: d('2024-01-06') },
      { id: 'B', start: d('2024-01-04'), end: d('2024-01-06'), dependencies: ['A'] },
    ];
    const b = computeProjectReschedule(tasks).find((c) => c.id === 'B')!;
    expect(b.start.toISOString()).toBe(d('2024-01-06').toISOString()); // straight onto Saturday
    expect(b.end.toISOString()).toBe(d('2024-01-08').toISOString()); // +2 calendar days
  });

  it('preserves working-day duration when cascading over weekends', () => {
    // C has a 3-working-day span; pushed past B it must keep 3 working days,
    // stepping over the Jan 13/14 weekend.
    const tasks: SchedulableTask[] = [
      { id: 'A', start: d('2024-01-01'), end: d('2024-01-10') },
      { id: 'B', start: d('2024-01-05'), end: d('2024-01-11'), dependencies: ['A'] }, // pushed to Wed Jan 10 → 4 wd
      { id: 'C', start: d('2024-01-08'), end: d('2024-01-11'), dependencies: ['B'] }, // 3 working days
    ];
    const out = computeProjectReschedule(tasks, weekdaysOnly);
    const c = out.find((x) => x.id === 'C')!;
    // B finishes mid-Jan; C keeps exactly 3 working days regardless of weekends.
    const start = c.start.getTime();
    const end = c.end.getTime();
    let working = 0;
    // Local days: the working calendar counts the chart's own calendar days
    // since objectui#10866 (the suite pins `TZ=UTC`, where the two agree).
    for (let t = start; t < end; t += 86_400_000) {
      const wd = new Date(t).getDay();
      if (wd !== 0 && wd !== 6) working++;
    }
    expect(working).toBe(3);
    expect(new Date(start).getDay()).not.toBe(0); // not a Sunday start
    expect(new Date(start).getDay()).not.toBe(6); // not a Saturday start
  });

  it('treats holidays as non-working days', () => {
    // A finishes on Fri Jan 5, which is a holiday; B must skip the holiday and
    // the Sat/Sun weekend to start Mon Jan 8.
    const cal: WorkingCalendar = { skipWeekends: true, holidays: new Set(['2024-01-05']) };
    const tasks: SchedulableTask[] = [
      { id: 'A', start: d('2024-01-01'), end: d('2024-01-05') }, // finish lands on the holiday
      { id: 'B', start: d('2024-01-02'), end: d('2024-01-04'), dependencies: ['A'] },
    ];
    const b = computeProjectReschedule(tasks, cal).find((c) => c.id === 'B')!;
    expect(b.start.toISOString()).toBe(d('2024-01-08').toISOString()); // skips Fri holiday + weekend
  });

  it('critical path counts working days, flipping a weekend-inflated leg', () => {
    // A→B→D vs A→C→D. B spans a weekend (5 calendar / 3 working days); C is a
    // clean 4 working days. Calendar-day math makes the B leg longest; working
    // days make the C leg longest, flipping which parallel branch is critical.
    const tasks: SchedulableTask[] = [
      { id: 'A', start: d('2024-01-01'), end: d('2024-01-02') }, // 1 wd
      { id: 'B', start: d('2024-01-05'), end: d('2024-01-10'), dependencies: ['A'] }, // Fri→Wed: 5 cal / 3 wd
      { id: 'C', start: d('2024-01-02'), end: d('2024-01-06'), dependencies: ['A'] }, // 4 wd
      { id: 'D', start: d('2024-01-10'), end: d('2024-01-11'), dependencies: ['B', 'C'] }, // 1 wd
    ];
    expect([...computeCriticalPath(tasks).criticalIds].sort()).toEqual(['A', 'B', 'D']);
    expect([...computeCriticalPath(tasks, weekdaysOnly).criticalIds].sort()).toEqual(['A', 'C', 'D']);
  });
});

describe('wouldCreateDependencyCycle', () => {
  // Edges are [predecessor, dependent]: a→b means b depends on a.
  const chain: Array<[string, string]> = [['a', 'b'], ['b', 'c']];

  it('rejects a direct back-edge (b→a when a→b exists)', () => {
    expect(wouldCreateDependencyCycle([['a', 'b']], 'b', 'a')).toBe(true);
  });

  it('rejects a transitive back-edge (c→a across a→b→c)', () => {
    expect(wouldCreateDependencyCycle(chain, 'c', 'a')).toBe(true);
  });

  it('rejects self-links', () => {
    expect(wouldCreateDependencyCycle([], 'a', 'a')).toBe(true);
  });

  it('allows forward and diamond edges', () => {
    expect(wouldCreateDependencyCycle(chain, 'a', 'c')).toBe(false); // shortcut, no cycle
    expect(wouldCreateDependencyCycle(chain, 'c', 'd')).toBe(false); // extend chain
    // Diamond: a→b, a→c; closing b→c is fine.
    expect(wouldCreateDependencyCycle([['a', 'b'], ['a', 'c']], 'b', 'c')).toBe(false);
  });

  it('coerces mixed id types via String()', () => {
    expect(wouldCreateDependencyCycle([['1', '2']], 2, 1)).toBe(true);
  });
});
