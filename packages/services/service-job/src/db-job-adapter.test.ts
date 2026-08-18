// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scheduledJobs } from 'croner';
import { DbJobAdapter } from './db-job-adapter.js';
import { CronJobAdapter } from './cron-job-adapter.js';
import {
  NEVER_FIRES_SCHEDULE as CRON,
  expectFixtureCannotFire,
  expectInertRegistration,
} from './never-fires.fixture.js';

function makeFakeEngine() {
  const tables = new Map<string, any[]>();
  return {
    tables,
    async find(table: string, opts: any = {}) {
      const t = tables.get(table) ?? [];
      let out = opts.where
        ? t.filter((r) => Object.entries(opts.where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }))
        : [...t];
      if (opts.orderBy) {
        for (const ord of [...opts.orderBy].reverse()) {
          // Canonical SortNode key only (spec/data/query.zod.ts): the real
          // engine strips an unknown `direction:` key and defaults to asc,
          // so the mock must too — honoring both keys masks wrong-key sorts.
          out.sort((a, b) => {
            const av = a[ord.field], bv = b[ord.field];
            if (av === bv) return 0;
            const cmp = av > bv ? 1 : -1;
            return ord.order === 'desc' ? -cmp : cmp;
          });
        }
      }
      if (opts.limit) out = out.slice(0, opts.limit);
      return out;
    },
    async insert(table: string, data: any) {
      const t = tables.get(table) ?? [];
      t.push({ ...data });
      tables.set(table, t);
      return { id: data.id };
    },
    async update(table: string, patch: any) {
      const t = tables.get(table) ?? [];
      const r = t.find((x) => x.id === patch.id);
      if (!r) throw new Error(`row ${patch.id} not in ${table}`);
      Object.assign(r, patch);
      return r;
    },
  };
}

describe('DbJobAdapter', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let adapter: DbJobAdapter;

  beforeEach(() => {
    engine = makeFakeEngine();
    adapter = new DbJobAdapter({ engine });
  });
  afterEach(async () => { await adapter.destroy(); });

  it('upserts sys_job on schedule', async () => {
    await adapter.schedule('cleanup', { type: 'cron', expression: '0 0 * * *' }, async () => {});
    const rows = engine.tables.get('sys_job') ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'cleanup',
      schedule_type: 'cron',
      schedule_expression: '0 0 * * *',
      active: true,
    });
  });

  it('updates existing sys_job on re-schedule', async () => {
    await adapter.schedule('daily', { type: 'cron', expression: '0 0 * * *' }, async () => {});
    await adapter.schedule('daily', { type: 'cron', expression: '*/15 * * * *' }, async () => {});
    const rows = engine.tables.get('sys_job') ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].schedule_expression).toBe('*/15 * * * *');
  });

  it('records sys_job_run on successful trigger', async () => {
    await adapter.schedule('ok', { type: 'cron', expression: '* * * * *' }, async () => {});
    await adapter.trigger('ok');
    const runs = engine.tables.get('sys_job_run') ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('success');
    expect(runs[0].job_name).toBe('ok');
    expect(typeof runs[0].duration_ms).toBe('number');
  });

  it('records sys_job_run on failure and bumps failure_count', async () => {
    await adapter.schedule('bad', { type: 'cron', expression: '* * * * *' }, async () => {
      throw new Error('oops');
    });
    await adapter.trigger('bad');
    const runs = engine.tables.get('sys_job_run') ?? [];
    expect(runs[0].status).toBe('failed');
    expect(runs[0].error).toBe('oops');
    const job = (engine.tables.get('sys_job') ?? [])[0];
    expect(job.last_status).toBe('failed');
    expect(job.failure_count).toBe(1);
    expect(job.run_count).toBe(1);
  });

  it('cancel marks sys_job inactive', async () => {
    await adapter.schedule('temp', { type: 'cron', expression: '* * * * *' }, async () => {});
    await adapter.cancel('temp');
    const row = (engine.tables.get('sys_job') ?? [])[0];
    expect(row.active).toBe(false);
  });

  it('listExecutionsByStatus filters from DB', async () => {
    await adapter.schedule('mix', { type: 'cron', expression: '* * * * *' }, async () => {});
    await adapter.trigger('mix');
    await adapter.schedule('bad', { type: 'cron', expression: '* * * * *' }, async () => {
      throw new Error('x');
    });
    await adapter.trigger('bad');

    const failed = await adapter.listExecutionsByStatus('failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].jobId).toBe('bad');
    const ok = await adapter.listExecutionsByStatus('success');
    expect(ok).toHaveLength(1);
    expect(ok[0].jobId).toBe('mix');
  });

  it('listExecutionsByStatus returns the newest run first', async () => {
    // Regression: the query sorted with the non-canonical `direction: 'desc'`
    // key, which SortNode strips — so "latest run" returned the OLDEST run.
    engine.tables.set('sys_job_run', [
      { id: '1', job_name: 'first', status: 'success', started_at: '2026-01-01T00:00:00Z' },
      { id: '2', job_name: 'third', status: 'success', started_at: '2026-03-01T00:00:00Z' },
      { id: '3', job_name: 'second', status: 'success', started_at: '2026-02-01T00:00:00Z' },
    ]);
    const runs = await adapter.listExecutionsByStatus('success');
    expect(runs.map((r) => r.jobId)).toEqual(['third', 'second', 'first']);
  });

  it('replay tags a synthetic run as replay trigger', async () => {
    await adapter.schedule('rj', { type: 'cron', expression: '* * * * *' }, async () => {});
    await adapter.replay('rj');
    const runs = engine.tables.get('sys_job_run') ?? [];
    // One synthetic replay run + one wrapped success run from inner trigger
    const triggers = runs.map((r) => r.trigger).sort();
    expect(triggers).toEqual(['replay', 'schedule']);
  });
});

