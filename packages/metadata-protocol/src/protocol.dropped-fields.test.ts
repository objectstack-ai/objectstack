// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#3431] REST/API write paths must not SILENTLY drop caller-supplied fields.
// #3413 built the engine-level `onFieldsDropped` channel and wired the flow
// (`update_record`) side; this locks the DataProtocol passthrough that carries
// the strip back to the REST layer:
//   - updateData forwards the engine's onFieldsDropped events (readonly /
//     readonly_when) onto the response as `droppedFields`;
//   - createData surfaces the #3043 static-`readonly` INGRESS strip, which runs
//     BEFORE the engine (so it is recovered by diffing the payload, not via the
//     engine listener) — symmetric with update;
//   - no strip → NO `droppedFields` key, so the response shape stays
//     backward-compatible for clients that only read `record`.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';

const SCHEMA = {
  name: 'approval_case',
  fields: {
    title: { name: 'title', type: 'text' },
    approval_status: { name: 'approval_status', type: 'text', readonly: true, defaultValue: 'draft' },
  },
};

describe('updateData — forwards engine write strips as droppedFields (#3431)', () => {
  it('surfaces a readonly strip the engine reports via onFieldsDropped', async () => {
    const engine = {
      registry: { getObject: () => SCHEMA },
      // Stand in for the engine stripping `approval_status` and reporting it.
      update: vi.fn(async (object: string, data: any, options?: any) => {
        assertEngineUpdateDispatch(data, options);
        options?.onFieldsDropped?.({ object, fields: ['approval_status'], reason: 'readonly' });
        return { id: 'rec-1', title: data.title };
      }),
      // The row EXISTS — `updateData`'s #4435 existence probe reads this, and a
      // PATCH of an id that names no row is now a 404 rather than a 200 with a
      // null record. These fixtures are about the strip channel, not about
      // missing records, so they describe an engine that has the row.
      findOne: vi.fn(async () => ({ id: 'rec-1' })),
    };
    const p = new ObjectStackProtocolImplementation(engine as any);
    const res: any = await p.updateData({
      object: 'approval_case',
      id: 'rec-1',
      data: { title: 'B', approval_status: 'approved' },
      context: { userId: 'u1' },
    });
    expect(res.droppedFields).toEqual([
      { object: 'approval_case', fields: ['approval_status'], reason: 'readonly' },
    ]);
    // The write still succeeded; the returned record is unchanged in shape.
    expect(res.record).toEqual({ id: 'rec-1', title: 'B' });
  });

  it('forwards multiple strip passes in order (readonly_when then readonly)', async () => {
    const engine = {
      registry: { getObject: () => SCHEMA },
      update: vi.fn(async (object: string, data: any, options?: any) => {
        assertEngineUpdateDispatch(data, options);
        options?.onFieldsDropped?.({ object, fields: ['locked'], reason: 'readonly_when' });
        options?.onFieldsDropped?.({ object, fields: ['approval_status'], reason: 'readonly' });
        return { id: 'rec-1' };
      }),
      findOne: vi.fn(async () => ({ id: 'rec-1' })),
    };
    const p = new ObjectStackProtocolImplementation(engine as any);
    const res: any = await p.updateData({ object: 'approval_case', id: 'rec-1', data: {} });
    expect(res.droppedFields).toEqual([
      { object: 'approval_case', fields: ['locked'], reason: 'readonly_when' },
      { object: 'approval_case', fields: ['approval_status'], reason: 'readonly' },
    ]);
  });

  it('omits droppedFields entirely when the engine stripped nothing', async () => {
    const engine = {
      registry: { getObject: () => SCHEMA },
      update: vi.fn(async (_o: string, data: any) => ({ id: 'rec-1', ...data })),
      findOne: vi.fn(async () => ({ id: 'rec-1' })),
    };
    const p = new ObjectStackProtocolImplementation(engine as any);
    const res: any = await p.updateData({ object: 'approval_case', id: 'rec-1', data: { title: 'B' } });
    expect(res).not.toHaveProperty('droppedFields');
  });
});

describe('createData — surfaces the #3043 ingress readonly strip as droppedFields (#3431)', () => {
  function makeProtocol() {
    const engine = {
      registry: { getObject: (n: string) => (n === 'approval_case' ? SCHEMA : undefined) },
      insert: vi.fn(async (_object: string, data: any) => ({ id: 'rec-1', ...data })),
    };
    return { p: new ObjectStackProtocolImplementation(engine as any), engine };
  }

  it('reports the forged readonly field a non-system create dropped', async () => {
    const { p } = makeProtocol();
    const res: any = await p.createData({
      object: 'approval_case',
      data: { title: 'A', approval_status: 'approved' },
      context: { userId: 'u1' },
    });
    expect(res.droppedFields).toEqual([
      { object: 'approval_case', fields: ['approval_status'], reason: 'readonly' },
    ]);
    // Stripped field is absent from the persisted payload (existing #3043 behaviour).
    expect(res.record).not.toHaveProperty('approval_status');
  });

  it('omits droppedFields when the create seeds no readonly field', async () => {
    const { p } = makeProtocol();
    const res: any = await p.createData({
      object: 'approval_case',
      data: { title: 'A' },
      context: { userId: 'u1' },
    });
    expect(res).not.toHaveProperty('droppedFields');
  });

  it('a system-context create keeps the field — no strip, no droppedFields', async () => {
    const { p } = makeProtocol();
    const res: any = await p.createData({
      object: 'approval_case',
      data: { title: 'A', approval_status: 'approved' },
      context: { isSystem: true },
    });
    expect(res).not.toHaveProperty('droppedFields');
    expect(res.record.approval_status).toBe('approved');
  });
});
