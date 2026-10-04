// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #21663 — a system writer is exempt from the readonly STRIP, never from the
// value-SHAPE check.
//
// ## The defect, as measured on unfixed `main` (72f3c74d60)
//
//   field                         writer                     value          outcome
//   ----------------------------  -------------------------  -------------  -----------------------------
//   readonly datetime             seed (`isSystem`)          'yesterday'    stored verbatim, no error
//   NON-readonly datetime         seed (`isSystem`)          'yesterday'    refused, counted as seed error
//   readonly datetime             seeder skipping the        cel envelope   stored verbatim
//                                 `cel` resolution
//
// The record validator skipped every `readonly` field, on the premise that the
// readonly strip had already removed anything a caller sent. The strip exempts
// a system write, so for exactly those writers the premise was false.
//
// ## Ruling (triage on #21663, verbatim from "Ruling" to the pins)
//
// > - Split the branch. The readonly strip keeps its system-context exemption,
// >   and the value-shape check runs for every write.
// > - A malformed readonly value is refused loudly with the same message the
// >   non-readonly path gives, and a seed counts it as a seed error.
// > - ⛔ No silent coercion.
// >
// > **Pins:**
// > - `'yesterday'` on a readonly datetime in a seed is refused;
// > - a valid ISO value on a readonly field under the seed context is kept;
// > - the non-readonly path is unchanged.
//
// Each refusal asserts the ADR-0112 pair: `code`, and the `status` the HTTP
// boundary assigns (`resolveThrownHttpError` — a `ValidationError` carries no
// `status` of its own by design). The seed loader's own error record carries
// only a sentence, so on the loader the pin asserts the count and that
// sentence, and the code/status pair is asserted on the loader's own call
// shape (an engine write under `SEED_WRITE_EXECUTION_CONTEXT`).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { cel } from '@objectstack/spec';
import { SEED_WRITE_EXECUTION_CONTEXT } from '@objectstack/spec/kernel';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL } from './engine.js';

/** `run_at` is READONLY here … */
const RO = 'seed_ro_case';
/** … and the SAME field, minus `readonly`, here: the non-readonly control. */
const RW = 'seed_rw_case';
const BOOT = '2026-10-03T12:00:00.000Z';
const ISO = '2026-09-01T12:00:00.000Z';
/** `daysAgo(5)` at `BOOT`: UTC midnight of the calendar day five days back. */
const DAYS_AGO_5 = '2026-09-28T00:00:00.000Z';

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
    // The predicate seam's entry point: without it the engine never reaches
    // the predicate path, so that seam would go unmeasured.
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const s = storeFor(object);
      let changed = 0;
      for (const [id, row] of s) {
        if (!matches(row, ast?.where)) continue;
        s.set(id, { ...row, ...data, id });
        changed += 1;
      }
      return changed;
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

const seed = (object: string, records: Array<Record<string, unknown>>) => ({
  object,
  externalId: 'ref',
  mode: 'upsert',
  env: ['prod', 'dev', 'test'],
  records,
});

/** The validation sentence a seed error quotes, after its `(ref=…): ` lead. */
const quotedSentence = (message: string) => message.slice(message.indexOf('): ') + 3);

/** The thrown refusal, read the way an HTTP boundary reads it. */
async function refusal(write: () => Promise<unknown>) {
  let thrown: any;
  try {
    await write();
  } catch (err) {
    thrown = err;
  }
  expect(thrown, 'the write must be refused').toBeDefined();
  const http = resolveThrownHttpError(thrown);
  return { thrown, status: http.status, code: http.code, fields: thrown.fields as any[] };
}

