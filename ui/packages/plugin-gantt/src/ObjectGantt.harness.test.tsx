/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectGantt's shared harness: the pins that render the real `ObjectGantt`
 * over a stand-in bar canvas and a stubbed record drawer, folded into one file
 * (objectstack#29469, the rollout of objectstack#25911's pilot).
 *
 * Each block below was its own file, named in its `describe`, with the same
 * three mocks: `sonner`'s toast, `./GanttView`, and `@object-ui/plugin-detail`
 * with `RecordDetailDrawer` and `deriveRecordPageHref` stubbed out. Only the
 * `GanttView` stand-in differed, in which task attributes it writes to the
 * DOM. Under the `dom` project's `isolate: true`, each of those files paid the
 * whole module graph's import again, and the import was nearly all of a file's
 * time. Here the graph loads once, and each block installs its own stand-in in
 * a `beforeEach`, through the `standIns` slot the `./GanttView` mock reads.
 * Every block keeps its fixtures, hooks and assertions as they were, and its
 * issue number in its `describe`.
 *
 * Isolation between blocks:
 *  - React Testing Library's `cleanup()` runs after every test (the `dom`
 *    setup registers it).
 *  - Every fixture, adapter and call log is declared inside its block, so no
 *    block reads another's.
 *  - `./index` is imported once, for the blocks that render through
 *    `SchemaRenderer`: it registers `object-gantt` in the `ComponentRegistry`
 *    for the whole file. No block asserts that key absent.
 *
 * A new `ObjectGantt` pin that renders over these three mocks joins this file
 * as its own top-level `describe`, and installs its `GanttView` stand-in the
 * same way.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { NON_GRID_ROW_CEILING, nonGridRowCeilingQuery, ValueDataSource } from '@object-ui/core';
import { SchemaRendererProvider, SchemaRenderer } from '@object-ui/react';
import { ObjectGantt } from './ObjectGantt';
import './index';

