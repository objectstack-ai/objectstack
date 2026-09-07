// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16061 — a cleanup run that loses deletes must SAY SO, at both triggers.
 *
 * ## The closed loop this file pins open
 *
 * Three things composed to make a failing cleanup completely silent:
 *
 *   1. every inner `catch` on the delete path is a bare `catch {` — unbound,
 *      so the error object is gone;
 *   2. the only `console.error` in `runCleanup()` sits in its OUTER catch,
 *      which the inner catches prevent execution from reaching;
 *   3. `start()` invoked the run as `void this.runCleanup()`, discarding the
 *      `{ deleted, errors }` the run returns — at BOTH call sites.
 *
 * ⇒ A driver whose deletes fail on every scheduled run produced zero output
 * and no reachable error count. The history table grew past its retention
 * policy with nothing to find.
 *
 * ## What is asserted, and what is deliberately NOT
 *
 * The subject is the SIGNAL, not the cleanup. Adding a report here is not an
 * enhancement — it turns an error path that already exists from unobservable
 * into observable — so every case below asserts that a failing run produces
 * something an operator can read, and none of them asserts that any row was
 * deleted.
 *
 * ⛔ Not pinned: the wording of the report, beyond the two facts AGENTS.md →
 * "Degradation log levels" says such a line owes — the consequence and the
 * fix — plus the failure count, which is the only thing `runCleanup()`
 * carries out of the swallowing catches. Pinning the prose would make every
 * later clarification a test edit.
 *
 * ⛔ Not changed, and asserted unchanged: `runCleanup()`'s own contract. Its
 * inner catches stay silent on purpose — the same AGENTS.md section names a
 * log per failed write as the mirror-image failure and calls a failure handed
 * to the CALLER the third legal answer. The defect was never that the seams
 * report through the envelope; it was that nobody read the envelope.
 *
 * ## Why the two triggers are separate cases
 *
 * `start()` runs the pass twice over: once immediately, and once per interval
 * tick. Both were `void this.runCleanup()`. Repairing only the immediate one
 * leaves every SCHEDULED run silent — which is the defect, for the trigger
 * that runs forever rather than the one that runs once. A single case that
 * only counted reports could pass on a half-fix, so the immediate run and a
 * tick are asserted separately.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IDataDriver } from '@objectstack/spec/contracts';
import type { MetadataHistoryRetentionPolicy } from '@objectstack/spec/system';
import type { DatabaseLoader } from '../loaders/database-loader.js';
import { HistoryCleanupManager } from './history-cleanup.js';

const TABLE = 'sys_metadata_history';
const HOUR_MS = 60 * 60 * 1000;

/** Every delete the age branch attempts, and whether the driver refuses it. */
interface DriverLog {
  deleteManyCalls: number;
}

/**
 * A manager over a driver whose bulk delete either refuses or succeeds.
 *
 * `HistoryCleanupManager` reads `driver`, `historyTableName` and
 * `organizationId` off the loader by property, so a plain object is enough
 * (the same stub shape `history-cleanup-dst.test.ts` uses).
 */
function managerFor(
  mode: 'refuses' | 'succeeds',
  log: DriverLog,
  policy: MetadataHistoryRetentionPolicy,
): HistoryCleanupManager {
  const driver = {
    deleteMany(table: string, _filter: Record<string, unknown>): number {
      expect(table).toBe(TABLE);
      log.deleteManyCalls++;
      if (mode === 'refuses') {
        throw new Error('driver refused the delete');
      }
      return 0;
    },
    find(): Record<string, unknown>[] {
      throw new Error('the maxVersions branch must not run in these cases');
    },
  } as unknown as IDataDriver;

  const loader = {
    driver,
    historyTableName: TABLE,
    organizationId: undefined,
  } as unknown as DatabaseLoader;

  return new HistoryCleanupManager(policy, loader);
}

/** Join one `console.error` call's arguments into the text an operator reads. */
function textOf(call: unknown[]): string {
  return call.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('#16061 — a failing history cleanup is not silent', () => {
  it('reports the IMMEDIATE run started by start()', async () => {
    const log: DriverLog = { deleteManyCalls: 0 };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();

    const manager = managerFor('refuses', log, {
      autoCleanup: true,
      maxAgeDays: 30,
      cleanupIntervalHours: 1,
    });

    manager.start();
    // Let the immediate run settle without advancing to the first tick.
    await vi.advanceTimersByTimeAsync(0);
    manager.stop();

    // The run really ran and really lost a delete — without this the case
    // could pass over a driver that was never asked.
    expect(log.deleteManyCalls).toBe(1);

    expect(errors).toHaveBeenCalledTimes(1);
    const text = textOf(errors.mock.calls[0]);
    expect(text).toMatch(/history cleanup/i);
    // The count is the only thing carried out of the swallowing catches.
    expect(text).toContain('1');
    // The two things AGENTS.md says such a line owes.
    expect(text).toMatch(/still in the table|grows past the retention policy/i);
    expect(text).toMatch(/fix:/i);
  });

  it('reports EVERY SCHEDULED run, not only the first', async () => {
    const log: DriverLog = { deleteManyCalls: 0 };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();

    const manager = managerFor('refuses', log, {
      autoCleanup: true,
      maxAgeDays: 30,
      cleanupIntervalHours: 1,
    });

    manager.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveBeenCalledTimes(1);

    // One interval tick. This is the SECOND call site; a fix applied only to
    // the immediate run leaves this one silent and this expectation red.
    await vi.advanceTimersByTimeAsync(HOUR_MS);
    manager.stop();

    expect(log.deleteManyCalls).toBe(2);
    expect(errors).toHaveBeenCalledTimes(2);
    expect(textOf(errors.mock.calls[1])).toMatch(/history cleanup/i);
  });

  it('CONTROL — a run that loses nothing says nothing', async () => {
    const log: DriverLog = { deleteManyCalls: 0 };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();

    const manager = managerFor('succeeds', log, {
      autoCleanup: true,
      maxAgeDays: 30,
      cleanupIntervalHours: 1,
    });

    manager.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(HOUR_MS);
    manager.stop();

    // Same code path, same two triggers, driver simply does not refuse.
    expect(log.deleteManyCalls).toBe(2);
    expect(errors).not.toHaveBeenCalled();
  });

  it('leaves runCleanup()\'s envelope exactly as it was', async () => {
    const log: DriverLog = { deleteManyCalls: 0 };
    const manager = managerFor('refuses', log, { maxAgeDays: 30 });

    // A DIRECT caller still gets the counts, unchanged: the repair reads the
    // envelope, it does not replace it.
    await expect(manager.runCleanup()).resolves.toEqual({ deleted: 0, errors: 1 });
  });
});
