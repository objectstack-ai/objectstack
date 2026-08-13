// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7226] `is_completed` / `is_overdue` are GONE, and every surface that read
 * them now asks a stored column.
 *
 * ## What was wrong
 *
 * Both were `readonly: true` booleans defaulting to `false` that nothing in the
 * app ever wrote — no hook leg, no flow node, no action handler, and the seed
 * data set neither. They were `false` on every row for the life of the app,
 * while twelve view / dashboard / report / flow filters read them as if they
 * were maintained. Every `is_completed: true` surface ("Completed Today", the
 * weekly-completion trend, both completed-task reports) and the whole "Overdue
 * Tasks" view were therefore permanently EMPTY, and `task.hook.ts` carried an
 * `afterUpdate` branch gated on `data.is_overdue && previous && !previous.is_overdue`
 * that could never run.
 *
 * ## Why removed rather than derived as formulas
 *
 * A formula computes both correctly — including the temporal one — so the
 * obvious repair looks available. It is not, and the reason is a STORAGE fact
 * rather than a taste judgment: a `formula` field is virtual, no driver
 * materialises a column for it, and so a FILTER naming one cannot be applied
 * as written. That is measured here, not asserted — {@link REVERSE} registers
 * the formula-shaped object and shows `where { is_completed: false }` failing
 * where the stored column answers every row. Deriving would have emptied the
 * "Due Today" view, the daily reminder flow and both open-task reports.
 *
 * Since **#8296** that failure is VISIBLE. The engine's filter seam refuses a
 * `where` naming a virtual `formula` field with `400 INVALID_FIELD` instead of
 * handing the predicate to a driver with no column behind it and answering
 * **0 rows with no error** — which is what this test measured when #7226 was
 * decided, and the invisible zero was the danger: a wrong answer traded for an
 * unobservable one.
 *
 * The storage fact that decided #7226 is unchanged, so the decision stands and
 * its reasoning is stronger, not weaker: a formula field still carries no
 * column, a filter naming one still could not have worked, and the eight app
 * filters that read these flags still had to move to stored columns. Only the
 * failure mode changed — a silent zero became a named 400.
 *
 * `status` and `due_date` are stored, indexed columns that already carry the
 * information, and both are declared dimensions on the `task_metrics` dataset,
 * so the dashboard/report filters now sit on the semantic layer's own vocabulary.
 *
 * ## What these tests pin
 *
 * 1. **Nothing references the removed fields** — a recursive walk of the app's
 *    REAL `defineStack` (objects, views, dashboards, reports, datasets, flows,
 *    actions, translations and seed data in one pass), so a dangling reference
 *    re-introduced anywhere fails here rather than at runtime as a silent zero.
 * 2. **The replacements actually select** — driven against the real engine
 *    across BOTH sides of the completion transition. This is the anti-vacuity
 *    half: a filter asserted only on a never-completed task is green for the
 *    same reason the old broken flag was green (everything is false), so each
 *    assertion below checks a row moving INTO and OUT OF the selected set.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { Task } from '../src/objects/task.object.js';
import taskHook from '../src/objects/task.hook.js';
import TodoApp from '../objectstack.config.js';

/** The two fields this card retired. */
const REMOVED_FIELDS = ['is_completed', 'is_overdue'] as const;

const openDrivers: Array<{ disconnect?: () => Promise<void> }> = [];
afterEach(async () => {
  while (openDrivers.length) {
    try { await openDrivers.pop()?.disconnect?.(); } catch { /* noop */ }
  }
});

/**
 * A real kernel over in-process sqlite-wasm with the app's real `todo_task`
 * object and its real lifecycle hook — the same shape
 * `task-completion-trigger.test.ts` boots, so the completion stamp behaves here
 * exactly as it does in the app.
 */
async function bootEngine(objectDef: unknown = Task) {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
  await kernel.use(new ObjectQLPlugin());
  await kernel.bootstrap();
  const objectql: any = kernel.getService('objectql');

  const driver: any = new SqliteWasmDriver({ filename: ':memory:' });
  await driver.connect();
  objectql.registerDriver(driver, true);
  openDrivers.push(driver);
  objectql.registry.registerObject(objectDef, 'todo', 'todo');
  await objectql.syncSchemas();
  objectql.bindHooks([taskHook], { packageId: 'app:com.example.todo' });
  return objectql;
}

