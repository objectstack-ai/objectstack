/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectGantt` reads its `find()` answers as `QueryResult` DECLARES them — and
 * does NOT read `records` (objectui#6839).
 *
 * ⭐ This module is the one with TWO sinks, reached by two different routes,
 * and they behave differently — which is why they are pinned separately here
 * rather than folded into one "the gantt rendered" case:
 *
 *   1. THE ROWS — `find(task)` -> `applyNonGridRowCeiling` (`@object-ui/react`)
 *      -> `extractRecords`. Indirect: this component never names the helper on
 *      this path, so a card enumerating the helper's direct callers would not
 *      list it. A refused envelope draws an empty chart.
 *   2. THE QUICK-FILTER DOMAIN — `find(projects)` -> `extractRecords`, called
 *      directly. A refused envelope here does NOT empty the chart: the bars
 *      still draw, and the only casualty is the dropdown's option list, which
 *      silently narrows to the values present in the loaded rows. That failure
 *      is invisible to any rows-only assertion, and it is the reason this file
 *      asserts the domain separately.
 *
 * MEASURED for this module: no `find()` in `plugin-gantt`, nor in any app or
 * example mounting a gantt, emits a `records` envelope — the package's four
 * `records:` occurrences are three doc comments and a record-VISIBILITY batch
 * route stub (`fetch`, not `find`). CONTROL, so the zero is a reading: the same
 * sweep finds a live `find()` double emitting `{ records: [...] }` at
 * `plugin-list`'s ObjectGallery, a consumer with its own unwrap ladder.
 *
 * ⚠️ Every refusal case is ALSO satisfied by an `extractRecords` that returns
 * `[]` for everything — an implementation strictly worse than the bug. The
 * `data` and bare-array cases refuse it: they push the SAME rows through the
 * SAME mounts, on BOTH sinks.
 *
 * ## The waits were repaired in objectui#8665 — what was measured
 *
 * Both refusal arms below used to read WITHOUT a completion anchor: sink 1 read
 * the bars straight after a wait on `find` merely having been CALLED, and sink
 * 2 asserted an ABSENCE with nothing proving the domain query had answered.
 * Probed on this component with the two queries answering at different times:
 *
 *   - sink 2, LIVE `data` envelope, domain answering one macrotask later:
 *     `offersP3=false, offered=[p1]` where the old shape read it, and
 *     `offered=[p1,p2,p3]` once the same mount settled. ⇒ the refusal
 *     assertion PASSED against a component that resolved the whole domain.
 *     The arm was measuring the polling tick, not the envelope.
 *   - sink 1, same profile: the DOM at the old wait was the `Loading Gantt
 *     chart…` placeholder and the read threw `Unable to find an element by:
 *     [data-testid="gantt-view"]` — a failure that is not about the envelope.
 *
 * Both now anchor on something that appears only once the relevant query has
 * settled, and both anchors are PRESENCE assertions, so neither arm can pass
 * by timing out. See {@link mount} and {@link domainSettled}.
 *
 * MODULE RESOLUTION: this file imports the component by relative source path
 * and `@object-ui/core` is aliased by the root `vitest.config.mts` to
 * `packages/core/src`, so both legs resolve to SOURCE — no package `exports`
 * hop, no `dist`, and therefore no rebuild leg to get wrong.
 */

import React from 'react';
import { render, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * `GanttView` is mocked to a thin shell surfacing the task count, exactly as
 * `ObjectGantt.quickfilter.test.tsx` and `ObjectGantt.referenceArms-6837
 * .test.tsx` do — how the chart paints bars is not what this file observes.
 *
 * It also surfaces the drawn TITLES. A count alone is satisfied by any two
 * rows, so the positive arms below assert which two arrived; the count on its
 * own could not tell `TASKS` from some other pair the unwrap ladder invented.
 */
vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div
      data-testid="gantt-view"
      data-count={tasks.length}
      data-titles={tasks.map((t: any) => t.title).join('|')}
    />
  ),
}));

import { ObjectGantt } from './ObjectGantt';

afterEach(cleanup);

/** Both loaded rows point at `p1`, so `p2`/`p3` can only come from the domain. */
const TASKS = [
  { id: '1', name: 'Alpha', start: '2024-01-01', end: '2024-01-05', project: 'p1' },
  { id: '2', name: 'Beta', start: '2024-02-01', end: '2024-02-10', project: 'p1' },
];

/** The referenced object's full domain — reachable ONLY through sink 2. */
const PROJECTS = [
  { id: 'p1', name: 'Apollo' },
  { id: 'p2', name: 'Borealis' },
  { id: 'p3', name: 'Cygnus' },
];

/**
 * The CONTROL dimension's domain — the completion anchor sink 2 is read
 * against. See {@link domainSettled}.
 *
 * No loaded task carries an `owner`, so the distinct-values fallback offers
 * NOTHING for this dimension: an `owner` option in the dropdown can only have
 * come from the domain fetch having been read and committed.
 */
const PEOPLE = [
  { id: 'u1', name: 'Ada' },
  { id: 'u2', name: 'Grace' },
];

/** How one case wraps its rows on the way back out of `find()`. */
type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asBareArray: Envelope = (rows) => rows;
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });

const GANTT_SCHEMA = {
  type: 'gantt',
  objectName: 'task',
  startDateField: 'start',
  endDateField: 'end',
  titleField: 'name',
  quickFilters: [
    { field: 'project', label: 'Project' },
    // The control dimension — resolved by the SAME `setLookupOptions` commit
    // as `project`, and answered OUTSIDE the envelope under test.
    { field: 'owner', label: 'Owner' },
  ],
} as any;

/**
 * Mount over a `find()` that wraps BOTH answers in `envelope`, wait for the
 * schema-dependent query, and then wait for the chart to have FINISHED
 * loading.
 *
 * ## The two waits do different jobs — objectui#8665
 *
 * The first is envelope-INDEPENDENT evidence that the schema was consumed:
 * once `objectSchema` lands, the record query is re-issued carrying `$expand`,
 * and `buildExpandFields` decides that from the field's `type` alone. So the
 * recorded `find('task', {$expand})` proves the component consumed the schema
 * for a REFUSED envelope exactly as it does for a live one.
 *
 * ⛔ But that call being RECORDED is not the query having ANSWERED, and this
 * file used to read the bars straight off it. Probed on this component
 * (objectui#8665): with the row query answering one macrotask later, the DOM at
 * the moment that wait passed was the `Loading Gantt chart…` placeholder, and
 * the read threw `Unable to find an element by: [data-testid="gantt-view"]` —
 * the pin failing for a reason that is not about the envelope at all.
 *
 * ⭐ So the second wait is the COMPLETION ANCHOR, and it is keyed to the
 * component's own mechanism: `gantt-view` renders BELOW `ObjectGantt`'s
 * `if (loading)` early return, and `loading` is cleared in `reload`'s
 * `finally` — in the same commit as `setData(capped.rows)`, and only by the
 * newest reload (both are guarded by `isCurrent()`). So this node's presence is
 * proof that the row query settled AND committed. It is a PRESENCE assertion,
 * so it cannot pass by timing out, which is the failure mode every
 * absence-shaped pin has.
 *
 * ⛔ Call ONCE per case, never inside a `waitFor` predicate (objectui#7802).
 */
async function mount(envelope: Envelope) {
  const ds: any = {
    find: vi.fn(async (object: string) => {
      // The control domain is answered OUTSIDE the envelope under test, as a
      // bare array, so {@link domainSettled} anchors on the same DOM whichever
      // envelope this case is exercising.
      if (object === 'people') return PEOPLE;
      return object === 'projects' ? envelope(PROJECTS) : envelope(TASKS);
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'task',
      fields: {
        name: { type: 'text' },
        start: { type: 'date' },
        end: { type: 'date' },
        project: { type: 'lookup', reference: 'projects' },
        owner: { type: 'lookup', reference: 'people' },
      },
    }),
  };
  const view = render(<ObjectGantt schema={GANTT_SCHEMA} dataSource={ds} />);
  await waitFor(() =>
    expect(
      ds.find.mock.calls.some((c: any[]) => c[0] === 'task' && c[1]?.$expand?.includes('project')),
    ).toBe(true),
  );
  await view.findByTestId('gantt-view');
  // Carried as its own observation so "the chart finished loading" and "the
  // chart drew no bars" can never stand in for one another.
  const drewChart = view.queryByTestId('gantt-view') !== null;
  return { ds, view, drewChart };
}

/** Bars the chart drew — sink 1. */
const bars = (view: any) => Number(view.getByTestId('gantt-view').getAttribute('data-count'));

/** The titles the chart drew — sink 1, as a shape rather than a count. */
const barTitles = (view: any) =>
  view.getByTestId('gantt-view').getAttribute('data-titles') as string;

/**
 * ⭐ THE COMPLETION ANCHOR FOR SINK 2 (objectui#8665).
 *
 * Sink 2's refusal case is an ABSENCE — "`p3` is not offered" — and an absence
 * is satisfied by a component that has not answered yet. Probed on this
 * component: with the domain query answering one macrotask after the rows, the
 * LIVE `data` envelope produced `offersP3=false, offered=[p1]` at the moment
 * the old shape read it, while the very same mount settled to
 * `offered=[p1,p2,p3]`. ⇒ the refusal assertion passed against a component
 * that demonstrably DID resolve the domain. Nothing about the envelope was
 * being measured; the polling tick was.
 *
 * `ObjectGantt` publishes no DOM marker for that fetch on the REFUSING branch —
 * a refused domain leaves `lookupOptions[field]` an empty array, the resolver
 * falls through to "distinct values present in the loaded data", and the
 * dropdown looks exactly as it does before the fetch answers. So the anchor is
 * a CONTROL DIMENSION instead: `owner` is a second lookup resolved by the same
 * effect, whose `setLookupOptions` call sits AFTER the loop over every
 * dimension — one commit for all of them. No loaded task carries an `owner`,
 * so the fallback offers nothing there and `u1` can only come from the domain
 * fetch having been read and committed.
 *
 * ⇒ waiting for `u1` proves the `projects` answer was consumed in that same
 * commit, and it is a PRESENCE assertion, so this arm cannot pass by timing
 * out. It also reddens under "resolve nothing, ever" — the implementation
 * strictly worse than the bug, which the old absence-only shape passed.
 */
async function domainSettled(view: any): Promise<void> {
  fireEvent.click(view.getByTestId('quick-filter-trigger-owner'));
  await view.findByTestId('quick-filter-option-owner-u1');
}

/**
 * Is `p3` — a project NO loaded row points at — offered in the dropdown?
 *
 * This is the only observation that separates sink 2 from sink 1: the fallback
 * arm ("distinct values present in the loaded data") would still offer `p1`
 * whether or not the domain fetch was read.
 *
 * ⛔ Read it only AFTER {@link domainSettled}.
 */
async function offersUnloadedProject(view: any): Promise<boolean> {
  fireEvent.click(view.getByTestId('quick-filter-trigger-project'));
  const panel = await view.findByTestId('quick-filter-panel-project');
  return within(panel).queryByTestId('quick-filter-option-project-p3') !== null;
}

describe('ObjectGantt — the find() envelopes it reads (objectui#6839)', () => {
  describe('sink 1 — the rows, via applyNonGridRowCeiling', () => {
    it("still reads the contract's `data` member", async () => {
      const { view } = await mount(asData);
      expect(bars(view), 'the declared rows member must still draw').toBe(2);
      expect(barTitles(view), 'and it must draw THOSE two tasks').toBe('Alpha|Beta');
    });

    it('still reads a bare array — the live non-envelope shape fakes answer with', async () => {
      const { view } = await mount(asBareArray);
      expect(bars(view), 'the bare-array arm must still draw').toBe(2);
      expect(barTitles(view), 'and it must draw THOSE two tasks').toBe('Alpha|Beta');
    });

    it('does NOT read `records` — not a QueryResult member', async () => {
      // Before the fix these two tasks drew off a key `QueryResult` does not
      // declare, and did so AHEAD of `data`.
      const { view, drewChart } = await mount(asRecords);
      // TWO observations, kept apart on purpose: without the first, a zero-bar
      // reading is indistinguishable from a chart that had not drawn yet —
      // which is what this arm did before objectui#8665.
      expect(
        drewChart,
        'the chart must have finished loading before it is read — an unanchored zero cannot tell a refusal from a chart still in its loading placeholder',
      ).toBe(true);
      expect(
        bars(view),
        'a `records` envelope must reach the chart as zero bars, not as the tasks it names',
      ).toBe(0);
      expect(barTitles(view), 'and no task titles at all').toBe('');
    });
  });

  describe('sink 2 — the quick-filter option domain, read directly', () => {
    it("still reads the contract's `data` member", async () => {
      const { view } = await mount(asData);
      await domainSettled(view);
      expect(
        await offersUnloadedProject(view),
        'the full referenced domain must still widen the dropdown past the loaded rows',
      ).toBe(true);
    });

    it('still reads a bare array', async () => {
      const { view } = await mount(asBareArray);
      await domainSettled(view);
      expect(await offersUnloadedProject(view)).toBe(true);
    });

    it('does NOT read `records` — and the chart is NOT how you would notice', async () => {
      // The sharp half of this file. The bars are unaffected by sink 2, so a
      // rows-only pin would have called this module green while the dropdown
      // silently narrowed to the values already on screen.
      const { view } = await mount(asRecords);
      // ⭐ The absence below is only worth reading once the domain resolution
      // has COMMITTED. `domainSettled` is what makes this arm fail when the
      // domain is read, instead of passing because it has not answered yet.
      await domainSettled(view);
      expect(
        await offersUnloadedProject(view),
        'a `records` envelope must not resolve the referenced domain',
      ).toBe(false);
    });
  });
});
