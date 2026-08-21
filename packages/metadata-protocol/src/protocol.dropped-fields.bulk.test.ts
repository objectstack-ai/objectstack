// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#3455] Extends the single-write drop-observability of #3431 to the BULK
// write paths. Each bulk method must (a) surface the same LEGAL strips
// (static `readonly` #2948 / `readonlyWhen` #3042 / #3043 create ingress) that
// single-write now reports, and (b) thread the caller's execution `context` to
// the engine so RLS/FLS/`readonlyWhen` run under the caller — a gap the
// pre-#3455 `updateManyData`/`batchData` loops had. Channels:
//   - updateManyData / batchData → per-row `droppedFields` on each result row;
//   - insertManyData            → per-row `droppedFields` on each outcome;
//   - createManyData            → aggregated top-level `droppedFields` (its
//     response has no per-row slot; the insert strip is schema-uniform).

import { describe, it, expect, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
  name: 'approval_case',
  fields: {
    title: { name: 'title', type: 'text' },
    approval_status: { name: 'approval_status', type: 'text', readonly: true, defaultValue: 'draft' },
  },
};

describe('updateManyData — per-row droppedFields + context threading (#3455)', () => {
  it('surfaces per-row engine strips and threads the caller context to each update', async () => {
    const update = vi.fn(async (object: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      // Only the second row forges the readonly field → only it drops.
      if (data.approval_status !== undefined) {
        options?.onFieldsDropped?.({ object, fields: ['approval_status'], reason: 'readonly' });
      }
      return { id: options.where.id, title: data.title };
    });
    // [#5088] `findOne` is the existence probe the by-id bulk write faces now
    // run before the write, so it has to answer from the same row set this
    // fixture pretends to update — existence must mean one thing in a harness.
    // (It answered a flat `null` while nothing called it; a row that does not
    // exist is now correctly refused before `engine.update`.)
    const findOne = vi.fn(async (_object: string, options?: any) => ({ id: options?.where?.id, title: 'stored' }));
    const engine = { registry: { getObject: () => SCHEMA }, update, findOne };
    const p = new ObjectStackProtocolImplementation(engine as any);

    const ctx = { userId: 'u1' };
    const res: any = await p.updateManyData({
      object: 'approval_case',
      records: [
        { id: 'rec-1', data: { title: 'A' } },
        { id: 'rec-2', data: { title: 'B', approval_status: 'approved' } },
      ],
      context: ctx,
    } as any);

    // Row 0 dropped nothing → no droppedFields key; row 1 dropped approval_status.
    expect(res.results[0]).not.toHaveProperty('droppedFields');
    expect(res.results[1].droppedFields).toEqual([
      { object: 'approval_case', fields: ['approval_status'], reason: 'readonly' },
    ]);
    // [#3455] The pre-fix loop never threaded context — assert every engine
    // call now runs under the caller's principal.
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0][2].context).toBe(ctx);
    expect(update.mock.calls[1][2].context).toBe(ctx);
    expect(res.succeeded).toBe(2);
  });
});

describe('createManyData — aggregated top-level droppedFields (#3455)', () => {
  function makeProtocol() {
    const engine = {
      registry: { getObject: (n: string) => (n === 'approval_case' ? SCHEMA : undefined) },
      insert: vi.fn(async (_object: string, rows: any[]) => rows.map((r, i) => ({ id: `rec-${i + 1}`, ...r }))),
    };
    return { p: new ObjectStackProtocolImplementation(engine as any), engine };
  }

  it('aggregates the schema-uniform ingress strip across rows into one event', async () => {
    const { p } = makeProtocol();
    const res: any = await p.createManyData({
      object: 'approval_case',
      records: [
        { title: 'A', approval_status: 'approved' },
        { title: 'B', approval_status: 'approved' },
      ],
      context: { userId: 'u1' },
    });
    // Union, not one-event-per-row: both rows dropped the same readonly field.
    expect(res.droppedFields).toEqual([
      { object: 'approval_case', fields: ['approval_status'], reason: 'readonly' },
    ]);
    expect(res.count).toBe(2);
    expect(res.records[0]).not.toHaveProperty('approval_status');
  });

  it('omits droppedFields when no row seeds a readonly field', async () => {
    const { p } = makeProtocol();
    const res: any = await p.createManyData({
      object: 'approval_case',
      records: [{ title: 'A' }, { title: 'B' }],
      context: { userId: 'u1' },
    });
    expect(res).not.toHaveProperty('droppedFields');
  });

  it('a system-context bulk create keeps the field — no strip, no droppedFields', async () => {
    const { p } = makeProtocol();
    const res: any = await p.createManyData({
      object: 'approval_case',
      records: [{ title: 'A', approval_status: 'approved' }],
      context: { isSystem: true },
    });
    expect(res).not.toHaveProperty('droppedFields');
    expect(res.records[0].approval_status).toBe('approved');
  });
});