/** The `GanttView` stand-in the running block installed; the `./GanttView` mock renders it. */
const standIns = vi.hoisted(() => ({
  ganttView: null as null | ((props: Record<string, unknown>) => unknown),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('./GanttView', () => ({
  GanttView: (props: Record<string, unknown>) => {
    if (!standIns.ganttView) {
      throw new Error('ObjectGantt.harness: the running block installed no GanttView stand-in in its beforeEach.');
    }
    return standIns.ganttView(props);
  },
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

// ── ObjectGantt.fetchGate-7225 ──────────────────────────────────────────────────

/**
 * objectui#7225 ask 2 — the gantt's DUPLICATE query is gated (maintainer
 * ruling B, 2026-09-02; objectui#6482's undischarged gating half).
 *
 * Before this, `reload` listed `objectSchema` in its dependency list, so a
 * mount issued TWO `find` calls: one before the object schema settled, with
 * `buildExpandFields` seeing no fields and therefore NO `$expand` at all, and
 * one after. Measured on this component with an instrumented adapter over
 * three latency profiles — invariably 2 `find` and 1 `getObjectSchema` per
 * load, expand sets `[null, ['owner']]`.
 *
 * ⭐ Why gating pays HERE, per #6482's own per-component standard (it measured
 * three profiles and found the cost differs by component, so the table is not
 * an argument on its own): the gantt is not the mild kanban-style "round trip
 * bought and thrown away". Whenever the metadata read is the slower of the two
 * — the common case on a cold `MetadataCache` — the user sees the full
 * THREE-STEP PAINT: raw foreign-key ids, back to the loading placeholder, then
 * the expanded rows.
 *
 * ⛔ GATING IS NOT CAPPING. objectui#7210's ruling a' put a row ceiling on
 * these queries and that is a different change on the same lines; this file
 * asserts only HOW MANY queries go out and whether the first one carries its
 * expansion. The ceiling has its own pin
 * (the `ObjectGantt.rowCeiling-7210` block in this file).
 *
 * ⚠️ The gate is only safe because the schema resolution now SETTLES ON EVERY
 * EXIT (objectui#7232): the component's own effect used to return without
 * settling on `!effectiveDataSource`, on `!resource` and in its `catch`, which
 * cost nothing while nothing waited on it — and would hold a gated query open
 * FOREVER. `useSettledSchema` settles on all three, and the last two cases
 * below are that trap, pinned: a chart that never loads is the failure this
 * file exists to make impossible.
 *
 * REVERSE VERIFICATION — prediction MISSED, reported rather than adjusted.
 * Predicted before running: deleting
 * `if (recordQueryDerivesExpand && !objectSchemaReady) return;` from
 * `ObjectGantt` turns the first two cases red and leaves the two
 * settle-on-every-exit cases green — 2 failed / 3 passed. OBSERVED:
 * **4 failed / 1 passed**. Direction as predicted, magnitude higher, and the
 * reason is worth writing down: the prediction assumed the second query came
 * from `objectSchema`'s identity changing, so a definition that settles as
 * `null` (no `getObjectSchema`, or a read that threw) would still produce one
 * query. It does not. The second query comes from `objectSchemaReady` being in
 * the effect's DEPENDENCY LIST — it flips `false` to `true` on every path,
 * including both settle-with-nothing paths, so with the early return deleted
 * the effect re-runs and reloads a second time in all four adapter cases. The
 * inline-`value` case is the one that stays green, since it never queries at
 * all. The gate line and the dependency are two halves of one mechanism, and
 * the ablation only removed one of them.
 */
describe('ObjectGantt.fetchGate-7225', () => {
  beforeEach(() => {
    standIns.ganttView = ({ tasks }: any) => (
      <div data-testid="gantt-view" data-task-count={String(tasks.length)} />
    );
  });

  const ROWS = [
    { id: '1', subject: 'Renewal', owner: 'u1', visible_from: '2026-01-01', due_date: '2026-01-05' },
  ];

  /** A definition with a lookup, so a gated query has a real `$expand` to carry. */
  const OBJECT_DEF = {
    name: 'task',
    fields: {
      id: { name: 'id', type: 'text' },
      subject: { name: 'subject', type: 'text' },
      owner: { name: 'owner', type: 'lookup', reference: 'user' },
      visible_from: { name: 'visible_from', type: 'date' },
      due_date: { name: 'due_date', type: 'date' },
    },
  };

  function makeAdapter(getObjectSchema?: any) {
    return {
      find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      ...(getObjectSchema === undefined ? {} : { getObjectSchema }),
    } as any;
  }

  const schema: any = {
    type: 'object-gantt',
    objectName: 'task',
    gantt: { titleField: 'subject', startDateField: 'visible_from', endDateField: 'due_date' },
  };

  /** The expand sets of every issued query, in order. */
  function expandSets(adapter: any): Array<unknown> {
    return adapter.find.mock.calls.map(([, params]: [string, any]) => params?.$expand ?? null);
  }

  describe('objectui#7225 ask 2 — the gantt waits for the object schema instead of querying twice', () => {
    it('issues ONE query per load, and it already carries the expansion', async () => {
      const adapter = makeAdapter(vi.fn(async () => OBJECT_DEF));

      render(<ObjectGantt schema={schema} dataSource={adapter} />);

      await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
      await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));

      // The old regime's signature was `[null, ['owner']]`. One expanded call.
      expect(expandSets(adapter)).toEqual([['owner']]);
      expect(adapter.getObjectSchema).toHaveBeenCalledTimes(1);
    });

    it('never issues an UNEXPANDED query for an object that declares a lookup', async () => {
      const adapter = makeAdapter(vi.fn(async () => OBJECT_DEF));

      render(<ObjectGantt schema={schema} dataSource={adapter} />);

      await waitFor(() => expect(adapter.find).toHaveBeenCalled());
      // The discarded round trip — and the raw-id frame it painted — is the
      // thing gating removes. Not "fewer" unexpanded calls: none.
      for (const params of adapter.find.mock.calls.map(([, p]: [string, any]) => p)) {
        expect(params.$expand).toEqual(['owner']);
      }
    });

    it('still queries when the adapter exposes NO `getObjectSchema` — the gate is on SETTLED, not on truthy', async () => {
      // objectui#7232's trap: an exit that returns without settling would hold
      // this query open forever, and the chart would never load.
      const adapter = makeAdapter(undefined);

      render(<ObjectGantt schema={schema} dataSource={adapter} />);

      await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
      expect(adapter.find).toHaveBeenCalledTimes(1);
      // Nothing to derive an expand set from, so the query is unexpanded — which
      // is the same query this case produced before the gate.
      expect(expandSets(adapter)).toEqual([null]);
    });

    it('still queries when the definition read REJECTS', async () => {
      const adapter = makeAdapter(
        vi.fn(async () => {
          throw new Error('metadata endpoint down');
        }),
      );
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        render(<ObjectGantt schema={schema} dataSource={adapter} />);

        await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
        expect(adapter.find).toHaveBeenCalledTimes(1);
        expect(expandSets(adapter)).toEqual([null]);
        expect(String(error.mock.calls[0]?.[0] ?? '')).toContain('[useSettledSchema]');
      } finally {
        error.mockRestore();
      }
    });

    it('an inline `value` data set paints without waiting for any metadata read', async () => {
      const inline: any = {
        ...schema,
        data: { provider: 'value', items: ROWS },
      };
      const adapter = makeAdapter(vi.fn(async () => OBJECT_DEF));

      render(<ObjectGantt schema={inline} dataSource={adapter} />);

      await waitFor(() =>
        expect(screen.getByTestId('gantt-view').getAttribute('data-task-count')).toBe('1'),
      );
      expect(adapter.find).not.toHaveBeenCalled();
    });
  });
});

// ── ObjectGantt.rowCeiling-7210 ─────────────────────────────────────────────────

/**
 * objectui#7210, half 2 — maintainer ruling a′ (2026-09-02), on the gantt.
 *
 * The ruling, and the pin it names: a non-grid visualisation may fetch the
 * whole FILTERED result set, because a truthful range needs all of it, but the
 * fetch carries a platform-level hard ceiling expressed as a named constant in
 * the renderer, not an authorable view key. Past the ceiling the visualisation
 * draws the first N rows and shows a LOUD FOOTNOTE naming both N and M.
 * Below it: no footnote, and the full set draws.
 *
 * ⛔ The direction the ruling calls dangerous is SILENT truncation — "a cut-off
 * schedule still looks like a schedule". That is precisely what these cases
 * exist to make impossible to reintroduce: the first one would still pass if
 * the footnote were deleted and only the cap kept, so it asserts the note's
 * text and BOTH numbers, not merely the row count.
 *
 * ⛔ This is the CAP, not the gate. objectui#7225's half gates the gantt's
 * DUPLICATE schema-driven query; nothing here is about that, and the two are
 * separate commits on this branch for that reason.
 *
 * REVERSE VERIFICATION — MEASURED, and corrected from what this docblock used
 * to predict (objectui#7507). Removing `...nonGridRowCeilingQuery()` from
 * `ObjectGantt`'s reload turns the truncation case red at the **`$top`
 * assertion**; the below-ceiling case stays green. ⚠️ The pass/fail TALLY that
 * used to be quoted here is deliberately gone: objectui#8769 changed how many
 * cases this file has, and a stale count reads as a measurement.
 *
 * ⚠️ It does NOT go red at the footnote. The prediction that it would — "no
 * probe row ⇒ `truncated` false ⇒ no note" — reads the mechanism backwards,
 * and a wrong mechanism in a docblock is worse than none, because the next
 * reader trusts it while deciding what an edit is safe to break. What actually
 * happens: an adapter with no `$top` answers with the WHOLE filtered set, so
 * `applyNonGridRowCeiling` sees far more rows than the ceiling, slices to it,
 * and reports `truncated` from the rows in hand. The drawn count stays 2,000
 * and the note still names both numbers. The probe row bounds the RESPONSE; it
 * is not what makes truncation detectable once an unbounded one has arrived.
 * So in this file the `$top` is graded by the `$top` assertion and by nothing
 * else — which is the reason that assertion is not redundant with the note.
 */
describe('ObjectGantt.rowCeiling-7210', () => {
  beforeEach(() => {
    // The bar canvas is irrelevant here — every assertion is about how many rows
    // reached the chart and what the component says about them. Same stub the
    // sibling ObjectGantt tests use, for the same reason.
    standIns.ganttView = ({ tasks }: any) => (
      <div data-testid="gantt-view" data-task-count={String(tasks.length)} />
    );
  });

  /** The whole filtered result set the store holds. */
  const TOTAL_ROWS = 4321;

  function makeRows(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: String(i + 1),
      subject: `Task ${i + 1}`,
      visible_from: '2026-01-01',
      due_date: '2026-12-31',
    }));
  }

  let calls: Array<Record<string, any>> = [];

  /** An adapter that HONOURS `$top`, the way a real one does. */
  function makeDataSource(storeSize: number) {
    const store = makeRows(storeSize);
    return {
      find: vi.fn(async (_resource: string, params: any) => {
        calls.push({ ...(params ?? {}) });
        const top = typeof params?.$top === 'number' ? params.$top : store.length;
        return { data: store.slice(0, top), total: store.length };
      }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => ({
        name: 'duly_task',
        fields: {
          id: { name: 'id', type: 'text' },
          subject: { name: 'subject', type: 'text' },
          visible_from: { name: 'visible_from', type: 'date' },
          due_date: { name: 'due_date', type: 'date' },
        },
      })),
    } as any;
  }

  const schema: any = {
    type: 'object-gantt',
    objectName: 'duly_task',
    gantt: {
      titleField: 'subject',
      startDateField: 'visible_from',
      endDateField: 'due_date',
    },
  };

  describe('objectui#7210 ruling a′ — the gantt draws at most the platform ceiling, loudly', () => {
    beforeEach(() => {
      calls = [];
    });

    it('above the ceiling: draws exactly N rows and names BOTH N and M', async () => {
      const dataSource = makeDataSource(TOTAL_ROWS);

      render(<ObjectGantt schema={schema} dataSource={dataSource} />);

      await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
      await waitFor(() =>
        expect(screen.getByTestId('gantt-view').getAttribute('data-task-count')).toBe(
          String(NON_GRID_ROW_CEILING),
        ),
      );

      // The fetch asked for one probe row past the ceiling — that is what makes
      // the cut a fact about the rows in hand rather than a guess.
      expect(calls.length).toBeGreaterThan(0);
      for (const params of calls) {
        expect(params.$top).toBe(nonGridRowCeilingQuery().$top);
      }

      // ⭐ The half the ruling cares about: the truncation is NOT silent.
      const note = await screen.findByRole('note');
      expect(note.getAttribute('data-row-ceiling-note')).toBe('non-grid');
      expect(note.textContent).toContain(String(NON_GRID_ROW_CEILING));
      expect(note.textContent).toContain(String(TOTAL_ROWS));
      expect(note.textContent).toMatch(/narrow the filter/i);
    });

    it('below the ceiling: the full set draws and there is NO footnote', async () => {
      const dataSource = makeDataSource(7);

      render(<ObjectGantt schema={schema} dataSource={dataSource} />);

      await waitFor(() =>
        expect(screen.getByTestId('gantt-view').getAttribute('data-task-count')).toBe('7'),
      );
      expect(screen.queryByRole('note')).toBeNull();
    });

    /**
     * ⚠️ THIS CASE WAS INVERTED (objectui#8769). It used to read "an inline
     * `value` data set is never capped by us, and never footnoted", and it was
     * green because `reload` returned before the query — the same short-circuit
     * that dropped an authored `filter` on that provider. It pinned the
     * SHORT-CIRCUIT, not ruling a′: the ruling's budget is measured in DOM
     * ELEMENTS PER RECORD, its own measurement table was taken over "real child
     * views, inline `value` provider", and its text carves out no provider. An
     * inline row costs the browser exactly what a fetched row costs.
     *
     * The inline provider's own three-key pin lives in
     * the `ObjectGantt.inlineQueryKeys-8769` block in this file; this one stays here so the
     * ceiling's own file states the exemption boundary in one place.
     */
    it('an inline `value` data set IS capped, and says so', async () => {
      const total = nonGridRowCeilingQuery().$top + 500;
      const inline: any = {
        ...schema,
        data: { provider: 'value', items: makeRows(total) },
      };

      render(<ObjectGantt schema={inline} />);

      await waitFor(() =>
        expect(screen.getByTestId('gantt-view').getAttribute('data-task-count')).toBe(
          String(NON_GRID_ROW_CEILING),
        ),
      );
      const note = await screen.findByRole('note');
      expect(note.textContent).toContain(String(NON_GRID_ROW_CEILING));
      expect(note.textContent).toContain(String(total));
    });

    /**
     * The exemption that REMAINS, and the reason the case above is not a
     * contradiction: rows a HOST component hands down through the `data` prop
     * are not ours to cap — we did not issue the query that produced them and
     * have no `total` to name in a footnote.
     */
    it('a host `data` prop is still never capped, and never footnoted', async () => {
      const rows = makeRows(nonGridRowCeilingQuery().$top + 500);

      render(<ObjectGantt schema={schema} {...({ data: rows } as any)} />);

      await waitFor(() =>
        expect(screen.getByTestId('gantt-view').getAttribute('data-task-count')).toBe(
          String(rows.length),
        ),
      );
      expect(screen.queryByRole('note')).toBeNull();
    });
  });
});

