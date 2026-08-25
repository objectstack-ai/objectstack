// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11552] The per-row dispatch signal, and D2's `input.options` visibility,
 * OBSERVED FROM INSIDE A SHIPPED BODY — the conformance face of the maintainer
 * ruling that closed ADR-0058 Addendum II's declared≠observable gap for
 * body-only hooks.
 *
 * ## What was measured broken (and is pinned fixed here)
 *
 * D3 names three routes for row-specific work — throw, `ctx.api` per row, or
 * caller-side pagination — and routes 1 and 2 both require the handler to KNOW
 * it is on the per-row predicate path. The signal existed on the engine context
 * (`dispatch`, #6966; `input.options`, D2) and was dropped at the sandbox
 * boundary: `unwrapProxyToPlain` materialises only what `installFlatInput`'s
 * `ownKeys` enumerates (payload fields), and `dispatch` was never marshalled.
 * So the natural guard — `ctx.dispatch?.mode === 'per-row'` — lowered cleanly,
 * passed in-process handler tests, and evaluated `false` on EVERY production
 * dispatch: the inert-guard shape, shipped.
 *
 * ## Why this harness and not a unit mock
 *
 * The drop happened between two real components whose composition no unit
 * mock exercises: objectql's flat-input proxy (its `ownKeys`/descriptor
 * hiding) and the QuickJS marshalling. So this drives the REAL `ObjectQL` +
 * REAL `SqlDriver` (better-sqlite3) + REAL `QuickJSScriptRunner` behind
 * `hookBodyRunnerFactory` — the same wiring `AppPlugin` performs — and every
 * assertion lands on what a body OBSERVED, reported out through the `log`
 * capability. It mirrors the tripwire test on
 * `hotcrm@claude/issue-1265-batch-scoped-payload`
 * (`#1265 — the shipped hook body cannot tell it is on a per-row predicate
 * dispatch`), which asserts the four broken facts and is written to go red as
 * this lands; this file is the framework-side twin asserting the fixed ones.
 *
 * ## The contract pinned, member by member
 *
 *  - `ctx.dispatch` = frozen `{ mode, index }` — `'per-row'` + row index on
 *    the predicate path, `'record'` on single-record writes. NOT `scope`:
 *    shared-identity scratch cannot survive a JSON copy into an isolated heap,
 *    so marshalling it would ship a silently-inert write channel (see
 *    `ScriptContext.dispatch`).
 *  - `ctx.input.options` = frozen, NON-ENUMERABLE `{ multi?, where? }` — the
 *    projection D2 declares `before*`-visible, not the whole caller bag (the
 *    host-error-allowlist reasoning in `quickjs-runner.ts`: everything
 *    marshalled becomes readable by untrusted code).
 *  - Enumeration stays flat-only: `Object.keys(ctx.input)` lists payload
 *    fields, exactly as the #7254 witness pins for bodies — so the payload
 *    diff idiom cannot pick up a phantom `options` field.
 *  - `ctx.input.id` stays ABSENT on the body face (not part of the ruling);
 *    the row id a per-row body needs is `ctx.previous.id`, bound since #5574.
 *  - The write-back channel still works and still cannot carry `options`:
 *    payload writes land on the batch payload; the caller's live bag is never
 *    overwritten by a JSON copy (non-enumerable ⇒ excluded from the post-run
 *    `JSON.stringify` dump `applyMutationsToInput` consumes).
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

const ARTICLE = {
  name: 'probe_article',
  fields: {
    title: { type: 'text' },
    status: { type: 'text' },
    published_at: { type: 'text' },
  },
};

/**
 * Reports what the body can OBSERVE, then attempts the mutations the contract
 * forbids, then reports what it observes AFTER the attempts — so the frozen
 * halves are asserted from inside the VM rather than inferred.
 */
const PROBE_SOURCE = `
  const o = {
    event: ctx.event,
    dispatchType: typeof ctx.dispatch,
    dispatchMode: ctx.dispatch ? ctx.dispatch.mode : null,
    dispatchIndex: ctx.dispatch ? ctx.dispatch.index : null,
    dispatchScopeType: ctx.dispatch ? typeof ctx.dispatch.scope : null,
    inputKeys: Object.keys(ctx.input).sort(),
    inputIdType: typeof ctx.input.id,
    optionsType: typeof ctx.input.options,
    optionsMulti: ctx.input.options ? ctx.input.options.multi : null,
    optionsWhere: ctx.input.options ? ctx.input.options.where : null,
    previousId: ctx.previous ? typeof ctx.previous.id : null,
  };
  try { ctx.dispatch.mode = 'record'; } catch (e) { /* frozen */ }
  try { ctx.input.options.multi = false; } catch (e) { /* frozen */ }
  try { ctx.input.options = { multi: false } } catch (e) { /* non-writable */ }
  o.postDispatchMode = ctx.dispatch ? ctx.dispatch.mode : null;
  o.postOptionsMulti = ctx.input.options ? ctx.input.options.multi : null;
  ctx.log.info('probe', o);
`;

