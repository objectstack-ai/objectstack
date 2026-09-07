// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3043 → #14147 — where the create-side static-`readonly` strip LIVES, pinned
// from the ingress side.
//
// #3043 put the strip at this DataProtocol ingress because the engine was
// INSERT-readonly-exempt (#3413), and the ingress is the seam every external
// REST/GraphQL/MCP create funnels through. That left the exemption's other half
// standing: a non-system caller reaching `engine.insert` DIRECTLY wrote the
// read-only column with no refusal, no WARN and no `onFieldsDropped` event.
//
// Maintainer ruling, 2026-09-03 (option C), superseding their own 2026-07-24
// "INSERT (all callers) exempt" row: the strip is `stripReadonlyFields` inside
// `engine.insert` — the same function, the same `isSystem` gate and the same
// reporting the UPDATE path has had since #2948 — and the ingress copy is
// DELETED rather than kept as a second implementation.
//
// ⇒ What this file may still pin is DELEGATION, and only that:
//   - every create face hands the caller's payload to `engine.insert` WHOLE —
//     `createData`, `cloneData`, `createManyData`, `insertManyData`, and
//     `batchData`'s `create` rows AND both arms of `upsert` that create;
//   - every create face whose RESPONSE carries `droppedFields` surfaces the
//     ENGINE's `onFieldsDropped` there, which is the channel the ingress used
//     to FAKE with a before/after payload diff. `cloneData` is the one face
//     that does not: `CloneDataResponseSchema` declares no such member (pinned
//     in the firing-control block at the bottom).
// The enforcement itself is pinned where it now runs, against a real engine:
// `packages/objectql/src/engine-insert-static-readonly-strip.test.ts`. This
// package does not depend on `@objectstack/objectql`, so a strip assertion here
// could only ever re-测 a mock — which is exactly how the direct-`engine.insert`
// hole survived four rulings.

import { describe, it, expect, vi } from 'vitest';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';

const SCHEMA = {
  name: 'approval_case',
  fields: {
    title: { name: 'title', type: 'text' },
    // readonly approval column — the #3003/#3043 attack target
    approval_status: { name: 'approval_status', type: 'text', readonly: true, defaultValue: 'draft' },
    // readonly provenance stamp with no default
    source: { name: 'source', type: 'text', readonly: true },
  },
};

/**
 * A stand-in engine that behaves like the real one AFTER #14147: it strips the
 * declared `readonly` keys the caller supplied and reports them through
 * `options.onFieldsDropped`, exactly once per call.
 *
 * The strip here is a STUB of the engine's verdict, never a second copy of its
 * rules — the assertions below are about what the ingress FORWARDS and what it
 * SURFACES, and a stub that never dropped anything would make every
 * `droppedFields` assertion vacuously green (the firing control is
 * `engine listener wiring` at the bottom of this file).
 */
function makeProtocol(schema: any = SCHEMA) {
  const inserts: Array<{ object: string; data: any; options: any }> = [];
  const strip = (row: any) => {
    if (!row || typeof row !== 'object') return { row, dropped: [] as string[] };
    const dropped: string[] = [];
    const out: any = { ...row };
    for (const [name, def] of Object.entries<any>(schema.fields)) {
      if (!def?.readonly || !(name in out)) continue;
      delete out[name];
      dropped.push(name);
    }
    return { row: out, dropped };
  };
  const run = (object: string, data: any, options?: any) => {
    inserts.push({ object, data, options });
    const rows = Array.isArray(data) ? data : [data];
    const stripped = rows.map(strip);
    const union = [...new Set(stripped.flatMap((s) => s.dropped))];
    if (union.length > 0 && typeof options?.onFieldsDropped === 'function') {
      options.onFieldsDropped({ object, fields: union, reason: 'readonly' } as DroppedFieldsEvent);
    }
    return stripped.map((s, i) => ({ id: `rec-${i + 1}`, ...s.row }));
  };
  const engine = {
    registry: { getObject: (n: string) => (n === schema.name ? schema : undefined) },
    insert: vi.fn(async (object: string, data: any, options?: any) => {
      const out = run(object, data, options);
      return Array.isArray(data) ? out : out[0];
    }),
    insertMany: vi.fn(async (object: string, rows: any[], options?: any) =>
      run(object, rows, options).map((record) => ({ ok: true, record }))),
    // `cloneData` reads the source through the engine's find path — opened with
    // the shared predicate so this double cannot be looser than `ObjectQL.findOne`
    // (`check:engine-double-contract`).
    findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => {
      assertEngineFindOnePredicate(object, query);
      // The clone source exists; any other id names no row, which is what sends
      // `batchData`'s upsert fork (`probeRecord`, #5099) down its CREATE arm.
      const id = (query as any)?.where?.id;
      return id === 'src-1' ? { id: 'src-1', title: 'Source', approval_status: 'approved' } : null;
    }),
  };
  const p = new ObjectStackProtocolImplementation(engine as any);
  return { p, engine, inserts };
}