/**
 * Every string that appears anywhere in `value` — as an object KEY or as a
 * string VALUE — flattened with the path that reached it.
 *
 * Both halves matter and they catch different re-introductions: a filter written
 * as `{ is_completed: false }` hides the name in a KEY, while a view filter
 * `{ field: 'is_completed', ... }` hides it in a VALUE. Cycles are guarded so a
 * metadata graph with back-references cannot hang the walk.
 */
function walkStrings(value: unknown, path = '$', seen = new WeakSet<object>()): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (typeof value === 'string') { out.push([path, value]); return out; }
  if (!value || typeof value !== 'object') return out;
  if (seen.has(value as object)) return out;
  seen.add(value as object);
  if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...walkStrings(v, `${path}[${i}]`, seen)));
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.push([`${path}.${k}`, k]);            // the KEY itself
    out.push(...walkStrings(v, `${path}.${k}`, seen));
  }
  return out;
}

describe('#7226 — the inert derived flags are removed, app-wide', () => {
  it('the object no longer declares either field', () => {
    const fields = (Task as unknown as { fields: Record<string, unknown> }).fields;
    for (const name of REMOVED_FIELDS) {
      expect(fields, `todo_task must not declare '${name}'`).not.toHaveProperty(name);
    }
    // Non-vacuous: the columns that replaced them are really there, so this
    // test cannot pass by the object failing to load.
    expect(fields).toHaveProperty('status');
    expect(fields).toHaveProperty('due_date');
    expect(fields).toHaveProperty('completed_date');
  });

  it('NOTHING in the whole app stack references either field — keys or values', () => {
    // The app's real `defineStack` default export: objects, views, dashboards,
    // reports, datasets, flows, actions, apps, translations and seed data.
    const hits = walkStrings(TodoApp)
      .filter(([, s]) => (REMOVED_FIELDS as readonly string[]).includes(s));

    expect(
      hits.map(([p, s]) => `${p} -> ${s}`),
      'a removed flag is still referenced; that filter can only ever match zero rows',
    ).toEqual([]);

    // Non-vacuous: the walk really does reach deep filter internals. If this
    // ever goes empty the assertion above is worthless, so pin a name that IS
    // expected to appear at depth.
    const statusHits = walkStrings(TodoApp).filter(([, s]) => s === 'status');
    expect(statusHits.length, 'the walk must actually reach filter internals').toBeGreaterThan(5);
  });

  it("the hook's afterUpdate no longer carries the unreachable overdue branch", () => {
    // Read the handler's own source: the branch was dead code, so no runtime
    // observation can distinguish "removed" from "never fired".
    const src = String((taskHook as unknown as { handler: unknown }).handler);
    expect(src).not.toMatch(/\bis_overdue\b/);
    // The completion log leg is untouched and still present.
    expect(src).toMatch(/completed by/);
  });
});

