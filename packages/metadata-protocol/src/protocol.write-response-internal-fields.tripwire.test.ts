// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7823 — THE TRIPWIRE: every generic data ingress routes its write-response
// records through `omitInternalFieldsFromWriteResponse`, and a NEW ingress
// cannot ship unexamined.
//
// ## Why this file exists (the A-prime ruling's own condition)
//
// The `internal: true` write-response strip lives at the protocol ingress, not
// in the engine — the engine's write results must stay whole (better-auth
// reads a minted `sys_session.token` back off `engine.insert`'s return), while
// `PATCH /data/sys_api_key/{id}`'s 200 body must NOT carry the stored key hash
// (measured: with the strip neutralised it did). The honest cost of that
// placement is that response-body policy became a per-ingress obligation, so a
// FUTURE `*Data` face that forgets the helper leaks silently. The maintainer
// ruling (2026-08-13) refused to defer that risk: this tripwire ships in the
// same PR as the relocation.
//
// ## How the enumeration catches a NEW ingress
//
// The method list is NOT hand-written. It is read off the protocol class's
// prototype chain at runtime — every function whose name ends in `Data`, the
// naming convention every data-plane face in this file has followed since
// `findData`/`createData`. Each enumerated method must have a RECIPE below;
// a `*Data` method with no recipe FAILS the suite with instructions, so the
// author of a new ingress is forced to (1) route its response records through
// the helper and (2) register how to drive it here. A hand-kept list of
// today's faces would silently stay true forever; this one grows by itself.
//
// ## What each recipe proves
//
// The fixture engine returns write results that ALWAYS carry a field declared
// `internal: true` holding SENTINEL (that is exactly what the real engine does
// now — write results are whole). Read results never carry it (the engine's
// read path strips, unchanged by #7823). Each recipe drives its face and the
// suite deep-scans the full response JSON:
//
//   - SENTINEL anywhere in the response  → the ingress skipped the helper → RED
//   - CONTROL missing where a record was promised → the probe went blind → RED
//     (falsifiability: proves a real record flowed through the response, so
//     "no sentinel" cannot be satisfied by an empty or failed response)
//
// A negative control at the bottom proves the machinery can go red: a subclass
// adds `leakyData` (returning an engine write result verbatim), the
// enumeration is shown to pick it up, and the scan is shown to catch its leak.

import { describe, it, expect } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import {
  collectInternalWriteResponseFields,
  omitInternalFieldsFromWriteResponse,
} from './write-response-internal-fields.js';

/** The value that must NEVER appear in any ingress response. */
const SENTINEL = 'INTERNAL-SENTINEL-7823-NEVER-SERIALIZED';
/** The value that MUST appear wherever a record was promised (falsifiability). */
const CONTROL = 'CONTROL-VALUE-7823-RECORD-FLOWED';

const VAULT_SCHEMA = {
  name: 'vault',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    vault_secret: { name: 'vault_secret', type: 'text', internal: true },
  },
  enable: { clone: true },
};

/**
 * Fixture engine mirroring the post-#7823 engine contract:
 *  - WRITE results (insert / update / insertMany outcomes) carry the flagged
 *    column, holding SENTINEL — the engine no longer strips its own write
 *    results;
 *  - READ results (find / findOne) do NOT carry it — the engine's read-path
 *    `omitInternalFields` is unchanged;
 *  - transaction support so the atomic arms run for real.
 */
function makeSentinelEngine() {
  const storedRow = (id: string) => ({ id, name: CONTROL });
  const writtenRow = (id: string, data?: Record<string, unknown>) => ({
    id,
    name: (data as any)?.name ?? CONTROL,
    vault_secret: SENTINEL,
  });
  let nextId = 1;
  const handle = { id: 'trx-1' };

  const engine: any = {
    registry: { getObject: (n: string) => (n === 'vault' ? VAULT_SCHEMA : undefined) },
    insert: async (_object: string, data: any) =>
      Array.isArray(data)
        ? data.map((d: any) => writtenRow(d?.id ?? `new-${nextId++}`, d))
        : writtenRow(data?.id ?? `new-${nextId++}`, data),
    insertMany: async (_object: string, rows: any[]) =>
      rows.map((r: any) => ({ ok: true, record: writtenRow(r?.id ?? `new-${nextId++}`, r) })),
    update: async (_object: string, data: any, options?: any) => {
      // [#5480] The producer's own update-verb dispatch contract, so this fake
      // cannot accept a call `ObjectQL.update` refuses (check:engine-double-contract).
      assertEngineUpdateDispatch(data, options);
      return writtenRow(options?.where?.id ?? data?.id ?? 'row-1', data);
    },
    // Contract per #4435: `false` is the positive not-found value.
    delete: async (_object: string, options?: any) => {
      // [#4550] Likewise for delete.
      assertEngineDeleteDispatch(options);
      return { deleted: 1 };
    },
    findOne: async (_object: string, options?: any) => storedRow(options?.where?.id ?? 'row-1'),
    find: async (_object: string, _options?: any) => [storedRow('row-1')],
    count: async () => 1,
    validate: async () => ({ valid: true, issues: [] }),
    getDefaultDriverName: () => 'default',
    getDriverByName: () => ({ beginTransaction: async () => handle }),
    transaction: async (callback: (ctx: any) => Promise<any>, baseContext?: any) =>
      callback({ ...(baseContext ?? {}), transaction: handle }),
  };
  return engine;
}

