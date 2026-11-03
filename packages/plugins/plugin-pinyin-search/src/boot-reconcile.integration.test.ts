// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — spawns the real producer once per single-cause fixture: real-kernel boots over a SQLite file holding a 2,500-row history, each remaining full walk its case's subject (the shared first walk, a write raced against a held walk, readiness against a held page, a shutdown mid-walk, the ledger-less boots, the forced rebuild); slowest CI reading 15.2 s (scheduled full-battery run 41271604267, Test Core shard log) x 1.25, rounded up; read before the three cases sharing the first walk took a copy of it

/**
 * #25634 — the boot reconcile reads what changed, not the whole table, and
 * readiness does not wait for it.
 *
 * Measured on `main` before this change: `kernel:bootstrapped` awaited
 * `backfillSearchCompanion`, which keyset-walked every row of every
 * companion-bearing object on every boot, and the kernel awaits every
 * `kernel:bootstrapped` handler before `kernel:listening` (the HTTP listen).
 * 6.7 M `sys_inbox_message` rows held a production boot for about 4 min 50 s,
 * and the next, unchanged boot paid the same again.
 *
 * Drives the REAL kernel, the REAL ObjectQL engine and the REAL plugin over a
 * SQLite FILE (so two boots share one database), with the REAL
 * `sys_migration` ledger object. Pages and rows are counted at the engine's
 * `find` for the probe object — the cost a boot actually pays.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import type { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMigration } from '@objectstack/platform-objects/system';
import { PinyinSearchPlugin } from './pinyin-search-plugin.js';
import { rebuildSearchCompanion } from './companion-projection.js';
import { SEARCH_COMPANION_RECONCILE_MIGRATION_ID } from './boot-reconcile.js';

const PROBE = 'pinyin_probe';
const SYSTEM = { isSystem: true } as const;
/** A history older than any watermark this test can write. */
const HISTORIC = '2026-01-01T00:00:00.000Z';
const ROWS = 2_500;
const PAGE = 1_000;
/** SQLite's compound-SELECT ceiling: the most rows one `bulkCreate` can carry. */
const INSERT_BATCH = 500;

const PROBE_OBJECT = {
  name: PROBE,
  label: 'Pinyin probe',
  nameField: 'title',
  systemFields: { tenant: false },
  fields: {
    title: { name: 'title', type: 'text' },
  },
};

/** `queries`: every `find` the walk issued for the probe, an empty one included. */
interface Reads { queries: number; rows: number }

/**
 * The deployment under test: ObjectQL over one SQLite file, the probe object
 * and the ledger, and a read counter on the probe's `find`. `gate`, when
 * given, holds the probe reads from the `holdFrom`-th one (0-based, default
 * 0) until it resolves.
 */
class FixturePlugin implements Plugin {
  name = 'test.pinyin-reconcile-fixture';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.engine.objectql'];
  driver: any;
  engine!: ObjectQL;
  readonly reads: Reads = { queries: 0, rows: 0 };

  constructor(
    private readonly file: string,
    private readonly opts: { ledger?: boolean; gate?: Promise<void>; holdFrom?: number } = {},
  ) {}

  async init(): Promise<void> {}

  async start(ctx: PluginContext): Promise<void> {
    const engine = ctx.getService<ObjectQL>('objectql');
    this.engine = engine;
    this.driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: this.file }, useNullAsDefault: true });
    await this.driver.connect();
    (engine as any).registerDriver(this.driver, true);
    const objects: any[] = this.opts.ledger === false ? [PROBE_OBJECT] : [PROBE_OBJECT, SysMigration];
    for (const def of objects) (engine as any).registry.registerObject(def, 'pinyin-test', 'pinyin-test');
    await (engine as any).syncSchemas();

    const find = engine.find.bind(engine);
    const reads = this.reads;
    const gate = this.opts.gate;
    const holdFrom = this.opts.holdFrom ?? 0;
    let issued = 0;
    (engine as any).find = async (object: string, ...rest: any[]) => {
      if (object !== PROBE) return find(object, ...rest);
      if (gate && issued++ >= holdFrom) await gate;
      const rows = await find(object, ...rest);
      reads.queries++;
      reads.rows += rows.length;
      return rows;
    };
  }

  /**
   * A write that bypasses every hook and the audit stamp: an import, a migration.
   * Batched `bulkCreate`, not one awaited `create` per row (#25749): 2,500
   * single-row autocommit inserts timed these cases out under CI load. A batch
   * is one `… UNION ALL SELECT …` statement on SQLite, which refuses more than
   * 500 terms ("too many terms in compound SELECT"), hence the slices. The
   * driver keeps the given `created_at`/`updated_at`, so the history stays older
   * than any watermark.
   */
  async directInsert(rows: Array<Record<string, unknown>>): Promise<void> {
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      await this.driver.bulkCreate(PROBE, rows.slice(i, i + INSERT_BATCH));
    }
  }

  async row(id: string): Promise<Record<string, any> | null> {
    return this.engine.findOne(PROBE, { where: { id }, fields: ['id', 'title', '__search'], context: SYSTEM });
  }
}