describe('a system writer is exempt from the readonly strip, never from the value-shape check (#21663)', () => {
  let kernel: ObjectKernel;
  let objectql: ObjectQL;
  let storeFor: ReturnType<typeof makeStubDriver>['storeFor'];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(BOOT));
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
    // `created_at` is NOT declared: the registry injects it from
    // `AUDIT_FIELD_DEFS` (`readonly`, `system`, and a lifecycle name), as on
    // every real object — three skips the old walk applied to it at once.
    for (const [name, readonly] of [[RO, true], [RW, false]] as const) {
      objectql.registry.registerObject({
        name,
        label: name,
        datasource: 'seed-store',
        fields: {
          ref: { name: 'ref', label: 'Ref', type: 'text' },
          subject: { name: 'subject', label: 'Subject', type: 'text' },
          run_at: { name: 'run_at', label: 'Run At', type: 'datetime', readonly },
          // The constraint arms a readonly value does NOT reach (see
          // `ReadonlyValueScope`): an option set and a bound.
          kind: { name: 'kind', label: 'Kind', type: 'select', options: [{ label: 'Built-in', value: 'builtin' }], readonly },
          score: { name: 'score', label: 'Score', type: 'number', max: 5, readonly },
        },
      } as any, 'test', 'test');
    }
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (kernel.getState() === 'running') await kernel.shutdown();
  });

  const loader = () => new SeedLoaderService(objectql as never, emptyMetadata() as never, quietLogger as never);
  const load = (...seeds: ReturnType<typeof seed>[]) =>
    loader().load({ seeds: seeds as never, config: LOAD_CONFIG });
  const rows = (object: string, ref: string) =>
    Array.from(storeFor(object).values()).filter((r) => r.ref === ref);
  const stored = (object: string, ref: string) => {
    const found = rows(object, ref);
    expect(found.length, `exactly one stored ${object} row for ref ${ref}`).toBe(1);
    return found[0];
  };

  // ── Pin 1 ────────────────────────────────────────────────────────────────
  describe("pin 1: 'yesterday' on a readonly datetime in a seed is refused, as the non-readonly path refuses it", () => {
    it('the seed loader counts it as a seed error, quotes the non-readonly sentence, and stores no row', async () => {
      const result = await load(
        seed(RO, [{ ref: 'bad', run_at: 'yesterday' }]),
        seed(RW, [{ ref: 'bad', run_at: 'yesterday' }]),
      );

      expect(result.summary.totalErrored).toBe(2);
      expect(result.errors).toHaveLength(2);
      const [ro, rw] = [RO, RW].map((o) => result.errors.find((e: any) => e.sourceObject === o)!);
      expect(quotedSentence(ro.message)).toBe('Run At must be a valid datetime (ISO-8601)');
      expect(quotedSentence(ro.message)).toBe(quotedSentence(rw.message));
      expect(rows(RO, 'bad')).toEqual([]);
      expect(rows(RW, 'bad')).toEqual([]);
    });

    it('the replay (UPDATE) of an existing seed row is refused too, and the stored value stands', async () => {
      const first = await load(seed(RO, [{ ref: 'r', run_at: ISO }]));
      expect(first.errors).toEqual([]);

      const replay = await load(seed(RO, [{ ref: 'r', run_at: 'yesterday' }]));
      expect(replay.summary.totalErrored).toBe(1);
      expect(quotedSentence(replay.errors[0].message)).toBe('Run At must be a valid datetime (ISO-8601)');
      expect(stored(RO, 'r').run_at).toBe(ISO);
    });

    it('the refusal is VALIDATION_FAILED / 400 on all four write seams, with the non-readonly field envelope', async () => {
      const ctx = { context: SEED_WRITE_EXECUTION_CONTEXT };
      const [existing] = await objectql.insert(RO, [{ ref: 'e', run_at: ISO }], ctx);

      const seams: Array<[string, () => Promise<unknown>]> = [
        ['insert', () => objectql.insert(RO, { ref: 'i', run_at: 'yesterday' }, ctx)],
        ['update by id', () => objectql.update(RO, { id: existing.id, run_at: 'yesterday' }, ctx)],
        ['update by predicate', () => objectql.update(RO, { run_at: 'yesterday' }, { ...ctx, where: { ref: 'e' }, multi: true } as any)],
      ];
      for (const [seam, write] of seams) {
        const r = await refusal(write);
        expect([seam, r.code, r.status]).toEqual([seam, 'VALIDATION_FAILED', 400]);
        expect(r.fields.map((f) => [f.field, f.code, f.message])).toEqual([
          ['run_at', 'invalid_date', 'Run At must be a valid datetime (ISO-8601)'],
        ]);
      }
      // The control: the SAME write on the non-readonly twin answers the same envelope.
      const control = await refusal(() => objectql.insert(RW, { ref: 'i', run_at: 'yesterday' }, ctx));
      expect([control.code, control.status]).toEqual(['VALIDATION_FAILED', 400]);
      expect(control.fields.map((f) => [f.field, f.code, f.message])).toEqual([
        ['run_at', 'invalid_date', 'Run At must be a valid datetime (ISO-8601)'],
      ]);
      expect(stored(RO, 'e').run_at).toBe(ISO);
      // Positive control on the predicate seam: a valid value lands through it.
      await objectql.update(RO, { run_at: DAYS_AGO_5 }, { ...ctx, where: { ref: 'e' }, multi: true } as any);
      expect(stored(RO, 'e').run_at).toBe(DAYS_AGO_5);

      // The dry run (fourth seam) reports what the write refuses.
      const preview = await objectql.validate(RO, { ref: 'p', run_at: 'yesterday' }, { mode: 'insert', context: SEED_WRITE_EXECUTION_CONTEXT });
      expect(preview.valid).toBe(false);
      expect(preview.results[0].errors.map((f: any) => [f.field, f.code])).toEqual([['run_at', 'invalid_date']]);
    });

    it('an unresolved `cel` envelope from a seeder that skips its resolution is refused, and so is a malformed authored `created_at`', async () => {
      // `AppPlugin`'s fallback inserts and `@objectstack/verify`'s `seed()`
      // hand the row to the engine without `resolveSeedRecord`: this is their
      // call shape, single-row and array.
      const ctx = { context: SEED_WRITE_EXECUTION_CONTEXT };
      for (const write of [
        () => objectql.insert(RO, { ref: 'c1', run_at: cel`daysAgo(5)` }, ctx),
        () => objectql.insert(RO, [{ ref: 'c2', run_at: cel`daysAgo(5)` }], ctx),
      ]) {
        const r = await refusal(write);
        expect([r.code, r.status]).toEqual(['VALIDATION_FAILED', 400]);
        expect(r.fields.map((f) => [f.field, f.code])).toEqual([['run_at', 'invalid_date']]);
      }
      // The injected audit column the seed keeps since #21646.
      const audit = await refusal(() => objectql.insert(RO, { ref: 'ca', created_at: 'yesterday' }, ctx));
      expect([audit.code, audit.status]).toEqual(['VALIDATION_FAILED', 400]);
      expect(audit.fields.map((f) => [f.field, f.code])).toEqual([['created_at', 'invalid_date']]);
      expect(rows(RO, 'c1')).toEqual([]);
      expect(rows(RO, 'c2')).toEqual([]);
      expect(rows(RO, 'ca')).toEqual([]);
    });
  });

  // ── Pin 2 ────────────────────────────────────────────────────────────────
  it('pin 2: a valid ISO value on a readonly field under the seed context is kept — authored, evaluated from `cel`, or on `created_at`', async () => {
    const result = await load(seed(RO, [
      { ref: 'iso', run_at: ISO, created_at: ISO },
      { ref: 'cel', run_at: cel`daysAgo(5)`, created_at: cel`daysAgo(5)` },
    ]));
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
    expect(stored(RO, 'iso').run_at).toBe(ISO);
    expect(stored(RO, 'iso').created_at).toBe(ISO);
    expect(new Date(stored(RO, 'cel').run_at).toISOString()).toBe(DAYS_AGO_5);
    expect(new Date(stored(RO, 'cel').created_at).toISOString()).toBe(DAYS_AGO_5);

    // The replay keeps it too.
    const replay = await load(seed(RO, [{ ref: 'iso', subject: 'v2', run_at: ISO, created_at: ISO }]));
    expect(replay.errors).toEqual([]);
    expect(stored(RO, 'iso').subject).toBe('v2');
    expect(stored(RO, 'iso').run_at).toBe(ISO);
  });

  // ── Pin 3 ────────────────────────────────────────────────────────────────
  describe('pin 3: the non-readonly path is unchanged', () => {
    it('a non-readonly datetime takes a valid value and refuses a malformed one, as before', async () => {
      const result = await load(seed(RW, [{ ref: 'ok', run_at: ISO }]));
      expect(result.errors).toEqual([]);
      expect(stored(RW, 'ok').run_at).toBe(ISO);
      const r = await refusal(() => objectql.insert(RW, { ref: 'no', run_at: 'yesterday' }, { context: { isSystem: true } }));
      expect([r.code, r.status]).toEqual(['VALIDATION_FAILED', 400]);
      expect(r.fields.map((f) => [f.field, f.code])).toEqual([['run_at', 'invalid_date']]);
    });

    it('a NON-system caller\'s readonly value is still dropped by the strip, never refused — on insert and on a whole-record write-back', async () => {
      const user = { context: { userId: 'user-1' } };
      const [row] = await objectql.insert(RO, [{ ref: 'u', run_at: 'yesterday' }], user);
      expect(stored(RO, 'u').run_at).toBeUndefined();

      // A form round-trip echoes every key it read, a malformed legacy one
      // included. The strip drops it; judging it ahead of the strip would turn
      // the save into a refusal.
      storeFor(RO).get(row.id).run_at = 'legacy text';
      await objectql.update(RO, { id: row.id, subject: 'edited', run_at: 'legacy text' }, user);
      expect(stored(RO, 'u').subject).toBe('edited');
      expect(stored(RO, 'u').run_at).toBe('legacy text');
    });

    it('a readonly value reaches the SHAPE arms only: an undeclared option and an out-of-bound number are stored, as before', async () => {
      // The open-vocabulary ruling on `sys_activity.type` (commit 88b9d749a):
      // a readonly option set is the built-in set, not a closed enum.
      await objectql.insert(RO, { ref: 'k', kind: 'author_value', score: 9 }, { context: SEED_WRITE_EXECUTION_CONTEXT });
      expect(stored(RO, 'k').kind).toBe('author_value');
      expect(stored(RO, 'k').score).toBe(9);
      // …while the non-readonly twin refuses both, unchanged.
      const r = await refusal(() => objectql.insert(RW, { ref: 'k', kind: 'author_value', score: 9 }, { context: SEED_WRITE_EXECUTION_CONTEXT }));
      expect([r.code, r.status]).toEqual(['VALIDATION_FAILED', 400]);
      expect(r.fields.map((f) => [f.field, f.code]).sort()).toEqual([['kind', 'invalid_option'], ['score', 'max_value']]);
    });
  });
});
