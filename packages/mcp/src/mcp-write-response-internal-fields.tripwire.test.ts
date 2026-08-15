// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #8497 — THE TRIPWIRE, MCP HALF: no response body an MCP caller receives from
// a write carries an `internal: true` value.
//
// ## Why a second tripwire rather than a wider first one
//
// #7823 shipped `protocol.write-response-internal-fields.tripwire.test.ts`,
// which walks the protocol class's prototype for `*Data` faces. That guard is
// strong and is NOT replaced here — but its coverage is "every `*Data` face on
// one class", while the property that needs holding is "every response body an
// external caller receives from a write". Those were the same set on the day it
// was written and are not the same set by construction: this transport reaches
// `IDataEngine` directly (see `stdio-data-bridge.ts`'s header — the stdio host
// cannot reuse the runtime's request-shaped `callData` builder), so no walk of
// the protocol class can see it.
//
// ⚠️ That gap was not hypothetical when this file was written. The `create`
// arm handed `engine.insert`'s result — whole since #7823 relocated the strip
// off the engine — straight back to the caller, and a flagged column rode the
// tool response verbatim. Measured, then fixed, then pinned here.
//
// ## How the enumeration catches a NEW write face
//
// The face list is NOT hand-written. It is read off the bridge object that
// `createStdioDataBridge` actually returns, at runtime. Every face must have a
// RECIPE below; a face with no recipe FAILS the suite with instructions, so a
// future verb cannot ship unexamined. Read faces are enumerated too — with
// `writesRecords: false` — so the map stays total and a rename is noticed
// rather than silently dropping a face out of coverage.
//
// ## What each recipe proves
//
// The fixture engine mirrors the post-#7823 engine contract: WRITE results
// carry the flagged column holding SENTINEL, READ results do not. Each recipe
// drives its face and the suite deep-scans the full response JSON:
//
//   - SENTINEL anywhere in the response  → the mouth skipped the helper → RED
//   - CONTROL missing where a record was promised → the probe went blind → RED
//
// A negative control at the bottom proves the machinery can go red: a bridge
// whose create arm skips the strip is shown to leak and to be caught.

import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { omitInternalFieldsFromWriteResponse } from '@objectstack/core';
import { createStdioDataBridge } from './stdio-data-bridge.js';

/** The value that must NEVER appear in any MCP response. */
const SENTINEL = 'INTERNAL-SENTINEL-8497-NEVER-SERIALIZED';
/** The value that MUST appear wherever a record was promised (falsifiability). */
const CONTROL = 'CONTROL-VALUE-8497-RECORD-FLOWED';

const VAULT = {
  name: 'vault',
  label: 'Vault',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    vault_secret: { name: 'vault_secret', type: 'text', internal: true },
  },
  // No `apiEnabled`/`apiMethods` narrowing: the ADR-0049 exposure gate must let
  // every verb through, or a recipe would be measuring a 404 instead of a body.
  enable: {},
};

/**
 * Engine double mirroring the post-#7823 contract:
 *  - WRITE results (insert / update) carry the flagged column holding SENTINEL;
 *  - READ results (find / findOne) do NOT — the engine's read-path strip is
 *    unchanged by #7823 and this transport depends on it.
 */
function makeSentinelEngine(): IDataEngine {
  const storedRow = (id = 'row-1') => ({ id, name: CONTROL });
  const writtenRow = (id: string, data?: Record<string, unknown>) => ({
    id,
    name: (data?.name as string) ?? CONTROL,
    vault_secret: SENTINEL,
  });
  return {
    find: vi.fn(async () => [storedRow()]),
    findOne: vi.fn(async () => storedRow()),
    insert: vi.fn(async (_o: string, data: Record<string, unknown>) =>
      writtenRow((data?.id as string) ?? 'new-1', data)),
    update: vi.fn(async (_o: string, data: Record<string, unknown>) =>
      writtenRow('row-1', data)),
    delete: vi.fn(async () => ({ deleted: 1 })),
    count: vi.fn(async () => 1),
    aggregate: vi.fn(async () => [{ n: 1 }]),
  } as unknown as IDataEngine;
}

function makeMetadata(): IMetadataService {
  return {
    listObjects: vi.fn(async () => [VAULT]),
    getObject: vi.fn(async () => VAULT),
  } as unknown as IMetadataService;
}

function makeBridge(engine: IDataEngine = makeSentinelEngine()) {
  return createStdioDataBridge({
    engine,
    metadataService: makeMetadata(),
    resolvePrincipal: async () => ({ userId: 'u1' }) as unknown as ExecutionContext,
  });
}

/**
 * Every callable face on the bridge the factory actually returns — the runtime
 * enumeration a future author cannot dodge by adding a verb without touching
 * this file. `aggregate` is attached conditionally (graceful degradation), so
 * the walk reads the built object rather than any declared type.
 */
function enumerateBridgeFaces(bridge: object): string[] {
  return Object.entries(bridge)
    .filter(([, v]) => typeof v === 'function')
    .map(([k]) => k)
    .sort();
}

/**
 * One entry per enumerated face. `invoke` drives it; `writesRecords` demands
 * CONTROL in the response (faces that promise a record back from a write).
 */
