// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The overlap-check hook template, run as written.
 *
 * Ruling 6876330213 keeps "no two of mine overlap" in hook scripts (no
 * `exclusions` key, no kernel change) and orders a vetted template into the
 * published skill (`skills/objectstack-data/references/data-hooks.md`,
 * pattern 5) and the docs (`content/docs/automation/hooks.mdx`). This file is
 * the vetting: {@link TEMPLATE} is that template's hook, byte for byte, and
 * it runs here in composition — a real `ObjectQL`, a real SQLite driver, the
 * real `QuickJSScriptRunner` and hook binder — for the five cases the order
 * names, read off `mapDataError`, the ADR-0112 table every data door answers
 * with.
 *
 * The copy is held here, not read from `skills/`: this package's suites do
 * not read outside it. When you edit the template there, edit it here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mapDataError } from '@objectstack/types';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

/** The published template's hook (data-hooks.md pattern 5), byte for byte. */
const TEMPLATE = {
  name: 'leave_request_no_overlap',
  object: 'leave_request',
  events: ['beforeInsert', 'beforeUpdate'],
  refusals: { OVERLAP: { message: 'This overlaps another request of yours.', status: 409 } },
  body: {
    language: 'js',
    capabilities: ['api.read'],
    source: `
      const r = Object.assign({}, ctx.previous, ctx.input); // update: stored row under the patch
      const off = ['rejected', 'cancelled'];
      if (!r.owner_id || !r.start_at || !r.end_at || off.includes(r.status)) return;
      const where = {
        owner_id: r.owner_id,
        status: { $nin: off },        // fail closed: a new status counts until listed here
        start_at: { $lt: r.end_at },  // half-open: one ending 18:00 and
        end_at: { $gt: r.start_at },  // one starting 18:00 do not overlap
      };
      if (ctx.previous) where.id = { $ne: ctx.previous.id }; // not the record itself
      if (await ctx.api.object('leave_request').count({ where }) > 0)
        throw Object.assign(new Error(), { code: 'OVERLAP' });
    `,
  },
};

const LEAVE = {
  name: 'leave_request',
  fields: {
    owner_id: { type: 'text', name: 'owner_id' },
    start_at: { type: 'datetime', name: 'start_at' },
    end_at: { type: 'datetime', name: 'end_at' },
    status: { type: 'text', name: 'status' },
    note: { type: 'text', name: 'note' },
  },
};

describe('overlap-check hook template (data-hooks.md pattern 5)', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  async function boot(): Promise<ObjectQL> {
    dir = mkdtempSync(join(tmpdir(), 'os-overlap-template-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    await driver.initObjects([LEAVE]);
    engine = new ObjectQL();
    engine.registerDriver(driver as any, true);
    await engine.init();
    engine.registry.registerObject(LEAVE as any);
    const bodyRunner = hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'overlap' });
    bindHooksToEngine(engine, [TEMPLATE as any], { packageId: 'overlap', bodyRunner });
    return engine;
  }

  const day = (from: string, to: string, extra: Record<string, unknown> = {}) => ({
    owner_id: 'u1',
    start_at: `2026-11-10T${from}:00.000Z`,
    end_at: `2026-11-10T${to}:00.000Z`,
    status: 'approved',
    ...extra,
  });

  async function refusal(p: Promise<unknown>) {
    const err = await p.then(() => null, (x) => x);
    expect(err, 'the write must be refused').not.toBeNull();
    return mapDataError(err, 'leave_request');
  }

  function expectOverlapRefusal(r: ReturnType<typeof mapDataError>) {
    expect(r.status).toBe(409);
    expect((r.body as any).declaredCode).toBe('OVERLAP');
    expect(String(r.body.error)).toContain('This overlaps another request of yours.');
  }

  it('refuses an insert that overlaps a live row of the same owner, and writes nothing', async () => {
    const e = await boot();
    await e.insert('leave_request', day('18:30', '21:30'));
    expectOverlapRefusal(await refusal(e.insert('leave_request', day('18:30', '21:30', { status: 'draft' }))));
    expectOverlapRefusal(await refusal(e.insert('leave_request', day('20:00', '23:00'))));
    expect(await e.count('leave_request', {})).toBe(1);
  }, 30_000);

  it('fails closed: a sibling with no status, or in a status the list does not name, still counts', async () => {
    const e = await boot();
    await e.insert('leave_request', day('08:00', '09:00', { status: null }));
    await e.insert('leave_request', day('10:00', '11:00', { status: 'escalated' }));
    expectOverlapRefusal(await refusal(e.insert('leave_request', day('08:30', '08:45'))));
    expectOverlapRefusal(await refusal(e.insert('leave_request', day('10:30', '10:45'))));
  }, 30_000);

  it('accepts an adjacent range (half-open), another owner, and a row with an ignored status', async () => {
    const e = await boot();
    await e.insert('leave_request', day('18:30', '21:30'));
    await e.insert('leave_request', day('21:30', '23:00'));
    await e.insert('leave_request', day('17:00', '18:30'));
    await e.insert('leave_request', day('18:30', '21:30', { owner_id: 'u2' }));
    // The rejected row is ignored as a sibling, and a rejected write is not checked.
    await e.insert('leave_request', day('19:00', '20:00', { status: 'rejected' }));
    await e.insert('leave_request', day('09:00', '10:00', { status: 'rejected' }));
    await e.insert('leave_request', day('09:30', '10:30'));
    expect(await e.count('leave_request', {})).toBe(7);
  }, 30_000);

  it('refuses an update that moves a row into overlap, merging the stored row under the patch', async () => {
    const e = await boot();
    await e.insert('leave_request', day('18:30', '21:30'));
    const later = await e.insert('leave_request', day('22:00', '23:00')) as any;
    // The patch carries only `start_at`; `end_at`, `owner_id` and `status` come from the stored row.
    expectOverlapRefusal(await refusal(e.update('leave_request', { id: later.id, start_at: '2026-11-10T21:00:00.000Z' })));
    // Reviving a rejected row into an overlap is refused too.
    const dead = await e.insert('leave_request', day('19:00', '20:00', { status: 'rejected' })) as any;
    expectOverlapRefusal(await refusal(e.update('leave_request', { id: dead.id, status: 'approved' })));
  }, 30_000);

  it('does not refuse an update of the record against itself', async () => {
    const e = await boot();
    const row = await e.insert('leave_request', day('18:30', '21:30')) as any;
    await e.update('leave_request', { id: row.id, note: 'renamed' });
    await e.update('leave_request', { id: row.id, start_at: '2026-11-10T18:00:00.000Z' });
    const got = await e.findOne('leave_request', { where: { id: row.id } }) as any;
    expect(got.note).toBe('renamed');
  }, 30_000);
});
