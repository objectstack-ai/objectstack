// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35329] A by-id delete whose driver answers `false` after the pre-image
 * proved the row present answers `RECORD_NOT_FOUND`, and runs none of the
 * delete's after-effects: no `afterDelete`, no roll-up summary recompute and no
 * `data.record.deleted` event. The driver removed nothing, so there is no
 * deletion for any of them to report.
 *
 * Measured over the REAL stack: `ObjectQL` and `SqlDriver` on better-sqlite3
 * `:memory:` (a single-connection pool). The driver's `false` is not faked: two
 * writers race for the same row. The first one reads its pre-image and parks
 * in a code-registered `beforeDelete` hook (no metadata, so no after-abort unit
 * opens and nothing holds the connection while it waits); the second one
 * deletes the row meanwhile; the first one, released, reaches `driver.delete`
 * for a row that is already gone and the driver answers `false`.
 *
 * With a metadata `beforeDelete` hook the after-abort unit opens around the
 * engine body, the parked writer holds the store's only connection in its
 * `BEGIN`, and the second writer waits behind it and loses at its pre-image
 * read instead. That cell's answer was already `RECORD_NOT_FOUND`; it is here
 * so both bindings are pinned to the same answer. On a store with more than one
 * connection (PostgreSQL) the hooked writers do not queue, and the loser
 * reaches the driver's `false` exactly as in the first cell; this file runs on
 * SQLite only.
 *
 * The control: a delete nobody races removes the row and fires each
 * after-effect exactly once.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

const SYS = { context: { isSystem: true } } as never;
const ORDER = 'dlnf_order';
const LINE = 'dlnf_line';
/** How long the second writer gets while the first one is parked. */
const WINDOW_MS = 2_000;
const QUIET = { debug() {}, info() {}, warn() {}, error() {} };

type Binding = 'code' | 'metadata';

async function boot(binding: Binding) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.delete-driver-false', name: 'delete driver false', version: '1.0.0', type: 'plugin', scope: 'system',
    objects: [
      {
        name: ORDER, label: 'Order', tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          line_total: {
            name: 'line_total', type: 'summary',
            summaryOperations: { object: LINE, field: 'amount', function: 'sum' },
          },
        },
      },
      {
        name: LINE, label: 'Line', tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          amount: { name: 'amount', type: 'number' },
          order: { name: 'order', type: 'master_detail', reference: ORDER },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();

  // The first `beforeDelete` dispatch on a line parks until the test releases
  // it; every later one passes. It runs after the pre-image read, so the
  // parked writer has already proven the row present.
  let release!: () => void;
  const parked = new Promise<void>((resolve) => { release = resolve; });
  let arrived!: () => void;
  const arrival = new Promise<void>((resolve) => { arrived = resolve; });
  let dispatches = 0;
  const park = async () => {
    dispatches += 1;
    if (dispatches === 1) { arrived(); await parked; }
  };
  if (binding === 'metadata') {
    // Any metadata `beforeDelete` opens the after-abort unit on this object.
    bindHooksToEngine(engine as never, [{
      name: 'dlnf_park', object: LINE, events: ['beforeDelete'], handler: park,
    } as never], { packageId: 'app:dlnf', logger: QUIET as never });
  } else {
    engine.registerHook('beforeDelete', park as never, { object: LINE });
  }

  // The three after-effects, each counted where it lands. Code-registered
  // hooks carry no metadata, so they open no unit and change no cell.
  const afterDelete: unknown[] = [];
  engine.registerHook('afterDelete', (async (ctx: any) => { afterDelete.push(ctx.input?.id); }) as never, { object: LINE });
  // The roll-up recompute writes the parent through `update`.
  const recomputed: unknown[] = [];
  engine.registerHook('afterUpdate', (async (ctx: any) => { recomputed.push(ctx.input?.id); }) as never, { object: ORDER });
  const deletedEvents: unknown[] = [];
  engine.setRealtimeService({
    publish: vi.fn(async (event: any) => {
      if (event.type === 'data.record.deleted' && event.object === LINE) deletedEvents.push(event.payload?.recordId);
    }),
    subscribe: vi.fn(async () => 'sub'),
    unsubscribe: vi.fn(async () => undefined),
  } as never);

  await engine.insert(ORDER, { id: 'ord_1', name: 'Order 1' }, SYS);
  await engine.insert(LINE, [
    { id: 'ln_race', amount: 5, order: 'ord_1' },
    { id: 'ln_keep', amount: 7, order: 'ord_1' },
  ], SYS);
  const reset = () => { afterDelete.length = 0; recomputed.length = 0; deletedEvents.length = 0; };
  reset();
  return { engine, release, arrival, afterDelete, recomputed, deletedEvents };
}