describe('insertManyData — per-row droppedFields on outcomes (#3455)', () => {
  it('attaches the ingress strip to the matching outcome row only', async () => {
    const insertMany = vi.fn(async (_object: string, rows: any[]) =>
      rows.map((r, i) => ({ ok: true, record: { id: `rec-${i + 1}`, ...r } })),
    );
    const engine = { registry: { getObject: () => SCHEMA }, insertMany };
    const p = new ObjectStackProtocolImplementation(engine as any);

    const res: any = await p.insertManyData({
      object: 'approval_case',
      records: [
        { title: 'A' },
        { title: 'B', approval_status: 'approved' },
      ],
      context: { userId: 'u1' },
    });

    expect(res.outcomes[0]).not.toHaveProperty('droppedFields');
    expect(res.outcomes[1].droppedFields).toEqual([
      { object: 'approval_case', fields: ['approval_status'], reason: 'readonly' },
    ]);
    // The strip really removed the field from what the engine inserted.
    expect(insertMany.mock.calls[0][1][1]).not.toHaveProperty('approval_status');
  });
});

describe('batchData — per-row droppedFields + context threading (#3455)', () => {
  it('create rows surface the ingress strip and honour a system context', async () => {
    const insert = vi.fn(async (_object: string, data: any, _options?: any) => ({ id: 'rec-1', ...data }));
    const engine = { registry: { getObject: () => SCHEMA }, insert, update: vi.fn(), findOne: vi.fn() };
    const p = new ObjectStackProtocolImplementation(engine as any);

    const res: any = await p.batchData({
      object: 'approval_case',
      request: {
        operation: 'create',
        records: [{ data: { title: 'A', approval_status: 'approved' } }],
      },
      context: { userId: 'u1' },
    } as any);

    expect(res.results[0].droppedFields).toEqual([
      { object: 'approval_case', fields: ['approval_status'], reason: 'readonly' },
    ]);
    expect(res.results[0].data).not.toHaveProperty('approval_status');
    // [#3455] context is threaded to the insert (was hard-coded undefined before).
    expect(insert.mock.calls[0][2].context).toEqual({ userId: 'u1' });
  });

  it('a system-context batch create is exempt from the strip (context now threaded to it)', async () => {
    const insert = vi.fn(async (_object: string, data: any) => ({ id: 'rec-1', ...data }));
    const engine = { registry: { getObject: () => SCHEMA }, insert, update: vi.fn(), findOne: vi.fn() };
    const p = new ObjectStackProtocolImplementation(engine as any);

    const res: any = await p.batchData({
      object: 'approval_case',
      request: { operation: 'create', records: [{ data: { title: 'A', approval_status: 'approved' } }] },
      context: { isSystem: true },
    } as any);

    expect(res.results[0]).not.toHaveProperty('droppedFields');
    expect(res.results[0].data.approval_status).toBe('approved');
  });

  it('update rows surface the engine strip and keep droppedFields when returnRecords=false', async () => {
    const update = vi.fn(async (object: string, _data: any, options?: any) => {
      assertEngineUpdateDispatch(_data, options);
      options?.onFieldsDropped?.({ object, fields: ['approval_status'], reason: 'readonly' });
      return { id: options.where.id };
    });
    // [#5088] See the updateManyData fixture above: `findOne` is now the
    // existence probe in front of the write, so it must answer for `rec-1`.
    const findOne = vi.fn(async (_object: string, options?: any) => ({ id: options?.where?.id }));
    const engine = { registry: { getObject: () => SCHEMA }, update, insert: vi.fn(), findOne };
    const p = new ObjectStackProtocolImplementation(engine as any);

    const res: any = await p.batchData({
      object: 'approval_case',
      request: {
        operation: 'update',
        records: [{ id: 'rec-1', data: { approval_status: 'approved' } }],
        options: { returnRecords: false },
      },
      context: { userId: 'u1' },
    } as any);

    // returnRecords:false drops `record` but MUST keep the warning.
    expect(res.results[0]).not.toHaveProperty('record');
    expect(res.results[0].droppedFields).toEqual([
      { object: 'approval_case', fields: ['approval_status'], reason: 'readonly' },
    ]);
    expect(update.mock.calls[0][2].context).toEqual({ userId: 'u1' });
  });
});
