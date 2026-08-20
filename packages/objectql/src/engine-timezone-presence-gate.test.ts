// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ── `buildDriverOptions`' timezone PRESENCE gate, pinned in both directions ──
//
// `buildDriverOptions` folds a handful of `ExecutionContext` fields into
// `DriverOptions`, and it opens with an early return:
//
//   if (!hasTx && !hasTenant && !isSystem && !hasTz && !preserveAudit) return base;
//
// `hasTz` is `execCtx?.timezone !== undefined` — one of the few places in the
// engine where the ABSENCE of a field is itself a meaningful state rather than
// a missing value. A context that starts carrying `timezone` therefore does two
// things at once: it supplies `opts.timezone`, and it FLIPS that early return
// for callers who would previously have taken it.
//
// ## Why this file exists now (#7279)
//
// The stdio MCP transport used to hand the engine a hand-assembled context that
// resolved no localization at all, so every stdio call took the early return on
// the `hasTz` arm. Converging that face onto `assembleExecutionContext` makes it
// carry the workspace timezone, which crosses this gate for the first time.
// The convergence was ruled on an assessment that analysed the flip as benign
// BECAUSE the stdio face was read-only — `opts.timezone`'s consumer is
// date-dependent driver generation (autonumber `{YYYYMMDD}` tokens), a write
// concern.
//
// ⚠️ That premise no longer holds: the stdio face acquired create / update /
// remove doors (`createStdioDataBridge`), so the write consumer IS reachable
// there now. The flip is still correct — a workspace-timezone calendar day is
// the right one to stamp, and it is what every HTTP face already sends — but it
// is no longer un-observable, which is precisely why it gets pinned rather than
// shrugged at.
//
// ## Both directions are load-bearing
//
// Asserting only "timezone reaches the driver" would stay green if the engine
// started synthesizing a default timezone for every caller — which would erase
// the early return that context-less internal engine calls depend on. So the
// absence direction is asserted against the same doors.

import { describe, it, expect } from 'vitest';
import type { DataEngineInsertOptions, EngineQueryOptions, EngineReadOptions } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ObjectQL } from './engine.js';

interface ObservedCall {
  object: string;
  method: string;
  options: Record<string, unknown> | undefined;
}

function makeDriver(observed: ObservedCall[]) {
  const record = (object: string, method: string, options: any) => {
    observed.push({ object, method, options });
  };
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, _ast: any, options: any) { record(object, 'find', options); return []; },
    async findOne(object: string, _ast: any, options: any) { record(object, 'findOne', options); return null; },
    async count(object: string, _ast: any, options: any) { record(object, 'count', options); return 0; },
    async create(object: string, data: any, options: any) { record(object, 'create', options); return { id: 'r_1', ...data }; },
    async update(object: string, id: string, data: any, options: any) { record(object, 'update', options); return { id, ...data }; },
    async delete() { return true; },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async syncSchema() {},
  };
  return driver;
}

const OBJECT = {
  name: 'tz_note',
  fields: {
    title: { type: 'text' },
  },
} as any;

const PACKAGE_ID = 'com.example.tz';

async function makeEngine() {
  const observed: ObservedCall[] = [];
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver(observed), true);
  await engine.init();
  engine.registry.registerObject(OBJECT, PACKAGE_ID);
  return { engine, observed };
}

/**
 * A caller carrying NOTHING the gate keys off: no timezone, no tenant, not
 * system, no transaction, no `preserveAudit`. This is the shape that takes the
 * early return, and the shape the stdio face used to send.
 */
const BARE: ExecutionContext = { userId: 'u_1' };

/** The same caller once localization is resolved — the post-#7279 stdio shape. */
const LOCALIZED: ExecutionContext = { userId: 'u_1', timezone: 'Asia/Shanghai' };

const READ_DOORS = [
  { name: 'find', driverMethod: 'find', run: (e: ObjectQL, ctx: ExecutionContext) => e.find('tz_note', {}, { context: ctx }) },
  { name: 'findOne', driverMethod: 'findOne', run: (e: ObjectQL, ctx: ExecutionContext) => e.findOne('tz_note', { where: { title: 'x' } }, { context: ctx }) },
  { name: 'count', driverMethod: 'count', run: (e: ObjectQL, ctx: ExecutionContext) => e.count('tz_note', {}, { context: ctx }) },
] as const;

describe('#7279 — the `hasTz` presence gate withholds timezone when the context carries none', () => {
  it.each(READ_DOORS)(
    '$name: DriverOptions carry no timezone for a context without one',
    async ({ driverMethod, run }) => {
      const { engine, observed } = await makeEngine();
      await run(engine, BARE);

      const call = observed.find((c) => c.method === driverMethod);
      expect(call, `driver.${driverMethod} was never reached`).toBeDefined();
      expect(call!.options?.timezone).toBeUndefined();
    },
  );

  it('insert: DriverOptions carry no timezone for a context without one', async () => {
    const { engine, observed } = await makeEngine();
    await engine.insert('tz_note', { title: 'bare' }, { context: BARE } as DataEngineInsertOptions);

    const call = observed.find((c) => c.method === 'create');
    expect(call, 'driver.create was never reached').toBeDefined();
    expect(call!.options?.timezone).toBeUndefined();
  });
});

describe('#7279 — a context carrying timezone crosses the gate on every door', () => {
  it.each(READ_DOORS)(
    '$name: DriverOptions carry the caller timezone',
    async ({ driverMethod, run }) => {
      const { engine, observed } = await makeEngine();
      await run(engine, LOCALIZED);

      const call = observed.find((c) => c.method === driverMethod);
      expect(call, `driver.${driverMethod} was never reached`).toBeDefined();
      expect(call!.options?.timezone).toBe('Asia/Shanghai');
    },
  );

  it('insert: DriverOptions carry the caller timezone — the autonumber date-token consumer', async () => {
    const { engine, observed } = await makeEngine();
    await engine.insert('tz_note', { title: 'localized' }, { context: LOCALIZED } as DataEngineInsertOptions);

    // The write door is the one `opts.timezone` was threaded FOR: date-dependent
    // driver generation resolves the calendar day from it. Reachable from stdio
    // since that face gained create/update/remove doors.
    const call = observed.find((c) => c.method === 'create');
    expect(call, 'driver.create was never reached').toBeDefined();
    expect(call!.options?.timezone).toBe('Asia/Shanghai');
  });

  it('does not overwrite a timezone the caller passed in the option bag', async () => {
    const { engine, observed } = await makeEngine();
    // `buildDriverOptions` fills `opts.timezone` only when it is undefined, so
    // an explicit per-call timezone outranks the envelope's. The bag it reads
    // is the QUERY argument (`opCtx.options = query`, one of
    // `ENGINE_DRIVER_PASSTHROUGH_KEYS`) — NOT the third `EngineReadOptions`
    // argument, which carries `context` and is not forwarded to the driver.
    // Measured both ways before being written down: passing `timezone` in the
    // third argument silently reaches no driver at all, which is what makes the
    // argument position part of the assertion rather than a detail.
    await engine.find(
      'tz_note',
      // DELIBERATELY off-contract in the type, on-contract at run time: the
      // driver-passthrough keys are legal on this bag
      // (`ENGINE_DRIVER_PASSTHROUGH_KEYS`) but are not declared on
      // `EngineQueryOptions`. Named rather than erased with `as any`.
      { timezone: 'UTC' } as unknown as EngineQueryOptions,
      { context: LOCALIZED } as EngineReadOptions,
    );

    const call = observed.find((c) => c.method === 'find');
    expect(call!.options?.timezone).toBe('UTC');
  });
});