const deleteLine = (engine: ObjectQL, id: string) => engine.delete(LINE, { where: { id }, ...SYS } as never);
const outcome = (p: Promise<unknown>) =>
  p.then((value) => ({ value }), (error: any) => ({ code: error?.code, status: error?.status }));
const settledWithin = (p: Promise<unknown>, ms: number) =>
  Promise.race([
    p.then(() => 'settled', () => 'settled'),
    new Promise<string>((resolve) => setTimeout(() => resolve('still waiting'), ms)),
  ]);
const lineIds = async (engine: ObjectQL) =>
  ((await engine.find(LINE, {} as never, SYS)) as any[]).map((r) => r.id).sort();
const orderTotal = async (engine: ObjectQL) =>
  ((await engine.findOne(ORDER, { where: { id: 'ord_1' } } as never, SYS)) as any)?.line_total;

describe('[#35329] delete — the loser whose driver answers false (no metadata delete hook, no unit)', () => {
  it('answers RECORD_NOT_FOUND and fires no afterDelete, no summary recompute and no event', async () => {
    const { engine, release, arrival, afterDelete, recomputed, deletedEvents } = await boot('code');
    const loser = outcome(deleteLine(engine, 'ln_race'));
    await arrival;
    // The winner deletes the row while the loser is parked past its pre-image.
    const winner = await outcome(deleteLine(engine, 'ln_race'));
    expect(winner).toEqual({ value: true });
    release();
    expect(await loser, 'the loser, whose driver.delete answered false').toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
    // Each after-effect fired once, for the winner's delete only.
    expect(afterDelete).toEqual(['ln_race']);
    expect(recomputed).toEqual(['ord_1']);
    expect(deletedEvents).toEqual(['ln_race']);
    expect(await lineIds(engine)).toEqual(['ln_keep']);
    expect(await orderTotal(engine)).toBe(7);
  });
});

describe('[#35329] delete — the loser behind a metadata beforeDelete hook (the unit serialises it)', () => {
  it('waits for the winner, answers RECORD_NOT_FOUND at its pre-image and fires nothing', async () => {
    const { engine, release, arrival, afterDelete, recomputed, deletedEvents } = await boot('metadata');
    const winner = outcome(deleteLine(engine, 'ln_race'));
    await arrival;
    const loserCall = outcome(deleteLine(engine, 'ln_race'));
    // The parked writer holds the only connection in its unit, so the second
    // writer cannot get past its first read until the first one commits.
    expect(await settledWithin(loserCall, WINDOW_MS)).toBe('still waiting');
    release();
    expect(await winner).toEqual({ value: true });
    expect(await loserCall).toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
    expect(afterDelete).toEqual(['ln_race']);
    expect(recomputed).toEqual(['ord_1']);
    expect(deletedEvents).toEqual(['ln_race']);
    expect(await lineIds(engine)).toEqual(['ln_keep']);
    expect(await orderTotal(engine)).toBe(7);
  });
});

describe('[#35329] control — a delete nobody races fires each after-effect once', () => {
  it('removes the row, answers true and fires afterDelete, the recompute and the event once each', async () => {
    const { engine, release, afterDelete, recomputed, deletedEvents } = await boot('code');
    release();
    expect(await outcome(deleteLine(engine, 'ln_race'))).toEqual({ value: true });
    expect(afterDelete).toEqual(['ln_race']);
    expect(recomputed).toEqual(['ord_1']);
    expect(deletedEvents).toEqual(['ln_race']);
    expect(await lineIds(engine)).toEqual(['ln_keep']);
    expect(await orderTotal(engine)).toBe(7);
  });
});
