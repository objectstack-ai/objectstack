// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7258] The showcase's sandboxed `body` hooks write the PERSISTED row — and
 * a body sees the record FLAT, not the engine's envelope.
 *
 * #7225 read these two hooks against `HookContextSchema.input`'s contract table
 * (`insert` → `{ data, options }`, so the record lives at `ctx.input.data`),
 * concluded that `StampInquiryDefaultsHook` and `NormalizeTaskTitleHook`
 * silently do nothing, and prescribed re-spelling both to `ctx.input.data`.
 * Measurement answered the other way twice over:
 *
 *   1. both hooks work today, on the real production wiring; and
 *   2. the prescribed re-spelling is a LIVE REGRESSION on this half. Inside a
 *      sandboxed body `ctx.input.data` is `undefined`, and both hooks carry
 *      `onError: 'abort'` — so the re-spelled `StampInquiryDefaultsHook` threw
 *      `TypeError` and persisted ZERO rows. The public web-to-lead insert
 *      (ADR-0056 Option A, anonymous visitors) would have gone from working to
 *      refusing every submission.
 *
 * WHY A BODY SEES THE RECORD. `bindHooks` wraps every declarative hook in
 * `wrapDeclarativeHook` → `installFlatInput` (`packages/objectql/src/
 * hook-wrappers.ts:446`, helper `:502`), a Proxy presenting a flat record view
 * over the envelope. `buildSandboxContext` then snapshots it with
 * `unwrapProxyToPlain(engineCtx.input)`, which runs through that proxy's
 * `ownKeys` trap — and the trap enumerates the record's fields only. So the
 * body receives the RECORD, and the envelope keys are not there to be read.
 * The contract table describes the raw-engine surface and is accurate about it;
 * that it says nothing about the declarative one is filed as #7254, and the
 * shape probe at the bottom of this file is that card's witness.
 *
 * THE HARNESS IS THE PRODUCTION ONE. Real `ObjectQL`, real `SqlDriver`
 * (better-sqlite3), real `QuickJSScriptRunner` behind `hookBodyRunnerFactory`,
 * the app's REAL objects and REAL hooks — the same call `AppPlugin` makes from
 * `defineStack({ hooks })` (`packages/runtime/src/app-plugin.ts`:
 * `ql.bindHooks(hooks, { packageId, bodyRunner: hookBodyRunnerFactory(new
 * QuickJSScriptRunner(), …) })`). Assertions land on rows read back out of the
 * database, because "the handler ran and had no effect" — the defect #7225
 * believed in — is invisible to anything that watches the handler instead of
 * the row.
 *
 * Test-only pin: nothing in `src/` changes.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { QuickJSScriptRunner, hookBodyRunnerFactory } from '@objectstack/runtime';

import { Account, Project, Task, Inquiry } from '../src/data/objects/index.js';
import { allHooks } from '../src/data/hooks/index.js';

/** The app id `AppPlugin` derives its `packageId` from. */
const APP_ID = 'com.objectstack.showcase';
const PACKAGE_ID = `app:${APP_ID}`;

