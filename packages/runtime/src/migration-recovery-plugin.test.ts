// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0119 D2 boot reconciliation (#4617 deliverable 3).
 *
 * The behaviour under test is not "it logs something" — it is the split this
 * plugin exists to enforce: **boot discovers, the CLI acts**. So the assertions
 * that matter are (a) an interrupted run is impossible to miss, (b) nothing is
 * resumed as a side effect of booting, and (c) the three states an operator
 * must tell apart — clean, interrupted, half-unwound — read differently.
 */

import { describe, it, expect, vi } from 'vitest';
import { MigrationRecoveryPlugin, describeInterruptedRun } from './migration-recovery-plugin.js';

const JOURNAL = 'sys_migration_journal';

function makeCtx(opts: { engine?: any; noEngine?: boolean } = {}) {
  const services = new Map<string, any>();
  const hooks: Array<() => Promise<void> | void> = [];
  const warns: string[] = [];
  if (!opts.noEngine) services.set('objectql', opts.engine);
  const ctx: any = {
    logger: { info: () => {}, warn: (m: string) => { warns.push(String(m)); } },
    registerService: (n: string, s: any) => services.set(n, s),
    getService: (n: string) => {
      if (!services.has(n)) throw new Error(`service '${n}' not registered`);
      return services.get(n);
    },
    hook: (event: string, fn: () => Promise<void> | void) => {
      if (event === 'kernel:ready') hooks.push(fn);
    },
    _warns: warns,
    _services: services,
    _ready: async () => { for (const h of hooks) await h(); },
  };
  return ctx;
}

/** Engine backed by a fixed set of journal rows. */
function engineWith(rows: any[], opts: { failFind?: boolean; noJournalObject?: boolean } = {}) {
  return {
    getObject: (n: string) => (opts.noJournalObject && n === JOURNAL ? undefined : { name: n }),
    find: async (obj: string, q?: any) => {
      if (opts.failFind) throw new Error('table is gone');
      if (obj !== JOURNAL) return [];
      const where = q?.where ?? {};
      return rows.filter((r) => Object.entries(where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }));
    },
    insert: async () => ({}),
  };
}

async function boot(ctx: any) {
  const plugin = new MigrationRecoveryPlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);
  await ctx._ready();
  return plugin;
}

describe('MigrationRecoveryPlugin — the migration-plans registry', () => {
  it('registers the service in init, before the kernel:ready scan', async () => {
    const ctx = makeCtx({ engine: engineWith([]) });
    const plugin = new MigrationRecoveryPlugin();
    await plugin.init(ctx);
    // Available during other plugins' init/start — which is the point: a plugin
    // contributing a plan must be able to find it before the scan runs.
    expect(ctx._services.get('migration-plans')).toBeDefined();
    expect(ctx._services.get('migration-plans').list()).toEqual([]);
  });

  it('hands back a registered plan by id', async () => {
    const ctx = makeCtx({ engine: engineWith([]) });
    await boot(ctx);
    const registry = ctx._services.get('migration-plans');
    const plan = { id: 'backfill', steps: [] };
    registry.register(plan);
    expect(registry.get('backfill')).toBe(plan);
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.list()).toEqual([plan]);
  });
});