const kernels: ObjectKernel[] = [];
let dir: string;
let file: string;

beforeEach(() => {
  // The registry decides at construction whether to provision `__search`.
  vi.stubEnv('OS_SEARCH_PINYIN_ENABLED', 'true');
  dir = mkdtempSync(join(tmpdir(), 'pinyin-reconcile-'));
  file = join(dir, 'db.sqlite');
});

afterEach(async () => {
  while (kernels.length) {
    try { await kernels.pop()!.shutdown(); } catch { /* already stopped */ }
  }
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function boot(opts: {
  ledger?: boolean;
  gate?: Promise<void>;
  holdFrom?: number;
  before?: (f: FixturePlugin) => Promise<void>;
  /** The database file; the case's own `file` unless named. */
  on?: string;
} = {}) {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } });
  kernels.push(kernel);
  const fixture = new FixturePlugin(opts.on ?? file, opts);
  const plugin = new PinyinSearchPlugin({ enabled: true });
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(fixture);
  if (opts.before) {
    await kernel.use({
      name: 'test.pinyin-reconcile-before', version: '1.0.0', type: 'standard',
      dependencies: [fixture.name],
      init: async () => {},
      start: async () => opts.before!(fixture),
    } as Plugin);
  }
  await kernel.use(plugin);
  await kernel.bootstrap();
  return { kernel, fixture, plugin };
}

async function shutdown(kernel: ObjectKernel): Promise<void> {
  await kernel.shutdown();
  kernels.splice(kernels.indexOf(kernel), 1);
}

/** 2,500 historic rows a hook never saw: every 10th one is CJK. */
function history(): Array<Record<string, unknown>> {
  return Array.from({ length: ROWS }, (_, i) => ({
    id: `p${String(i).padStart(5, '0')}`,
    title: i % 10 === 0 ? `张伟${i}` : `Message ${i}`,
    created_at: HISTORIC,
    updated_at: HISTORIC,
  }));
}

