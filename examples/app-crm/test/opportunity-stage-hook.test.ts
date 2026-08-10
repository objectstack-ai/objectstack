// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7258] `OpportunityStageHook` pins the probability — on the PERSISTED row.
 *
 * This file exists because a careful reader got it wrong. #7225 read the three
 * shipped example hooks against `HookContextSchema.input`'s contract table
 * (`{ data, options }` — the record lives at `ctx.input.data`), concluded that
 * this hook's `input.stage` is always `undefined` and that it silently does
 * nothing, and prescribed re-spelling every one of them to `ctx.input.data`.
 * Measurement answered the other way: all three work, and the prescribed fix
 * would have turned the showcase's public web-to-lead insert into a hard
 * refusal. One full dispatch was spent on the false alarm.
 *
 * THE MISSING LINK, and why the contract table did not lie: `bindHooks` wraps
 * every DECLARATIVE hook in `wrapDeclarativeHook`, which calls `installFlatInput`
 * (`packages/objectql/src/hook-wrappers.ts:446`, helper at `:502`). That swaps
 * `ctx.input` for a Proxy presenting a FLAT RECORD VIEW over the envelope —
 * reads of a non-wrapper key resolve against `data`, and writes always land in
 * `data`, "so the engine's downstream `input.data` read picks up mutations made
 * by user code as `input.field = value`". The contract table describes the
 * RAW-ENGINE surface; an authored hook only ever meets the declarative one.
 * (The table's silence about that is filed separately as #7254.)
 *
 * WHY THE ASSERTIONS ARE ON PERSISTED ROWS. The defect #7225 believed in was
 * "the handler runs and has no effect" — a shape that a handler-side spy reads
 * as healthy. Only the row that came back out of the database can tell
 * "mutated the envelope nobody reads" from "mutated the record". So the harness
 * is the real `ObjectQL` engine over a real `SqlDriver` (better-sqlite3), the
 * app's REAL `crm_opportunity` object and the app's REAL hook, bound the way
 * `AppPlugin` binds it from `defineStack({ hooks })`
 * (`packages/runtime/src/app-plugin.ts`, `ql.bindHooks(hooks, { packageId })`).
 * No double anywhere in the chain.
 *
 * WHAT THIS FILE DOES AND DOES NOT CATCH — measured, both directions, rather
 * than assumed. Unregistering the hook turns four of the cases below red;
 * misspelling its `closed_won` predicate turns exactly the two closed_won cases
 * red and leaves closed_lost green. But re-spelling the handler to
 * `ctx.input.data` — the change #7225 prescribed — keeps all seven GREEN, and
 * that is correct rather than a hole: on the code-handler path `data` is a
 * wrapper key the proxy passes straight through, so both spellings really do
 * work here. The spelling is only fatal inside a sandboxed `body`, where
 * `ctx.input.data` is `undefined`; the pin that bites on it is therefore the
 * showcase's (`examples/app-showcase/test/hook-body-persisted-writes.test.ts`),
 * not this one. Read the two files as one pair.
 *
 * Test-only pin: nothing in `src/` changes. If this file ever goes red, the
 * behaviour it describes regressed — the hook is not to be "fixed" toward the
 * raw-engine spelling on the strength of the contract table alone.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

import { Account, Opportunity, OpportunityLineItem } from '../src/objects/index.js';
import { allHooks } from '../src/hooks/index.js';
import { OpportunityStageHook } from '../src/hooks/opportunity.hook.js';

/** The app id `AppPlugin` derives its `packageId` from. */
const PACKAGE_ID = 'app:com.example.crm';

/** Engines opened by a test, destroyed when that test ends. */
const openEngines: ObjectQL[] = [];
afterEach(async () => {
  while (openEngines.length) {
    try { await openEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * A real kernel-free engine carrying the app's real CRM objects.
 *
 * `hooks` is a parameter so the reverse check below can withhold exactly one
 * thing — the binding — from an otherwise identical engine.
 */
async function bootCrm(hooks: unknown[] = allHooks): Promise<ObjectQL> {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await driver.connect();

  const engine = new ObjectQL();
  openEngines.push(engine);
  engine.registerDriver(driver as never, true);
  await engine.init();

  // The app's real objects, not a reduction of them: `crm_opportunity` carries
  // a required `account` lookup, a `line_total` summary over the line items, a
  // state-machine rule on `stage` and a formula reading `probability`. Any of
  // those could plausibly be what actually moves the column, so all of them are
  // in the picture.
  for (const def of [Account, Opportunity, OpportunityLineItem]) {
    engine.registry.registerObject(def as never, PACKAGE_ID, 'crm');
  }
  await engine.syncSchemas();

  // Exactly the AppPlugin call, minus the sandbox body runner this app has no
  // use for (its single hook is an inline code handler).
  engine.bindHooks(hooks as never[], { packageId: PACKAGE_ID });
  return engine;
}

const ctx = { context: { userId: 'u_crm', isSystem: true } };

describe('#7258 — app-crm `OpportunityStageHook` moves the persisted probability', () => {
  /** An account to hang the opportunities off — `account` is a required lookup. */
  async function seedAccount(engine: ObjectQL): Promise<string> {
    const account: any = await engine.insert('crm_account', { name: 'Acme', industry: 'technology' }, ctx as never);
    return String(account.id);
  }

  const readBack = async (engine: ObjectQL, id: string) =>
    (await engine.find('crm_opportunity', { where: { id } }, ctx as never))[0] as any;

  it('INSERT closed_won: the stored row has probability 100, not the authored 50', async () => {
    const engine = await bootCrm();
    const accountId = await seedAccount(engine);

    const created: any = await engine.insert(
      'crm_opportunity',
      { name: 'Won deal', account: accountId, stage: 'closed_won', probability: 50 },
      ctx as never,
    );

    // The row as the DATABASE holds it. A hook that mutated only the envelope
    // would leave the authored 50 here.
    const stored = await readBack(engine, String(created.id));
    expect(stored.stage).toBe('closed_won');
    expect(stored.probability).toBe(100);
  }, 30000);

  it('INSERT closed_lost: the stored row has probability 0 — the falsy end of the pin', async () => {
    // `0` matters on its own: it is the value a `??`/`||`-shaped repair would
    // silently drop, so pinning only the 100 case would leave half the hook
    // unwitnessed.
    const engine = await bootCrm();
    const accountId = await seedAccount(engine);

    const created: any = await engine.insert(
      'crm_opportunity',
      { name: 'Lost deal', account: accountId, stage: 'closed_lost', probability: 90 },
      ctx as never,
    );

    const stored = await readBack(engine, String(created.id));
    expect(stored.stage).toBe('closed_lost');
    expect(stored.probability).toBe(0);
  }, 30000);

  it('UPDATE into closed_won: the hook fires on beforeUpdate too', async () => {
    // `events` lists both, and the update path binds `input` differently from
    // insert (the envelope carries `id` as well), so this is a distinct seam
    // rather than a repetition of the insert case.
    const engine = await bootCrm();
    const accountId = await seedAccount(engine);

    const created: any = await engine.insert(
      'crm_opportunity',
      { name: 'Advancing deal', account: accountId, stage: 'proposal', probability: 40 },
      ctx as never,
    );
    const id = String(created.id);
    expect((await readBack(engine, id)).probability).toBe(40);

    await engine.update('crm_opportunity', { id, stage: 'closed_won' }, ctx as never);

    const stored = await readBack(engine, id);
    expect(stored.stage).toBe('closed_won');
    expect(stored.probability).toBe(100);
  }, 30000);

  it('CONTROL: a non-closed stage is left exactly as authored', async () => {
    // The half that makes the three cases above mean something. A hook that
    // stamped unconditionally — or an engine that recomputed the column on
    // every write — would also satisfy them.
    const engine = await bootCrm();
    const accountId = await seedAccount(engine);

    const created: any = await engine.insert(
      'crm_opportunity',
      { name: 'Open deal', account: accountId, stage: 'proposal', probability: 40 },
      ctx as never,
    );

    const stored = await readBack(engine, String(created.id));
    expect(stored.stage).toBe('proposal');
    expect(stored.probability).toBe(40);
  }, 30000);

  it('THE #7225 QUESTION: the handler sees the record FLAT on `ctx.input`', async () => {
    // The documented-surface witness for the code-handler half (the showcase
    // file carries the sandboxed-body twin). #7225's whole case was that
    // `input.stage` is `undefined` here; it is bound, and `input.data` — the
    // spelling the contract table teaches — is a passthrough on this path
    // rather than the only one that works.
    const engine = await bootCrm();
    const accountId = await seedAccount(engine);

    const seen: Array<Record<string, unknown>> = [];
    engine.bindHooks(
      [{
        name: 'probe_flat_input',
        object: 'crm_opportunity',
        events: ['beforeInsert'],
        // Lower than the real hook's 100 is irrelevant to what it observes: it
        // reads the caller's payload, which no ordering changes.
        priority: 10,
        handler: async (hookCtx: any) => {
          const input = hookCtx.input as Record<string, unknown>;
          seen.push({
            keys: Object.keys(input),
            stage: input.stage,
            typeofData: typeof (input as { data?: unknown }).data,
          });
        },
      }] as never[],
      { packageId: 'probe' },
    );

    await engine.insert(
      'crm_opportunity',
      { name: 'Probe deal', account: accountId, stage: 'closed_won', probability: 50 },
      ctx as never,
    );

    expect(seen).toHaveLength(1);
    // The flat record's own fields are what `Object.keys` enumerates — the
    // proxy's `ownKeys` trap, which is also why a sandboxed body receives the
    // record rather than the envelope.
    expect(seen[0].keys).toContain('stage');
    expect(seen[0].keys).toContain('probability');
    expect(seen[0].stage).toBe('closed_won');
  }, 30000);

  it('REVERSE: the same writes with the hook unbound leave the authored values', async () => {
    // The pins above must be able to FAIL. This engine is identical except that
    // `bindHooks` is handed nothing — the #4984 phantom check, run as a
    // fixture rather than as a promise: if the assertions here also read 100/0,
    // then something other than the hook is moving the column and every
    // expectation above is vacuous.
    const engine = await bootCrm([]);
    const accountId = await seedAccount(engine);

    const won: any = await engine.insert(
      'crm_opportunity',
      { name: 'Won deal, hook unbound', account: accountId, stage: 'closed_won', probability: 50 },
      ctx as never,
    );
    const lost: any = await engine.insert(
      'crm_opportunity',
      { name: 'Lost deal, hook unbound', account: accountId, stage: 'closed_lost', probability: 90 },
      ctx as never,
    );

    expect((await readBack(engine, String(won.id))).probability).toBe(50);
    expect((await readBack(engine, String(lost.id))).probability).toBe(90);
  }, 30000);

  it('the hook is registered on the app bundle — an unregistered hook never runs', async () => {
    // The behavioural cases bind the hook themselves (this file assembles its
    // own engine). This one pins the wiring the RUNTIME reads: `AppPlugin`
    // walks `defineStack({ hooks })` via `collectBundleHooks` and nothing else,
    // so a hook absent from that array is dead metadata however correct its
    // file is. That is exactly what #7036 found in app-todo.
    const stack = (await import('../objectstack.config.js')).default as {
      hooks?: Array<{ name?: string; object?: string; events?: string[] }>;
    };
    const registered = (stack.hooks ?? []).find((h) => h.name === OpportunityStageHook.name);
    expect(registered, '`opportunity_stage_probability` must be in defineStack({ hooks })').toBeDefined();
    expect(registered!.object).toBe('crm_opportunity');
    expect(registered!.events).toEqual(expect.arrayContaining(['beforeInsert', 'beforeUpdate']));
  });
});