describe('MigrationRecoveryPlugin — boot scan', () => {
  it('says nothing when every run concluded', async () => {
    const ctx = makeCtx({
      engine: engineWith([
        { run_id: 'r1', seq: 0, kind: 'run_started' },
        { run_id: 'r1', seq: 1, kind: 'run_done' },
      ]),
    });
    await boot(ctx);
    expect(ctx._warns).toEqual([]);
  });

  it('warns per interrupted run and names the command that acts', async () => {
    const ctx = makeCtx({
      engine: engineWith([
        { run_id: 'r1', seq: 0, kind: 'run_started', plan_hash: 'h', detail: JSON.stringify({ planId: 'backfill' }) },
        { run_id: 'r1', seq: 1, kind: 'chunk_started', chunk_index: 0 },
        { run_id: 'r1', seq: 2, kind: 'chunk_done', chunk_index: 0 },
        { run_id: 'r1', seq: 3, kind: 'chunk_started', chunk_index: 1 },
        // …process died here.
      ]),
    });
    await boot(ctx);

    const all = ctx._warns.join('\n');
    expect(all).toContain("run 'r1'");
    expect(all).toContain("plan 'backfill'");
    // The state the journal design exists to make legible.
    expect(all).toContain('UNKNOWN outcome');
    expect(all).toContain('os migrate resume');
    // The promise this plugin makes: it did not act.
    expect(all).toContain('NOT resumed automatically');
  });

  it('does not resume — booting never writes to the journal', async () => {
    const insert = vi.fn(async () => ({}));
    const engine = { ...engineWith([
      { run_id: 'r1', seq: 0, kind: 'run_started' },
      { run_id: 'r1', seq: 1, kind: 'chunk_done', chunk_index: 0 },
    ]), insert };
    const ctx = makeCtx({ engine });
    await boot(ctx);
    // Discovery, not action: a resume would append chunk_started/chunk_done.
    expect(insert).not.toHaveBeenCalled();
  });

  it('reports a half-finished unwind as needing a decision, not a retry', async () => {
    const ctx = makeCtx({
      engine: engineWith([
        { run_id: 'stuck', seq: 0, kind: 'run_started' },
        { run_id: 'stuck', seq: 1, kind: 'chunk_done', chunk_index: 0 },
        { run_id: 'stuck', seq: 2, kind: 'chunk_done', chunk_index: 1 },
        { run_id: 'stuck', seq: 3, kind: 'compensated', chunk_index: 1 },
        { run_id: 'stuck', seq: 4, kind: 'run_failed' },
      ]),
    });
    await boot(ctx);
    const all = ctx._warns.join('\n');
    expect(all).toContain('COMPENSATION DID NOT FINISH');
    expect(all).toContain('needs a decision, not a retry');
  });

  it('reports a scan FAILURE rather than reading it as "nothing found"', async () => {
    const ctx = makeCtx({ engine: engineWith([], { failFind: true }) });
    await boot(ctx);
    const all = ctx._warns.join('\n');
    expect(all).toContain('scan failed');
    expect(all).toContain('NOT detected');
  });
});

describe('MigrationRecoveryPlugin — quiet degradation', () => {
  it('skips silently on a kernel with no engine', async () => {
    const ctx = makeCtx({ noEngine: true });
    await boot(ctx);
    expect(ctx._warns).toEqual([]);
  });

  it('skips silently when sys_migration_journal is not registered', async () => {
    // A lean kernel that never composed platform-objects has no journal, so it
    // has no interrupted runs. Warning here would train operators to ignore
    // this plugin's output — the one thing it cannot afford.
    const ctx = makeCtx({ engine: engineWith([], { noJournalObject: true }) });
    await boot(ctx);
    expect(ctx._warns).toEqual([]);
  });
});

describe('describeInterruptedRun', () => {
  const base = {
    runId: 'r1', planId: 'p', planHash: 'h',
    committedChunks: [0], unknownChunks: [], compensatedChunks: [],
  };

  it('tells the operator a plan is unresumable in THIS process, not that there is nothing to do', () => {
    const s = describeInterruptedRun(base, { register() {}, get: () => undefined, list: () => [] });
    expect(s).toContain("No loaded plugin registers plan 'p'");
    expect(s).toContain('os migrate resume');
  });

  it('offers the plain resume line when the plan is registered', () => {
    const plan = { id: 'p', steps: [] } as any;
    const s = describeInterruptedRun(base, { register() {}, get: () => plan, list: () => [plan] });
    expect(s).toContain('Resume with: os migrate resume --run r1');
    expect(s).not.toContain('No loaded plugin registers');
  });
});