describe('#7226 — the replacement filters really select, on BOTH sides of the transition', () => {
  /** Fixed calendar anchors either side of "now", so the pin cannot drift. */
  const PAST = '2020-01-01';
  const FUTURE = '2999-01-01';

  it('status replaces is_completed — and the set FLIPS on the completion transition', async () => {
    const ql = await bootEngine();
    const t = await ql.insert('todo_task', { subject: 'write the report', status: 'in_progress', priority: 'normal' });
    const id = t.id ?? t._id;

    const open = () => ql.find('todo_task', { where: { status: { $ne: 'completed' } } });
    const done = () => ql.find('todo_task', { where: { status: 'completed' } });

    // BEFORE: the task is open. This is the state the old flag also reported
    // correctly (by accident), so on its own it proves nothing.
    expect((await open()).map((r: any) => r.id ?? r._id)).toEqual([id]);
    expect(await done()).toEqual([]);

    // Drive the real completion transition through the real hook.
    await ql.update('todo_task', { status: 'completed' }, { where: { id } });

    // AFTER: the sets have swapped. THIS is the half the old `is_completed`
    // flag failed — it stayed `false`, so "Completed Today" and both completed
    // reports stayed empty forever while `completed_date` was stamped.
    expect(await open()).toEqual([]);
    const completed = await done();
    expect(completed.map((r: any) => r.id ?? r._id)).toEqual([id]);
    // ...and it is consistent with the #7036 stamp by construction, which is
    // the divergence this card was filed for.
    expect(completed[0].completed_date, 'completion date and completion state agree').toBeTruthy();

    // Reopening puts it back — the filter tracks the column in both directions.
    await ql.update('todo_task', { status: 'in_progress' }, { where: { id } });
    expect((await open()).map((r: any) => r.id ?? r._id)).toEqual([id]);
    expect(await done()).toEqual([]);
  });

  it('due_date + status replaces is_overdue — selecting exactly the overdue rows', async () => {
    const ql = await bootEngine();
    const mk = async (subject: string, status: string, due?: string) =>
      (await ql.insert('todo_task', { subject, status, priority: 'normal', ...(due ? { due_date: due } : {}) }));

    const late = await mk('late', 'in_progress', PAST);
    const soon = await mk('not yet due', 'in_progress', FUTURE);
    const noDue = await mk('no due date', 'not_started');
    // Completed via the real transition, not seeded as `completed`: the app's
    // `completed_date_required` rule is satisfied by the hook's stamp on the
    // UPDATE path, so inserting a completed task directly is refused (#7036).
    const lateDone = await mk('late but finished', 'in_progress', PAST);
    await ql.update(
      'todo_task', { status: 'completed' }, { where: { id: lateDone.id ?? lateDone._id } },
    );

    // The shape the `overdue` view and the "Overdue Tasks" tile now declare.
    const overdue = await ql.find('todo_task', {
      where: { due_date: { $lt: new Date().toISOString().slice(0, 10) }, status: { $ne: 'completed' } },
    });
    const ids = overdue.map((r: any) => r.id ?? r._id);

    // Exactly one row qualifies, and each exclusion is a DIFFERENT reason —
    // future due date, no due date, and already completed.
    expect(ids).toEqual([late.id ?? late._id]);
    expect(ids).not.toContain(soon.id ?? soon._id);
    expect(ids).not.toContain(noDue.id ?? noDue._id);
    expect(ids).not.toContain(lateDone.id ?? lateDone._id);

    // Non-vacuous: all four rows exist and are visible to an unfiltered read,
    // so the three exclusions are the filter working, not an empty table.
    expect(await ql.find('todo_task', {})).toHaveLength(4);
  });
});

/**
 * REVERSE VERIFICATION — the measurement that chose removal over derivation.
 *
 * Predicted direction, recorded BEFORE running it: the formula field READS
 * correctly (so "just derive it" looks right) but is UNFILTERABLE. When #7226
 * ran it the failure was silent — 0 rows, no error — rather than an exception,
 * and this docblock named that asymmetry as the whole argument: **an exception
 * would have been safe, because someone would have seen it.**
 *
 * **#8296 supplied that exception**, and the second `it` below therefore
 * asserts a rejection envelope (`400 INVALID_FIELD`, naming the field and the
 * object) where it used to assert an empty array. That is this file's own
 * argument being adopted platform-wide — the safe design it asked for is now
 * the shipped one — not a correction of it.
 *
 * The verdict on the derive route is UNCHANGED. A formula field still
 * materialises no column and still cannot carry a predicate, so the eight app
 * filters that named these flags still could not have worked; removal in
 * favour of the stored `status` / `due_date` columns remains the only repair.
 * What #8296 changed is that choosing the derive route now fails where someone
 * can see it, instead of quietly answering an empty set.
 */
