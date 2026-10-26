/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Resource / workload model.
 *
 * Pure, framework-free aggregation that turns a flat task list into a
 * per-resource, per-time-column load histogram. The renderer (ResourceWorkload)
 * draws bars from this; keeping the math here makes it unit-testable and reused
 * identically by the demo and ObjectGantt.
 *
 * Load model — for each resource R and column C:
 *   load(R,C) = Σ effort(task)   over tasks assigned to R that overlap C
 * A column is "overloaded" when its load exceeds the resource capacity. `effort`
 * defaults to 1 (one full unit of capacity per concurrently-active task) and
 * `capacity` defaults to 1, so out of the box the histogram simply counts
 * concurrent tasks and flags any double-booking (load > 1) as overload.
 */

export interface WorkloadColumn {
  /** Inclusive start of the column's time span. */
  start: Date;
  /** Exclusive end of the column's time span. */
  end: Date;
}

export interface WorkloadOptions<T> {
  /**
   * Resource accessor — the person/team/machine a task loads. Return null to
   * route the task into the "unassigned" bucket.
   */
  assignee: (task: T) => { key: string | number; label: string } | null;
  /**
   * Capacity units a task consumes per column while active. Default 1 (a task
   * fully occupies its resource). Use e.g. 0.5 for a half-time allocation.
   */
  effort?: (task: T) => number;
  /**
   * Per-resource capacity ceiling. A number applies to every resource; a
   * function can vary it per key. Default 1. Loads above this flag overload.
   */
  capacity?: number | ((key: string) => number);
  /** Label for the bucket of tasks whose `assignee` returns null. */
  unassignedLabel?: string;
}

export interface ResourceCell {
  /** Summed effort of overlapping tasks in this column. */
  load: number;
  /** Capacity ceiling for this resource. */
  capacity: number;
  /** load > capacity. */
  overloaded: boolean;
}

export interface ResourceLoad {
  key: string;
  label: string;
  capacity: number;
  cells: ResourceCell[];
  /** Highest single-column load — drives the histogram's vertical scale. */
  peak: number;
  /** How many columns are overloaded — a quick "is this resource hot" badge. */
  overloadedCount: number;
}

/** Two time ranges overlap when each starts before the other ends. */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  // Half-open columns [start, end); a zero-width task (milestone, start===end)
  // still counts in the column that contains its instant.
  if (aEnd.getTime() === aStart.getTime()) {
    return aStart.getTime() >= bStart.getTime() && aStart.getTime() < bEnd.getTime();
  }
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

export function computeWorkload<T extends { start: Date; end: Date }>(
  tasks: T[],
  columns: WorkloadColumn[],
  opts: WorkloadOptions<T>,
): ResourceLoad[] {
  const { assignee, effort, capacity = 1, unassignedLabel = 'Unassigned' } = opts;
  const capacityFor = (key: string): number =>
    typeof capacity === 'function' ? capacity(key) : capacity;
  const effortFor = (task: T): number => {
    const e = effort ? effort(task) : 1;
    return Number.isFinite(e) && e > 0 ? e : 0;
  };

  // Bucket tasks by resource, preserving first-seen order for stable rows.
  interface Bucket { key: string; label: string; items: T[]; }
  const buckets = new Map<string, Bucket>();
  for (const task of tasks) {
    const a = assignee(task);
    const key = a ? String(a.key) : '__unassigned__';
    const label = a ? a.label : unassignedLabel;
    let b = buckets.get(key);
    if (!b) { b = { key, label, items: [] }; buckets.set(key, b); }
    b.items.push(task);
  }

  const out: ResourceLoad[] = [];
  for (const b of buckets.values()) {
    const cap = capacityFor(b.key);
    let peak = 0;
    let overloadedCount = 0;
    const cells: ResourceCell[] = columns.map((col) => {
      let load = 0;
      for (const task of b.items) {
        if (overlaps(task.start, task.end, col.start, col.end)) load += effortFor(task);
      }
      if (load > peak) peak = load;
      const overloaded = load > cap + 1e-9;
      if (overloaded) overloadedCount++;
      return { load, capacity: cap, overloaded };
    });
    out.push({ key: b.key, label: b.label, capacity: cap, cells, peak, overloadedCount });
  }
  return out;
}
