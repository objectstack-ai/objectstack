// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19365 — `AutomationEngine.listRunsPage` and the truncation boundary.
 *
 * `GET /api/automation/:name/runs` used to answer `{ runs, hasMore: false }`
 * with the `false` written as a literal, beside a list the engine had already
 * cut with `.slice(0, limit)`. A caller asking for one row of a thousand was
 * handed one row and told that was all of them, with a `200` and nothing in
 * the status, headers or body to distinguish it from a complete answer. The
 * maintainer ruling of decision batch #204 item 2 (letter C) says the engine
 * reports truncation to the door and `hasMore` is computed.
 *
 * ## The boundary these cases exist to pin, and why the obvious signal is wrong
 *
 * The tempting implementation is `hasMore = runs.length === limit`. It is
 * WRONG at exactly one input, and that input is neither rare nor detectable
 * from the response: a flow holding EXACTLY `limit` runs produces a window
 * byte-identical to one held by a flow with ten thousand. Reporting `true` for
 * the first is a lie — there is nothing more to fetch, and a caller that
 * widens its window learns that only by doing the work.
 *
 * So the signal is an OVER-READ of exactly one row: the history arm is asked
 * for `limit + 1` and the merged, filtered, ordered set is compared against
 * `limit`. The three-case table below is the whole contract, and the middle
 * row is the one that separates a correct implementation from the tempting
 * one:
 *
 *   | runs the store holds | hasMore |
 *   |----------------------|---------|
 *   | fewer than `limit`   | false   |
 *   | EXACTLY `limit`      | false   |  ⭐ the case `length === limit` gets wrong
 *   | more than `limit`    | true    |
 *
 * ## What these cases deliberately do NOT execute
 *
 * No flow is run here. Seeding the durable store directly through
 * `recordTerminal` is what makes the arithmetic readable: the in-memory ring
 * and the paused arm both stay empty, so the merged set IS the history arm and
 * a failing count cannot be blamed on a third source. The arms' merge is
 * `run-history.test.ts`'s and `paused-run-visibility.test.ts`'s subject, not
 * this file's.
 */

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { RunRecord } from './engine.js';
import { InMemorySuspendedRunStore, DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW } from './suspended-run-store.js';

const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;

const FLOW = 'runs_window';

/** One terminal history row, ordered by `startedAt` the way the store sorts. */
function record(n: number, flowName = FLOW): RunRecord {
    return {
        // The run id carries the flow name because the store keys history by
        // `runId` alone: two flows seeded with the same ids would overwrite
        // each other's rows rather than coexist.
        runId: flowName === FLOW ? `run_${String(n).padStart(4, '0')}` : `${flowName}_${n}`,
        flowName,
        status: 'completed',
        // Descending `startedAt` order is what `listHistory` sorts on, so a
        // bigger `n` is a NEWER run and lands earlier in the window.
        startedAt: new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString(),
        finishedAt: new Date(Date.UTC(2026, 0, 1) + n * 60_000 + 1_000).toISOString(),
    } as RunRecord;
}

/** A store holding exactly `count` terminal runs for {@link FLOW}. */
async function storeWith(count: number) {
    // The per-flow retention cap is raised above every count used here so that
    // eviction can never be what makes a case pass: these cases are about the
    // WINDOW, and a run the cap evicted is not "more" — it does not exist any
    // more and no `limit` brings it back.
    const store = new InMemorySuspendedRunStore({ maxTerminalRunsPerFlow: 10_000 });
    for (let n = 1; n <= count; n += 1) await store.recordTerminal(record(n));
    return store;
}

async function pageOf(count: number, limit: number) {
    const engine = new AutomationEngine(silent, await storeWith(count));
    return engine.listRunsPage(FLOW, { limit });
}

