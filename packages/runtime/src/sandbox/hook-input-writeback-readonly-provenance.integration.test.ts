// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14760] A caller-supplied `readonly` field that no hook body ever names must
 * NOT survive `stripReadonlyFields` just because a sandboxed body ran.
 *
 * ## What was measured broken
 *
 * #14758 narrowed the sandbox write-back to the keys the body wrote. Its leg 2
 * — "did the body write THROUGH this object-valued key?" — compared the HOST
 * entry snapshot against the VM's exit dump. The dump is JSON; the snapshot was
 * not. So a host `Date` was compared against its own ISO projection, could not
 * be proved equal, and took `sameJsonValue`'s documented fail-open: CARRIED.
 *
 * Carried means assigned onto `engineCtx.input`, which is the engine's
 * flat-input Proxy — the one the #14088 provenance recorder watches. The key
 * entered `hookWrittenKeys`, and `stripReadonlyFields` keeps what a hook wrote.
 * Measured end to end on `main` before this fix, by-id path:
 *
 * ```
 * seeded    locked_at = 2020-01-01T00:00:00.000Z   locked_note = 'SEEDED'
 * caller    locked_at = new Date('2099-12-31…')    locked_note = 'CALLER'
 * body      ctx.input.touched_by = 'hook'          (names no readonly key)
 * row       locked_at = 2099-12-31T23:59:59.000Z   ← the CALLER's value
 *           locked_note = 'SEEDED'                 ← correctly stripped
 * ```
 *
 * The readonly TEXT field stripped in the SAME run is what makes that
 * conclusive rather than a probe that never worked, so it is asserted in every
 * case here for the same reason.
 *
 * The class is wider than `Date`: it is every object-valued entry value a JSON
 * round-trip cannot prove equal. A readonly `json` value carrying an
 * `undefined` member survived too, while a plainly round-trippable object of
 * the same shape was stripped.
 *
 * ## Why this harness, and why these controls
 *
 * The defect is a composition of three real components no unit mock exercises:
 * QuickJS marshalling, objectql's flat-input proxy, and the #14088 recorder's
 * `set` trap — followed by objectql's readonly strip reading that recording. So
 * this drives REAL `ObjectQL` + REAL `SqlDriver` (better-sqlite3) + REAL
 * `QuickJSScriptRunner` behind `hookBodyRunnerFactory`.
 *
 * A test that only asserts "the readonly value was stripped" passes just as
 * well when the write-back has been broken into carrying nothing at all, so
 * three controls carry the weight:
 *
 *  - **the body's own write LANDS** (`touched_by`) and the caller's writable
 *    key lands, in every case — the body really ran;
 *  - **the FIRING control**: a body that DOES assign the readonly key still has
 *    its value kept, so provenance is still able to say KEEP;
 *  - **the write-THROUGH control**: a body that mutates a readonly `json` value
 *    in place trips no trap on `ctx.input`, so only leg 2 — the leg this card
 *    changes — can carry it. It must still be carried and still land.
 *
 * Seeding goes through `driver.create`, bypassing the insert-side readonly
 * strip, or the columns under measurement would start empty and every case
 * would pass vacuously.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';
const GUARD_TASK = {
  name: 'guard_task',
  fields: {
    title: { type: 'text' },
    bucket: { type: 'text' },
    status: { type: 'text' },
    touched_by: { type: 'text' },
    // The reachable member of the class: a host `Date` on the payload.
    locked_at: { type: 'datetime', readonly: true },
    // The primitive control — leg 2 never looks at it, so it was always
    // stripped. A run where THIS one survives is a broken strip, not this card.
    locked_note: { type: 'text', readonly: true },
    // The widening: an object-valued readonly key.
    locked_meta: { type: 'json', readonly: true },
  },
};

const SEEDED_AT = new Date('2020-01-01T00:00:00.000Z');
const CALLER_AT = new Date('2099-12-31T23:59:59.000Z');
const HOOK_AT = '2031-03-03T03:03:03.000Z';

