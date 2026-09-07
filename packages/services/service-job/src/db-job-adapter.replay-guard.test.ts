// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14501 — the REFUSAL half of the maintainer's A + a2 ruling, pinned where its
// subject lives. `DbJobAdapter.replay()` owns the ADR-0112 envelope, the
// `force` door past it, and the guarantee that a refusal REJECTS rather than
// resolving having done nothing; it deliberately knows nothing about flows,
// tick windows or the `sys_flow_dispatch` ledger, so a guard double here is the
// real contract and not a stand-in for one.
//
// The other side of the seam — the guard `@objectstack/trigger-schedule`
// actually registers, and the `(flow, tick-window)` claim it answers from —
// is pinned in that package's `schedule-dispatch-claim.test.ts`.
//
// The specification is `IJobService.replay`'s TSDoc in `packages/spec`
// (#14766): claim absent/failed → re-run; claim succeeded → RESOURCE_CONFLICT /
// 409 naming the window and the claim; `{ force: true }` → send anyway.

import { describe, it, expect, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { DbJobAdapter } from './db-job-adapter.js';
import type { ReplayGuard } from './db-job-adapter.js';

const JOB = 'flow-schedule:nightly_digest';
const WINDOW = "cron '0 1 * * *' window starting 2026-09-07T01:00:00.000Z";

function fakeEngine() {
  return {
    async find() { return []; },
    async insert(_t: string, data: any) { return data; },
    // Routed through ObjectQL's OWN dispatch predicate, so this fake cannot be
    // looser than the engine it stands in for — the sibling doubles in this
    // package do the same, and `pnpm check:engine-double-contract` is the gate.
    async update(_t: string, data: any, options?: any) {
      assertEngineUpdateDispatch(data, options);
      return {};
    },
  };
}

async function adapterWith(guard: ReplayGuard | null) {
  const runs: string[] = [];
  const warn = vi.fn();
  const adapter = new DbJobAdapter({
    engine: fakeEngine() as any,
    logger: { info: () => {}, warn, error: () => {} },
    options: { recordRuns: false },
  });
  // An interval far enough out that no timer fires inside a test.
  await adapter.schedule(JOB, { type: 'interval', intervalMs: 3_600_000 }, async () => {
    runs.push('r');
  });
  if (guard) adapter.setReplayGuard(JOB, guard);
  return { adapter, runs, warn };
}

const refuse: ReplayGuard = async ({ force }) =>
  force ? { allow: true } : { allow: false, window: WINDOW, claimedAt: '2026-09-07T01:00:00.000Z' };

describe('DbJobAdapter.replay — the #14501 refusal', () => {
  it('refuses a delivered window with the ADR-0112 envelope, naming the window and the claim', async () => {
    const { adapter, runs } = await adapterWith(refuse);

    // The contract prescribes asserting on `code` and `status`. ⛔ Not
    // `toThrow()` alone: a bare `Error` from an unfixed adapter passes that.
    const err = await adapter.replay(JOB).then(
      () => { throw new Error('replay resolved — the refusal did not fire'); },
      (e: any) => e,
    );
    expect(err.code).toBe('RESOURCE_CONFLICT');
    expect(err.status).toBe(409);
    expect(err.message).toContain(WINDOW);
    expect(err.message).toContain('2026-09-07T01:00:00.000Z');
    expect(err.message).toMatch(/force: true/);

    // Refused means REFUSED — the handler did not run.
    expect(runs).toHaveLength(0);
  });

  it('REJECTS rather than resolving having done nothing — the silent no-op the ruling rejected', async () => {
    const { adapter } = await adapterWith(refuse);
    await expect(adapter.replay(JOB)).rejects.toThrow(/already delivered/);
  });

  it('{ force: true } is the door past it, and the guard is told it is forced', async () => {
    const seen: Array<{ force: boolean }> = [];
    const guard: ReplayGuard = async (opts) => { seen.push(opts); return refuse(opts); };
    const { adapter, runs } = await adapterWith(guard);

    await expect(adapter.replay(JOB, undefined, { force: true })).resolves.toBeUndefined();
    expect(runs).toHaveLength(1);
    expect(seen).toEqual([{ force: true }]);

    // …and an unforced replay after a forced one is refused exactly as before.
    await expect(adapter.replay(JOB)).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
  });

  it('force:false and an omitted options bag are the same call', async () => {
    const seen: Array<{ force: boolean }> = [];
    const guard: ReplayGuard = async (opts) => { seen.push(opts); return { allow: true }; };
    const { adapter } = await adapterWith(guard);

    await adapter.replay(JOB);
    await adapter.replay(JOB, undefined, {});
    await adapter.replay(JOB, undefined, { force: false });
    expect(seen).toEqual([{ force: false }, { force: false }, { force: false }]);
  });

  it('a guard that ALLOWS lets the replay through untouched', async () => {
    const { adapter, runs } = await adapterWith(async () => ({ allow: true }));
    await expect(adapter.replay(JOB)).resolves.toBeUndefined();
    expect(runs).toHaveLength(1);
  });

  it('a job with NO guard replays exactly as it always did', async () => {
    const { adapter, runs } = await adapterWith(null);
    await expect(adapter.replay(JOB)).resolves.toBeUndefined();
    await expect(adapter.replay(JOB)).resolves.toBeUndefined();
    expect(runs).toHaveLength(2);
  });

  it('a guard that THROWS lets the replay through, logged — a refusal is a positive reading', async () => {
    const { adapter, runs, warn } = await adapterWith(async () => {
      throw new Error('ledger unreachable');
    });
    await expect(adapter.replay(JOB)).resolves.toBeUndefined();
    expect(runs).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('replay pre-flight for job'),
      expect.anything(),
    );
  });

  it('the guard is consulted only for a job that HAS one, and only once per replay', async () => {
    const guard = vi.fn(async () => ({ allow: true as const }));
    const { adapter } = await adapterWith(guard);
    await adapter.replay(JOB);
    expect(guard).toHaveBeenCalledTimes(1);
  });

  it('an unknown job is still "not found", checked before any guard runs', async () => {
    const guard = vi.fn(async () => ({ allow: true as const }));
    const { adapter } = await adapterWith(guard);
    await expect(adapter.replay('no_such_job')).rejects.toThrow(/not found/);
    expect(guard).not.toHaveBeenCalled();
  });

  it('cancel() withdraws the guard, and setReplayGuard(name, null) does too', async () => {
    const { adapter, runs } = await adapterWith(refuse);
    await expect(adapter.replay(JOB)).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });

    adapter.setReplayGuard(JOB, null);
    await expect(adapter.replay(JOB)).resolves.toBeUndefined();
    expect(runs).toHaveLength(1);

    adapter.setReplayGuard(JOB, refuse);
    await adapter.cancel(JOB);
    await adapter.schedule(JOB, { type: 'interval', intervalMs: 3_600_000 }, async () => {
      runs.push('r');
    });
    await expect(adapter.replay(JOB)).resolves.toBeUndefined();
    expect(runs).toHaveLength(2);

    await adapter.destroy();
  });

  it('trigger() is NOT gated — only replay() is', async () => {
    const { adapter, runs } = await adapterWith(refuse);
    await adapter.trigger(JOB);
    await adapter.trigger(JOB);
    expect(runs).toHaveLength(2);
  });
});