// ── ObjectGantt.hostDataProp-7210 ───────────────────────────────────────────────

/**
 * objectui#7210 — the registered `object-gantt` renderer draws its OWN query,
 * not the host's rows.
 *
 * This is the measured basis for the paging-chrome correction one package over
 * (`plugin-list/src/ListView.tsx`, `surfaceDrawsFetchedRows`): a host that
 * fetches a page and hands it down as `data` — `ListView` does exactly that,
 * for every view type — does not thereby feed the chart. `ObjectGanttRenderer`
 * (`./index`) destructures `{ schema }` and renders
 * `< ObjectGantt schema={bound} dataSource={dataSource} / >`, forwarding no
 * other prop, so `ObjectGantt.reload`'s `rest.data` short-circuit is never
 * reached from the registry path and the component queries for itself. The
 * sibling wrappers (`object-grid`, `object-kanban`, `object-calendar`,
 * `object-map`, `object-tree`) all spread `{...props}`; this one is the outlier.
 *
 * Two facts are pinned, because the footer correction rests on both:
 *
 *   1. the rows drawn are the ADAPTER's, not the host `data` prop's;
 *   2. the query's `$top` is the PLATFORM CEILING — so its row count is not the
 *      host's page size and cannot be made to be by authoring
 *      `pagination.pageSize`.
 *
 * ⛔ Do not "fix" (1) by spreading `{...props}` in the renderer. That caps the
 * chart at the host's page — a complete schedule silently becomes a truncated
 * one that still looks like a schedule.
 *
 * ⚠️ Case (2) changed shape when objectui#7210's half 2 was RULED (a′,
 * 2026-09-02) and kept its point. When this file was written the answer was
 * open and the query carried no `$top` at all; the ruling settled it — a
 * non-grid view may fetch the whole filtered set up to a PLATFORM CEILING
 * expressed as a named constant in the renderer, and past it must say so
 * loudly. So the assertion moves from "no cap" to "the cap is the platform's",
 * which is what still separates it from the forbidden direction: `pageSize: 2`
 * is on this schema and the query is not 2 rows wide. The pin that the host's
 * page cannot bound the chart is unchanged; only the reason the number is not
 * the host's has been written down.
 *
 * REVERSE VERIFICATION — direction and counts predicted before running: add
 * `{...props}` to the `ObjectGanttRenderer` children callback and BOTH
 * assertions in the first case flip (5 rows → 2, host rows drawn), while the
 * `$top` case stays green because the component never gets as far as querying.
 */
