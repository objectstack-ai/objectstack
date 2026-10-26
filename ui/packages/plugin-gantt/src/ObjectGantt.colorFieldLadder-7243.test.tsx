/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7243 — `gantt.colorField` used to be passed RAW into the bar's
 * `backgroundColor`.
 *
 * Pointing the documented key at a select field therefore produced
 * `backgroundColor: "open"` — not a colour, so the browser dropped the
 * declaration and every bar rendered identically. OMITTING the key was
 * strictly better: the absent-key branch derived a real colour per status.
 *
 * The ladder this file pins (the triage ruling on #7243, shared with
 * `plugin-timeline` and `plugin-calendar` through
 * `@object-ui/core#createFieldColorResolver`):
 *
 *   1. the field's own option `color` for the record's value;
 *   2. else the value when it already IS a colour literal (#hex / rgb / hsl);
 *   3. else the existing semantic-token derivation — never a raw value.
 *
 * The assertions read the `tasks` prop `ObjectGantt` hands `GanttView` rather
 * than the painted bar: that prop IS the colour contract between the two
 * (`GanttView` writes `backgroundColor: task.color || '#3b82f6'` at four
 * sites), and reading it keeps the fixture from depending on which of those
 * four sites a given row happens to take.
 *
 * REVERSE VERIFICATION — direction predicted before running: on the
 * unmodified tree the first case reports `color: 'open'` instead of the
 * authored `#7c3aed`, and the palette-token case reports `'red'` instead of
 * that palette's hex. Both are the pre-fix values, not a crash.
 *
 * ---
 *
 * objectui#7828 — HARNESS GUARDS, ported from the timeline fixture
 * (objectui#7527 `c2fc261f5`) together with PR #7826's bound capture. Four
 * changes, none of them about the ladder: the readiness predicate identifies
 * WHICH render wrote (a title token this call owns) instead of counting
 * arity; the value returned is the array that predicate accepted, not a
 * second read of the module global; every render is torn down in a `finally`;
 * and no renderer may be alive when one is mounted. The two `it` blocks that
 * used to mount inline now go through the same helper, because guard 4 is
 * only worth anything if EVERY render in the file is accounted for.
 *
 * ⚠️ WHAT WAS MEASURED, because "it stopped failing" is not a mechanism and a
 * green loop is not evidence — objectui#7466 paid for that reading: on an
 * idle box the broken timeline harness passed 32/32, the same 32/32 the fixed
 * one gets. The lever is the METADATA fetch, not machine load, so the lever
 * was swept. Instrument: the PRE-PORT harness shape (module global,
 * arity-only predicate, no unmount, re-read of the global) driving two
 * renders inside one `it` — the objectui#7466 exposure shape — with
 * `getObjectSchema` held by 0/1/2/3/4/5/6/7/8/9/10/12/15/20/25/35/50 ms,
 * three runs at each hold, all three components in the SAME vitest runs:
 *
 *   ObjectTimeline (ungated CONTROL)   20 fail / 60 runs
 *   ObjectGantt                         0 fail / 60 runs
 *   ObjectCalendar                      0 fail / 60 runs
 *
 * The control is what makes those zeroes readable at all: the instrument DOES
 * fire, in this container, on that day, in those same runs — with the card's
 * exact signature: the second render reads the FIRST render's colour back out
 * of the global (`second=["#abc"]` where `["#123456"]` was authored).
 *
 * Note WHERE it fires: every timeline failure sits at a hold of 1-9ms, and the
 * coarse grid alone caught it at ONE hold out of eight. That is why the grid
 * was refined instead of repeated — repetition at a hold outside the window is
 * exactly the 32/32 that taught objectui#7466 nothing.
 *
 * The mechanism, measured the same way — writes into the module global AFTER
 * the readiness predicate went green, with the render left mounted exactly as
 * the pre-port harness left it:
 *
 *   ObjectTimeline, getObjectSchema +25ms    1 paint at green, 3 LATE writes
 *   ObjectGantt,    +0 / +25 / +100ms        1 paint, 0 late writes
 *   ObjectCalendar, +0 / +25 / +100ms        1 paint, 0 late writes
 *
 * `ObjectTimeline`'s data effect lists `objectDef`, so it paints once before
 * the metadata lands and again after. `ObjectGantt` GATES its record query on
 * the SETTLED schema (objectui#7225 ask 2, objectui#6482's undischarged
 * gating half — the effect returns early until `objectSchemaReady`), so its
 * first paint arrives only after the metadata read — the measured paint time
 * tracks the hold, 31ms at +25 and 114ms at +100 — and no schema-triggered
 * second paint follows it.
 *
 * ⛔ So this file does NOT claim the timeline's two-paint behaviour for
 * `ObjectGantt`: it was looked for, with a lit instrument, and it is not
 * there. **No failure was reproducible on this file today.** What is ported
 * is the HARNESS half, which does not depend on that behaviour — a module
 * global plus an arity-only predicate cannot say WHICH component wrote,
 * whatever the component does. The guards are here so that the ordinary next
 * edit to a ladder fixture — a second assertion inside one of these `it`
 * blocks, which is precisely the edit that made objectui#7466 — cannot
 * reintroduce one.
 */

import React from 'react';
import { render, waitFor, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectGantt } from './ObjectGantt';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

let lastTasks: any[] = [];

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => {
    lastTasks = tasks;
    return <div data-testid="gantt-view" data-task-count={String(tasks.length)} />;
  },
}));

/** The authored option colours — the single fact all three renderers must agree on. */
const STATUS_OPTIONS = [
  { value: 'open', label: 'Open', color: '#7c3aed' },
  { value: 'done', label: 'Done', color: '#059669' },
];