// ─── #8362 — the destroy chain, and what an evicted kernel leaves behind ─────
//
// Kernel eviction is ROUTINE in the cloud runtime: a freshness probe runs every
// few seconds and every auto-publish bumps freshness, so the eviction chain
// `KernelManager.evict() -> kernel.shutdown() -> plugin.destroy() ->
// JobServicePlugin.destroy() -> dbAdapter.destroy()` runs constantly. It used
// to stop one level short — `destroy()` destroyed `inner` and never `cron` — so
// every evicted kernel left its croner timers running and holding their
// PROCESS-GLOBAL names, and the rebuilt kernel could never re-bind that flow
// again. The only signal was one WARN.
//
// Why the ordering of the two fixes matters, pinned by the second case below:
// the leaked job is not merely holding a name, it is still ALIVE with a closure
// over the shut-down kernel's engine. Namespacing the names WITHOUT closing the
// destroy chain would therefore convert a silent death into a zombie
// double-write — two live jobs, one driving a dead kernel. Hence the assertion
// is `oldJob.isStopped()`, not "a new job exists somewhere".
describe('DbJobAdapter — kernel rebuild (#8362)', () => {
  /** Croner's process-global registry, narrowed to one PUBLIC job name. */
  const registeredFor = (jobName: string) =>
    scheduledJobs.filter((j) => (j.name ?? '').endsWith(jobName));

  /**
   * These cases inject a REAL CronJobAdapter, so `schedule()` builds a REAL
   * croner job. They scheduled on a daily expression, whose one instant a day
   * is a window the exact-count assertion below (`fired`) straddles just as an
   * every-minute expression's is — 1440x rarer, same defect. The inert fixture
   * removes the schedule entirely; see `never-fires.fixture.ts`.
   */
  it('the shared cron fixture cannot fire on its own', () => {
    expectFixtureCannotFire(CRON.expression);
  });

  /** One kernel's job-service wiring: the pair JobServicePlugin builds. */
  function kernel() {
    const cron = new CronJobAdapter();
    return { cron, db: new DbJobAdapter({ engine: makeFakeEngine(), cron }) };
  }

  it('destroy() destroys the CRON adapter too, freeing the process-global name', async () => {
    const NAME = 'flow-time-relative:xqao_contract_expiry_reminder_flow';
    const k = kernel();
    await k.db.schedule(NAME, CRON, async () => {});
    expectInertRegistration(k.cron, NAME);

    const [job] = registeredFor(NAME);
    expect(job, 'the first bind must register a REAL croner named job').toBeDefined();
    expect(job.isStopped()).toBe(false);

    // Exactly what the eviction chain reaches, one call short of which was the
    // whole defect.
    await k.db.destroy();

    expect(job.isStopped()).toBe(true);
    expect(registeredFor(NAME)).toHaveLength(0);
  });

  it('a rebuilt kernel re-binds the same flow: scheduled exactly once, and it fires', async () => {
    const NAME = 'flow-time-relative:xqao_contract_expiry_reminder_flow';
    const fired: string[] = [];

    const old = kernel();
    await old.db.schedule(NAME, CRON, async () => { fired.push('old-kernel'); });
    expectInertRegistration(old.cron, NAME);
    // Assert the FIRST bind landed before asserting anything about the second.
    expect(registeredFor(NAME)).toHaveLength(1);
    const oldJob = registeredFor(NAME)[0];

    await old.db.destroy(); // kernel evicted by the freshness probe

    const rebuilt = kernel();
    await rebuilt.db.schedule(NAME, CRON, async () => { fired.push('new-kernel'); });
    expectInertRegistration(rebuilt.cron, NAME);

    const held = registeredFor(NAME);
    expect(held).toHaveLength(1); // exactly once — not one live + one zombie
    expect(oldJob.isStopped()).toBe(true); // the old job is STOPPED, not merely renamed around

    await held[0].trigger();
    expect(fired).toEqual(['new-kernel']); // the dead kernel's closure never runs

    await rebuilt.db.destroy();
  });
});