/** Names no readonly key at all — the case the card is about. */
const UNTOUCHING_SOURCE = `
  ctx.log.info('row', { title: ctx.previous.title });
  ctx.input.touched_by = 'hook';
`;

/** FIRING control: the body really does assign the readonly key. */
const ASSIGNS_READONLY_SOURCE = `
  ctx.log.info('row', { title: ctx.previous.title });
  ctx.input.touched_by = 'hook';
  ctx.input.locked_at = '${HOOK_AT}';
`;

/**
 * Write-THROUGH control: mutates the object `locked_meta` holds instead of
 * assigning the key, so no trap on `ctx.input` fires and leg 1 cannot see it.
 * Only leg 2 — the leg this card changes — can carry this.
 */
const WRITES_THROUGH_SOURCE = `
  ctx.log.info('row', { title: ctx.previous.title });
  ctx.input.touched_by = 'hook';
  ctx.input.locked_meta.who = 'hook';
`;

/**
 * ⛔ No `captureExpectedReadRefusals` here, and that is derived rather than
 * skipped: this fixture seeds through `driver.create` and never calls
 * `engine.insert`, so nothing on these paths probes `sys_organization` and no
 * refusal envelope is emitted to withhold. Declaring the table anyway would
 * make `silentChannels()` name a channel that was never going to fire —
 * asserting a probe this file does not drive. Measured: the run below emits no
 * `refused a read on` line and no `Find operation failed` frame at all.
 */
type Boot = {
  engine: ObjectQL;
  driver: SqlDriver;
  seen: any[];
  dir: string;
};

/** `datetime` comes back as a `Date` or an ISO string depending on the driver. */
const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as any).toISOString();

/** `json` comes back parsed or as text; normalise before asserting. */
const asJson = (v: unknown): any =>
  typeof v === 'string' ? JSON.parse(v) : v;