const OBJECT_SCHEMA = {
  name: 'duly_task',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text' },
    visible_from: { name: 'visible_from', type: 'date' },
    due_date: { name: 'due_date', type: 'date' },
    status: { name: 'status', type: 'select', options: STATUS_OPTIONS },
    // No `options` — a plain text field an author may use to store a literal
    // colour, which is the only shape rung 2 exists for.
    accent: { name: 'accent', type: 'text' },
  },
};

const ROWS = [
  {
    id: '1',
    subject: 'Ship it',
    status: 'open',
    accent: '#123456',
    visible_from: '2026-01-01',
    due_date: '2026-01-10',
  },
];

function makeDataSource(rows: any[] = ROWS, objectSchema: any = OBJECT_SCHEMA) {
  return {
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectSchema),
  } as any;
}

/** Distinguishes one render from the next. See `token` below. */
let renderSeq = 0;

/**
 * Mounts ONE gantt, waits for THIS render to be the one that wrote, and
 * returns the tasks the predicate accepted. Every render in this file goes
 * through here — the colour rungs via `colorsFor` below, and the two cases
 * that need a non-default `gantt` block or object schema directly.
 */
async function tasksFor(
  ganttConfig: Record<string, any>,
  rows: any[] = ROWS,
  objectSchema: any = OBJECT_SCHEMA,
) {
  // objectui#7828 (objectui#7521's guard) — a STRUCTURAL check, deliberately
  // not a timing one. RTL's auto-cleanup runs in `afterEach`, never between
  // two renders inside one `it`, so a render this helper failed to tear down
  // is observable HERE, at a synchronous point, rather than as a race someone
  // has to catch in the act.
  expect(screen.queryAllByTestId('gantt-view')).toHaveLength(0);

  // A token this call OWNS. `ObjectGantt` resolves a task's `title` from the
  // configured `titleField` first (ADR-0079 ladder), so the token rides
  // through to `lastTasks` untouched — and it is NOT the value under test, so
  // the predicate below can tell "THIS render is ready" from "something else
  // wrote again" without asserting the colour the caller is about to assert.
  const token = `render-${++renderSeq}`;
  const stampedRows = rows.map((row, i) => ({ ...row, subject: `${token}-${i}` }));

  lastTasks = [];
  const schema: any = {
    type: 'object-gantt',
    objectName: 'duly_task',
    gantt: {
      titleField: 'subject',
      startDateField: 'visible_from',
      endDateField: 'due_date',
      ...ganttConfig,
    },
  };
  const { unmount } = render(
    <ObjectGantt schema={schema} dataSource={makeDataSource(stampedRows, objectSchema)} />,
  );
  try {
    // Identify the AUTHOR, not just the arity. `lastTasks.length` alone cannot
    // separate "the component I just mounted has painted" from "an earlier one
    // painted again": both leave length === rows.length.
    //
    // And RETURN THE ARRAY THE PREDICATE ACCEPTED (PR #7826). `lastTasks` is
    // module-level and mutable, so reading it again on the next line asks a
    // SECOND question — after `act` has yielded on its way out of `waitFor`, a
    // real window in which a still-live writer can answer it. Capturing inside
    // the predicate makes "the value asserted" and "the value validated" the
    // same object by construction.
    let settled: typeof lastTasks = [];
    await waitFor(() => {
      const tasks = lastTasks;
      expect(tasks.map((t) => t.title)).toEqual(stampedRows.map((r) => r.subject));
      settled = tasks;
    });
    return settled;
  } finally {
    // Tear THIS render down before returning, so nothing this helper mounted
    // can still be writing to `lastTasks` during the NEXT call — after that
    // call has reset it. Measured above: `ObjectGantt` emits no late write
    // today, which is why this is a guard and not a fix.
    unmount();
  }
}

async function colorsFor(colorField: string, rows: any[] = ROWS) {
  return (await tasksFor({ colorField }, rows)).map((t) => t.color);
}

describe('objectui#7243 — gantt colorField ladder', () => {
  it('rung 1: a select field paints the AUTHORED option colour', async () => {
    expect(await colorsFor('status')).toEqual(['#7c3aed']);
  });

  it('rung 2: a literal hex in a plain field still passes through untouched', async () => {
    expect(await colorsFor('accent')).toEqual(['#123456']);
  });

  it('rung 3: a value with no option colour derives a colour, never the raw value', async () => {
    const rows = [{ ...ROWS[0], status: 'in_progress' }];
    const schemaless = {
      ...OBJECT_SCHEMA,
      fields: { ...OBJECT_SCHEMA.fields, status: { name: 'status', type: 'text' } },
    };
    const tasks = await tasksFor({ colorField: 'status' }, rows, schemaless);
    // `in_progress` is a SEMANTIC_COLOR_MAP key -> blue -> that palette's hex.
    expect(tasks[0].color).toBe('#3b82f6');
    expect(tasks[0].color).not.toBe('in_progress');
  });

  it('rung 3: a palette token resolves to that palette colour, not a raw CSS name', async () => {
    const rows = [{ ...ROWS[0], accent: 'red' }];
    expect(await colorsFor('accent', rows)).toEqual(['#ef4444']);
  });

  it('an empty colorField value still falls back to the record status story', async () => {
    const rows = [{ ...ROWS[0], accent: '' }];
    // `status: 'open'` -> SEMANTIC_COLOR_MAP blue.
    expect(await colorsFor('accent', rows)).toEqual(['#3b82f6']);
  });

  it('borderColorField takes rung 1 too — the alert stroke honours option colours', async () => {
    const tasks = await tasksFor({ borderColorField: 'status' });
    expect(tasks[0].borderColor).toBe('#7c3aed');
  });
});
