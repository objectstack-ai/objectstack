// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// STORAGE GROWTH — ADR-0057 data lifecycle, exercised end-to-end through a real
// showcase boot (#2786 P1). The 260 MB dev.db regression happened because
// platform-generated rows had NO retention contract: every append-only table
// grew forever. This gate makes that class of regression revert-provable:
//
// @proof: adr0057-lifecycle-bounded-growth
//
//   • CONTRACT — every registered object declaring a non-`record` lifecycle
//     class carries a bounding policy (retention / ttl / rotation), and the
//     shipped sys_* declarations are present in a real boot (deleting one
//     turns this red).
//   • REAPER — rows older than the declared window are deleted by
//     `lifecycle.sweep()`; fresh rows and record-class/business data are
//     untouched; space reclaim runs on the touched datasource.
//   • ARCHIVE SAFETY — an audit-class object with `archive` declared is NEVER
//     hot-deleted before the Archiver has copied it out (no archive
//     datasource registered ⇒ rows are retained, not dropped).
//
// The runaway writer is simulated with direct driver inserts (backdated
// `created_at`) rather than waiting on scheduled flow ticks — deterministic,
// and it exercises the exact path the Reaper sweeps.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import showcaseStack from '@objectstack/example-showcase';

const DAY_MS = 86_400_000;

interface EngineLike {
  registry: {
    getAllObjects(): Array<{ name: string; lifecycle?: Record<string, any> }>;
    registerObject(obj: Record<string, unknown>): void;
    getObject(name: string): { name: string; lifecycle?: Record<string, any> } | undefined;
  };
  syncObjectSchema(name: string): Promise<void>;
  getDriverForObject(name: string): DriverLike | undefined;
}

interface DriverLike {
  create(object: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  count(object: string, query?: Record<string, unknown>): Promise<number>;
  reclaimSpace?(): Promise<void>;
}

interface LifecycleLike {
  sweep(): Promise<{
    swept: Array<{ object: string; policy: string; deleted?: number }>;
    skipped: Array<{ object: string; reason: string }>;
    errors: Array<{ object: string; error: string }>;
    reclaimed: string[];
  }>;
}

describe('objectstack verify LIFECYCLE (ADR-0057): declared policies bound growth (#adr0057-lifecycle-bounded-growth)', () => {
  let stack: VerifyStack;
  let engine: EngineLike;
  let lifecycle: LifecycleLike;
  let driver: DriverLike;

  // Platform storage convention: `created_at` is registry-injected as a
  // `datetime` field, stored as epoch-ms INTEGER on SQLite (a JS Date through
  // the driver) — and filter cutoffs are coerced to match. Backdate with Date
  // objects, exactly like the real write paths, or the rows land as TEXT and
  // no temporal filter ever matches them.
  const backdated = (days: number) => new Date(Date.now() - days * DAY_MS);

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    engine = stack.kernel.getService('objectql') as unknown as EngineLike;
    lifecycle = stack.kernel.getService('lifecycle') as unknown as LifecycleLike;
    expect(lifecycle?.sweep, 'the ObjectQLPlugin must register the ADR-0057 lifecycle service').toBeTruthy();

    // Fixture objects: a telemetry stream, a record-class sibling, and an
    // audit ledger with a declared (but unresolvable) archive target.
    engine.registry.registerObject({
      name: 'growth_probe_event',
      label: 'Growth Probe Event',
      lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } },
      fields: { payload: { type: 'text', label: 'Payload' } },
    });
    engine.registry.registerObject({
      name: 'growth_probe_record',
      label: 'Growth Probe Record',
      lifecycle: { class: 'record' },
      fields: { payload: { type: 'text', label: 'Payload' } },
    });
    engine.registry.registerObject({
      name: 'growth_probe_ledger',
      label: 'Growth Probe Ledger',
      lifecycle: {
        class: 'audit',
        retention: { maxAge: '90d' },
        archive: { after: '90d', to: 'archive_missing' },
      },
      fields: { payload: { type: 'text', label: 'Payload' } },
    });
    await engine.syncObjectSchema('growth_probe_event');
    await engine.syncObjectSchema('growth_probe_record');
    await engine.syncObjectSchema('growth_probe_ledger');

