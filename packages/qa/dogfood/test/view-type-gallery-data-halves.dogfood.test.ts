// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.view-type-gallery` (#26573): the API half of
// its two api clauses, on the showcase as shipped — what the views declare
// (`GET /api/v1/meta/view?object=showcase_task`) and what the data door
// answers for the fields they name.
//
//   acceptance[1] — the kanban view groups by status and summarizes
//     estimate_hours; every one of the five status columns holds seeded tasks;
//     and the server aggregate (`POST /data/showcase_task/query`, group by
//     status, sum estimate_hours) agrees, column by column, with the raw rows
//     grouped client-side.
//   acceptance[2] — the temporal views name their true date fields (calendar
//     due_date, timeline created_at, gantt start_date → end_date with
//     progressField progress), and the seeded tasks carry those values over
//     the API (gantt bars never end before they start).
//
// Placement on the canvas, the per-variant screenshots (acceptance[0],
// negative[0]), map and chart (acceptance[3], negative[1]) and the tree
// (acceptance[4]) stay browser legs; acceptance[5] stays the smoke spec's.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const TASK = 'showcase_task';
const COLUMNS = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];

describe('records-forms.view-type-gallery — the view declarations and the data they read', () => {
  let stack: VerifyStack;
  let token = '';
  let views: any[] = [];
  let tasks: any[] = [];

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  const viewOfType = (type: string) => {
    const hit = views.filter((v) => v.type === type);
    expect(hit, `exactly one showcase_task ${type} view`).toHaveLength(1);
    return hit[0];
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
    const meta = await call('GET', `/meta/view?object=${TASK}`);
    expect(meta.status, meta.text).toBe(200);
    views = (meta.json.items as any[]).map((item) => item.config);
    const list = await call('GET', `/data/${TASK}?$top=500`);
    expect(list.status, list.text).toBe(200);
    tasks = list.json.records ?? list.json.data ?? list.json.value ?? [];
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[1]: the kanban groups by status, every column holds seeded tasks, and the server aggregate agrees per column', async () => {
    const board = viewOfType('kanban');
    expect(board.kanban).toMatchObject({ groupByField: 'status', summarizeField: 'estimate_hours' });

    const byStatus = new Map<string, number>();
    for (const t of tasks) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + Number(t.estimate_hours ?? 0));
    for (const column of COLUMNS) {
      expect(tasks.filter((t) => t.status === column).length, `column ${column} is populated`).toBeGreaterThan(0);
    }

    const agg = await call('POST', `/data/${TASK}/query`, {
      groupBy: ['status'], aggregations: [{ function: 'sum', field: 'estimate_hours', alias: 'hours' }],
    });
    expect(agg.status, agg.text).toBe(200);
    const rows: any[] = agg.json.records;
    expect(rows.map((r) => r.status).sort(), 'one aggregate row per column').toEqual([...COLUMNS].sort());
    const server = new Map(rows.map((r) => [r.status, Number(r.hours ?? 0)]));
    for (const column of COLUMNS) {
      expect(server.get(column) ?? 0, `column ${column}`).toBeCloseTo(byStatus.get(column) ?? 0, 4);
    }
  });

  it('acceptance[2]: the temporal views name their true date fields, and the seeded tasks carry them', async () => {
    expect(viewOfType('calendar').calendar).toMatchObject({ startDateField: 'due_date' });
    expect(viewOfType('timeline').timeline).toMatchObject({ startDateField: 'created_at' });
    expect(viewOfType('gantt').gantt).toMatchObject({ startDateField: 'start_date', endDateField: 'end_date', progressField: 'progress' });

    expect(tasks.filter((t) => t.due_date).length, 'tasks the calendar can place').toBeGreaterThanOrEqual(2);
    expect(tasks.every((t) => t.created_at), 'every task carries created_at for the timeline').toBe(true);
    const bars = tasks.filter((t) => t.start_date && t.end_date);
    expect(bars.length, 'tasks the gantt can draw').toBeGreaterThanOrEqual(2);
    for (const t of bars) {
      expect(String(t.end_date) >= String(t.start_date), `${t.title}: ${t.start_date} → ${t.end_date}`).toBe(true);
      expect(typeof t.progress === 'number', `${t.title}: progress`).toBe(true);
    }
  });
});