describe('ObjectGantt.hostDataProp-7210', () => {
  beforeEach(() => {
    standIns.ganttView = ({ tasks }: any) => (
      <div data-testid="gantt-view" data-task-count={String(tasks.length)}>
        {tasks.map((t: any) => (
          <div key={t.id} data-testid={`gv-task-${t.id}`}>{t.title}</div>
        ))}
      </div>
    );
  });

  /** What the adapter answers with — the whole result set. */
  const ADAPTER_ROWS = Array.from({ length: 5 }, (_, i) => ({
    id: String(i + 1),
    subject: `Adapter task ${i + 1}`,
    visible_from: '2026-01-01',
    due_date: '2026-01-10',
  }));

  /** What a paging host hands down as `data` — one page of it. */
  const HOST_PAGE = ADAPTER_ROWS.slice(0, 2).map(r => ({ ...r, subject: `Host task ${r.id}` }));

  const schema: any = {
    type: 'object-gantt',
    objectName: 'duly_task',
    gantt: {
      titleField: 'subject',
      startDateField: 'visible_from',
      endDateField: 'due_date',
    },
  };

  let calls: Array<Record<string, any>> = [];

  function makeDataSource() {
    return {
      find: vi.fn(async (_resource: string, params: any) => {
        calls.push({ ...(params ?? {}) });
        return { data: ADAPTER_ROWS, total: ADAPTER_ROWS.length };
      }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => ({
        name: 'duly_task',
        fields: {
          id: { name: 'id', type: 'text' },
          subject: { name: 'subject', type: 'text' },
          visible_from: { name: 'visible_from', type: 'date' },
          due_date: { name: 'due_date', type: 'date' },
        },
      })),
    } as any;
  }

  describe('objectui#7210 — object-gantt ignores a host `data` prop', () => {
    beforeEach(() => {
      calls = [];
    });

    it('draws the adapter rows, not the page the host handed down', async () => {
      const dataSource = makeDataSource();

      render(
        <SchemaRendererProvider dataSource={dataSource}>
          <SchemaRenderer schema={schema} data={HOST_PAGE} />
        </SchemaRendererProvider>,
      );

      await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
      await waitFor(() =>
        expect(screen.getByTestId('gantt-view').getAttribute('data-task-count')).toBe('5'),
      );

      // The host's two rows are nowhere on screen; all five adapter rows are.
      expect(screen.queryByText('Host task 1')).toBeNull();
      expect(screen.getByText('Adapter task 5')).toBeTruthy();
      expect(calls.length).toBeGreaterThan(0);
    });

    it('issues its query at the PLATFORM ceiling — the host page size cannot bound it', async () => {
      const dataSource = makeDataSource();

      render(
        <SchemaRendererProvider dataSource={dataSource}>
          <SchemaRenderer schema={schema} data={HOST_PAGE} pagination={{ pageSize: 2 }} />
        </SchemaRendererProvider>,
      );

      await waitFor(() => expect(calls.length).toBeGreaterThan(0));

      for (const params of calls) {
        // Not `pagination.pageSize` (2), and not absent either: the platform
        // ceiling, one probe row wide so the cut is detectable.
        expect(params.$top).not.toBe(2);
        expect(params.$top).toBe(nonGridRowCeilingQuery().$top);
        expect(params.$skip).toBeUndefined();
      }
    });
  });
});

// ── ObjectGantt.emptyHostData-7333 ──────────────────────────────────────────────

/**
 * objectui#7333 — an EMPTY host `data` array is "no host rows yet", not "the
 * host owns zero rows".
 *
 * `ObjectGantt` read a host `data` prop at two sites, and both took `[]` as an
 * authoritative answer: `reload`'s short-circuit (`data && Array.isArray(data)`
 * — `[]` is truthy) adopted it and returned before the chart's own query, and
 * the gating flag (`Array.isArray(data)`) switched off the object-schema gate
 * and the invalidation subscription that belong to that query. So a gantt whose
 * `data` names its own source painted an EMPTY chart the moment a host handed
 * it an array it had not filled yet.
 *
 * Both sites now read one predicate, `hostRows` in `ObjectGantt.tsx`: a
 * non-empty host array is adopted as it always was, and an empty one leaves the
 * chart reading from its own source, exactly as with no host array at all.
 *
 * ⚠️ Reach: the registered `object-gantt` renderer forwards no host prop, which
 * the `ObjectGantt.hostDataProp-7210` block in this file pins, and `ObjectGanttProps` does
 * not declare `data`. So every case here renders `ObjectGantt` directly and
 * spreads the prop in, as a direct caller would have to.
 *
 * Cases 1 and 4 are the pins; 2 and 3 are their controls, and 5 is the "yet":
 *   1. own source + host `[]` ⇒ the source is read and its rows paint;
 *   2. own source + host rows ⇒ those rows paint, the source is never read;
 *   3. own source + no host `data` ⇒ the source is read;
 *   4. object provider + host `[]` ⇒ the query waits for the object schema and
 *      goes out ONCE, already expanded (the gating flag's half);
 *   5. host rows that arrive after an empty first render are adopted.
 *
 * Cases 1–3 and 5 used to name an `api`-provider gantt's endpoint as its own
 * source. The view-level `api` data source is retired in `@objectstack/spec`
 * (objectstack#23082) and ObjectGantt builds no adapter from it
 * (objectui#12325), so the own source here is the bound object, read through
 * the context adapter — the predicate under test does not depend on which
 * provider supplies it.
 */
