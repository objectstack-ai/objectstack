// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25905] The declared write provenance, OBSERVED FROM INSIDE A SHIPPED BODY —
 * the sandbox face of `HookContext.provenance`.
 *
 * ## What is pinned, and why a kernel rig could not pin it
 *
 * A flow that runs `runAs: 'user'` writes as the person who started it, so on
 * the real path `ctx.user`, `ctx.session` and `ctx.input` are identical between
 * the flow data node's write and that person's own REST write of the same
 * fields. The one discriminator is server-stamped: the automation engine puts
 * the run id on the data node's execution context (`resolveRunDataContext`),
 * and objectql's `buildProvenance()` projects it onto the hook context as
 * `provenance.flowRunId`. It reaches a lowered body only if
 * `buildSandboxContext` and `installCtx` carry it — which is what this proves,
 * from inside the VM, rather than from a handler running in-process.
 *
 * Same wiring as the referential-marker pins next door: the REAL `ObjectQL` +
 * REAL `SqlDriver` (better-sqlite3) + REAL `QuickJSScriptRunner` behind
 * `hookBodyRunnerFactory` — what `AppPlugin` composes — and every assertion
 * lands on what the body OBSERVED, reported out through the `log` capability:
 *
 *  - on the flow's write, `ctx.provenance.flowRunId` is the run id, beside the
 *    same caller identity a REST write carries;
 *  - on the REST write, `ctx.provenance` is ABSENT (`typeof` reads
 *    `'undefined'`), so `ctx.provenance?.flowRunId` reads "not a flow write";
 *  - a REST write whose PAYLOAD carries a provenance-shaped value surfaces it
 *    on `ctx.input` only, never on `ctx.provenance`: the mark cannot be forged
 *    through the data API;
 *  - the body cannot drift its own copy: the member and the key are frozen.
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

/** `provenance` is an ordinary field name here, so a payload can carry one. */
const ACCOUNT = {
  name: 'probe_prov_account',
  fields: {
    name: { type: 'text' },
    provenance: { type: 'text' },
  },
};

/**
 * Reports exactly what a shipped guard can read. `provenanceType`
 * distinguishes an absent key from every present shape, so the REST case
 * cannot pass by accident of a falsy value. The two drift attempts run in
 * try/catch so a strict-mode TypeError on a frozen target is reported as a
 * reading, not as a failed hook; they run only where the key is present,
 * since an absent key is the body's own to define (as with `ctx.dispatch`).
 */
const PROBE_SOURCE = `
  var present = typeof ctx.provenance;
  if (present !== 'undefined') {
    try { ctx.provenance.flowRunId = 'drifted'; } catch (e) {}
    try { ctx.provenance = { flowRunId: 'replaced' }; } catch (e) {}
  }
  ctx.log.info('probe', {
    event: ctx.event,
    name: ctx.input ? ctx.input.name : null,
    provenanceType: present,
    flowRunId: ctx.provenance ? ctx.provenance.flowRunId : null,
    keys: ctx.provenance ? Object.keys(ctx.provenance).sort() : null,
    inputProvenance: ctx.input ? ctx.input.provenance : null,
    sessionUserId: ctx.session ? ctx.session.userId : null,
  });
`;

// [#21516] The engine refuses a name its registry does not hold before any driver,
// so this read no longer reaches the driver; the pin asserts nothing was withheld.
const ABSENT_TENANCY_TABLE = 'sys_organization';

describe('#25905 — a shipped body observes ctx.provenance across the sandbox boundary', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;
  let noise: ExpectedReadRefusalCapture | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  it('carries flowRunId on the flow write, nothing on the REST write, and nothing a payload forges', async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-25905-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE]);
    noise.captureDriver(driver);
    await driver.initObjects([ACCOUNT]);
    engine = new ObjectQL();
    noise.captureEngine(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(ACCOUNT as any, 'probe');

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
      name: 'probe_write_provenance',
      object: 'probe_prov_account',
      events: ['beforeInsert', 'afterInsert'],
      body: { language: 'js', source: PROBE_SOURCE, capabilities: ['log'] },
    } as any], { packageId: 'probe' });

    // The caller identity both writes share: a `runAs: 'user'` flow writes as
    // the person who started it, so only the run id tells the two apart.
    const CALLER = { userId: 'u_probe', isSystem: true };

    // ── The flow data node's write: the run id rides the execution context.
    await engine.insert('probe_prov_account', { name: 'from-flow' }, { context: { ...CALLER, flowRunId: 'run_25905' } } as any);
    const flow = seen.splice(0);
    expect(flow.map((o) => o.event)).toEqual(['beforeInsert', 'afterInsert']);
    for (const o of flow) {
      expect(o.name).toBe('from-flow');
      // The whole card: the declared key, readable from inside QuickJS.
      expect(o.provenanceType).toBe('object');
      // Read AFTER the body tried to drift the member and replace the key:
      // the graft is frozen, so neither moved.
      expect(o.flowRunId).toBe('run_25905');
      expect(o.keys).toEqual(['flowRunId']);
      expect(o.sessionUserId).toBe('u_probe');
    }

    // ── The person's own REST write, same identity.
    await engine.insert('probe_prov_account', { name: 'by-hand' }, { context: { ...CALLER } } as any);
    const hand = seen.splice(0);
    expect(hand.map((o) => o.event)).toEqual(['beforeInsert', 'afterInsert']);
    for (const o of hand) {
      expect(o.name).toBe('by-hand');
      // Absent, not empty — the guard idiom must read "not a flow write".
      expect(o.provenanceType).toBe('undefined');
      expect(o.flowRunId).toBeNull();
      expect(o.sessionUserId).toBe('u_probe');
    }

    // ── A REST write whose payload carries a provenance-shaped value.
    const forged = JSON.stringify({ flowRunId: 'run_forged' });
    await engine.insert('probe_prov_account', { name: 'forged', provenance: forged }, { context: { ...CALLER } } as any);
    const forgery = seen.splice(0);
    expect(forgery.map((o) => o.event)).toEqual(['beforeInsert', 'afterInsert']);
    for (const o of forgery) {
      expect(o.name).toBe('forged');
      // The payload field is a field, on `ctx.input` and nowhere else.
      expect(o.inputProvenance).toBe(forged);
      expect(o.provenanceType).toBe('undefined');
      expect(o.flowRunId).toBeNull();
    }

    // Withheld-noise pin, same as the sibling harnesses: quiet by construction.
    expect(noise?.tablesSeen() ?? ['no capture was installed']).toEqual([]);
  }, 30000);
});