const openEngines: ObjectQL[] = [];
afterEach(async () => {
  while (openEngines.length) {
    try { await openEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * The showcase's real objects on a real engine, with the real body runner.
 *
 * `hooks` is a parameter so the reverse check can withhold exactly one thing —
 * the binding — from an otherwise identical engine.
 */
async function bootShowcase(hooks: unknown[] = allHooks): Promise<ObjectQL> {
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

  // `showcase_task.project` is a REQUIRED master-detail and
  // `showcase_project.account` a required lookup, so the whole chain is real
  // rather than a trimmed stand-in for the object under test.
  for (const def of [Account, Project, Task, Inquiry]) {
    engine.registry.registerObject(def as never, PACKAGE_ID, 'showcase');
  }
  await engine.syncSchemas();

  engine.bindHooks(hooks as never[], {
    packageId: PACKAGE_ID,
    bodyRunner: hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: APP_ID }),
  });
  return engine;
}

const ctx = { context: { userId: 'u_showcase', isSystem: true } };

const readBack = async (engine: ObjectQL, object: string, id: string) =>
  (await engine.find(object, { where: { id } }, ctx as never))[0] as any;

describe('#7258 — app-showcase sandboxed `body` hooks reach the persisted row', () => {
  it('StampInquiryDefaultsHook: an inquiry with neither field set persists status=new / source=web', async () => {
    // The public web-to-lead submission, exactly as an anonymous visitor sends
    // it: the three whitelisted fields and nothing else. `status` / `source`
    // are server-controlled, so if the hook is inert they persist as NULL and
    // an inquiry can arrive without provenance.
    const engine = await bootShowcase();

    const created: any = await engine.insert(
      'showcase_inquiry',
      { name: 'Ada Lovelace', email: 'ada@example.com', message: 'Please send a demo.' },
      ctx as never,
    );

    const stored = await readBack(engine, 'showcase_inquiry', String(created.id));
    expect(stored.status).toBe('new');
    expect(stored.source).toBe('web');
    // ...and the visitor's own fields survived the hook untouched.
    expect(stored.name).toBe('Ada Lovelace');
    expect(stored.email).toBe('ada@example.com');
  }, 30000);

  it('StampInquiryDefaultsHook: a value the caller DID supply is left alone', async () => {
    // The hook is `if (!ctx.input.status)`, not an unconditional stamp. Pinning
    // only the empty case would stay green if the guard were dropped — which
    // would let a crafted submission be overwritten rather than defaulted, a
    // different behaviour from the one documented.
    const engine = await bootShowcase();

    const created: any = await engine.insert(
      'showcase_inquiry',
      {
        name: 'Grace Hopper', email: 'grace@example.com', message: 'Triaged already.',
        status: 'contacted', source: 'import',
      },
      ctx as never,
    );

    const stored = await readBack(engine, 'showcase_inquiry', String(created.id));
    expect(stored.status).toBe('contacted');
    expect(stored.source).toBe('import');
  }, 30000);

  it('NormalizeTaskTitleHook: the stored title is trimmed on insert AND on update', async () => {
    const engine = await bootShowcase();
    const account: any = await engine.insert(
      'showcase_account', { name: 'Initech', status: 'active' }, ctx as never,
    );
    const project: any = await engine.insert(
      'showcase_project',
      { name: 'Platform', account: String(account.id), status: 'planned' },
      ctx as never,
    );

    const created: any = await engine.insert(
      'showcase_task',
      { title: '   spaced out   ', project: String(project.id), status: 'backlog' },
      ctx as never,
    );
    expect((await readBack(engine, 'showcase_task', String(created.id))).title).toBe('spaced out');

    // `events` lists `beforeUpdate` too, and the update envelope carries `id`
    // alongside `data` — a distinct binding, not a repeat of the insert.
    await engine.update(
      'showcase_task',
      { id: String(created.id), title: '  renamed  ' },
      ctx as never,
    );
    expect((await readBack(engine, 'showcase_task', String(created.id))).title).toBe('renamed');
  }, 30000);

  it('THE #7254 WITNESS: inside a body, `ctx.input` IS the record and `ctx.input.data` is undefined', async () => {
    // The load-bearing line of this file, and the one the documentation card
    // quotes. It is asserted from INSIDE the sandbox — the observation is
    // written to a real column and read back out of the database, so it cannot
    // be satisfied by anything short of the body actually running and actually
    // seeing that shape.
    //
    // Priority 10 puts this ahead of `StampInquiryDefaultsHook` (50 — entries
    // sort ascending), so the keys it reports are the caller's payload rather
    // than the payload plus that hook's stamps.
    const engine = await bootShowcase([
      ...allHooks,
      {
        name: 'showcase_probe_body_input_shape',
        object: 'showcase_inquiry',
        events: ['beforeInsert'],
        priority: 10,
        body: {
          language: 'js',
          source:
            "ctx.input.company = 'KEYS[' + Object.keys(ctx.input).sort().join(',') + "
            + "'] hasData=' + typeof ctx.input.data;",
        },
      },
    ]);

    const created: any = await engine.insert(
      'showcase_inquiry',
      { name: 'Ada Lovelace', email: 'ada@example.com', message: 'Please send a demo.' },
      ctx as never,
    );

    const stored = await readBack(engine, 'showcase_inquiry', String(created.id));
    // The record's own fields are what a body enumerates...
    expect(stored.company).toBe('KEYS[email,message,name] hasData=undefined');
    // ...and the write the probe made through that flat view landed in the row,
    // which is the second half of `installFlatInput`'s contract.
    expect(stored.status).toBe('new');
  }, 30000);

  it('REVERSE: with the hooks unbound the same writes persist raw — the pins are not vacuous', async () => {
    // The #4984 phantom check as a fixture rather than a promise. If these rows
    // came back stamped and trimmed anyway, something other than the hooks
    // would be doing it and every expectation above would be about nothing.
    const engine = await bootShowcase([]);

    const inquiry: any = await engine.insert(
      'showcase_inquiry',
      { name: 'Ada Lovelace', email: 'ada@example.com', message: 'Please send a demo.' },
      ctx as never,
    );
    const storedInquiry = await readBack(engine, 'showcase_inquiry', String(inquiry.id));
    expect(storedInquiry.status == null).toBe(true);
    expect(storedInquiry.source == null).toBe(true);

    const account: any = await engine.insert(
      'showcase_account', { name: 'Initech', status: 'active' }, ctx as never,
    );
    const project: any = await engine.insert(
      'showcase_project',
      { name: 'Platform', account: String(account.id), status: 'planned' },
      ctx as never,
    );
    const task: any = await engine.insert(
      'showcase_task',
      { title: '   spaced out   ', project: String(project.id), status: 'backlog' },
      ctx as never,
    );
    expect((await readBack(engine, 'showcase_task', String(task.id))).title).toBe('   spaced out   ');
  }, 30000);

  it('both hooks are registered on the app bundle — an unregistered hook never runs', async () => {
    // The wiring the RUNTIME reads: `AppPlugin`'s `collectBundleHooks` walks
    // `defineStack({ hooks })` and nothing else, so a hook missing from that
    // array is dead metadata however correct its file is (#7036, app-todo).
    const stack = (await import('../objectstack.config.js')).default as {
      hooks?: Array<{ name?: string; object?: string; events?: string[] }>;
    };
    const byName = new Map((stack.hooks ?? []).map((h) => [h.name, h]));

    const stamp = byName.get('showcase_stamp_inquiry_defaults');
    expect(stamp, 'the web-to-lead defaults hook must be in defineStack({ hooks })').toBeDefined();
    expect(stamp!.object).toBe('showcase_inquiry');
    expect(stamp!.events).toEqual(expect.arrayContaining(['beforeInsert']));

    const trim = byName.get('showcase_normalize_task_title');
    expect(trim, 'the title-normalising hook must be in defineStack({ hooks })').toBeDefined();
    expect(trim!.object).toBe('showcase_task');
    expect(trim!.events).toEqual(expect.arrayContaining(['beforeInsert', 'beforeUpdate']));
  });
});