describe('ObjectGantt.emptyHostData-7333', () => {
  beforeEach(() => {
    standIns.ganttView = ({ tasks }: any) => (
      <div data-testid="gantt-view" data-task-count={String(tasks.length)}>
        {tasks.map((t: any) => (
          <div key={t.id} data-testid={`gv-task-${t.id}`}>{t.title}</div>
        ))}
      </div>
    );
  });

  /** What the gantt's own source (the bound object) answers with. */
  const SOURCE_ROWS = [
    { id: 'e1', name: 'Source task 1', start_date: '2026-01-01', end_date: '2026-01-05' },
    { id: 'e2', name: 'Source task 2', start_date: '2026-01-02', end_date: '2026-01-06' },
  ];

  /** What a host hands down as `data` when it DOES have rows. */
  const HOST_ROWS = [
    { id: 'h1', name: 'Host task 1', start_date: '2026-02-01', end_date: '2026-02-03' },
  ];

  function ownSourceSchema(): any {
    return {
      type: 'object-gantt',
      objectName: 'tasks',
      gantt: { titleField: 'name', startDateField: 'start_date', endDateField: 'end_date' },
    };
  }

  function makeSource() {
    return {
      find: vi.fn(async () => ({ data: SOURCE_ROWS, total: SOURCE_ROWS.length })),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => ({ name: 'tasks', fields: {} })),
    } as any;
  }

  /** Renders an object-bound gantt, spreading `hostProps` in as a direct caller would. */
  function renderOwnSourceGantt(source: ReturnType<typeof makeSource>, hostProps: Record<string, unknown>) {
    const tree = (props: Record<string, unknown>) => (
      <ObjectGantt schema={ownSourceSchema()} dataSource={source} {...(props as any)} />
    );
    const utils = render(tree(hostProps));
    return { ...utils, rerenderWith: (props: Record<string, unknown>) => utils.rerender(tree(props)) };
  }

  const taskCount = () => screen.getByTestId('gantt-view').getAttribute('data-task-count');

  /** Lets every in-flight read settle, so a query that would follow is counted. */
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

  describe('objectui#7333 — a gantt handed an EMPTY host array still reads its own source', () => {
    it('host `data: []` ⇒ the source is read and its rows paint', async () => {
      const source = makeSource();

      renderOwnSourceGantt(source, { data: [] });

      await waitFor(() => expect(screen.getByTestId('gv-task-e2')).toBeTruthy());
      expect(taskCount()).toBe(String(SOURCE_ROWS.length));
      expect(source.find).toHaveBeenCalledWith('tasks', expect.anything());
    });

    it('CONTROL — host `data` with rows ⇒ those rows paint and the source is never read', async () => {
      const source = makeSource();

      renderOwnSourceGantt(source, { data: HOST_ROWS });

      await waitFor(() => expect(screen.getByTestId('gv-task-h1')).toBeTruthy());
      await settle();
      expect(taskCount()).toBe(String(HOST_ROWS.length));
      expect(screen.queryByTestId('gv-task-e1')).toBeNull();
      expect(source.find).not.toHaveBeenCalled();
    });

    it('CONTROL — no host `data` ⇒ the source is read', async () => {
      const source = makeSource();

      renderOwnSourceGantt(source, {});

      await waitFor(() => expect(screen.getByTestId('gv-task-e2')).toBeTruthy());
      expect(source.find).toHaveBeenCalledWith('tasks', expect.anything());
    });

    it('host rows that arrive after an empty first render are adopted', async () => {
      const source = makeSource();

      const { rerenderWith } = renderOwnSourceGantt(source, { data: [] });
      await waitFor(() => expect(screen.getByTestId('gv-task-e2')).toBeTruthy());

      rerenderWith({ data: HOST_ROWS });

      await waitFor(() => expect(screen.getByTestId('gv-task-h1')).toBeTruthy());
      expect(taskCount()).toBe(String(HOST_ROWS.length));
      expect(screen.queryByTestId('gv-task-e1')).toBeNull();
    });
  });

  describe('objectui#7333 — an EMPTY host array does not switch off the object-schema gate', () => {
    /** A definition with a lookup, so the gated query has a real `$expand` to carry. */
    const OBJECT_DEF = {
      name: 'task',
      fields: {
        id: { name: 'id', type: 'text' },
        subject: { name: 'subject', type: 'text' },
        owner: { name: 'owner', type: 'lookup', reference: 'user' },
        visible_from: { name: 'visible_from', type: 'date' },
        due_date: { name: 'due_date', type: 'date' },
      },
    };

    const OBJECT_ROWS = [
      { id: '1', subject: 'Renewal', owner: 'u1', visible_from: '2026-01-01', due_date: '2026-01-05' },
    ];

    const objectSchema: any = {
      type: 'object-gantt',
      objectName: 'task',
      gantt: { titleField: 'subject', startDateField: 'visible_from', endDateField: 'due_date' },
    };

    it('host `data: []` on an object-bound gantt ⇒ ONE query, issued after the schema settles, already expanded', async () => {
      const adapter = {
        find: vi.fn(async () => ({ data: OBJECT_ROWS, total: OBJECT_ROWS.length })),
        findOne: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        getObjectSchema: vi.fn(async () => OBJECT_DEF),
      } as any;

      render(<ObjectGantt schema={objectSchema} dataSource={adapter} {...({ data: [] } as any)} />);

      await waitFor(() => expect(taskCount()).toBe(String(OBJECT_ROWS.length)));
      await waitFor(() => expect(adapter.find).toHaveBeenCalled());
      await settle();
      // Ungated, the first query goes out before the definition lands and
      // carries no expansion, and a second follows once it does: `[null,
      // ['owner']]` — the signature the `ObjectGantt.fetchGate-7225` block
      // records for the ungated regime.
      const expandSets = adapter.find.mock.calls.map(([, params]: [string, any]) => params?.$expand ?? null);
      expect(expandSets).toEqual([['owner']]);
    });
  });
});

// ── ObjectGantt.inlineQueryKeys-8769 ────────────────────────────────────────────

/**
 * objectui#8769 — a `provider: 'value'` gantt honours the three query keys the
 * fetching path honours: `filter`, `sort`, and the objectui#7210 row ceiling.
 *
 * ## What was wrong
 *
 * `reload` short-circuited the inline provider (`setData(dataItems)`; return)
 * BEFORE `effectiveDataSource.find(...)`, which is the ONE site that lowers
 * `schema.filter` to `$filter`, `schema.sort` to `$orderby` and the ceiling to
 * `$top`. An authored `filter` therefore reached nothing and every inline row
 * was charted — the fail-OPEN direction: the key that was ignored is the key
 * that NARROWS, so the author saw MORE rows than declared, with no diagnostic.
 *
 * ⛔ Not a data-exposure boundary. The rows are already in the authored schema;
 * what is wrong is that the chart answers a question nobody asked.
 *
 * ## The two-sided reading is the finding
 *
 * A one-sided reproduction cannot tell "the filter was ignored" from "the
 * filter matched everything", so the first case renders the SAME rows and the
 * SAME filter twice — once inline, once through a context adapter — and reads
 * the DISAGREEMENT. The adapter is a `ValueDataSource` over the same rows, so
 * the matcher is literally the same object on both sides and the only variable
 * left is which branch of `reload` ran.
 *
 * ## ORDER: filter first, ceiling second (objectui#7210 ruling a′)
 *
 * The ceiling is applied to the FILTERED set, matching the fetching path
 * exactly — there `$filter` and `$top` travel in one query and every backend
 * filters before it limits. `ceilingOrder` pins it from the observable side: a
 * set that is over the ceiling BEFORE filtering and under it after draws every
 * matching row and shows NO footnote. A ceiling-then-filter implementation
 * would draw at most 2,000 rows there and would still footnote.
 *
 * ## The `never capped by us` case this file replaces
 *
 * The `ObjectGantt.rowCeiling-7210` block in this file asserted that an inline set is never
 * capped and never footnoted. That case pinned the SHORT-CIRCUIT's behaviour,
 * not ruling a′: the ruling's own budget is measured in DOM ELEMENTS PER
 * RECORD (its table was measured over "real child views, inline `value`
 * provider"), and an inline row costs the browser exactly what a fetched row
 * costs. Nothing in the ruling text carves the provider out. So the exemption
 * moves here, inverted, with the triage ruling on objectui#8769 as its
 * authority — and `ceilingNote` below is what makes the cut loud rather than
 * silent, which is the half ruling a′ actually protects.
 *
 * ## Live adjacency, measured (objectui#9001 / PR objectui#9049)
 *
 * That card makes core's `convertFiltersToAST` THROW `FilterOperatorError` for
 * an `$icontains` comparand that is not a non-empty string. This repair does
 * NOT inherit it: the inline provider resolves to `ValueDataSource`, whose
 * matcher is local and refuses by EXCLUDING the row and logging once. Since
 * objectui#10767 that adapter does reach the converter — its array arm lowers
 * a spec `ViewFilterRule[]` through `toFilterNode` before matching — but a
 * refusal the lowering raises is re-seated as the same excluded-and-logged
 * refusal, never rethrown from `find`; an AST tuple like the one below is
 * passed through the sink untouched and judged by the matcher's own comparand
 * door. `refusedComparandDoesNotThrow` pins the consequence from the outside
 * either way: a render, not a throw.
 *
 * REVERSE VERIFICATION — direction predicted BEFORE running, from the committed
 * fix, by restoring the short-circuit: `twoSidedFilter`, `inlineSort`,
 * `staticDataSpelling`, `ceilingCap`, `ceilingNote` and `ceilingOrder` go RED;
 * `control` and `refusedComparandDoesNotThrow` stay GREEN (the control draws
 * the same rows in the same order either way, which is what makes it a
 * control).
 */