/**
 * Every `*Data` method reachable on `proto`'s prototype chain — the runtime
 * enumeration a future author cannot dodge by adding a method without touching
 * this file. TypeScript `private` does not hide a method from this walk, which
 * is deliberate: private write helpers (e.g. `runAtomicBatchData`) are part of
 * the surface and are covered through their public face.
 */
function enumerateDataMethods(proto: object): string[] {
  const names = new Set<string>();
  for (let p: any = proto; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const name of Object.getOwnPropertyNames(p)) {
      if (name.endsWith('Data') && typeof (p as any)[name] === 'function') names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * One entry per enumerated method. `invocations` drives the face against the
 * fixture; `expectRecord` demands CONTROL in the response (write faces that
 * promise records). `coveredVia` marks a private helper exercised through the
 * named public face — its invocations live there.
 */
type Recipe =
  | { invocations: Array<(p: any) => Promise<unknown>>; expectRecord: boolean }
  | { coveredVia: string };

const RECIPES: Record<string, Recipe> = {
  // ── read / verdict faces: no write result to strip; enumerated so the map
  //    stays total and a rename is noticed ──────────────────────────────────
  findData: {
    invocations: [(p) => p.findData({ object: 'vault', query: {} })],
    expectRecord: false,
  },
  getData: {
    invocations: [(p) => p.getData({ object: 'vault', id: 'row-1' })],
    expectRecord: false,
  },
  validateData: {
    invocations: [(p) => p.validateData({ object: 'vault', data: { name: 'x' } })],
    expectRecord: false,
  },
  deleteData: {
    invocations: [(p) => p.deleteData({ object: 'vault', id: 'row-1' })],
    expectRecord: false,
  },
  deleteManyData: {
    invocations: [(p) => p.deleteManyData({ object: 'vault', ids: ['row-1'] })],
    expectRecord: false,
  },

  // ── write faces: engine write results ride the response — the helper is
  //    what keeps SENTINEL out of each ─────────────────────────────────────
  createData: {
    invocations: [(p) => p.createData({ object: 'vault', data: { name: CONTROL } })],
    expectRecord: true,
  },
  cloneData: {
    invocations: [(p) => p.cloneData({ object: 'vault', id: 'row-1' })],
    expectRecord: true,
  },
  updateData: {
    invocations: [(p) => p.updateData({ object: 'vault', id: 'row-1', data: { name: CONTROL } })],
    expectRecord: true,
  },
  createManyData: {
    invocations: [
      (p) => p.createManyData({ object: 'vault', records: [{ name: CONTROL }, { name: 'b' }] }),
    ],
    expectRecord: true,
  },
  insertManyData: {
    invocations: [(p) => p.insertManyData({ object: 'vault', records: [{ name: CONTROL }] })],
    expectRecord: true,
  },
  updateManyData: {
    invocations: [
      (p) => p.updateManyData({
        object: 'vault',
        records: [{ id: 'row-1', data: { name: CONTROL } }],
        options: {},
      }),
      // The atomic arm shares `runUpdateManyLoop`, but drive it too so the
      // transaction wrapper cannot grow its own record echo unexamined.
      (p) => p.updateManyData({
        object: 'vault',
        records: [{ id: 'row-1', data: { name: CONTROL } }],
        options: { atomic: true },
      }),
    ],
    expectRecord: true,
  },
  batchData: {
    invocations: [
      (p) => p.batchData({
        object: 'vault',
        request: { operation: 'create', records: [{ data: { name: CONTROL } }], options: {} },
      }),
      (p) => p.batchData({
        object: 'vault',
        request: { operation: 'update', records: [{ id: 'row-1', data: { name: CONTROL } }], options: {} },
      }),
      // Upsert, both forks: with an id (probe finds the row → update arm) and
      // without one (insert arm).
      (p) => p.batchData({
        object: 'vault',
        request: { operation: 'upsert', records: [{ id: 'row-1', data: { name: CONTROL } }], options: {} },
      }),
      (p) => p.batchData({
        object: 'vault',
        request: { operation: 'upsert', records: [{ data: { name: CONTROL } }], options: {} },
      }),
      // Atomic — this is what walks `runAtomicBatchData` for real.
      (p) => p.batchData({
        object: 'vault',
        request: { operation: 'create', records: [{ data: { name: CONTROL } }], options: { atomic: true } },
      }),
    ],
    expectRecord: true,
  },
  runAtomicBatchData: { coveredVia: 'batchData' },
};

describe('#7823 tripwire: every generic data ingress strips `internal: true` from its write response', () => {
  const enumerated = enumerateDataMethods(ObjectStackProtocolImplementation.prototype);

  it('the enumeration is real: it sees the three ruling-named ingresses', () => {
    expect(enumerated).toEqual(expect.arrayContaining(['createData', 'updateData', 'cloneData']));
  });

  it('every `*Data` method has a recipe — a NEW ingress must register here', () => {
    const missing = enumerated.filter((name) => !(name in RECIPES));
    expect(
      missing,
      `New generic data ingress(es) with no tripwire recipe: ${missing.join(', ')}. `
      + 'A `*Data` method is a generic-data-path surface (#7823): route every engine '
      + 'write result it returns through `omitInternalFieldsFromWriteResponse` (the '
      + 'single exported helper in write-response-internal-fields.ts), then add a '
      + 'recipe for it in this file so the strip is held by measurement.',
    ).toEqual([]);
    // …and the map carries no dead entries for methods that no longer exist.
    const stale = Object.keys(RECIPES).filter((name) => !enumerated.includes(name));
    expect(stale, `Tripwire recipes for methods that no longer exist: ${stale.join(', ')}`).toEqual([]);
  });

  it('a `coveredVia` entry points at a real recipe, never at another alias', () => {
    for (const [name, recipe] of Object.entries(RECIPES)) {
      if ('coveredVia' in recipe) {
        const target = RECIPES[recipe.coveredVia];
        expect(target, `${name} says coveredVia '${recipe.coveredVia}', which has no recipe`).toBeTruthy();
        expect('invocations' in (target as any), `${name}'s coveredVia target must carry real invocations`).toBe(true);
      }
    }
  });

  for (const name of enumerated) {
    const recipe = RECIPES[name];
    if (!recipe || 'coveredVia' in recipe) continue;
    it(`${name}: response never carries the internal sentinel${recipe.expectRecord ? ', and really returned a record' : ''}`, async () => {
      for (const invoke of recipe.invocations) {
        const p = new ObjectStackProtocolImplementation(makeSentinelEngine());
        const response = await invoke(p);
        const wire = JSON.stringify(response ?? null);
        expect(wire.includes(SENTINEL), `${name} leaked an internal field: ${wire}`).toBe(false);
        if (recipe.expectRecord) {
          expect(wire.includes(CONTROL), `${name} returned no record at all — the probe is blind: ${wire}`).toBe(true);
        }
      }
    });
  }

  it('NEGATIVE CONTROL: the machinery goes red on an ingress that skips the helper', async () => {
    // A future author adds a write face and forgets the helper. Prove both
    // halves of the defence: the enumeration picks the method up, and the
    // sentinel scan catches its leak.
    class LeakyProtocol extends ObjectStackProtocolImplementation {
      async leakyData(request: { object: string; id: string; data: any }) {
        const result = await (this as any).engine.update(request.object, request.data, { where: { id: request.id } });
        return { object: request.object, id: request.id, record: result };
      }
    }
    const names = enumerateDataMethods(LeakyProtocol.prototype);
    expect(names).toContain('leakyData'); // half 1: a new `*Data` face cannot hide
    expect(names.filter((n) => !(n in RECIPES))).toEqual(['leakyData']); // …and it has no recipe → the completeness arm above would fail

    const p = new LeakyProtocol(makeSentinelEngine());
    const wire = JSON.stringify(await p.leakyData({ object: 'vault', id: 'row-1', data: { name: 'x' } }));
    expect(wire.includes(SENTINEL)).toBe(true); // half 2: the scan detects the leak

    // And the helper is exactly what closes it — same response, one call.
    const fixed = await p.leakyData({ object: 'vault', id: 'row-1', data: { name: 'x' } });
    omitInternalFieldsFromWriteResponse(VAULT_SCHEMA, (fixed as any).record);
    expect(JSON.stringify(fixed).includes(SENTINEL)).toBe(false);
  });

  it('the collector agrees with the engine rule: strict `internal === true` only', () => {
    expect(collectInternalWriteResponseFields(VAULT_SCHEMA)).toEqual(['vault_secret']);
    expect(collectInternalWriteResponseFields({
      name: 'x',
      fields: { a: { internal: 'true' }, b: { internal: 1 }, c: {}, d: { internal: true } },
    })).toEqual(['d']);
    expect(collectInternalWriteResponseFields(undefined)).toEqual([]);
    expect(collectInternalWriteResponseFields({ name: 'x' })).toEqual([]);
  });

  it('the strip is idempotent and skips non-records', () => {
    const row: any = { id: '1', vault_secret: SENTINEL, name: CONTROL };
    omitInternalFieldsFromWriteResponse(VAULT_SCHEMA, row);
    expect(row).toEqual({ id: '1', name: CONTROL });
    omitInternalFieldsFromWriteResponse(VAULT_SCHEMA, row); // second pass: no-op
    expect(row).toEqual({ id: '1', name: CONTROL });
    expect(() => omitInternalFieldsFromWriteResponse(VAULT_SCHEMA, null)).not.toThrow();
    expect(() => omitInternalFieldsFromWriteResponse(VAULT_SCHEMA, 3)).not.toThrow();
    expect(() => omitInternalFieldsFromWriteResponse(VAULT_SCHEMA, [row, null, 7])).not.toThrow();
  });
});
