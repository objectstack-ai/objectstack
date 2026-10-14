// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23221] The declared cascade-delete marker, OBSERVED FROM INSIDE A SHIPPED
 * BODY — the sandbox face of `HookContext.referentialCascadeDelete`, the delete
 * twin of the referential-field-clear pin next door.
 *
 * ## What is pinned, and why a kernel rig could not pin it
 *
 * The engine's cascade deletes each child AS THE CALLER: it recurses through
 * the public `delete()` with the caller's own context, so on the real request
 * path (a DELETE carrying a `userId`) `ctx.user`, `ctx.session` and
 * `ctx.input` are identical between a child the cascade removes and a user's
 * hand delete of that same child. Unlike the update twin, there is not even an
 * operation-private envelope key to sniff: the engine recognises the delete it
 * issued through an engine-private ambient token. So the declared key is a
 * lowered body's ONLY channel, and it reaches the body only if
 * `buildSandboxContext` and `installCtx` carry it — which is what this proves,
 * from inside the VM, rather than from a handler running in-process.
 *
 * Same wiring as the twin: the REAL `ObjectQL` + REAL `SqlDriver`
 * (better-sqlite3) + REAL `QuickJSScriptRunner` behind `hookBodyRunnerFactory`
 * — what `AppPlugin` composes — and every assertion lands on what the body
 * OBSERVED, reported out through the `log` capability:
 *
 *  - on the cascaded child delete's dispatches, `ctx.referentialCascadeDelete
 *    === true` inside the VM, in both phases, beside the inherited caller
 *    identity (the discriminator-erasing condition in force);
 *  - on the user's hand delete of a line of the same parent under the SAME
 *    identity, the key is ABSENT (`typeof` reads `'undefined'`), so the guard
 *    idiom reads false;
 *  - the update twin is absent on both, so neither key reads as the other.
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
  name: 'probe_rcd_quote',
  fields: {
    name: { type: 'text' },
  },
};

/** The child: a master_detail line, whose deleteBehavior resolves to cascade. */
const LINE = {
  name: 'probe_rcd_line',
  fields: {
    title: { type: 'text' },
    quote: { type: 'master_detail', reference: 'probe_rcd_quote' },
  },
};

/**
 * Reports exactly what a shipped guard can read. `markerType` distinguishes an
 * absent key from every present shape, so the control case cannot pass by
 * accident of a falsy value. The row is named through `ctx.previous`, the
 * delete's pre-image in both phases: a body's `ctx.input` is the flattened
 * record payload, which a delete does not carry.
 */
const PROBE_SOURCE = `
  ctx.log.info('probe', {
    event: ctx.event,
    previousId: ctx.previous ? ctx.previous.id : null,
    markerType: typeof ctx.referentialCascadeDelete,
    markerIsTrue: ctx.referentialCascadeDelete === true,
    twinType: typeof ctx.referentialFieldClear,
    sessionUserId: ctx.session ? ctx.session.userId : null,
  });
`;

// [#21516] The engine refuses a name its registry does not hold before any driver,
// so this read no longer reaches the driver; the pin asserts nothing was withheld.
const ABSENT_TENANCY_TABLE = 'sys_organization';

describe('#23221 — a shipped body observes ctx.referentialCascadeDelete across the sandbox boundary', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;
  let noise: ExpectedReadRefusalCapture | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  it('true inside the VM on the cascaded child delete (both phases, identity inherited); absent on the hand delete', async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-23221-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE]);
    noise.captureDriver(driver);
    await driver.initObjects([PARENT, LINE]);
    engine = new ObjectQL();
    noise.captureEngine(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(PARENT as any, 'probe');
    engine.registry.registerObject(LINE as any, 'probe');

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
      name: 'probe_referential_cascade_delete',
      object: 'probe_rcd_line',
      events: ['beforeDelete', 'afterDelete'],
      body: { language: 'js', source: PROBE_SOURCE, capabilities: ['log'] },
    } as any], { packageId: 'probe' });

    // The REST-shaped caller envelope, on which every other context member is
    // identical between the engine's cascade and the user's hand delete.
    const CALLER = { userId: 'u_probe', isSystem: true };

    const q = (await engine.insert('probe_rcd_quote', { name: 'Q-1' })) as any;
    const l1 = (await engine.insert('probe_rcd_line', { title: 'one', quote: q.id })) as any;
    const l2 = (await engine.insert('probe_rcd_line', { title: 'two', quote: q.id })) as any;

    // ── The user's hand delete of one line, same identity.
    await engine.delete('probe_rcd_line', { where: { id: l1.id }, context: { ...CALLER } } as any);
    const hand = seen.splice(0);
    expect(hand.map((o) => o.event)).toEqual(['beforeDelete', 'afterDelete']);
    for (const o of hand) {
      expect(o.previousId).toBe(l1.id);
      // Absent, not false — the guard idiom must read "not cascade-issued".
      expect(o.markerType).toBe('undefined');
      expect(o.markerIsTrue).toBe(false);
      expect(o.twinType).toBe('undefined');
      // The identity that erases every other discriminator is present.
      expect(o.sessionUserId).toBe('u_probe');
    }

    // ── The engine's cascade when the quote is deleted.
    await engine.delete('probe_rcd_quote', { where: { id: q.id }, context: { ...CALLER } } as any);
    const cascade = seen.splice(0);
    expect(cascade.map((o) => o.event)).toEqual(['beforeDelete', 'afterDelete']);
    for (const o of cascade) {
      expect(o.previousId).toBe(l2.id);
      // The whole card: the declared key, readable from inside QuickJS.
      expect(o.markerType).toBe('boolean');
      expect(o.markerIsTrue).toBe(true);
      expect(o.twinType).toBe('undefined');
      // Beside the inherited identity — the same session as the hand delete.
      expect(o.sessionUserId).toBe('u_probe');
    }

    // The cascade itself landed.
    expect(await engine.findOne('probe_rcd_line', { where: { id: l2.id } })).toBeFalsy();

    // Withheld-noise pin, same as the sibling harnesses: quiet by construction.
    expect(noise?.tablesSeen() ?? ['no capture was installed']).toEqual([]);
  }, 30000);
});
