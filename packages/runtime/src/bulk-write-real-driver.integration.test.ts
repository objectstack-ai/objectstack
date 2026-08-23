// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Real-driver regression for the bulk-write hardening (framework#3147–#3152,
// #3172, #3173). The 2026-07-06 HotCRM incident's root lesson was that the
// in-memory mock driver MASKED the bug: it stored real booleans and never
// threw a transient error, so faithful local repro stayed green while turso
// dropped rows in production. These tests wire the REAL ObjectQL engine to the
// REAL SqlDriver (better-sqlite3, on-disk), and inject turso's actual failure
// shapes (a `fetch failed` before commit; a commit that lands then loses its
// response) through a thin driver proxy — the mocks cannot prove any of this.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  captureExpectedReadRefusals,
  type ExpectedReadRefusalCapture,
} from './expected-read-refusal-noise.js';

/**
 * Wrap a real driver so specific methods can fail the way turso does. Hooks
 * receive the 1-based call count for that (method, object) pair and may throw.
 * `*Before` hooks throw BEFORE the real op (a blip that never committed);
 * `*After` hooks run the real op first, then throw (commit landed, response
 * lost — the failure mode that makes naive retry duplicate rows).
 */
interface FaultPlan {
  updateBefore?: (object: string, callN: number) => void;
  createBefore?: (object: string, callN: number) => void;
  bulkCreateAfter?: (object: string, rows: any[], callN: number) => void;
}
function wrapDriver(real: any, plan: FaultPlan): any {
  const counts = new Map<string, number>();
  const bump = (k: string) => { const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return n; };
  // Prototype-delegate to the real driver: every method not overridden below
  // resolves through the chain to `real` (no Proxy, no dynamic property
  // dispatch — the engine only calls a fixed set of driver methods).
  const wrapper = Object.create(real);
  wrapper.update = async (object: string, id: string, data: any, opts: any) => {
    plan.updateBefore?.(object, bump(`update:${object}`)); // may throw (blip, never committed)
    return real.update(object, id, data, opts);
  };
  wrapper.create = async (object: string, data: any, opts: any) => {
    plan.createBefore?.(object, bump(`create:${object}`)); // may throw before commit
    return real.create(object, data, opts);
  };
  wrapper.bulkCreate = async (object: string, rows: any[], opts: any) => {
    const res = await real.bulkCreate(object, rows, opts); // commit lands
    plan.bulkCreateAfter?.(object, rows, bump(`bulkCreate:${object}`)); // then response lost
    return res;
  };
  return wrapper;
}

const INV = {
  name: 'inv',
  fields: {
    name: { type: 'text' },
    line_total: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' } },
  },
};
const INV_LINE = {
  name: 'inv_line',
  fields: { amount: { type: 'number' }, inv: { type: 'master_detail', reference: 'inv' } },
};
const TASK = {
  name: 'task',
  fields: { name: { type: 'text', required: true }, code: { type: 'autonumber', format: 'T-{000}' } },
};
const WIDGET = {
  name: 'widget',
  fields: { name: { type: 'text' }, sku: { type: 'text' } },
};
// A self-referencing object. Deliberately NOT named `employee`/`user`/etc. —
// CodeQL's PII heuristic treats such table names as sensitive data and then
// flags the driver's (benign, non-security) SHA-1 index-name suffix as "weak
// crypto on sensitive data". The self-ref shape is all this probe needs.
const TREENODE = {
  name: 'treenode',
  fields: { name: { type: 'text' }, parent: { type: 'lookup', reference: 'treenode' } },
};

const SEED_CONFIG = { dryRun: false, haltOnError: false, multiPass: true, defaultMode: 'insert', batchSize: 1000, transaction: false } as any;
const logger = { info() {}, warn() {}, error() {}, debug() {} };

function metadataFor(objects: any[]) {
  const byName = new Map(objects.map((o) => [o.name, o]));
  return {
    getObject: async (name: string) => byName.get(name),
    listObjects: async () => objects,
    register: async () => {}, get: async (_t: string, n: string) => byName.get(n),
    list: async () => [], unregister: async () => {}, exists: async () => false, listNames: async () => [],
  } as any;
}

/**
 * [#10629] This fixture provisions its own business objects and nothing else,
 * so the engine's single-tenant probe (`ObjectQL.probeInstallOrganizations`,
 * memoised once per engine) reads a `sys_organization` that was never created.
 * The probe is fail-soft by construction — it catches `isMissingTableError` and
 * only that — but the driver and the engine each log the fault on the way out.
 * Withheld and asserted rather than muted; `expected-read-refusal-noise.ts`
 * says why.
 */
const ABSENT_TENANCY_TABLE = 'sys_organization';

