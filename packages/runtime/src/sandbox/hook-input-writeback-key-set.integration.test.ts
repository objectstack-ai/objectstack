// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14758] The sandbox write-back carries back the keys the BODY wrote — so
 * #14099's per-row divergence refusal is true for shipped hook bodies too, in
 * either row order.
 *
 * ## What was measured broken
 *
 * #14099's refusal reads the #14088 provenance recorder: per row, the set of
 * payload keys the hook chain ASSIGNED. On the in-process face that set is
 * exact. On the sandbox face it was the whole input dump, because
 * `applyMutationsToInput` ended in `Object.assign(target, mutatedInput)` and
 * `readCtxInputJson` dumps every key of `ctx.input`, touched or not. Every
 * assignment goes through the flat-input proxy, whose `set` trap the recorder
 * watches — so a body that touched nothing still "wrote" every key.
 *
 * On D3's shared batch payload that is order-dependent, and it defeats the
 * refusal in exactly one of the two orders. #14099's own fixture, driven
 * through a QuickJS body (measured on `origin/main` before this fix):
 *
 * | dispatch order   | row 1 window          | row 2 window          | refused? |
 * |------------------|-----------------------|-----------------------|----------|
 * | open → already   | {status,completed_at} | {status,completed_at} | **NO**   |
 * | already → open   | {status}              | {status,completed_at} | yes      |
 *
 * In the first order the already-done row inherits `completed_at` from the
 * transitioning row's write onto THE shared payload, the blanket write-back
 * re-assigns it, both windows match, and the batch proceeds — landing #14099's
 * original corruption: a `completed_at` that moves on a row that never
 * transitioned.
 *
 * ## Why this harness
 *
 * The defect lives in the composition of three real components no unit mock
 * exercises: QuickJS marshalling, objectql's flat-input proxy, and the #14088
 * recorder's `set` trap. So this drives REAL `ObjectQL` + REAL `SqlDriver`
 * (better-sqlite3) + REAL `QuickJSScriptRunner` behind `hookBodyRunnerFactory`
 * — the wiring `AppPlugin` performs — exactly as the reviewer's probe did.
 *
 * ## The four cases, and why the last one is mandatory
 *
 *  1. sandbox, open → already — refused (the order that used to land the
 *     corruption);
 *  2. sandbox, already → open — refused (the order that always was);
 *  3. sandbox, row-INVARIANT body — NOT refused, and its write LANDS on every
 *     matched row. This is the over-narrowing guard: a write-back that carried
 *     back too little would make an honest batch refuse, or drop the write;
 *  4. sandbox deletion — `delete ctx.input.x` still propagates
 *     (`body-runner.ts`'s absence-from-dump leg, #12277), because a key-set
 *     write-back that carried only ASSIGNMENTS would silently drop it.
 *
 * The dispatch order is asserted from inside the bodies rather than assumed,
 * so a driver that stopped returning matched rows in insertion order fails
 * loudly here instead of quietly turning case 1 into a second copy of case 2.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';
import {
  captureExpectedReadRefusals,
  type ExpectedReadRefusalCapture,
} from '../expected-read-refusal-noise.js';

const TASK = {
  name: 'duly_task',
  fields: {
    title: { type: 'text' },
    bucket: { type: 'text' },
    status: { type: 'text' },
    completed_at: { type: 'text' },
    touched_by: { type: 'text' },
    internal_note: { type: 'text' },
  },
};

const STAMP = '2026-09-03T09:00:00.000Z';
const EARLIER = '2026-01-01T00:00:00.000Z';
const ABSENT_TENANCY_TABLE = 'sys_organization';

/**
 * #14099's fixture as a shipped hook BODY: stamp `completed_at` on the
 * transition into `done`, and only on the transition. Reports the row it saw
 * so the test can assert the order it actually drove.
 */
const TRANSITION_STAMP_SOURCE = `
  ctx.log.info('row', { title: ctx.previous.title, index: ctx.dispatch ? ctx.dispatch.index : null });
  if (ctx.input.status === 'done' && ctx.previous.status !== 'done') {
    ctx.input.completed_at = '${STAMP}';
  }
`;

/** Row-INVARIANT: the same key on every row, whatever the row looks like. */
const ROW_INVARIANT_SOURCE = `
  ctx.log.info('row', { title: ctx.previous.title, index: ctx.dispatch ? ctx.dispatch.index : null });
  ctx.input.touched_by = 'hook';
`;

/** Row-invariant DELETION — the leg `body-runner.ts:555-558` already carries. */
const ROW_INVARIANT_DELETE_SOURCE = `
  ctx.log.info('row', { title: ctx.previous.title, index: ctx.dispatch ? ctx.dispatch.index : null });
  delete ctx.input.internal_note;
`;

type Boot = {
  engine: ObjectQL;
  seen: any[];
  dir: string;
  noise: ExpectedReadRefusalCapture;
};

describe('#14758 — the sandbox write-back carries the keys the body wrote', () => {
  let booted: Boot | null = null;

  afterEach(async () => {
    try { await booted?.engine.destroy(); } catch { /* noop */ }
    if (booted?.dir) rmSync(booted.dir, { recursive: true, force: true });
    booted = null;
  });

  async function boot(source: string): Promise<Boot> {
    const dir = mkdtempSync(join(tmpdir(), 'os-14758-'));
    const driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: join(dir, 'data.sqlite') },
      useNullAsDefault: true,
    });
    const noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE]);
    noise.captureDriver(driver);
    await driver.initObjects([TASK]);
    const engine = new ObjectQL();
    noise.captureEngine(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(TASK as any, 'duly');

    const seen: any[] = [];
    const logger = {
      debug: () => {},
      info: (_m: string, meta?: any) => { seen.push(meta); },
      warn: () => {},
      error: () => {},
    };
    engine.setDefaultBodyRunner(
      hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'duly', logger }),
    );
    bindHooksToEngine(engine, [{
      name: 'duly_task_stamp',
      object: 'duly_task',
      events: ['beforeUpdate'],
      body: { language: 'js', source, capabilities: ['log'] },
    } as any], { packageId: 'duly' });

    booted = { engine, seen, dir, noise };
    return booted;
  }

  /** Seeds #14099's two rows in the requested dispatch order. */
  async function seed(engine: ObjectQL, order: 'open-first' | 'already-first') {
    const open = {
      title: 'open', bucket: 'b1', status: 'open',
      completed_at: null, internal_note: 'n1',
    };
    const already = {
      title: 'already', bucket: 'b1', status: 'done',
      completed_at: EARLIER, internal_note: 'n2',
    };
    const first = order === 'open-first' ? open : already;
    const second = order === 'open-first' ? already : open;
    await engine.insert('duly_task', first as any);
    await engine.insert('duly_task', second as any);
  }

  const byTitle = async (engine: ObjectQL, title: string) =>
    ((await engine.find('duly_task', { where: { title } })) as any[])[0];

  it.each([
    ['open-first', ['open', 'already']],
    ['already-first', ['already', 'open']],
  ] as const)(
    'the transition stamp is refused in BOTH row orders (%s) and nothing is written',
    async (order, expectedOrder) => {
      const { engine, seen, noise } = await boot(TRANSITION_STAMP_SOURCE);
      await seed(engine, order);
      seen.splice(0);

      let err: any;
      try {
        await engine.update(
          'duly_task',
          { status: 'done' },
          { multi: true, where: { bucket: 'b1' } } as any,
        );
      } catch (e) { err = e; }

      // The order this case actually drove — asserted, never assumed.
      expect(seen.map((o) => o.title)).toEqual(expectedOrder);
      expect(seen.map((o) => o.index)).toEqual([0, 1]);

      // ADR-0112 envelope: code AND status, plus the key that diverged.
      // `expect.soft` so a run where the refusal DOES NOT fire still reaches
      // the row-state assertions below and reports the corruption that lands,
      // instead of stopping at the missing envelope. That is the whole finding
      // of this card, and a pin that hides half of it teaches half of it.
      expect.soft(err).toBeDefined();
      expect.soft(err?.code).toBe('MULTI_UPDATE_HOOK_KEY_DIVERGENCE');
      expect.soft(err?.status).toBe(400);
      expect.soft(err?.keys).toEqual(['completed_at']);

      // #14099's corruption: the already-done row's stamp must not move — and
      // the refusal lands BEFORE any write, so neither row changed at all.
      const already = await byTitle(engine, 'already');
      const open = await byTitle(engine, 'open');
      expect(already.completed_at).toBe(EARLIER);
      expect(already.status).toBe('done');
      expect(open.status).toBe('open');
      expect(open.completed_at ?? null).toBeNull();

      expect(noise.silentChannels()).toEqual([]);
    },
    60000,
  );

  it('a row-INVARIANT sandboxed body is NOT refused, and its write lands on every row', async () => {
    const { engine, seen, noise } = await boot(ROW_INVARIANT_SOURCE);
    await seed(engine, 'open-first');
    seen.splice(0);

    await engine.update(
      'duly_task',
      { status: 'done' },
      { multi: true, where: { bucket: 'b1' } } as any,
    );

    expect(seen.map((o) => o.title)).toEqual(['open', 'already']);

    const already = await byTitle(engine, 'already');
    const open = await byTitle(engine, 'open');
    // The body's write reached the SET clause for both matched rows — the
    // over-narrowing guard.
    expect(open.touched_by).toBe('hook');
    expect(already.touched_by).toBe('hook');
    // …and the caller's own payload key still landed.
    expect(open.status).toBe('done');
    expect(already.status).toBe('done');
    // The already-done row's stamp is untouched: nothing carried it back.
    expect(already.completed_at).toBe(EARLIER);
    expect(open.completed_at ?? null).toBeNull();

    expect(noise.silentChannels()).toEqual([]);
  }, 60000);

  it('a row-invariant sandboxed DELETE still propagates (the absence-from-dump leg)', async () => {
    const { engine, seen, noise } = await boot(ROW_INVARIANT_DELETE_SOURCE);
    await seed(engine, 'open-first');
    seen.splice(0);

    await engine.update(
      'duly_task',
      { status: 'done', internal_note: 'CALLER-SENT' },
      { multi: true, where: { bucket: 'b1' } } as any,
    );

    expect(seen.map((o) => o.title)).toEqual(['open', 'already']);

    const already = await byTitle(engine, 'already');
    const open = await byTitle(engine, 'open');
    // The caller sent `internal_note`; every row's body deleted it from the
    // shared payload, so the stored rows keep their own originals.
    expect(open.internal_note).toBe('n1');
    expect(already.internal_note).toBe('n2');
    expect(open.status).toBe('done');
    expect(already.status).toBe('done');

    expect(noise.silentChannels()).toEqual([]);
  }, 60000);
});
