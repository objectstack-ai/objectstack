// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A read-only value the caller sent on create, that a `beforeInsert` hook
 * stamped over, is reported under `droppedFields` reason `readonly` — the
 * report the static strip gives the same value when no hook stamps it.
 *
 * The platform's own case is `created_by`: the audit binder stamps it from the
 * session, so a forged value was stored as the caller's id with no report,
 * while a forged `organization_id` in the same request was reported. A value
 * equal to the stamp was not lost, so it adds no row: the console toasts every
 * reported field. `owning_business_unit_id` has no stamp (ADR-0117 D2 has not
 * landed), so the static strip takes a forged value and reports it already;
 * the last describe pins that beside the change.
 *
 * Boots the real ingress: `ObjectQLPlugin` binds `sys_stamp_audit_insert`, and
 * `engine.insert` runs the withhold, the hooks, the hand-back and the strips.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL } from './engine.js';

const REAL_USER = 'real_user';

describe('insert: a read-only value a hook stamped over is reported, not lost silently', () => {
  let kernel: ObjectKernel;

  beforeEach(() => {
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  });

  afterEach(async () => {
    if (kernel.getState() === 'running') await kernel.shutdown();
  });

  async function boot() {
    const captured: Record<string, any>[] = [];
    let n = 0;
    const mockDriver = {
      name: 'stamp-capture', version: '1.0.0',
      connect: async () => {}, disconnect: async () => {},
      find: async () => [], findOne: async () => null,
      create: async (_o: string, d: any) => {
        captured.push({ ...d });
        n += 1;
        return { id: d.id ?? `r_${n}`, ...d };
      },
      update: async (_o: string, i: any, d: any) => ({ id: i, ...d }),
      delete: async () => true, syncSchema: async () => {},
    };
    await kernel.use({
      name: 'stamp-capture-plugin', type: 'driver', version: '1.0.0',
      init: async (ctx: any) => { ctx.registerService('driver.stamp-capture', mockDriver); },
    } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    const objectql = kernel.getService<ObjectQL>('objectql');
    // The registry injects the audit family and the ownership anchors.
    objectql.registry.registerObject({
      name: 'stamp_note',
      label: 'Note',
      datasource: 'stamp-capture',
      fields: { title: { name: 'title', label: 'Title', type: 'text' } },
    } as any, 'test', 'test');
    return { objectql, captured };
  }

  async function create(objectql: ObjectQL, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const dropped: any[] = [];
    await objectql.insert('stamp_note', payload, {
      context: { userId: REAL_USER },
      onFieldsDropped: (e: any) => dropped.push(e),
      ...extra,
    } as any);
    return dropped;
  }

  it('a forged created_by is stored as the stamp and reported, under reason readonly', async () => {
    const { objectql, captured } = await boot();
    const dropped = await create(objectql, { title: 'a', created_by: 'forged_user' });
    expect(captured.at(-1)!.created_by).toBe(REAL_USER);
    expect(dropped).toEqual([{ object: 'stamp_note', fields: ['created_by'], reason: 'readonly' }]);
  });

  it('CONTROL: created_by sent equal to the stamp adds no row', async () => {
    const { objectql, captured } = await boot();
    const dropped = await create(objectql, { title: 'b', created_by: REAL_USER });
    expect(captured.at(-1)!.created_by).toBe(REAL_USER);
    expect(dropped).toEqual([]);
  });

  it('it rides the same event as the strip\'s own drops, one event per reason', async () => {
    const { objectql } = await boot();
    const dropped = await create(objectql, { title: 'c', created_by: 'forged_user', organization_id: 'org_forged' });
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe('readonly');
    expect([...dropped[0].fields].sort()).toEqual(['created_by', 'organization_id']);
  });

  it('a partial-mode batch carries it on the row that sent it, and only that row', async () => {
    const { objectql } = await boot();
    const outcomes: any = await objectql.insertMany(
      'stamp_note',
      [{ title: 'd1', created_by: 'forged_user' }, { title: 'd2', created_by: REAL_USER }, { title: 'd3' }],
      { context: { userId: REAL_USER } } as any,
    );
    expect(outcomes.map((o: any) => o.ok)).toEqual([true, true, true]);
    expect(outcomes[0].droppedFields).toEqual([{ object: 'stamp_note', fields: ['created_by'], reason: 'readonly' }]);
    expect(outcomes[1].droppedFields).toBeUndefined();
    expect(outcomes[2].droppedFields).toBeUndefined();
  });

  it('strictReadonlyWrites still stores the stamp rather than refusing: the report is not a refusal', async () => {
    const { objectql, captured } = await boot();
    const dropped = await create(objectql, { title: 'e', created_by: 'forged_user' }, { strictReadonlyWrites: true });
    expect(captured.at(-1)!.created_by).toBe(REAL_USER);
    expect(dropped.flatMap((d) => d.fields)).toEqual(['created_by']);
  });

  it('a historical import (preserveAudit) keeps the caller\'s created_by and reports nothing', async () => {
    const { objectql, captured } = await boot();
    const dropped: any[] = [];
    await objectql.insert('stamp_note', { title: 'f', created_by: 'legacy_user' }, {
      context: { userId: REAL_USER, preserveAudit: true },
      onFieldsDropped: (e: any) => dropped.push(e),
    } as any);
    expect(captured.at(-1)!.created_by).toBe('legacy_user');
    expect(dropped).toEqual([]);
  });

  describe('owning_business_unit_id (no stamp: the static strip takes and reports it)', () => {
    it('a forged value is not stored and is reported', async () => {
      const { objectql, captured } = await boot();
      const dropped = await create(objectql, { title: 'g', owning_business_unit_id: 'bu_forged' });
      expect(captured.at(-1)!.owning_business_unit_id).toBeUndefined();
      expect(dropped).toEqual([{ object: 'stamp_note', fields: ['owning_business_unit_id'], reason: 'readonly' }]);
    });

    it('CONTROL: a create that does not send it reports nothing', async () => {
      const { objectql } = await boot();
      expect(await create(objectql, { title: 'h' })).toEqual([]);
    });
  });
});