// ─── #9633 — replay() honours `recordRuns`, on all three of its arms ─────────
//
// `recordRuns` had exactly two `startRun` call sites and the gate landed on one
// of them: `wrap`'s per-attempt row was gated, `replay`'s synthetic row was not.
// An operator who switched run history off therefore kept accumulating rows —
// exclusively replay ones, the least representative sample of a job's history,
// with no non-replay rows beside them for context. The carve-out was an
// artifact of `replay` being written to solve a different problem (#5548's
// synthetic row forces the `trigger: 'replay'` tag), never a designed exception,
// so it is closed rather than documented (the ruling on #9633).
//
// ⚠️ Nothing in this package referenced `recordRuns` in ANY direction before
// #9631 — the flag could have stopped being honoured entirely and the suite
// would not have noticed. These cases are written so that cannot happen again:
// each flag-off case asserts the execution REALLY RAN (handler counter plus the
// `sys_job` counters, which the flag deliberately does not gate) alongside the
// "no rows" assertion, so "0 rows" cannot pass for a job that never ran; and
// the flag-on cases assert the synthetic row reached a TERMINAL status, so
// over-gating the three `finishRun` arms — a dangling `running` half-row, worse
// than either original state — goes red instead of silently passing "a row
// exists".
describe('DbJobAdapter — replay() honours recordRuns (#9633)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  const adapters: DbJobAdapter[] = [];

  function makeAdapter(options?: { recordRuns?: boolean }) {
    const a = new DbJobAdapter({ engine, options });
    adapters.push(a);
    return a;
  }

  beforeEach(() => {
    engine = makeFakeEngine();
    adapters.length = 0;
  });
  afterEach(async () => {
    for (const a of adapters) await a.destroy();
  });

  const runs = () => engine.tables.get('sys_job_run') ?? [];
  const job = () => (engine.tables.get('sys_job') ?? [])[0];

  it('recordRuns: false — a replay runs the handler and writes NO sys_job_run row', async () => {
    const adapter = makeAdapter({ recordRuns: false });
    let ran = 0;
    await adapter.schedule('quiet', { type: 'cron', expression: '* * * * *' }, async () => { ran += 1; });

    await adapter.replay('quiet');

    // The discriminator: neither the synthetic replay row nor the wrapped
    // per-attempt row is written. Ungated, this table holds a `trigger:
    // 'replay'` row here.
    expect(runs()).toHaveLength(0);
    // …and the execution really happened, so "0 rows" cannot be passing for a
    // job that never ran. `bumpJob` is called outside the row gate by design.
    expect(ran).toBe(1);
    expect(job().run_count).toBe(1);
    expect(job().last_status).toBe('success');
    // README.md's options table — "`false` keeps the in-memory history only" —
    // was falsified by exactly the replay row this case now forbids. Pinned
    // here rather than restated in prose: the durable table is empty and the
    // in-memory history the sentence promises is still there.
    expect((await adapter.getExecutions('quiet')).length).toBeGreaterThan(0);
  });

  it('recordRuns: false — the terminal-status arm writes nothing either, and leaves no dangling row', async () => {
    const adapter = makeAdapter({ recordRuns: false });
    let ran = 0;
    await adapter.schedule('sour', { type: 'cron', expression: '* * * * *' }, async () => {
      ran += 1;
      throw new Error('replayed and failed');
    });

    await adapter.replay('sour');

    // The arm that reads the terminal status off the inner execution (#7734).
    // Half-gating — suppressing `startRun` but not `finishRun`, or the reverse
    // — is what would leave a `running` row with no `completed_at`.
    expect(runs()).toHaveLength(0);
    expect(ran).toBe(1);
    expect(job().last_status).toBe('failed');
    expect(job().failure_count).toBe(1);
  });

  it('recordRuns: false — the catch arm writes nothing and still rethrows', async () => {
    const adapter = makeAdapter({ recordRuns: false });
    await adapter.schedule('boom', { type: 'cron', expression: '* * * * *' }, async () => {});
    // `executeJob` swallows a handler throw, so the catch arm is unreachable
    // through the handler — the inner call itself has to reject for it to run.
    const inner = (adapter as any).inner;
    inner.trigger = async () => { throw new Error('inner exploded'); };

    await expect(adapter.replay('boom')).rejects.toThrow('inner exploded');

    expect(runs()).toHaveLength(0);
  });

  it('default recordRuns — the synthetic replay row is still written, and SETTLED', async () => {
    const adapter = makeAdapter(); // no options at all: the flag defaults to true
    await adapter.schedule('loud', { type: 'cron', expression: '* * * * *' }, async () => {});

    await adapter.replay('loud');

    // The #5548 tag survives the gate: one synthetic replay row beside the
    // wrapped run the execution itself produced.
    const replayRows = runs().filter((r: any) => r.trigger === 'replay');
    expect(replayRows).toHaveLength(1);
    // Terminal, not left `running` — this is what goes red if the three
    // `finishRun` arms are over-gated along with `startRun`.
    expect(replayRows[0].status).toBe('success');
    expect(replayRows[0].completed_at).toBeTruthy();
    expect(runs().map((r: any) => r.trigger).sort()).toEqual(['replay', 'schedule']);
  });

  it('recordRuns: true — the replay row still carries the terminal status of the inner execution', async () => {
    const adapter = makeAdapter({ recordRuns: true }); // explicit, matching the default
    await adapter.schedule('sour', { type: 'cron', expression: '* * * * *' }, async () => {
      throw new Error('replayed and failed');
    });

    await adapter.replay('sour');

    const replayRows = runs().filter((r: any) => r.trigger === 'replay');
    expect(replayRows).toHaveLength(1);
    // #7734: read off the inner execution, not assumed `success`.
    expect(replayRows[0].status).toBe('failed');
    expect(replayRows[0].error).toBe('replayed and failed');
    expect(replayRows[0].completed_at).toBeTruthy();
  });
});
