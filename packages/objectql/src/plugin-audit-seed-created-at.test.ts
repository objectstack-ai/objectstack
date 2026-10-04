// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #21646 — a seed row's authored `created_at` is KEPT on the INSERT of a fresh
// boot, exactly as the upsert UPDATE of a later boot already keeps it.
//
// ## The defect, as measured on a real app's seed (17.6.0)
//
//   seed row  authored created_at               fresh boot (INSERT)   second boot (UPDATE)
//   --------  --------------------------------  --------------------  ---------------------
//   A         cel`daysAgo(5)`                   boot instant          the authored value
//   B         '2026-09-01T12:00:00.000Z'        boot instant          the authored value
//   control   none                              boot instant          unchanged
//
// The audit binder's `beforeInsert` stamp (`sys_stamp_audit_insert`) kept a
// supplied `created_at` only under `preserveAudit`, and the seed write context
// (`SEED_WRITE_EXECUTION_CONTEXT` = `{ isSystem, skipTriggers, seedReplay }`)
// carries no `preserveAudit`. The `beforeUpdate` stamp touches `updated_at`
// only, and a seed write is `isSystem`, so the readonly strip never ran on the
// replay either — the authored value was written there. One value, two paths,
// two outcomes.
//
// ## Ruling (triage, verbatim from "Ruling" to the pins)
//
// > **Ruling: key the insert stamp on `seedReplay`, not on `preserveAudit`.**
// > - `preserveAudit` is "UPDATE-only … never when it is created" … ⛔ So the
// >   fix does **not** add `preserveAudit` to the seed context.
// > - So under `seedReplay` the insert stamp keeps an authored `created_at`
// >   (`?? now`), as the replay already does.
// >   - ⛔ Not under bare `isSystem`: a system clone could carry a source row's
// >     `created_at`.
// >   - ⛔ No change for REST or any other caller.
//
// The four pins below are the ruling's four, on the real seed boot path:
// `SeedLoaderService.load()` through the kernel's own ObjectQL engine, with
// `ObjectQLPlugin`'s audit hooks bound exactly as a booted app binds them. A
// "boot" is one `load()` over the same store; the second one is the replay.
//
// ## Where the stamp reads `seedReplay`
//
// The hook's `session` (engine `buildSession`) carries `isSystem`, the skip
// flags and `preserveAudit` — NOT `seedReplay`. The `beforeInsert` envelope's
// `input.options` IS the caller's own options bag (HookContext `input` PHASE
// contract, `packages/spec/src/data/hook.zod.ts`), so its `context` is the
// write's ExecutionContext as the seeder built it. That is where the stamp
// reads it, and every seed reader passes the one shared constant there.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { cel } from '@objectstack/spec';
import { SEED_WRITE_EXECUTION_CONTEXT } from '@objectstack/spec/kernel';
import { SeedLoaderService, ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL } from './engine.js';
import { preserveAuditIgnoredOnInsertWarning } from './validation/rule-validator.js';

const OBJECT = 'seed_case';
/** Boot instants. Same UTC day, so `daysAgo(5)` names one calendar day on both. */
const BOOT_1 = '2026-10-03T12:00:00.000Z';
const BOOT_2 = '2026-10-03T13:00:00.000Z';
/** `daysAgo(5)` at either boot: UTC midnight of the calendar day five days back. */
const DAYS_AGO_5 = '2026-09-28T00:00:00.000Z';
const AUTHORED_B = '2026-09-01T12:00:00.000Z';
const FORGED = '1999-01-01T00:00:00.000Z';

/** A store-backed stub driver: the stored row IS the verdict. */
function makeStubDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const checkOp = (value: any, cond: any): boolean => {
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond) || cond instanceof Date) {
      return value === cond;
    }
    return Object.entries(cond).every(([op, target]: [string, any]) => {
      switch (op) {
        case '$eq': return value === target;
        case '$ne': return value !== target;
        case '$in': return Array.isArray(target) && target.includes(value);
        // REFUSE, never silently match — an unsupported operator answered
        // `true` would read as a hit for every row.
        default: throw new Error(`stub driver: unsupported operator ${op}`);
      }
    });
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (k.startsWith('$')) throw new Error(`stub driver: unsupported combinator ${k}`);
      return checkOp(row?.[k], v);
    });
  };
  let n = 0;
  const driver: any = {
    name: 'seed-store', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async syncSchema() {},
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      return page.map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return { ...row };
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where)).length;
    },
  };
  return { driver, storeFor };
}

function emptyMetadata() {
  return {
    getObject: async () => undefined,
    listObjects: async () => [],
    register: async () => {},
    get: async () => undefined,
    list: async () => [],
    unregister: async () => {},
    exists: async () => false,
    listNames: async () => [],
  };
}

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };

const LOAD_CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
} as any;

/** The card's three rows; `subject` differs per boot so the replay is a real UPDATE. */
const seedFor = (subject: string) => ({
  object: OBJECT,
  externalId: 'code',
  mode: 'upsert',
  env: ['prod', 'dev', 'test'],
  records: [
    { code: 'A', subject, created_at: cel`daysAgo(5)` },
    { code: 'B', subject, created_at: AUTHORED_B },
    { code: 'C', subject },
  ],
});

/** An instant, read the same way whether the driver was handed a `Date` or a string. */
const instant = (v: unknown) => new Date(v as any).toISOString();

describe('audit binder: a seed row keeps its authored `created_at` (#21646)', () => {
  let kernel: ObjectKernel;
  let objectql: ObjectQL;
  let storeFor: ReturnType<typeof makeStubDriver>['storeFor'];
  let warns: string[];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(BOOT_1));
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const stub = makeStubDriver();
    storeFor = stub.storeFor;
    await kernel.use({
      name: 'seed-store-plugin', type: 'driver', version: '1.0.0',
      init: async (ctx: any) => { ctx.registerService('driver.seed-store', stub.driver); },
    } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    objectql = kernel.getService<ObjectQL>('objectql');
    // `created_at` / `created_by` are NOT declared: the registry injects them
    // from `AUDIT_FIELD_DEFS` (`readonly: true`), as on every real object.
    objectql.registry.registerObject({
      name: OBJECT,
      label: 'Seed Case',
      datasource: 'seed-store',
      fields: {
        code: { name: 'code', label: 'Code', type: 'text' },
        subject: { name: 'subject', label: 'Subject', type: 'text' },
        run_at: { name: 'run_at', label: 'Run At', type: 'datetime', readonly: true },
      },
    } as any, 'test', 'test');
    warns = [];
    const engineLogger = (objectql as any).logger;
    vi.spyOn(engineLogger, 'warn').mockImplementation((...a: unknown[]) => { warns.push(String(a[0])); });
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (kernel.getState() === 'running') await kernel.shutdown();
  });

  const loader = () => new SeedLoaderService(objectql as never, emptyMetadata() as never, quietLogger as never);
  const boot = async (at: string, subject: string) => {
    vi.setSystemTime(new Date(at));
    const result = await loader().load({ seeds: [seedFor(subject)] as never, config: LOAD_CONFIG });
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
    return result;
  };
  const stored = (code: string) => {
    const rows = Array.from(storeFor(OBJECT).values()).filter((r) => r.code === code);
    expect(rows.length, `exactly one stored row for code ${code}`).toBe(1);
    return rows[0];
  };

  // ── Pin 1 ────────────────────────────────────────────────────────────────
  it('pin 1: an authored `created_at` is kept on the fresh boot (INSERT) and on the replay (UPDATE)', async () => {
    const fresh = await boot(BOOT_1, 'v1');
    expect(fresh.summary.totalInserted).toBe(3);

    // The card's two rows. A `cel` value is evaluated by the loader BEFORE the
    // write decision, so the INSERT is handed the instant, never the envelope.
    expect(instant(stored('A').created_at)).toBe(DAYS_AGO_5);
    expect(instant(stored('B').created_at)).toBe(AUTHORED_B);

    const replay = await boot(BOOT_2, 'v2');
    // A real UPDATE of every row, not a skipped no-op replay.
    expect(replay.summary.totalUpdated).toBe(3);
    expect(stored('A').subject).toBe('v2');

    expect(instant(stored('A').created_at)).toBe(DAYS_AGO_5);
    expect(instant(stored('B').created_at)).toBe(AUTHORED_B);
    // The replay is still an UPDATE as far as the binder is concerned: the
    // last-modified stamp moves to the second boot.
    expect(stored('A').updated_at).toBe(BOOT_2);
    expect(stored('B').updated_at).toBe(BOOT_2);
  });

  // The three seed readers pass one constant, `SEED_WRITE_EXECUTION_CONTEXT`.
  // `SeedLoaderService` is pin 1. `AppPlugin`'s fallback replay of a stack's
  // `data[]` calls `ql.insert(object, record, { context: <it> })` per row, and
  // `@objectstack/verify`'s `seed()` calls `ql.insert(object, rows, { context:
  // <it> })` with an array — both shapes, through the same engine.
  it('pin 1, the other two readers\' call shapes: a single-row and an array insert under the seed context keep it too', async () => {
    await objectql.insert(OBJECT, { code: 'single', created_at: AUTHORED_B }, { context: SEED_WRITE_EXECUTION_CONTEXT });
    await objectql.insert(
      OBJECT,
      [{ code: 'arr0', created_at: AUTHORED_B }, { code: 'arr1' }],
      { context: SEED_WRITE_EXECUTION_CONTEXT },
    );

    expect(stored('single').created_at).toBe(AUTHORED_B);
    expect(stored('arr0').created_at).toBe(AUTHORED_B);
    expect(stored('arr1').created_at).toBe(BOOT_1);
  });

  // ── Pin 2 ────────────────────────────────────────────────────────────────
  it('pin 2: a seed row with no `created_at` is stamped at boot, and the replay leaves that stamp alone', async () => {
    await boot(BOOT_1, 'v1');
    // Stamped by the binder: the hook ran under `skipTriggers`, which
    // suppresses flow dispatch, never the code-registered audit hooks.
    expect(stored('C').created_at).toBe(BOOT_1);

    await boot(BOOT_2, 'v2');
    expect(stored('C').created_at).toBe(BOOT_1);
    expect(stored('C').updated_at).toBe(BOOT_2);
  });

  // ── Pin 3 ────────────────────────────────────────────────────────────────
  it('pin 3: a non-seed system insert and a REST insert are both stamped now', async () => {
    // System contexts WITHOUT `seedReplay`: bare elevation, and the seed
    // posture minus its one load-bearing flag.
    await objectql.insert(OBJECT, { code: 'sys', created_at: FORGED }, { context: { isSystem: true } });
    await objectql.insert(
      OBJECT,
      { code: 'sys_quiet', created_at: FORGED },
      { context: { isSystem: true, skipTriggers: true } },
    );
    // The REST data door: `POST /api/v1/data/OBJECT` reaches the engine through
    // the protocol's `createData` with the caller's assembled context.
    const protocol = new ObjectStackProtocolImplementation(objectql as never);
    await protocol.createData({ object: OBJECT, data: { code: 'rest', created_at: FORGED }, context: { userId: 'user-1' } });

    expect(stored('sys').created_at).toBe(BOOT_1);
    expect(stored('sys_quiet').created_at).toBe(BOOT_1);
    expect(stored('rest').created_at).toBe(BOOT_1);
  });

  // ── Pin 4 ────────────────────────────────────────────────────────────────
  it('pin 4: the `preserveAudit` insert warning is unchanged — it fires for a non-system create, never for a seed insert', async () => {
    // The lead clause, derived from the producer rather than spelled here.
    const lead = preserveAuditIgnoredOnInsertWarning('', []).split(':')[0];

    await boot(BOOT_1, 'v1');
    await boot(BOOT_2, 'v2');
    expect(warns.filter((w) => w.startsWith(lead))).toEqual([]);

    await objectql.insert(
      OBJECT,
      { code: 'hist', run_at: FORGED, created_at: FORGED },
      { context: { userId: 'user-1', preserveAudit: true } },
    );
    expect(warns.filter((w) => w.startsWith(lead))).toEqual([
      preserveAuditIgnoredOnInsertWarning(OBJECT, ['run_at']),
    ]);
    // The historical-import channel itself is untouched: the binder keeps the
    // authored `created_at` under `preserveAudit`, the strip takes `run_at`.
    expect(stored('hist').created_at).toBe(FORGED);
    expect(stored('hist').run_at).toBeUndefined();
  });

  // ── `created_by`, measured (a companion, not a pin) ──────────────────────
  // The seed context carries no `userId`, and the binder assigns the audit
  // user fields only inside `if (session?.userId)`, on either event. So an
  // authored `created_by` is untouched on the INSERT and on the UPDATE, and an
  // unauthored one stays absent. This was already true before #21646 and the
  // change does not touch it — green on both sides, so it is evidence of the
  // measurement, not of the fix.
  it('companion: an authored `created_by` is kept on the seed INSERT and the seed UPDATE; none is stamped', async () => {
    const [row] = await objectql.insert(
      OBJECT,
      [{ code: 'by', created_by: 'usr_seed_author' }, { code: 'by_none' }],
      { context: SEED_WRITE_EXECUTION_CONTEXT },
    );
    expect(stored('by').created_by).toBe('usr_seed_author');
    expect(stored('by_none').created_by).toBeUndefined();

    vi.setSystemTime(new Date(BOOT_2));
    await objectql.update(OBJECT, { id: row.id, subject: 'v2', created_by: 'usr_seed_author' }, { context: SEED_WRITE_EXECUTION_CONTEXT });
    expect(stored('by').created_by).toBe('usr_seed_author');
    expect(stored('by').updated_by).toBeUndefined();
  });
});
