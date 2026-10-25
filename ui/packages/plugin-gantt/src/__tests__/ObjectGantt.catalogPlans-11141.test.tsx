/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11141 — `plugin-gantt`'s own catalog plans draw each successor
 * where its predecessor ends.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * The catalog authors inclusive date-only ends with next-day successors
 * (`2024-01-01` to `2024-01-15`, then `2024-01-16`). `ObjectGantt` read an end
 * exactly like a start, as the named day's local midnight, so every bar was
 * drawn one day short and every successor stood one day after it, while the
 * timeline's gantt already drew the same authored end through its day
 * (objectui#11112). An end is now read through the one core helper both
 * surfaces share (`toDisplayEndDate`, `@object-ui/core`).
 *
 * ── What these pins hold ────────────────────────────────────────────────────
 * The three plans are read from disk, as authored (⛔ not re-authored here),
 * and drawn by the real `ObjectGantt` and `GanttView`. For every dependency
 * edge, the gap between the predecessor's right edge and the successor's left
 * edge is exactly the calendar days the plan leaves between the two, the days
 * strictly after the predecessor's end and before the successor's start. That
 * is zero on every edge that drives its successor, with ONE authored
 * exception, named below rather than hidden in a count: the project plan's
 * Development ends `2024-02-28` and Testing starts `2024-03-01`, and 2024 is a
 * leap year, so February 29th lies between them. The task list names each
 * authored end.
 *
 * The suite runs in UTC (`vitest.config.mts` pins `TZ`); the zone pins beside
 * this file drive the end read through other zones.
 */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { ObjectGantt } from '../ObjectGantt';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CATALOG = path.join(REPO_ROOT, 'examples/schema-catalog/src/schemas/plugin-gantt');

const PLANS = [
  'project-timeline-with-dependencies.json',
  'sprint-development-timeline.json',
  'construction-project-phases.json',
] as const;

interface Plan {
  type: string;
  staticData: Array<Record<string, unknown>>;
  gantt: { startDateField: string; endDateField: string; titleField: string; dependenciesField: string };
}

/**
 * A plan as `ObjectGantt` reads it. The file is the authored document: since
 * objectui#10859 batch 6 its props are in the spec's `properties` bag, which
 * `SchemaRenderer` hoists onto the node before `ObjectGantt` runs. These pins
 * mount `ObjectGantt` directly, so the bag is hoisted here the same way.
 */
function readPlan(file: string): Plan {
  const doc = JSON.parse(fs.readFileSync(path.join(CATALOG, file), 'utf8')) as {
    type: string;
    properties: Omit<Plan, 'type'>;
  };
  return { type: doc.type, ...doc.properties };
}

/** A stored `YYYY-MM-DD` as a UTC day number, where every day is 24 hours. */
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00.000Z`) / 86_400_000;

interface Edge {
  pred: string;
  succ: string;
  /** Calendar days strictly between the predecessor's end and the successor's start. */
  daysBetween: number;
  /** Whether the predecessor is the latest-ending one of its successor's: the edge that drives it. */
  drives: boolean;
}

function edgesOf(plan: Plan): Edge[] {
  const { startDateField: s, endDateField: e, dependenciesField: d } = plan.gantt;
  const byId = new Map(plan.staticData.map((row) => [String(row.id), row]));
  const edges: Edge[] = [];
  for (const row of plan.staticData) {
    const preds = ((row[d] as unknown[]) ?? []).map(String);
    const latest = Math.max(...preds.map((p) => dayNumber(byId.get(p)![e] as string)));
    for (const p of preds) {
      const end = dayNumber(byId.get(p)![e] as string);
      edges.push({
        pred: p,
        succ: String(row.id),
        daysBetween: dayNumber(row[s] as string) - end - 1,
        drives: end === latest,
      });
    }
  }
  return edges;
}

beforeEach(() => {
  // >= 1280 shows the task list's Start / End cells (objectui#7204).
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

interface Bar {
  left: number;
  right: number;
}

async function drawn(plan: Plan): Promise<{ bars: Map<string, Bar>; ends: Map<string, string>; pxPerDay: number }> {
  const { container } = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en-US' }}>
        <div style={{ width: 1280, height: 600 }}>
          <ObjectGantt schema={plan as unknown as React.ComponentProps<typeof ObjectGantt>['schema']} />
        </div>
      </LocalizationProvider>
    </I18nProvider>,
  );
  const ids = plan.staticData.map((row) => String(row.id));
  await waitFor(() => {
    for (const id of ids) expect(container.querySelector(`[data-testid="gantt-task-bar-${id}"]`), `bar ${id}`).not.toBeNull();
  });
  const bars = new Map<string, Bar>();
  const ends = new Map<string, string>();
  for (const id of ids) {
    const el = container.querySelector(`[data-testid="gantt-task-bar-${id}"]`) as HTMLElement;
    const left = parseFloat(el.style.left);
    bars.set(id, { left, right: left + parseFloat(el.style.width) });
    ends.set(id, (container.querySelector(`[data-testid="gantt-row-end-${id}"]`)?.textContent ?? '').trim());
  }
  // One day's width, read off two bars' starts: the axis is linear here (no
  // folded weekends), so any two authored starts measure it.
  const { startDateField: s } = plan.gantt;
  const [a, b] = plan.staticData.filter((row, i, all) => all.findIndex((r) => r[s] === row[s]) === i);
  const pxPerDay =
    (bars.get(String(b.id))!.left - bars.get(String(a.id))!.left) / (dayNumber(b[s] as string) - dayNumber(a[s] as string));
  return { bars, ends, pxPerDay };
}

describe('the catalog plans, as authored (objectui#11141)', () => {
  it.each(PLANS)('%s is on disk, an object-gantt with dependencies', (file) => {
    const plan = readPlan(file);
    expect(plan.type).toBe('object-gantt');
    expect(edgesOf(plan).length).toBeGreaterThan(0);
  });

  it('every driving edge leaves no day between its two tasks but one, across a leap day', () => {
    const between = PLANS.flatMap((file) =>
      edgesOf(readPlan(file))
        .filter((edge) => edge.drives && edge.daysBetween !== 0)
        .map((edge) => `${file} ${edge.pred}→${edge.succ}: ${edge.daysBetween}`),
    );
    expect(between).toEqual(['project-timeline-with-dependencies.json 2→3: 1']);
    const project = readPlan('project-timeline-with-dependencies.json').staticData;
    expect(project.find((r) => r.id === 2)!.endDate).toBe('2024-02-28');
    expect(project.find((r) => r.id === 3)!.startDate).toBe('2024-03-01');
  });
});

describe('the catalog plans draw each successor where the plan puts it (objectui#11141)', () => {
  it.each(PLANS)('%s: each gap is the days the plan leaves between the two tasks, so a driving edge has none', async (file) => {
    const plan = readPlan(file);
    const { bars, pxPerDay } = await drawn(plan);
    expect(pxPerDay).toBeGreaterThan(0);
    for (const edge of edgesOf(plan)) {
      const gapDays = (bars.get(edge.succ)!.left - bars.get(edge.pred)!.right) / pxPerDay;
      expect(gapDays, `${edge.pred}→${edge.succ}`).toBeCloseTo(edge.daysBetween, 3);
    }
  });

  it.each(PLANS)('%s: the task list names each authored end', async (file) => {
    const plan = readPlan(file);
    const { ends } = await drawn(plan);
    const { endDateField: e } = plan.gantt;
    for (const row of plan.staticData) {
      const [year, month, day] = (row[e] as string).split('-').map(Number);
      // The catalog's plans are authored in 2024, which is not the current
      // year, so the End cell names the year too (objectui#12110 item 5).
      expect(ends.get(String(row.id)), `task ${row.id}`).toBe(`${month}/${day}/${String(year).slice(-2)}`);
    }
  });
});