describe('#14760 — an untouched readonly key is not laundered by the sandbox write-back', () => {
  let booted: Boot | null = null;

  afterEach(async () => {
    try { await booted?.engine.destroy(); } catch { /* noop */ }
    if (booted?.dir) rmSync(booted.dir, { recursive: true, force: true });
    booted = null;
  });

  async function boot(source: string): Promise<Boot> {
    const dir = mkdtempSync(join(tmpdir(), 'os-14760-'));
    const driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: join(dir, 'data.sqlite') },
      useNullAsDefault: true,
    });
    await driver.initObjects([GUARD_TASK]);
    const engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(GUARD_TASK as any, 'guard');

    const seen: any[] = [];
    const logger = {
      debug: () => {},
      info: (_m: string, meta?: any) => { seen.push(meta); },
      warn: () => {},
      error: () => {},
    };
    engine.setDefaultBodyRunner(
      hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'guard', logger }),
    );
    bindHooksToEngine(engine, [{
      name: 'guard_task_body',
      object: 'guard_task',
      events: ['beforeUpdate'],
      body: { language: 'js', source, capabilities: ['log'] },
    } as any], { packageId: 'guard' });

    booted = { engine, driver, seen, dir };
    return booted;
  }

  /**
   * Seeds THROUGH THE DRIVER on purpose: `engine.insert` would strip the very
   * readonly columns this file measures, leaving them null and every assertion
   * below vacuously true.
   */
  async function seed(driver: SqlDriver, meta: unknown = { seeded: true }) {
    await driver.create('guard_task', {
      title: 'row',
      bucket: 'b1',
      status: 'open',
      locked_at: SEEDED_AT,
      locked_note: 'SEEDED',
      locked_meta: JSON.stringify(meta),
    } as any);
  }

  const row = async (engine: ObjectQL) =>
    ((await engine.find('guard_task', { where: { title: 'row' } })) as any[])[0];

  it('by-id: a caller-supplied readonly Date the body never names does NOT land', async () => {
    const { engine, driver, seen } = await boot(UNTOUCHING_SOURCE);
    await seed(driver);
    const seeded = await row(engine);
    seen.splice(0);

    await engine.update('guard_task', {
      id: seeded.id,
      status: 'done',
      locked_at: CALLER_AT,
      locked_note: 'CALLER',
    } as any);

    // The body really ran, and on this row.
    expect(seen.map((o) => o.title)).toEqual(['row']);

    const after = await row(engine);
    // THE CARD: the seeded value survived; the caller's 2099 did not land.
    expect(iso(after.locked_at)).toBe(SEEDED_AT.toISOString());
    // Control in the SAME run — the readonly primitive was stripped, so the
    // strip is present and working rather than absent.
    expect(after.locked_note).toBe('SEEDED');
    // Over-narrowing guards: the body's own write and the caller's writable key
    // both landed, so nothing here is green because the write-back went silent.
    expect(after.touched_by).toBe('hook');
    expect(after.status).toBe('done');
  }, 60000);

  it('predicate/multi: the same readonly Date does not land on the second strip site', async () => {
    const { engine, driver, seen } = await boot(UNTOUCHING_SOURCE);
    await seed(driver);
    seen.splice(0);

    await engine.update(
      'guard_task',
      { status: 'done', locked_at: CALLER_AT, locked_note: 'CALLER' },
      { multi: true, where: { bucket: 'b1' } } as any,
    );

    expect(seen.map((o) => o.title)).toEqual(['row']);

    const after = await row(engine);
    expect(iso(after.locked_at)).toBe(SEEDED_AT.toISOString());
    expect(after.locked_note).toBe('SEEDED');
    expect(after.touched_by).toBe('hook');
    expect(after.status).toBe('done');
  }, 60000);

  it('the class is wider than Date: a readonly json value carrying an undefined member does not land', async () => {
    const { engine, driver, seen } = await boot(UNTOUCHING_SOURCE);
    await seed(driver);
    const seeded = await row(engine);
    seen.splice(0);

    await engine.update('guard_task', {
      id: seeded.id,
      status: 'done',
      // Round-trips to `{ who: 'caller' }` — a JSON compare against the raw host
      // object could never prove them equal, which is the whole defect.
      locked_meta: { who: 'caller', dropped: undefined },
      locked_note: 'CALLER',
    } as any);

    expect(seen.map((o) => o.title)).toEqual(['row']);

    const after = await row(engine);
    expect(asJson(after.locked_meta)).toEqual({ seeded: true });
    expect(after.locked_note).toBe('SEEDED');
    expect(after.touched_by).toBe('hook');
    expect(after.status).toBe('done');
  }, 60000);

  it('FIRING control: a body that DOES assign the readonly key still lands its write', async () => {
    const { engine, driver, seen } = await boot(ASSIGNS_READONLY_SOURCE);
    await seed(driver);
    const seeded = await row(engine);
    seen.splice(0);

    await engine.update('guard_task', {
      id: seeded.id,
      status: 'done',
      locked_at: CALLER_AT,
      locked_note: 'CALLER',
    } as any);

    expect(seen.map((o) => o.title)).toEqual(['row']);

    const after = await row(engine);
    // Provenance still turns STRIP into KEEP for a key the body really wrote —
    // without this, "nothing readonly ever lands" would pass a write-back that
    // had simply stopped working.
    expect(iso(after.locked_at)).toBe(new Date(HOOK_AT).toISOString());
    expect(after.locked_note).toBe('SEEDED');
    expect(after.touched_by).toBe('hook');
  }, 60000);

  it('write-THROUGH control: leg 2 still carries an object the body mutated in place', async () => {
    const { engine, driver, seen } = await boot(WRITES_THROUGH_SOURCE);
    await seed(driver);
    const seeded = await row(engine);
    seen.splice(0);

    await engine.update('guard_task', {
      id: seeded.id,
      status: 'done',
      locked_meta: { who: 'caller' },
      locked_note: 'CALLER',
    } as any);

    expect(seen.map((o) => o.title)).toEqual(['row']);

    const after = await row(engine);
    // `ctx.input.locked_meta.who = 'hook'` trips no trap on `ctx.input`, so leg
    // 1 cannot list it: only the normalised leg-2 comparison can carry it, and
    // only a carried key is recorded as hook-written and kept by the strip.
    expect(asJson(after.locked_meta)).toEqual({ who: 'hook' });
    expect(after.locked_note).toBe('SEEDED');
    expect(after.touched_by).toBe('hook');
  }, 60000);
});

