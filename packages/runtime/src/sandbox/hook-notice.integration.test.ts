// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28251] A SHIPPED (sandboxed) hook body sets the save notice through
 * `ctx.notice(message)`.
 *
 * The body's `ctx.input.options` is the frozen `{ multi, where }` projection,
 * so before this card a body could not reach the write's `onNotice` listener
 * at all, and HotCRM — whose hooks the build lowers into bodies — answered a
 * save that sent a deal for approval with a `record:alert` banner instead.
 * The engine now binds `ctx.notice` from that listener on every insert /
 * update dispatch, and the body runner marshals it into the VM.
 *
 * Same wiring as the sibling signal pins: the REAL `ObjectQL` + REAL
 * `SqlDriver` (better-sqlite3) + REAL `QuickJSScriptRunner` behind
 * `hookBodyRunnerFactory`, what `AppPlugin` composes. Every assertion lands on
 * what the WRITE'S OWN LISTENER received, the same listener
 * `metadata-protocol`'s `createData` / `updateData` answer as `notice`.
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

const DEAL = {
  name: 'probe_notice_deal',
  fields: {
    name: { type: 'text' },
    stage: { type: 'text' },
  },
};

/**
 * Says what the save did, from the phase the row asks for, and reports
 * whether the member was there at all — so a delete dispatch is read too.
 * `stage: 'bad'` passes a number, which the member refuses.
 */
const BODY_SOURCE = `
  ctx.log.info('probe', { event: ctx.event, type: typeof ctx.notice });
  if (typeof ctx.notice !== 'function') return;
  var row = ctx.event.indexOf('after') === 0 ? ctx.result : ctx.input;
  if (!row) return;
  if (row.stage === 'bad') { ctx.notice(42); return; }
  if (ctx.event === 'beforeInsert' && row.stage === 'submitted') ctx.notice('Sent ' + row.name + ' for approval');
  if (ctx.event === 'afterUpdate' && row.stage === 'won') ctx.notice('Renewal created for ' + row.name);
`;

const ABSENT_TENANCY_TABLE = 'sys_organization';

describe('#28251 — a sandboxed hook body sets the save notice with ctx.notice', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;
  let noise: ExpectedReadRefusalCapture | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  it('reaches the write\'s own listener on insert and update, is absent on delete, and refuses a non-string', async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-28251-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE]);
    noise.captureDriver(driver);
    await driver.initObjects([DEAL]);
    engine = new ObjectQL();
    noise.captureEngine(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(DEAL as any, 'probe');

    const seen: any[] = [];
    const logger = {
      debug: () => {},
      info: (_msg: string, meta?: any) => { seen.push(meta); },
      warn: () => {},
      error: () => {},
    };
    engine.setDefaultBodyRunner(
      hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'probe', logger }),
    );
    bindHooksToEngine(engine, [{
      name: 'probe_save_notice',
      object: DEAL.name,
      events: ['beforeInsert', 'afterUpdate', 'beforeDelete'],
      body: { language: 'js', source: BODY_SOURCE, capabilities: ['log'] },
    } as any], { packageId: 'probe' });

    const CALLER = { context: { userId: 'u_probe', isSystem: true } };
    const listen = () => {
      const heard: unknown[] = [];
      return { heard, onNotice: (message: unknown) => { heard.push(message); } };
    };

    // ── beforeInsert: the body's sentence reaches the create's listener.
    const create = listen();
    const row: any = await engine.insert(DEAL.name, { name: 'Acme', stage: 'submitted' }, { ...CALLER, onNotice: create.onNotice } as any);
    expect(create.heard).toEqual(['Sent Acme for approval']);

    // ── afterUpdate: the update's own listener, a fresh one.
    const update = listen();
    await engine.update(DEAL.name, { stage: 'won' }, { ...CALLER, where: { id: row.id }, onNotice: update.onNotice } as any);
    expect(update.heard).toEqual(['Renewal created for Acme']);

    // ── A write nobody listens on: the member is there, and sets nothing.
    await engine.insert(DEAL.name, { name: 'Seeded', stage: 'submitted' }, CALLER as any);

    // ── A non-string message: refused, and the write with it.
    await expect(engine.insert(DEAL.name, { name: 'Bad', stage: 'bad' }, { ...CALLER, onNotice: () => {} } as any))
      .rejects.toThrow(/ctx\.notice\(message\) takes one non-empty string/);

    // ── beforeDelete: no answer carries a notice, so no member.
    seen.splice(0);
    await engine.delete(DEAL.name, { ...CALLER, where: { id: row.id } } as any);
    expect(seen.map((o) => [o.event, o.type])).toEqual([['beforeDelete', 'undefined']]);

    expect(noise?.tablesSeen() ?? ['no capture was installed']).toEqual([]);
  }, 30000);
});