    driver = engine.getDriverForObject('growth_probe_event') as DriverLike;
    expect(driver?.create, 'a driver must back the probe objects').toBeTruthy();
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('CONTRACT: every non-record lifecycle declaration in a real boot carries a bounding policy', () => {
    const declared = engine.registry
      .getAllObjects()
      .filter((o) => o.lifecycle && o.lifecycle.class !== 'record');

    // A platform boot with ZERO lifecycle-declared objects would mean the
    // shipped sys_* annotations were dropped — exactly the regression this
    // gate exists to catch.
    expect(declared.length, 'no lifecycle-declared objects registered — sys_* annotations were dropped').toBeGreaterThan(0);

    for (const obj of declared) {
      const lc = obj.lifecycle!;
      expect(
        Boolean(lc.retention || lc.ttl || lc.storage),
        `${obj.name} declares lifecycle.class='${lc.class}' with NO bounding policy (retention/ttl/storage) — ADR-0057 §3.5`,
      ).toBe(true);
    }
  });

  it('CONTRACT: the shipped sys_metadata_audit declaration survives (audit + archive-then-delete)', () => {
    const meta = engine.registry.getObject('sys_metadata_audit');
    expect(meta, 'sys_metadata_audit must be registered in a platform boot').toBeTruthy();
    expect(meta!.lifecycle?.class).toBe('audit');
    expect(meta!.lifecycle?.retention?.maxAge).toBe('365d');
    expect(meta!.lifecycle?.archive?.to).toBe('archive');
  });

  it('REAPER: past-window telemetry is reaped, fresh telemetry and record-class data survive, space is reclaimed', async () => {
    // Simulate a runaway writer: 40 telemetry rows spread over ~200 days,
    // 10 of them inside the 30d window; plus record-class rows older than
    // any window (must never be touched).
    for (let i = 0; i < 40; i++) {
      await driver.create('growth_probe_event', {
        payload: `tick-${i}`,
        created_at: backdated(5 + i * 5), // 5d … 200d
      });
    }
    for (let i = 0; i < 5; i++) {
      await driver.create('growth_probe_record', {
        payload: `business-${i}`,
        created_at: backdated(400),
      });
    }

    const before = await driver.count('growth_probe_event', { object: 'growth_probe_event' });
    expect(before).toBe(40);

    const report = await lifecycle.sweep();

    // Errors first — a failed delete otherwise shows up as a confusing
    // "expected 40 to be 5" count mismatch.
    expect(report.errors, `sweep reported errors: ${JSON.stringify(report.errors)}`).toEqual([]);
    expect(
      report.swept.map((e) => e.object),
      `sweep applied no policy — report: ${JSON.stringify(report)}`,
    ).toContain('growth_probe_event');

    // The telemetry table is now bounded by its declared 30d window:
    // rows at 5,10,15,20,25d survive (5 rows), everything older is gone.
    const after = await driver.count('growth_probe_event', { object: 'growth_probe_event' });
    expect(after, 'telemetry rows past retention.maxAge must be reaped').toBe(5);

    // Record-class/business data is sacrosanct — same age, still alive.
    const records = await driver.count('growth_probe_record', { object: 'growth_probe_record' });
    expect(records, 'record-class rows must NEVER be reaped').toBe(5);

    // The sweep reported the reap and reclaimed the datasource.
    const entry = report.swept.find((e) => e.object === 'growth_probe_event');
    expect(entry?.policy).toBe('retention');
    expect(report.errors).toEqual([]);
    expect(report.reclaimed.length, 'reclaimSpace must run on the touched datasource').toBeGreaterThan(0);
  });