describe('ObjectGantt.inlineQueryKeys-8769', () => {
  beforeEach(() => {
    // The bar canvas is irrelevant here — every assertion is about WHICH rows
    // reached the chart and in WHAT ORDER. Same stub the sibling ObjectGantt pins
    // use, widened by the id list because `sort` is unreadable from a count.
    standIns.ganttView = ({ tasks }: any) => (
      <div
        data-testid="gantt-view"
        data-task-count={String(tasks.length)}
        data-task-ids={tasks.map((t: any) => String(t.id)).join(',')}
      />
    );
  });

  const ROWS = [
    { id: '1', subject: 'Alpha', status: 'open', rank: 30, visible_from: '2026-01-01', due_date: '2026-01-31' },
    { id: '2', subject: 'Bravo', status: 'closed', rank: 10, visible_from: '2026-02-01', due_date: '2026-02-28' },
    { id: '3', subject: 'Charlie', status: 'open', rank: 40, visible_from: '2026-03-01', due_date: '2026-03-31' },
    { id: '4', subject: 'Delta', status: 'closed', rank: 20, visible_from: '2026-04-01', due_date: '2026-04-30' },
    { id: '5', subject: 'Echo', status: 'open', rank: 50, visible_from: '2026-05-01', due_date: '2026-05-31' },
  ];

  /** The three rows an authored `status = open` filter declares. */
  const OPEN_IDS = '1,3,5';
  const OPEN_FILTER = [['status', '=', 'open']];

  const base: any = {
    type: 'object-gantt',
    gantt: {
      titleField: 'subject',
      startDateField: 'visible_from',
      endDateField: 'due_date',
    },
  };

  function drawn() {
    const el = screen.getByTestId('gantt-view');
    return {
      count: el.getAttribute('data-task-count'),
      ids: el.getAttribute('data-task-ids'),
    };
  }

  function makeRows(n: number, status: (i: number) => string = () => 'open') {
    return Array.from({ length: n }, (_, i) => ({
      id: String(i + 1),
      subject: `Task ${i + 1}`,
      status: status(i),
      visible_from: '2026-01-01',
      due_date: '2026-12-31',
    }));
  }

  describe('objectui#8769 — the inline `value` provider honours filter / sort / the row ceiling', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      warn.mockRestore();
      vi.unstubAllGlobals();
    });

    it('twoSidedFilter: the inline path and the fetching path agree on the SAME rows and the SAME filter', async () => {
      // One matcher, two branches of `reload`. Any disagreement here is the
      // short-circuit and nothing else.
      const dataSource = new ValueDataSource({ items: ROWS }) as any;

      const { unmount } = render(
        <ObjectGantt
          schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: OPEN_FILTER }}
        />,
      );
      await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
      await waitFor(() => expect(drawn().count).toBe('3'));
      const inline = drawn();
      unmount();

      render(
        <ObjectGantt
          schema={{ ...base, objectName: 'duly_task', filter: OPEN_FILTER }}
          dataSource={dataSource}
        />,
      );
      await waitFor(() => expect(drawn().count).toBe('3'));
      const fetching = drawn();

      expect(inline.ids).toBe(OPEN_IDS);
      expect(fetching.ids).toBe(OPEN_IDS);
      // The finding, stated as the two paths agreeing.
      expect(inline.ids).toBe(fetching.ids);
    });

    it('inlineSort: an authored `sort` orders the inline rows', async () => {
      render(
        <ObjectGantt
          schema={{
            ...base,
            data: { provider: 'value', items: ROWS },
            sort: [{ field: 'rank', order: 'desc' }],
          }}
        />,
      );
      await waitFor(() => expect(drawn().count).toBe('5'));
      // rank 50,40,30,20,10 → Echo, Charlie, Alpha, Delta, Bravo
      expect(drawn().ids).toBe('5,3,1,4,2');
    });

    it('staticDataSpelling: the `staticData` rung reaches the same repair', async () => {
      // The ruled three-rung ladder wraps `staticData` into
      // `{ provider: 'value', items }`, so it lands on exactly this path. It is
      // the second spelling an author can use and it needs its own row.
      render(<ObjectGantt schema={{ ...base, staticData: ROWS, filter: OPEN_FILTER }} />);
      await waitFor(() => expect(drawn().count).toBe('3'));
      expect(drawn().ids).toBe(OPEN_IDS);
    });

    it('ceilingCap: an inline set past the ceiling draws exactly the ceiling', async () => {
      render(
        <ObjectGantt
          schema={{
            ...base,
            data: { provider: 'value', items: makeRows(nonGridRowCeilingQuery().$top + 500) },
          }}
        />,
      );
      await waitFor(() => expect(drawn().count).toBe(String(NON_GRID_ROW_CEILING)));
    });

    it('ceilingNote: the cut is LOUD — the footnote names both numbers', async () => {
      const total = nonGridRowCeilingQuery().$top + 500;
      render(
        <ObjectGantt schema={{ ...base, data: { provider: 'value', items: makeRows(total) } }} />,
      );
      await waitFor(() => expect(drawn().count).toBe(String(NON_GRID_ROW_CEILING)));

      const note = await screen.findByRole('note');
      expect(note.getAttribute('data-row-ceiling-note')).toBe('non-grid');
      expect(note.textContent).toContain(String(NON_GRID_ROW_CEILING));
      expect(note.textContent).toContain(String(total));
    });

    it('ceilingOrder: the ceiling is applied to the FILTERED set, not to the raw one', async () => {
      // Over the ceiling before filtering, under it after: 2,400 rows of which
      // only every third is `open` (800). Filter-then-ceiling draws all 800 and
      // stays quiet; ceiling-then-filter could not.
      const rows = makeRows(2400, (i) => (i % 3 === 0 ? 'open' : 'closed'));
      render(
        <ObjectGantt
          schema={{ ...base, data: { provider: 'value', items: rows }, filter: OPEN_FILTER }}
        />,
      );
      await waitFor(() => expect(drawn().count).toBe('800'));
      expect(screen.queryByRole('note')).toBeNull();
    });

    it('control: an inline chart with NO filter, NO sort and under the ceiling is unchanged', async () => {
      // ⭐ Green on BOTH ablation legs by construction. Without it a reviewer
      // cannot tell this repair from "the inline path now drops rows".
      render(<ObjectGantt schema={{ ...base, data: { provider: 'value', items: ROWS } }} />);
      await waitFor(() => expect(drawn().count).toBe('5'));
      expect(drawn().ids).toBe('1,2,3,4,5');
      expect(screen.queryByRole('note')).toBeNull();
    });

    it('refusedComparandDoesNotThrow: a comparand core would refuse RENDERS, it does not throw', async () => {
      // objectui#9001 / PR objectui#9049 makes `convertFiltersToAST` throw for
      // this comparand. The inline path resolves to `ValueDataSource`, which
      // judges an AST tuple with its own comparand door — it excludes the row
      // and logs once — and re-seats a refusal its rule-array lowering raises
      // the same way (objectui#10767): `find` does not throw on a bad filter.
      render(
        <ObjectGantt
          schema={{
            ...base,
            data: { provider: 'value', items: ROWS },
            filter: [['subject', 'icontains', '']],
          }}
        />,
      );
      await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
      await waitFor(() => expect(drawn().count).toBe('0'));
      expect(
        warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('icontains')),
      ).toBe(true);
    });
  });
});