describe('#19365 — hasMore at the truncation boundary', () => {
    it.each([
        ['far fewer than the window', 3, 10, false, 3],
        ['one short of the window', 9, 10, false, 9],
        // ⭐ The case the tempting `runs.length === limit` signal gets wrong.
        ['EXACTLY the window', 10, 10, false, 10],
        ['one more than the window', 11, 10, true, 10],
        ['far more than the window', 250, 10, true, 10],
        // `limit: 1` is the shape the filed defect was reported against — ask
        // for one row, be handed one row and told that is all of them.
        ['a single-row window over many runs', 250, 1, true, 1],
        ['a single-row window over a single run', 1, 1, false, 1],
    ])('%s: %i runs, limit %i -> hasMore %s', async (_label, count, limit, hasMore, rows) => {
        const page = await pageOf(count, limit);

        expect(page.hasMore, `${count} runs in a window of ${limit}`).toBe(hasMore);
        // The window itself is never widened by the over-read — the extra row
        // is dropped by the same `.slice(0, limit)` that was always here, so
        // nothing on the wire grows.
        expect(page.runs).toHaveLength(rows);
    });

    it('the extra row is a PROBE, not content — the window returns the NEWEST `limit` runs', async () => {
        // If the over-read row ever leaked into the response the window would
        // carry `limit + 1` rows, or the wrong ones. Both are checked: the
        // newest run is `run_0100` and a window of 3 is exactly the top three.
        const page = await pageOf(100, 3);

        expect(page.hasMore).toBe(true);
        expect(page.runs.map((r) => r.id)).toEqual(['run_0100', 'run_0099', 'run_0098']);
    });

    it('asks the STORE for `limit + 1` — the over-read is where the fact comes from', async () => {
        // The mechanism pin. `RunStore.listHistory`'s signature is deliberately
        // unchanged (#19365): over-reading is expressible in the `limit` it
        // already takes, so the truncation signal costs the store contract
        // nothing. A regression to `listHistory(flow, limit)` would make the
        // EXACTLY-the-window case above indistinguishable from the one above
        // it, which is the defect this card closed.
        const store = await storeWith(50);
        const spy = vi.spyOn(store, 'listHistory');
        const engine = new AutomationEngine(silent, store);

        await engine.listRunsPage(FLOW, { limit: 20 });

        expect(spy).toHaveBeenCalledWith(FLOW, 21);
    });

    it('applies the schema default window (20) when the caller names none', async () => {
        // `ListRunsRequestSchema.limit` declares `.default(20)` and the engine
        // carries the same number for a direct caller that passes no options.
        // ⛔ `limit` is NOT retired on this door — the sibling `/packages`
        // retirement (#17667) took its `limit` because nothing read it; here
        // it is read end to end, and this case is the over-block guard.
        expect((await pageOf(25, 20)).hasMore).toBe(true);

        const engine = new AutomationEngine(silent, await storeWith(25));
        const defaulted = await engine.listRunsPage(FLOW);
        expect(defaulted.runs).toHaveLength(20);
        expect(defaulted.hasMore).toBe(true);

        const exact = new AutomationEngine(silent, await storeWith(20));
        expect((await exact.listRunsPage(FLOW)).hasMore).toBe(false);
    });

    it('counts only the flow it was asked about', async () => {
        const store = new InMemorySuspendedRunStore({ maxTerminalRunsPerFlow: 10_000 });
        for (let n = 1; n <= 3; n += 1) await store.recordTerminal(record(n));
        for (let n = 1; n <= 99; n += 1) await store.recordTerminal(record(n, 'other_flow'));
        const engine = new AutomationEngine(silent, store);

        const page = await engine.listRunsPage(FLOW, { limit: 5 });
        expect(page.runs).toHaveLength(3);
        expect(page.hasMore).toBe(false);
    });

    it('⛔ hasMore is NOT a report on runs retention already discarded', async () => {
        // A run the deployment's per-flow cap evicted does not exist any more.
        // It is not "more", and no `limit` will bring it back — so a flow whose
        // history has been pruned to the cap answers `false` once the window
        // covers what survives. Reporting `true` there would send a caller
        // looking for rows that are gone.
        const store = new InMemorySuspendedRunStore({ maxTerminalRunsPerFlow: 5 });
        for (let n = 1; n <= 40; n += 1) await store.recordTerminal(record(n));
        const engine = new AutomationEngine(silent, store);

        expect(await store.listHistory(FLOW, 100)).toHaveLength(5);
        const page = await engine.listRunsPage(FLOW, { limit: 10 });
        expect(page.runs).toHaveLength(5);
        expect(page.hasMore).toBe(false);
        // And the cap is not a magic number here: the default is what a real
        // deployment gets, and it is well above the wire's maximum window.
        expect(DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW).toBeGreaterThanOrEqual(100);
    });
});

describe('#19365 — `listRuns` is the `runs` half of the same call', () => {
    it('returns the identical window, and reports no truncation of its own', async () => {
        // ONE implementation, two projections. A second merge/filter/sort here
        // would be the fork the route-ownership rule refuses, and it is the
        // half that would rot — the REST door calls the page method.
        const store = await storeWith(30);
        const engine = new AutomationEngine(silent, store);

        const page = await engine.listRunsPage(FLOW, { limit: 7 });
        const array = await engine.listRuns(FLOW, { limit: 7 });

        expect(array.map((r) => r.id)).toEqual(page.runs.map((r) => r.id));
        expect(array).toHaveLength(7);
        expect(page.hasMore).toBe(true);
    });

    it('still narrows by `status`, and the window still binds', async () => {
        const store = new InMemorySuspendedRunStore({ maxTerminalRunsPerFlow: 10_000 });
        for (let n = 1; n <= 8; n += 1) {
            await store.recordTerminal({ ...record(n), status: n % 2 === 0 ? 'failed' : 'completed' });
        }
        const engine = new AutomationEngine(silent, store);

        const failed = await engine.listRunsPage(FLOW, { status: 'failed', limit: 10 });
        expect(failed.runs.map((r) => r.status)).toEqual(['failed', 'failed', 'failed', 'failed']);
        // ⚠️ Honest residual, pre-existing and unchanged by this card: under a
        // status filter the history arm's window is still the newest
        // `limit + 1` rows of ANY status, because `listHistory` has no status
        // slot and the filter is applied to what comes back. So a
        // status-filtered `hasMore: false` means "no further match within the
        // scanned window", not "no further match exists". Here the window
        // covers the whole history, so the answer is exact.
        expect(failed.hasMore).toBe(false);
    });
});