describe('REVERSE — why the derive route was rejected, measured', () => {
  /** `todo_task` as it would look on the derive route. */
  const DERIVED = {
    name: 'derived_task',
    label: 'Derived Task',
    fields: {
      id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
      subject: { name: 'subject', label: 'Subject', type: 'text' as const },
      status: { name: 'status', label: 'Status', type: 'text' as const },
      due_date: { name: 'due_date', label: 'Due', type: 'date' as const },
      is_completed: {
        name: 'is_completed', label: 'Is Completed', type: 'formula' as const,
        expression: { dialect: 'cel', source: 'record.status == "completed"' },
      },
      is_overdue: {
        name: 'is_overdue', label: 'Is Overdue', type: 'formula' as const,
        expression: {
          dialect: 'cel',
          source: 'record.status != "completed" && !isBlank(record.due_date) && date(record.due_date) < today()',
        },
      },
    },
  };

  it('a formula field COMPUTES both flags correctly — including the temporal one', async () => {
    const ql = await bootEngine(DERIVED);
    await ql.insert('derived_task', { id: 'a', subject: 'done', status: 'completed', due_date: '2020-01-01' });
    await ql.insert('derived_task', { id: 'b', subject: 'late', status: 'in_progress', due_date: '2020-01-01' });
    await ql.insert('derived_task', { id: 'c', subject: 'later', status: 'in_progress', due_date: '2999-01-01' });
    await ql.insert('derived_task', { id: 'd', subject: 'undated', status: 'not_started' });

    const byId = Object.fromEntries((await ql.find('derived_task', {})).map((r: any) => [r.id, r]));

    // `today()` in a stored formula FIELD is legitimate and evaluates per read.
    expect(byId.a.is_completed).toBe(true);
    expect(byId.a.is_overdue).toBe(false);   // completed, so not overdue
    expect(byId.b.is_completed).toBe(false);
    expect(byId.b.is_overdue).toBe(true);    // past due and open
    expect(byId.c.is_overdue).toBe(false);   // due in the future
    expect(byId.d.is_overdue).toBe(false);   // no due date at all
  });

  it('...and is UNFILTERABLE: a `where` naming one is REFUSED, 400 INVALID_FIELD (#8296)', async () => {
    const ql = await bootEngine(DERIVED);
    await ql.insert('derived_task', { id: 'a', subject: 'done', status: 'completed', due_date: '2020-01-01' });
    await ql.insert('derived_task', { id: 'b', subject: 'late', status: 'in_progress', due_date: '2020-01-01' });

    // A formula field materialises no column on any driver, so the predicate
    // cannot be applied as written. When #7226 measured this the engine handed
    // it to the driver anyway and answered 0 rows with no error; since #8296
    // the engine's filter seam refuses it by name. The full envelope is pinned,
    // not merely "it throws": a driver that happened to throw a bare `Error`
    // would satisfy a bare `.rejects` while proving nothing about the verdict.
    await expect(ql.find('derived_task', { where: { is_completed: true } })).rejects.toMatchObject({
      status: 400, code: 'INVALID_FIELD', field: 'is_completed', object: 'derived_task',
    });
    await expect(ql.find('derived_task', { where: { is_overdue: true } })).rejects.toMatchObject({
      status: 400, code: 'INVALID_FIELD', field: 'is_overdue', object: 'derived_task',
    });

    // THE decisive one. On the old stored boolean this returned EVERY row; as a
    // formula it is not answerable at all. Eight filters in this app relied on
    // exactly this predicate ("Due Today", the reminder flow, both open-task
    // reports, three distribution charts), so the derive route would have
    // broken every one of them — before #8296 by silently emptying them, after
    // #8296 by failing loudly on the first query. Neither is a working app,
    // which is why these flags were removed rather than derived.
    await expect(ql.find('derived_task', { where: { is_completed: false } })).rejects.toMatchObject({
      status: 400, code: 'INVALID_FIELD', field: 'is_completed', object: 'derived_task',
    });

    // CONTROL — the stored column answers correctly on the same rows and the
    // same engine, so the refusal above is about the field being virtual, not
    // about the fixture or the driver. (Assertions unchanged from #7226: the
    // anti-vacuity arm never depended on the formula's failure mode.)
    expect((await ql.find('derived_task', { where: { status: 'completed' } })).map((r: any) => r.id)).toEqual(['a']);
    expect((await ql.find('derived_task', { where: { status: { $ne: 'completed' } } })).map((r: any) => r.id)).toEqual(['b']);
  });
});