// ── ObjectGantt.searchTerm-10250 ────────────────────────────────────────────────

/**
 * objectui#10250 — the gantt's record query carries the node's full-text
 * search: `search` as `$search`, and `searchableFields` as `$searchFields`
 * alongside it.
 *
 * ## What was wrong
 *
 * `ListView` offers its toolbar Search box on a gantt view, and its own fetch
 * sends `$search` (plus `$searchFields` when the view declares
 * `searchableFields`). The gantt chart does not draw those rows: the registered
 * `object-gantt` wrapper hands `ObjectGantt` the node's `schema` and nothing
 * else, and `reload` issues the chart's own query. That query had no search
 * channel at all, so the term changed the list's fetch and nothing drawn. The
 * node is the only door: `ListView` writes the term there, and this file pins
 * the half that reads it. The writing half is pinned in
 * `plugin-list/src/__tests__/ListView.selfQueryingViewsToolbarState-10250.test.tsx`.
 *
 * ## The shape is the list's own
 *
 * The pair travels together or not at all — a field list with no term is
 * inert, exactly as it is on `ListView`'s fetch and on `ObjectGrid`'s. Nothing
 * here decides WHICH fields a term matches: that is the server's answer from
 * the object's metadata (ADR-0061), narrowed only by an authored list.
 *
 * REVERSE VERIFICATION. Delete the `$search` spread from `reload`: TERM,
 * FIELDS, CHANGE and INLINE go red, and so does STABILITY, whose precondition
 * waits for the pair; CONTROL and INERT FIELDS stay green (they assert an
 * absence, which a query without the pair satisfies). Key the effect on
 * `schema.searchableFields` itself instead of its serialised value: STABILITY
 * alone goes red.
 */
describe('ObjectGantt.searchTerm-10250', () => {
  beforeEach(() => {
    // The bar canvas is irrelevant — every assertion is about the QUERY, plus one
    // about which inline rows reached the chart.
    standIns.ganttView = ({ tasks }: any) => (
      <div data-testid="gantt-view" data-task-ids={tasks.map((t: any) => String(t.id)).join(',')} />
    );
  });

  const ROWS = [
    { id: '1', subject: 'Alpha needle', visible_from: '2026-01-01', due_date: '2026-01-31' },
    { id: '2', subject: 'Bravo', visible_from: '2026-02-01', due_date: '2026-02-28' },
    { id: '3', subject: 'Charlie needle', visible_from: '2026-03-01', due_date: '2026-03-31' },
  ];

  let calls: Array<Record<string, any>> = [];

  function makeDataSource() {
    return {
      find: vi.fn(async (_resource: string, params: any) => {
        calls.push({ ...(params ?? {}) });
        return { data: ROWS, total: ROWS.length };
      }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => ({
        name: 'duly_task',
        fields: {
          id: { name: 'id', type: 'text' },
          subject: { name: 'subject', type: 'text' },
          visible_from: { name: 'visible_from', type: 'date' },
          due_date: { name: 'due_date', type: 'date' },
        },
      })),
    } as any;
  }

  const base: any = {
    type: 'object-gantt',
    objectName: 'duly_task',
    gantt: { titleField: 'subject', startDateField: 'visible_from', endDateField: 'due_date' },
  };

  const last = () => calls[calls.length - 1] ?? {};
  const settle = () => new Promise((r) => setTimeout(r, 50));

  beforeEach(() => {
    calls = [];
  });

  describe('ObjectGantt — the node\'s search reaches the record query (objectui#10250)', () => {
    it('CONTROL: a node with no `search` sends neither $search nor $searchFields', async () => {
      render(<ObjectGantt schema={base} dataSource={makeDataSource()} />);
      await waitFor(() => expect(calls.length).toBeGreaterThan(0));
      expect(last()).not.toHaveProperty('$search');
      expect(last()).not.toHaveProperty('$searchFields');
    });

    it('TERM: `search` is sent as $search', async () => {
      render(<ObjectGantt schema={{ ...base, search: 'needle' }} dataSource={makeDataSource()} />);
      await waitFor(() => expect(last().$search).toBe('needle'));
      expect(last()).not.toHaveProperty('$searchFields');
    });

    it('FIELDS: `searchableFields` is sent as $searchFields alongside the term', async () => {
      render(
        <ObjectGantt schema={{ ...base, search: 'needle', searchableFields: ['subject'] }} dataSource={makeDataSource()} />,
      );
      await waitFor(() => expect(last().$search).toBe('needle'));
      expect(last().$searchFields).toEqual(['subject']);
    });

    it('INERT FIELDS: `searchableFields` with no term sends neither key', async () => {
      render(<ObjectGantt schema={{ ...base, searchableFields: ['subject'] }} dataSource={makeDataSource()} />);
      await waitFor(() => expect(calls.length).toBeGreaterThan(0));
      await settle();
      expect(last()).not.toHaveProperty('$search');
      expect(last()).not.toHaveProperty('$searchFields');
    });

    it('CHANGE: a new term re-queries with it; clearing it re-queries without it', async () => {
      const dataSource = makeDataSource();
      const { rerender } = render(<ObjectGantt schema={{ ...base, search: 'needle' }} dataSource={dataSource} />);
      await waitFor(() => expect(last().$search).toBe('needle'));
      rerender(<ObjectGantt schema={{ ...base, search: 'thread' }} dataSource={dataSource} />);
      await waitFor(() => expect(last().$search).toBe('thread'));
      rerender(<ObjectGantt schema={{ ...base }} dataSource={dataSource} />);
      await waitFor(() => expect(last()).not.toHaveProperty('$search'));
    });

    it('STABILITY: a new but equal node — same term, a fresh equal field list — does not re-query', async () => {
      const dataSource = makeDataSource();
      const node = () => ({ ...base, search: 'needle', searchableFields: ['subject'] });
      const { rerender } = render(<ObjectGantt schema={node()} dataSource={dataSource} />);
      await waitFor(() => expect(last().$searchFields).toEqual(['subject']));
      await settle();
      const settled = calls.length;
      rerender(<ObjectGantt schema={node()} dataSource={dataSource} />);
      rerender(<ObjectGantt schema={node()} dataSource={dataSource} />);
      await settle();
      expect(calls.length).toBe(settled);
    });

    it('INLINE: the term narrows inline rows too, through the same in-memory adapter', async () => {
      // The provider does not change which query keys apply (objectui#8769):
      // `provider: 'value'` goes through `ValueDataSource`, which honours
      // `$search` the way it honours `$filter`.
      render(<ObjectGantt schema={{ ...base, objectName: undefined, data: { provider: 'value', items: ROWS }, search: 'needle' }} />);
      await waitFor(() => expect(screen.getByTestId('gantt-view').getAttribute('data-task-ids')).toBe('1,3'));
    });
  });
});