// [#25749] Each case pays for real-kernel boots over a SQLite file (two in
// most) and a full 2,500-row walk. Since #23181 the first walk three cases
// share runs once, in the describe's hook; those cases boot over a copy of
// what it left, and the forced-rebuild case still walks every row in its
// explicit rebuild. Idle, the slowest case took about 1 s. On a 4-core box
// with 20 busy loops the boots and walks alone took 6.8 s and 10.1 s (seed
// excluded), past vitest's 5 s default, so the suite carries its own budget.
describe('#25634 the boot reconcile reads what changed since its last completed walk', { timeout: 30_000 }, () => {
  // [#23181] The first boot over the 2,500-row history, walked to completion
  // with the ledger on, is the same setup in three cases. It runs ONCE, here,
  // and its readings are taken while it is up; each of those cases then boots
  // over its own copy of the database that walk left (`fromWalked`).
  let walkedDir: string;
  let walked: string;
  let firstReads: Reads;
  let firstCjkSearch: unknown;
  let firstLatinSearch: unknown;
  let firstReceipt: any;

  beforeAll(async () => {
    vi.stubEnv('OS_SEARCH_PINYIN_ENABLED', 'true');
    walkedDir = mkdtempSync(join(tmpdir(), 'pinyin-reconcile-walked-'));
    walked = join(walkedDir, 'db.sqlite');
    const first = await boot({ on: walked, before: (f) => f.directInsert(history()) });
    try {
      await first.plugin.whenReconciled();
      firstReads = { ...first.fixture.reads };
      firstCjkSearch = (await first.fixture.row('p00010'))?.__search;
      firstLatinSearch = (await first.fixture.row('p00011'))?.__search ?? null;
      firstReceipt = await first.fixture.engine.findOne('sys_migration', {
        where: { id: SEARCH_COMPANION_RECONCILE_MIGRATION_ID }, context: SYSTEM,
      });
    } finally {
      await shutdown(first.kernel);
      vi.unstubAllEnvs();
    }
  }, 30_000);

  afterAll(() => {
    rmSync(walkedDir, { recursive: true, force: true });
  });

  /** This case's database becomes a copy of the one the first walk left. */
  function fromWalked(): void {
    for (const name of readdirSync(walkedDir)) copyFileSync(join(walkedDir, name), join(dir, name));
  }

  it('a first boot walks every row; an unchanged second boot reads none — and a receipt sits in sys_migration', async () => {
    expect(firstReads.rows).toBe(ROWS);
    expect(firstReads.queries).toBe(Math.ceil(ROWS / PAGE));
    // The walk did its job: a CJK history row now carries its companion.
    expect(firstCjkSearch).toBe('zhangwei10 zw10');
    expect(firstLatinSearch).toBeNull();
    expect(firstReceipt?.blocking).toBe(0);
    expect(firstReceipt?.verified_at ?? null).toBeNull();
    expect(JSON.parse(firstReceipt.details).objects[PROBE].sources).toEqual(['title']);

    fromWalked();
    const second = await boot();
    await second.plugin.whenReconciled();
    // THE PIN: the unchanged table is not read again — one filtered query
    // that answers no row.
    expect(second.fixture.reads).toEqual({ queries: 1, rows: 0 });
    console.info(`[#25634] rows/queries read — first boot ${firstReads.rows}/${firstReads.queries}, ` +
      `unchanged second boot ${second.fixture.reads.rows}/${second.fixture.reads.queries}`);
  });

  it('a second boot still fills a row a hook-bypassing writer added since the last walk, reading only that row', async () => {
    fromWalked();
    const second = await boot({
      before: (f) => f.directInsert([{ id: 'p_new', title: '李娜', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]),
    });
    await second.plugin.whenReconciled();
    expect(second.fixture.reads.rows).toBe(1);
    expect((await second.fixture.row('p_new'))?.__search).toBe('lina ln');
  });

  it('control: a normal ObjectQL write still stamps __search through the hooks, with the reconcile off the boot path', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const { fixture, plugin } = await boot({ gate, before: (f) => f.directInsert(history()) });
    // The reconcile is still parked on its first page; the write does not wait for it.
    await fixture.engine.insert(PROBE, { id: 'p_live', title: '王芳' }, { context: SYSTEM });
    expect((await fixture.row('p_live'))?.__search).toBe('wangfang wf');
    open();
    await plugin.whenReconciled();
  });

  it('control: the explicit rebuild (force) still walks every row, and fills a row the watermark cannot see', async () => {
    // Booted over the walked history: the watermark that walk recorded is the
    // one the back-dated write below hides from.
    fromWalked();
    const first = await boot();
    await first.plugin.whenReconciled();
    // A hook- AND stamp-bypassing write that back-dates itself: no watermark
    // can see it. That is what the explicit rebuild is for.
    await first.fixture.directInsert([{ id: 'p_backdated', title: '赵磊', created_at: HISTORIC, updated_at: HISTORIC }]);
    const before = first.fixture.reads.rows;
    const result = await rebuildSearchCompanion(first.fixture.engine as any, undefined, { object: PROBE });
    expect(result.scanned).toBe(ROWS + 1);
    expect(first.fixture.reads.rows - before).toBe(ROWS + 1);
    expect((await first.fixture.row('p_backdated'))?.__search).toBe('zhaolei zl');
  });

  it('readiness does not wait for the reconcile: bootstrap() resolves while its first page is still held', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    let settled = false;
    const { fixture, plugin } = await boot({ gate, before: (f) => f.directInsert(history()) });
    void plugin.whenReconciled().then(() => { settled = true; });
    // bootstrap() — every boot-phase hook, `kernel:listening` included — has
    // resolved, and the reconcile has not read a single page.
    await new Promise((r) => setTimeout(r, 20));
    expect(fixture.reads.queries).toBe(0);
    expect(settled).toBe(false);
    open();
    await plugin.whenReconciled();
    expect(fixture.reads.rows).toBe(ROWS);
  });

  it('shutdown stops the reconcile between pages and records no receipt for the unfinished walk', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    // Page 1 is served, page 2 is held: shutdown arrives mid-walk.
    const first = await boot({ gate, holdFrom: 1, before: (f) => f.directInsert(history()) });
    while (first.fixture.reads.queries < 1) await new Promise((r) => setTimeout(r, 5));
    const stopping = shutdown(first.kernel);
    open();
    await stopping;
    expect(first.fixture.reads.queries).toBe(2);
    expect(first.fixture.reads.rows).toBe(2 * PAGE);

    const second = await boot();
    await second.plugin.whenReconciled();
    expect(second.fixture.reads.rows).toBe(ROWS);
  });

  it('without the sys_migration ledger every boot walks every row (the old cost, never a missed row)', async () => {
    const first = await boot({ ledger: false, before: (f) => f.directInsert(history()) });
    await first.plugin.whenReconciled();
    await shutdown(first.kernel);
    const second = await boot({ ledger: false });
    await second.plugin.whenReconciled();
    expect(second.fixture.reads.rows).toBe(ROWS);
  });
});

describe('#25634 a failing reconcile is logged, not swallowed', () => {
  it('logs at warn when the reconcile throws, and bootstrapped resolves first', async () => {
    const hooks: Record<string, () => Promise<void>> = {};
    const warn = vi.fn();
    const engine = {
      registerHook: () => {},
      unregisterHooksByPackage: () => 0,
      registry: { getObject: () => undefined, getAllObjects: () => { throw new Error('registry exploded'); } },
      // No `update`: the pass throws before it could write anything.
      find: async () => [],
    };
    const ctx: any = {
      logger: { warn, debug: () => {}, info: () => {}, error: () => {} },
      hook: (name: string, fn: () => Promise<void>) => { hooks[name] = fn; },
      getService: () => engine,
    };
    const plugin = new PinyinSearchPlugin({ enabled: true });
    await plugin.start(ctx);
    await hooks['kernel:bootstrapped']();
    await plugin.whenReconciled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('companion reconcile failed'),
      expect.objectContaining({ error: 'registry exploded' }),
    );
  });
});