  it('ROTATOR (P2): a rotation-declared stream is physically sharded through the real engine → driver path', async () => {
    engine.registry.registerObject({
      name: 'growth_probe_stream',
      label: 'Growth Probe Stream',
      lifecycle: {
        class: 'telemetry',
        storage: { strategy: 'rotation', shards: 3, unit: 'day' },
      },
      fields: { payload: { type: 'text', label: 'Payload' } },
    });
    await engine.syncObjectSchema('growth_probe_stream');

    // The base name is now a read view; writes land in the current shard.
    const streamDriver = engine.getDriverForObject('growth_probe_stream') as DriverLike & {
      execute(sql: string): Promise<unknown>;
    };
    const master = (await streamDriver.execute(
      "SELECT name, type FROM sqlite_master WHERE name LIKE 'growth_probe_stream%' AND name NOT LIKE '%autoindex%'",
    )) as Array<{ name: string; type: string }>;
    const types = Object.fromEntries(master.map((r) => [r.name, r.type]));
    expect(types['growth_probe_stream'], 'rotation must turn the base name into a view').toBe('view');
    const shardNames = master.filter((r) => /__r\d{6,8}$/.test(r.name)).map((r) => r.name);
    expect(shardNames.length, 'a current shard table must exist').toBeGreaterThan(0);

    // Round-trip: write through the driver, read through the view, and a
    // sweep applies the 'rotation' policy without touching the rows inside
    // the window.
    await streamDriver.create('growth_probe_stream', { payload: 'tick' });
    expect(await streamDriver.count('growth_probe_stream', { object: 'growth_probe_stream' })).toBe(1);

    const report = await lifecycle.sweep();
    const entry = report.swept.find((e) => e.object === 'growth_probe_stream');
    expect(entry?.policy).toBe('rotation');
    expect(await streamDriver.count('growth_probe_stream', { object: 'growth_probe_stream' })).toBe(1);
  });

  it('ARCHIVE SAFETY: an audit ledger with a declared archive is never hot-deleted unarchived', async () => {
    for (let i = 0; i < 3; i++) {
      await driver.create('growth_probe_ledger', {
        payload: `ledger-${i}`,
        created_at: backdated(365), // far past the 90d hot window
      });
    }

    const report = await lifecycle.sweep();

    // No archive datasource named 'archive_missing' exists ⇒ the rows are
    // RETAINED (today's behavior), not dropped. Compliance data cannot be
    // destroyed by declaring a lifecycle.
    const ledger = await driver.count('growth_probe_ledger', { object: 'growth_probe_ledger' });
    expect(ledger, 'archive-declared audit rows must be retained until archived').toBe(3);
    expect(report.skipped).toContainEqual({ object: 'growth_probe_ledger', reason: 'archive-pending' });
  });

  it('ARCHIVER (P3): once the archive datasource exists, cold rows move there and leave the hot store', async () => {
    // Provision a real second SQL store under the datasource name the ledger
    // declares, then re-run the sweep: retain → archive → delete.
    const { SqlDriver } = await import('@objectstack/driver-sql');
    const cold = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    } as any);
    Object.defineProperty(cold, 'name', { value: 'archive_missing' });
    await cold.connect();
    (engine as unknown as { registerDriver(d: unknown): void }).registerDriver(cold);

    const report = await lifecycle.sweep();

    const entry = report.swept.find((e) => e.object === 'growth_probe_ledger');
    expect(entry?.policy).toBe('archive');
    expect((entry as { archived?: number })?.archived).toBe(3);

    // Hot store drained, cold store holds the ledger.
    const hot = await driver.count('growth_probe_ledger', { object: 'growth_probe_ledger' });
    expect(hot, 'archived rows must leave the hot store').toBe(0);
    const coldRows = await cold.count('growth_probe_ledger', { object: 'growth_probe_ledger' });
    expect(coldRows, 'archived rows must land in the cold store').toBe(3);
    await cold.disconnect();
  });
});
