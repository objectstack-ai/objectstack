// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13644] The declared referential-cleanup marker, OBSERVED FROM INSIDE A
 * SHIPPED BODY — the sandbox-reachability mandate of the adoption ruling.
 *
 * ## What is pinned, and why a kernel rig could not pin it
 *
 * `HookContext.referentialFieldClear` exists because the engine's `set_null`
 * cleanup write is otherwise indistinguishable, from inside an app guard, from
 * a user hand-clearing the same lookup: the engine builds the cleanup context
 * by INHERITING the caller's envelope, so on the real request path (a DELETE
 * carrying a `userId`) `ctx.user`, `ctx.session` and `ctx.input` are identical
 * between the two writes. The only prior signal was the operation-private
 * `__referentialFieldClear` at `ctx.api.executionContext` — reachable in a
 * kernel rig, where `ctx.api` is the engine's own ScopedContext, and NOT
 * proven through the shipped path, where a body runs body-only inside QuickJS
 * and `buildSandboxApi` may hand it a `{ object }` shim with no
 * `executionContext` at all. A predicate green in the rig and silently false
 * in production is the #11552 inert-guard family, and the ruling on this card
 * names that as the reason the declared key must be pinned FROM INSIDE THE VM
 * (⛔ not "the kernel rig can read it").
 *
 * So, like the #11552 pin next door, this drives the REAL `ObjectQL` + REAL
 * `SqlDriver` (better-sqlite3) + REAL `QuickJSScriptRunner` behind
 * `hookBodyRunnerFactory` — the same wiring `AppPlugin` performs — and every
 * assertion lands on what the body OBSERVED, reported out through the `log`
 * capability:
 *
 *  - on the cleanup write's dispatches, `ctx.referentialFieldClear === true`
 *    inside the VM, in both phases — while the inherited caller identity is
 *    present alongside it (the discriminator-erasing condition is in force,
 *    not dodged by an identity-less rig context);
 *  - on the user's hand-clear of the SAME lookup under the SAME identity, the
 *    key is ABSENT (`typeof` reads `'undefined'`), so the guard idiom
 *    `ctx.referentialFieldClear === true` reads false — the spec's
 *    back-compatible absence semantics, observed rather than inferred.
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

const PARENT = {
  name: 'probe_rfc_account',
  fields: {
    name: { type: 'text' },
  },
};

/** The holder: an optional lookup whose deleteBehavior defaults to set_null. */
const HOLDER = {
  name: 'probe_rfc_note',
  fields: {
    body: { type: 'text' },
    account: { type: 'lookup', reference: 'probe_rfc_account' },
  },
};

/**
 * Reports exactly what a shipped guard can read. `markerType` is the honest
 * instrument: it distinguishes an absent key from every present shape, so the
 * control case cannot pass by accident of a falsy value.
 */
const PROBE_SOURCE = `
  ctx.log.info('probe', {
    event: ctx.event,
    markerType: typeof ctx.referentialFieldClear,
    markerIsTrue: ctx.referentialFieldClear === true,
    sessionUserId: ctx.session ? ctx.session.userId : null,
    accountInInput: 'account' in ctx.input ? ctx.input.account : '(absent)',
  });
`;

const ABSENT_TENANCY_TABLE = 'sys_organization';

describe('#13644 — a shipped body observes ctx.referentialFieldClear across the sandbox boundary', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;
  let noise: ExpectedReadRefusalCapture | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  it('true inside the VM on the cleanup write (both phases, identity inherited); absent on the identical hand-clear', async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-13644-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE]);
    noise.captureDriver(driver);
    await driver.initObjects([PARENT, HOLDER]);
    engine = new ObjectQL();
    noise.captureEngine(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(PARENT as any, 'probe');
    engine.registry.registerObject(HOLDER as any, 'probe');

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
      name: 'probe_referential_field_clear',
      object: 'probe_rfc_note',
      events: ['beforeUpdate', 'afterUpdate'],
      body: { language: 'js', source: PROBE_SOURCE, capabilities: ['log'] },
    } as any], { packageId: 'probe' });

    // The REST-shaped caller envelope — the corrected #13644 measurement's
    // row 1, on which every other context member is identical between the
    // engine's cascade and the user's hand-clear.
    const CALLER = { userId: 'u_probe', isSystem: true };

    const a = (await engine.insert('probe_rfc_account', { name: 'Acme' })) as any;
    const n = (await engine.insert('probe_rfc_note', { body: 'hi', account: a.id })) as any;

    // ── The user's hand-clear of the same lookup, same identity.
    await engine.update('probe_rfc_note', { id: n.id, account: null }, { context: { ...CALLER } } as any);
    const hand = seen.splice(0);
    expect(hand.length).toBe(2);
    expect(hand.map((o) => o.event)).toEqual(['beforeUpdate', 'afterUpdate']);
    for (const o of hand) {
      // Absent, not false — the guard idiom must read "not a cleanup".
      expect(o.markerType).toBe('undefined');
      expect(o.markerIsTrue).toBe(false);
      // The identity that erases every other discriminator is present…
      expect(o.sessionUserId).toBe('u_probe');
      // …and this write really does clear the same slot the cascade clears.
      expect(o.accountInInput).toBeNull();
    }

    // Restore the reference so the cascade has something to clear.
    await engine.update('probe_rfc_note', { id: n.id, account: a.id }, { context: { ...CALLER } } as any);
    seen.splice(0);

    // ── The engine's cascade when the referenced record is deleted.
    await engine.delete('probe_rfc_account', { where: { id: a.id }, context: { ...CALLER } } as any);
    const cascade = seen.splice(0);
    expect(cascade.length).toBe(2);
    expect(cascade.map((o) => o.event)).toEqual(['beforeUpdate', 'afterUpdate']);
    for (const o of cascade) {
      // The whole card: the declared key, readable from inside QuickJS.
      expect(o.markerType).toBe('boolean');
      expect(o.markerIsTrue).toBe(true);
      // Alongside the inherited identity — same session as the hand-clear.
      expect(o.sessionUserId).toBe('u_probe');
      expect(o.accountInInput).toBeNull();
    }

    // The cleanup itself landed.
    const cleared = (await engine.findOne('probe_rfc_note', { where: { id: n.id } })) as any;
    expect(cleared.account).toBeNull();

    // [#10629] Withheld-noise pin, same as the sibling harnesses.
    expect(noise?.silentChannels() ?? ['no capture was installed']).toEqual([]);
  }, 30000);
});