/**
 * The same line, read at the write-back boundary instead of at the row.
 *
 * These drive the REAL `QuickJSScriptRunner` through `hookBodyRunnerFactory`
 * with a plain host `ctx`, because two properties of the fix are invisible once
 * a driver has normalised everything into a column:
 *
 *  - the SECOND harm — a carried key is re-asserted FROM THE DUMP, so an
 *    untouched host `Date` used to be replaced by its ISO string and an object
 *    used to lose its `undefined` member even where nothing was readonly;
 *  - the FAIL-OPEN, which #14758 chose deliberately and this card does not
 *    reverse. `safeJsonStringify` lets a cyclic or bigint-bearing value cross
 *    into the VM in degraded form, so such a key IS in the exit dump and DOES
 *    reach the comparison — where a plain round-trip of the host value throws.
 *    It must still be reported as changed and carried, exactly as before.
 */
describe('#14760 — write-back fidelity and the preserved fail-open', () => {
  const runner = new QuickJSScriptRunner();

  const bind = (source: string) =>
    hookBodyRunnerFactory(runner, { ql: {}, appId: 'guard' })({
      name: 'guard_body',
      object: 'guard_task',
      events: ['beforeUpdate'],
      body: { language: 'js', source, capabilities: [] },
    } as any)!;

  it('an untouched host Date keeps its identity — it is not replaced by the dump string', async () => {
    const fn = bind("ctx.input.touched_by = 'hook';");
    const locked = new Date('2099-12-31T23:59:59.000Z');
    const engineCtx = { input: { status: 'done', locked_at: locked } } as any;

    await fn(engineCtx);

    expect(engineCtx.input.touched_by).toBe('hook');
    // Same instance, not an equal one: nothing was carried back over it.
    expect(engineCtx.input.locked_at).toBeInstanceOf(Date);
    expect(Object.is(engineCtx.input.locked_at, locked)).toBe(true);
  });

  it('an untouched object keeps its host form, undefined members included', async () => {
    const fn = bind("ctx.input.touched_by = 'hook';");
    const meta = { who: 'caller', dropped: undefined };
    const engineCtx = { input: { status: 'done', meta } } as any;

    await fn(engineCtx);

    expect(Object.is(engineCtx.input.meta, meta)).toBe(true);
    expect('dropped' in engineCtx.input.meta).toBe(true);
  });

  it('FAIL-OPEN preserved: an entry value the round-trip cannot evaluate is still carried', async () => {
    const fn = bind("ctx.input.touched_by = 'hook';");
    // `safeJsonStringify` drops the back-edge on the way in, so the VM sees
    // `{ tag: 'cyclic' }` and dumps it — but a plain round-trip of the HOST
    // value throws, which is exactly the case #14758's fail-open exists for.
    const cyclic: Record<string, unknown> = { tag: 'cyclic' };
    cyclic.self = cyclic;
    const engineCtx = { input: { status: 'done', meta: cyclic } } as any;

    await fn(engineCtx);

    expect(engineCtx.input.touched_by).toBe('hook');
    // Carried: the host key now holds the dump's degraded copy, byte for byte
    // the pre-#14760 behaviour for a value JSON cannot represent.
    expect(Object.is(engineCtx.input.meta, cyclic)).toBe(false);
    expect(engineCtx.input.meta).toEqual({ tag: 'cyclic' });
  });
});