describe('#14147 — the create ingress DELEGATES the readonly strip to engine.insert', () => {
  it('createData forwards the caller payload WHOLE — the forged key is the engine’s to judge', async () => {
    const { p, inserts } = makeProtocol();
    const res: any = await p.createData({
      object: 'approval_case',
      data: { title: 'Case A', approval_status: 'approved' },
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].data, 'nothing is removed before the engine sees it')
      .toEqual({ title: 'Case A', approval_status: 'approved' });
    // ...and the engine's verdict is what the 201 body reports.
    expect(res.droppedFields).toEqual([
      { object: 'approval_case', fields: ['approval_status'], reason: 'readonly' },
    ]);
    expect(res.record).not.toHaveProperty('approval_status');
  });

  it('createData passes a SYSTEM context through untouched — the exemption is the engine’s too', async () => {
    const { p, inserts } = makeProtocol();
    await p.createData({
      object: 'approval_case',
      data: { title: 'Case B', approval_status: 'approved' },
      context: { isSystem: true },
    });
    expect(inserts[0].data.approval_status, 'the ingress never pre-empts the isSystem gate').toBe('approved');
    expect(inserts[0].options.context).toEqual({ isSystem: true });
  });

  it('cloneData forwards the copied row AND the caller overrides whole', async () => {
    const { p, inserts } = makeProtocol();
    await p.cloneData({
      object: 'approval_case',
      id: 'src-1',
      overrides: { source: 'forged' },
    } as any);
    expect(inserts).toHaveLength(1);
    // `overrides` are applied BEFORE the insert, so a readonly key smuggled
    // through them is still the engine's to strip (#3043's carried-over case).
    expect(inserts[0].data.source).toBe('forged');
    expect(inserts[0].data.approval_status, 'the copied readonly column travels too').toBe('approved');
  });

  it('createManyData forwards every row whole and AGGREGATES the engine’s event', async () => {
    const { p, inserts } = makeProtocol();
    const res: any = await p.createManyData({
      object: 'approval_case',
      records: [{ title: 'A', approval_status: 'approved' }, { title: 'B', source: 'x' }],
    });
    expect(inserts[0].data).toEqual([
      { title: 'A', approval_status: 'approved' },
      { title: 'B', source: 'x' },
    ]);
    expect(res.droppedFields).toEqual([
      { object: 'approval_case', fields: ['approval_status', 'source'], reason: 'readonly' },
    ]);
  });

  it('batchData create forwards the row whole and hangs the engine’s event on that row', async () => {
    const { p, inserts } = makeProtocol();
    const res: any = await p.batchData({
      object: 'approval_case',
      request: { operation: 'create', records: [{ data: { title: 'A', approval_status: 'approved' } }] },
    } as any);
    expect(inserts[0].data).toEqual({ title: 'A', approval_status: 'approved' });
    expect(res.results[0].droppedFields).toEqual([
      { object: 'approval_case', fields: ['approval_status'], reason: 'readonly' },
    ]);
  });

  it('batchData upsert-CREATE (row with no id) forwards the row whole and hangs the engine’s event on that row', async () => {
    const { p, inserts } = makeProtocol();
    const res: any = await p.batchData({
      object: 'approval_case',
      request: { operation: 'upsert', records: [{ data: { title: 'A', approval_status: 'approved' } }] },
    } as any);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].data).toEqual({ title: 'A', approval_status: 'approved' });
    expect(res.results[0].success).toBe(true);
    expect(res.results[0].droppedFields).toEqual([
      { object: 'approval_case', fields: ['approval_status'], reason: 'readonly' },
    ]);
  });

  it('batchData upsert-CREATE (id names no row) forwards `{ id, ...data }` whole and hangs the engine’s event on that row', async () => {
    const { p, engine, inserts } = makeProtocol();
    const res: any = await p.batchData({
      object: 'approval_case',
      request: { operation: 'upsert', records: [{ id: 'new-1', data: { title: 'A', approval_status: 'approved' } }] },
    } as any);
    // The fork asked existence first (#5099) and was answered null, so this is
    // the CREATE arm — pinned, because the update arm five lines above it in
    // `runBatchDataLoop` already reported drops and would make this green for
    // the wrong reason.
    expect(engine.findOne).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].data).toEqual({ id: 'new-1', title: 'A', approval_status: 'approved' });
    expect(res.results[0].success).toBe(true);
    expect(res.results[0].droppedFields).toEqual([
      { object: 'approval_case', fields: ['approval_status'], reason: 'readonly' },
    ]);
  });

  it('insertManyData forwards every row whole and keeps ROW precision from the union', async () => {
    const { p, inserts } = makeProtocol();
    const res: any = await p.insertManyData({
      object: 'approval_case',
      records: [{ title: 'A', approval_status: 'approved' }, { title: 'B' }],
    });
    expect(inserts[0].data).toEqual([{ title: 'A', approval_status: 'approved' }, { title: 'B' }]);
    // The engine's event is the batch UNION (its listener carries no row
    // index); row precision is recovered by asking which row SUPPLIED the key.
    expect(res.outcomes[0].droppedFields).toEqual([
      { object: 'approval_case', fields: ['approval_status'], reason: 'readonly' },
    ]);
    expect(res.outcomes[1].droppedFields, 'row B supplied none of the dropped names').toBeUndefined();
  });
});