// ── ObjectGantt.ruleArrayFilter-10767 ───────────────────────────────────────────

/**
 * objectui#10767 — an `object-gantt` with inline rows charts the rows a spec
 * `ViewFilterRule[]` `filter` selects.
 *
 * ## What was wrong
 *
 * `resolveDataSource` (`@object-ui/core`) answers `provider: 'value'` with an
 * in-memory `ValueDataSource`, and `reload` hands `schema.filter` to whichever
 * adapter it resolved, unlowered — the same call for every provider
 * (objectui#8769). On the wire adapter the rule array is translated; on
 * `ValueDataSource` it was refused node by node, so the one filter form the
 * spec's converged `filter` doors accept (objectui#6206 B) charted NO rows on
 * an inline gantt, with one `console.warn` as the only signal. The record form
 * and the AST form charted the three; they are the controls here.
 *
 * The repair is in `@object-ui/core`'s `ValueDataSource` (the array arm lowers
 * through `toFilterNode`), so this file changes nothing in `ObjectGantt.tsx`;
 * it pins the consequence on THIS block, through both of its inline spellings.
 *
 * REVERSE VERIFICATION — direction predicted BEFORE running, from the committed
 * fix, by restoring the unlowered array arm in `ValueDataSource.find`:
 * `ruleArrayFilter` and `ruleArrayFilterStaticData` go RED; `recordFormControl`
 * and `astControl` stay GREEN — they chart the same three either way, which is
 * what makes them controls.
 */
describe('ObjectGantt.ruleArrayFilter-10767', () => {
  beforeEach(() => {
    // The bar canvas is irrelevant here — every assertion is about WHICH rows
    // reached the chart. Same stub the sibling ObjectGantt pins use.
    standIns.ganttView = ({ tasks }: any) => (
      <div
        data-testid="gantt-view"
        data-task-count={String(tasks.length)}
        data-task-ids={tasks.map((t: any) => String(t.id)).join(',')}
      />
    );
  });

  afterEach(cleanup);

  const ROWS = [
    { id: '1', subject: 'Alpha', status: 'open', visible_from: '2026-01-01', due_date: '2026-01-31' },
    { id: '2', subject: 'Bravo', status: 'closed', visible_from: '2026-02-01', due_date: '2026-02-28' },
    { id: '3', subject: 'Charlie', status: 'open', visible_from: '2026-03-01', due_date: '2026-03-31' },
    { id: '4', subject: 'Delta', status: 'closed', visible_from: '2026-04-01', due_date: '2026-04-30' },
    { id: '5', subject: 'Echo', status: 'open', visible_from: '2026-05-01', due_date: '2026-05-31' },
  ];

  /** The three rows a `status = open` filter declares, in every spelling. */
  const OPEN_IDS = '1,3,5';
  const RULE_ARRAY_FILTER = [{ field: 'status', operator: 'equals', value: 'open' }];
  const RECORD_FORM_FILTER = { status: 'open' };
  const AST_FILTER = [['status', '=', 'open']];

  const base: any = {
    type: 'object-gantt',
    gantt: {
      titleField: 'subject',
      startDateField: 'visible_from',
      endDateField: 'due_date',
    },
  };

  function drawn() {
    const el = screen.getByTestId('gantt-view');
    return {
      count: el.getAttribute('data-task-count'),
      ids: el.getAttribute('data-task-ids'),
    };
  }

  describe('objectui#10767 — the gantt charts the rows a rule-array `filter` selects on inline `value` data', () => {
    it('ruleArrayFilter: the spec’s rule array charts the three declared rows', async () => {
      render(
        <ObjectGantt
          schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: RULE_ARRAY_FILTER }}
        />,
      );
      await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
      await waitFor(() => expect(drawn().count).toBe('3'));
      expect(drawn().ids).toBe(OPEN_IDS);
    });

    it('ruleArrayFilterStaticData: the `staticData` rung reaches the same repair', async () => {
      render(<ObjectGantt schema={{ ...base, staticData: ROWS, filter: RULE_ARRAY_FILTER }} />);
      await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
      await waitFor(() => expect(drawn().count).toBe('3'));
      expect(drawn().ids).toBe(OPEN_IDS);
    });

    it('recordFormControl: the record form charts the same three (green on both trees)', async () => {
      render(
        <ObjectGantt
          schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: RECORD_FORM_FILTER }}
        />,
      );
      await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
      await waitFor(() => expect(drawn().count).toBe('3'));
      expect(drawn().ids).toBe(OPEN_IDS);
    });

    it('astControl: the AST form charts the same three (green on both trees)', async () => {
      render(
        <ObjectGantt
          schema={{ ...base, data: { provider: 'value', items: ROWS }, filter: AST_FILTER }}
        />,
      );
      await waitFor(() => expect(screen.getByTestId('gantt-view')).toBeTruthy());
      await waitFor(() => expect(drawn().count).toBe('3'));
      expect(drawn().ids).toBe(OPEN_IDS);
    });
  });
});