describe('bulk-write hardening on a REAL SqlDriver (framework#3147–#3152, #3172, #3173)', () => {
  let dir: string | null = null;
  let engine: ObjectQL | null = null;
  /** [#10629] The expected-noise capture belonging to the latest boot. */
  let noise: ExpectedReadRefusalCapture | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
    // [#10629] The capture is a PIN, not a mute — asserted after teardown so a
    // failure here can never leave the engine running. Every test in this file
    // boots and writes, so the probe fires for each of them: this holds for a
    // single `-t` run as well as for the whole file.
    expect(noise?.silentChannels() ?? ['no capture was installed']).toEqual([]);
    noise = null;
  });

  async function boot(objects: any[], plan: FaultPlan = {}) {
    dir = mkdtempSync(join(tmpdir(), 'os-bulk-real-'));
    const real = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    // [#10629] Installed on the REAL driver (the one that logs) before it runs
    // a statement, and on the engine before it issues a read — the two sinks the
    // expected refusal travels out on. `wrapDriver` prototype-delegates, so the
    // wrapper resolves `logger` through the chain to this sink.
    noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE]);
    noise.captureDriver(real);
    await real.initObjects(objects); // create real tables + sequences
    const driver = wrapDriver(real, plan);
    engine = new ObjectQL();
    noise.captureEngine(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    // Fast, deterministic summary-retry backoff (framework#3147).
    (engine as any).summaryRetryOptions = { sleep: async () => {}, backoffBaseMs: 0 };
    for (const o of objects) engine.registry.registerObject(o as any);
    return engine;
  }

  it('#3172: insertMany culls a bad row per-row and writes survivors with contiguous autonumber (real SQL)', async () => {
    const e = await boot([TASK]);
    const outcomes = await e.insertMany('task', [{ name: 'a' }, { nope: 1 }, { name: 'b' }]);

    expect(outcomes.map((o) => o.ok)).toEqual([true, false, true]);
    const rows = await e.find('task', {});
    expect(rows).toHaveLength(2);
    // Real persistent sequence — the dead row consumed no number.
    expect(rows.map((r: any) => r.code).sort()).toEqual(['T-001', 'T-002']);
  });

  it('#3147: a transient blip on the parent summary update is retried and the roll-up lands (real SQL aggregate)', async () => {
    // First update to `inv` (the summary write) throws like turso, then succeeds.
    const e = await boot([INV, INV_LINE], {
      updateBefore: (object, callN) => { if (object === 'inv' && callN === 1) throw new Error('fetch failed'); },
    });
    const inv = await e.insert('inv', { name: 'INV-1' });
    await e.insert('inv_line', [{ inv: inv.id, amount: 10 }, { inv: inv.id, amount: 32 }]);

    const parent: any = (await e.find('inv', { where: { id: inv.id } }))[0];
    expect(parent.line_total).toBe(42); // recomputed correctly after the retry
  });

  it('#3149/#3173: a commit-then-lost-response retry does NOT duplicate seed rows (real SQL)', async () => {
    // The bulkCreate writes the rows to the real table, THEN throws — the exact
    // turso shape the in-memory mock could never produce.
    const e = await boot([WIDGET], {
      bulkCreateAfter: (object, _rows, callN) => { if (object === 'widget' && callN === 1) throw new Error('fetch failed'); },
    });
    const seeder = new SeedLoaderService(e as any, metadataFor([WIDGET]), logger as any);
    const result = await seeder.load({
      seeds: [{ object: 'widget', externalId: 'sku', mode: 'insert', env: ['prod', 'dev', 'test'],
        records: [{ name: 'A', sku: 'W-A' }, { name: 'B', sku: 'W-B' }] }] as any,
      config: SEED_CONFIG,
    });

    expect(result.summary.totalErrored).toBe(0);
    const rows = await e.find('widget', {});
    expect(rows).toHaveLength(2); // recheck-by-externalId prevented the duplicate re-insert
    expect(rows.map((r: any) => r.sku).sort()).toEqual(['W-A', 'W-B']);
  });

  it('#3150: a transient blip on the self-referencing seed path is retried, not dropped (real SQL)', async () => {
    // `treenode.parent -> treenode` forces the sequential writeRecord path;
    // the first create throws before commit, then the retry lands the row.
    const e = await boot([TREENODE], {
      createBefore: (object, callN) => { if (object === 'treenode' && callN === 1) throw new Error('fetch failed'); },
    });
    const seeder = new SeedLoaderService(e as any, metadataFor([TREENODE]), logger as any);
    const result = await seeder.load({
      seeds: [{ object: 'treenode', externalId: 'name', mode: 'insert', env: ['prod', 'dev', 'test'],
        records: [{ name: 'Alice' }, { name: 'Bob' }] }] as any,
      config: SEED_CONFIG,
    });

    expect(result.summary.totalErrored).toBe(0);
    const rows = await e.find('treenode', {});
    expect(rows.map((r: any) => r.name).sort()).toEqual(['Alice', 'Bob']);
  });
});