describe('#14147 — engine listener wiring (the firing control for every assertion above)', () => {
  // The faces enumerated here are the ones whose RESPONSE carries
  // `droppedFields`: `CreateDataResponse`, `CreateManyDataResponse`, and the
  // per-row results of `insertManyData` / `batchData`. `cloneData` is
  // deliberately NOT among them — its contract has no such member; the case
  // after this one pins that exclusion so "every" stays true of what is listed.
  it('every create face whose response carries droppedFields passes an onFieldsDropped listener to the engine', async () => {
    const { p, inserts } = makeProtocol();
    await p.createData({ object: 'approval_case', data: { title: 'A' } });
    await p.createManyData({ object: 'approval_case', records: [{ title: 'A' }] });
    await p.batchData({
      object: 'approval_case',
      request: { operation: 'create', records: [{ data: { title: 'A' } }] },
    } as any);
    await p.batchData({
      object: 'approval_case',
      request: { operation: 'upsert', records: [{ data: { title: 'A' } }] },
    } as any);
    await p.batchData({
      object: 'approval_case',
      request: { operation: 'upsert', records: [{ id: 'new-1', data: { title: 'A' } }] },
    } as any);
    await p.insertManyData({ object: 'approval_case', records: [{ title: 'A' }] });
    expect(inserts, 'createData · createManyData · batchData create · batchData upsert-create ×2 (no id / unknown id) · insertManyData')
      .toHaveLength(6);
    for (const call of inserts) {
      expect(typeof call.options?.onFieldsDropped, 'a face with no listener reports a silent drop').toBe('function');
    }
  });

  it('cloneData is the one create face that passes NO listener — its response contract declares no droppedFields', async () => {
    // `CloneDataResponseSchema` (#11924, declared AS PRODUCED) is exactly
    // `{ object, id, sourceId, record }`; `search-clone-schema-conformance.test.ts`
    // holds the producer to that key set and asserts `droppedFields` in
    // particular is absent. So a listener here would have nowhere contracted
    // to report to. The engine still strips a copied-over or overridden
    // readonly column and still logs the `warn` line — the clone simply does
    // not carry the event on the wire. Reporting it means a new response key,
    // which is a spec change with its own card, not a delegation detail.
    const { p, inserts } = makeProtocol();
    await p.cloneData({ object: 'approval_case', id: 'src-1' } as any);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].options?.onFieldsDropped).toBeUndefined();
  });

  it('a create that drops NOTHING reports no droppedFields at all', async () => {
    const { p } = makeProtocol();
    const res: any = await p.createData({ object: 'approval_case', data: { title: 'clean' } });
    expect(res.droppedFields).toBeUndefined();
  });
});