type Recipe = {
  invoke: (b: any) => Promise<unknown>;
  /** True for faces whose response echoes a record produced by a WRITE. */
  writesRecords: boolean;
};

const RECIPES: Record<string, Recipe> = {
  // ── read / summary faces: no engine write result to strip. Enumerated so the
  //    map stays total and a rename is noticed. ─────────────────────────────
  listObjects: { invoke: (b) => b.listObjects(), writesRecords: false },
  // [#6504] `listObjects` seen at its second width — the same object summaries
  // plus the completeness verdict. A summary face like its twin: it echoes no
  // engine write result, and the `{ name, label, fieldCount }` projection both
  // share is what keeps a stored field off this response in the first place.
  listObjectsDiagnosed: { invoke: (b) => b.listObjectsDiagnosed(), writesRecords: false },
  describeObject: { invoke: (b) => b.describeObject('vault'), writesRecords: false },
  query: { invoke: (b) => b.query('vault', {}), writesRecords: false },
  get: { invoke: (b) => b.get('vault', 'row-1'), writesRecords: false },
  aggregate: { invoke: (b) => b.aggregate('vault', {}), writesRecords: false },

  // ── write faces: an engine write result rides (or could ride) the response ──
  create: { invoke: (b) => b.create('vault', { name: CONTROL }), writesRecords: true },
  update: { invoke: (b) => b.update('vault', 'row-1', { name: CONTROL }), writesRecords: true },
  // `remove` answers `{ object, id, success }` — no record echo by contract,
  // driven anyway so a future receipt that starts carrying the row is caught.
  remove: { invoke: (b) => b.remove('vault', 'row-1'), writesRecords: false },
};

describe('#8497 tripwire: no MCP write response carries an `internal: true` value', () => {
  it('the enumeration is real: it sees the bridge write verbs', () => {
    const faces = enumerateBridgeFaces(makeBridge());
    expect(faces).toEqual(expect.arrayContaining(['create', 'update', 'remove']));
  });

  it('every bridge face has a recipe — a NEW verb must register here', () => {
    const faces = enumerateBridgeFaces(makeBridge());
    const missing = faces.filter((name) => !(name in RECIPES));
    expect(
      missing,
      `New McpDataBridge face(s) with no tripwire recipe: ${missing.join(', ')}. `
      + 'Every face this transport serves is a generic data mouth answering an '
      + 'external caller (#7728/#7823): if it returns an engine WRITE result, '
      + 'route the record(s) through `omitInternalFieldsFromWriteResponse` '
      + '(@objectstack/core) first, then add a recipe here so the strip is held '
      + 'by measurement rather than by review.',
    ).toEqual([]);
    // …and the map carries no dead entries for faces that no longer exist.
    const stale = Object.keys(RECIPES).filter((name) => !faces.includes(name));
    expect(stale, `Tripwire recipes for faces that no longer exist: ${stale.join(', ')}`).toEqual([]);
  });

  for (const [name, recipe] of Object.entries(RECIPES)) {
    it(`${name}: response never carries the internal sentinel${recipe.writesRecords ? ', and really returned a record' : ''}`, async () => {
      const bridge = makeBridge();
      const wire = JSON.stringify((await recipe.invoke(bridge)) ?? null);
      expect(wire.includes(SENTINEL), `${name} leaked an internal field: ${wire}`).toBe(false);
      if (recipe.writesRecords) {
        expect(
          wire.includes(CONTROL),
          `${name} returned no record at all — the probe is blind: ${wire}`,
        ).toBe(true);
      }
    });
  }

  it('the caller cannot use their own patch as an oracle on an internal column', async () => {
    // The one remaining way an `internal: true` KEY can reach the update echo:
    // the caller put it in `data`. Answering with it back would confirm-or-deny
    // a guess about a column the flag says is never returned.
    const bridge = makeBridge();
    const wire = JSON.stringify(await bridge.update('vault', 'row-1', {
      name: CONTROL,
      vault_secret: 'caller-guess',
    }));
    expect(wire.includes('caller-guess')).toBe(false);
    expect(wire.includes(CONTROL)).toBe(true); // still a real record echo
  });

  it('NEGATIVE CONTROL: the machinery goes red on a write mouth that skips the helper', async () => {
    // Exactly the defect this file was written after: an engine-only mouth that
    // echoes `engine.insert`'s (whole) result. Reintroduce it locally and prove
    // BOTH halves — the sentinel scan catches it, and the shared helper closes
    // it — without touching the shipped bridge.
    const engine = makeSentinelEngine();
    const leaky = {
      async create(object: string, data: Record<string, unknown>) {
        const written = await (engine as any).insert(object, data, {});
        return { object, id: written.id, record: { ...data, ...written } };
      },
    };

    const leaked = await leaky.create('vault', { name: CONTROL });
    expect(JSON.stringify(leaked).includes(SENTINEL)).toBe(true); // the scan bites

    omitInternalFieldsFromWriteResponse(VAULT, (leaked as any).record);
    expect(JSON.stringify(leaked).includes(SENTINEL)).toBe(false); // the helper closes it
    expect(JSON.stringify(leaked).includes(CONTROL)).toBe(true); // …without eating the record
  });
});