const ABSENT_TENANCY_TABLE = 'sys_organization';

describe('#11552 — a shipped body observes the per-row dispatch signal and the D2 options projection', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;
  let noise: ExpectedReadRefusalCapture | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  it('per-row: mode/index/options visible, frozen, and invisible to enumeration; single-record: mode is record', async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-11552-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE]);
    noise.captureDriver(driver);
    await driver.initObjects([ARTICLE]);
    engine = new ObjectQL();
    noise.captureEngine(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    // `packageId` is a required parameter (`registerObject(schema, packageId, …)`)
    // — the sibling harness's 1-arg spelling is frozen TEST_DEBT, not a template.
    engine.registry.registerObject(ARTICLE as any, 'probe');

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
      name: 'probe_perrow_signal',
      object: 'probe_article',
      events: ['beforeInsert', 'beforeUpdate'],
      body: { language: 'js', source: PROBE_SOURCE, capabilities: ['log'] },
    } as any], { packageId: 'probe' });

    await engine.insert('probe_article', { title: 'a', status: 'draft', published_at: 'x' });
    await engine.insert('probe_article', { title: 'b', status: 'draft', published_at: 'y' });
    await engine.insert('probe_article', { title: 'c', status: 'live', published_at: 'z' });
    const inserts = seen.splice(0);
    expect(inserts.length).toBe(3);
    for (const o of inserts) {
      // An insert is the caller's whole write: the marker says so.
      expect(o.dispatchMode).toBe('record');
      expect(o.dispatchIndex).toBe(0);
    }

    // ── The predicate path (multi: true + where) — one write, two matched rows.
    const callerOptions = { multi: true, where: { status: 'draft' } };
    await engine.update('probe_article', { title: 'renamed' }, callerOptions as any);
    const perRow = seen.splice(0);
    expect(perRow.length).toBe(2);

    for (const o of perRow) {
      expect(o.event).toBe('beforeUpdate');
      // Route 1/2's precondition — the signal, now observable (was
      // `dispatchType: 'undefined'` before #11552, measured on this exact
      // harness).
      expect(o.dispatchType).toBe('object');
      expect(o.dispatchMode).toBe('per-row');
      // `scope` deliberately does not cross — see the module doc.
      expect(o.dispatchScopeType).toBe('undefined');
      // D2's projection, under D2's own spelling.
      expect(o.optionsType).toBe('object');
      expect(o.optionsMulti).toBe(true);
      expect(o.optionsWhere).toEqual({ status: 'draft' });
      // Enumeration is STILL flat-only — no phantom `options` in a payload
      // diff, exactly the #7254 witness contract.
      expect(o.inputKeys).toEqual(['title']);
      // `input.id` stays absent (not part of the ruling); the row id channel
      // on the per-row path is `previous.id`.
      expect(o.inputIdType).toBe('undefined');
      expect(o.previousId).toBe('string');
      // Frozen: the body's own mutation attempts changed nothing it can read.
      expect(o.postDispatchMode).toBe('per-row');
      expect(o.postOptionsMulti).toBe(true);
    }
    expect(perRow.map((o) => o.dispatchIndex).sort()).toEqual([0, 1]);

    // The caller's live bag was not clobbered by any write-back of the graft
    // (non-enumerable ⇒ excluded from the mutatedInput dump), nor by the
    // body's frozen-write attempts. `toMatchObject`, not `toEqual`: the
    // engine's post-`before*` driver merge is allowed to ADD keys, never to
    // flip these.
    expect(callerOptions).toMatchObject({ multi: true, where: { status: 'draft' } });

    // The payload write channel itself still works under the graft: both
    // matched rows took the batch payload.
    const renamed = (await engine.find('probe_article', { where: { title: 'renamed' } })) as any[];
    expect(renamed.length).toBe(2);

    // ── The single-record path: same hook, by-id write.
    const live = ((await engine.find('probe_article', { where: { status: 'live' } })) as any[])[0];
    await engine.update('probe_article', { id: live.id, title: 'single' });
    const single = seen.splice(0);
    expect(single.length).toBe(1);
    expect(single[0].dispatchMode).toBe('record');
    expect(single[0].dispatchIndex).toBe(0);
    // Whatever options bag a by-id write carries, it must not read as a
    // predicate write from inside a body.
    expect(single[0].optionsMulti).not.toBe(true);

    // [#10629] Withheld-noise pin, same as the sibling real-SQLite harness.
    expect(noise?.silentChannels() ?? ['no capture was installed']).toEqual([]);
  }, 30000);
});
