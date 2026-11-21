// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The DETAIL-ROW lock (ruling A on the record-page edit card, 「一起锁」): while
 * a master record is held by a locking pending approval, its master-detail rows
 * refuse insert, update and delete with `RECORD_LOCKED` — driven through the
 * REAL hook, a real {@link ObjectQL} and a real sqlite driver (the rig of
 * `record-lock-batch-row-status.integration.test.ts`), so every write shape
 * below is the engine's own dispatch, not fixture code.
 *
 * Each refusal cell sits beside its control: the same write under a master no
 * approval holds, the system write, the opening run, and a `lockRecord: false`
 * node all still land.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { bindDetailRowLockHook, bindRecordDeleteCancelHook } from './lifecycle-hooks.js';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { installDefaultOrganization } from './default-organization.testkit.js';

const opportunity = {
  name: 'opportunity',
  label: 'Opportunity',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
  },
};

const lineItem = {
  name: 'opportunity_line',
  label: 'Opportunity Line',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    product: { name: 'product', type: 'text' as const },
    quantity: { name: 'quantity', type: 'number' as const },
    opportunity: { name: 'opportunity', type: 'master_detail' as const, reference: 'opportunity' },
  },
};

/** A plain lookup child: the lock does NOT reach it (ruling A names master-detail rows). */
const note = {
  name: 'opportunity_note',
  label: 'Opportunity Note',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    body: { name: 'body', type: 'text' as const },
    opportunity: { name: 'opportunity', type: 'lookup' as const, reference: 'opportunity' },
  },
};

const approvalRequest = {
  name: 'sys_approval_request',
  label: 'Approval Request',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    object_name: { name: 'object_name', type: 'text' as const },
    record_id: { name: 'record_id', type: 'text' as const },
    status: { name: 'status', type: 'text' as const },
    flow_run_id: { name: 'flow_run_id', type: 'text' as const },
    node_config_json: { name: 'node_config_json', type: 'text' as const },
  },
};

const SYSTEM = { context: { isSystem: true } } as any;
const USER = { context: { userId: 'u1' } } as any;

async function refusal(write: () => Promise<unknown>): Promise<any> {
  try {
    await write();
  } catch (err) {
    return err;
  }
  return null;
}

describe('ruling A — a locked master\'s detail rows refuse insert / update / delete', () => {
  let engine: ObjectQL;
  let lockedId: string;
  let freeId: string;
  let openNodeId: string;
  let lineOfLocked: string;
  let lineOfFree: string;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const o of [opportunity, lineItem, note, approvalRequest]) {
      engine.registry.registerObject(o as any, 'com.objectstack.test.detail-row-lock');
    }
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    lockedId = String((await engine.insert('opportunity', { name: 'Locked deal' }, SYSTEM)).id);
    freeId = String((await engine.insert('opportunity', { name: 'Free deal' }, SYSTEM)).id);
    openNodeId = String((await engine.insert('opportunity', { name: 'Open-node deal' }, SYSTEM)).id);
    lineOfLocked = String((await engine.insert('opportunity_line', { product: 'A', quantity: 1, opportunity: lockedId }, SYSTEM)).id);
    lineOfFree = String((await engine.insert('opportunity_line', { product: 'B', quantity: 1, opportunity: freeId }, SYSTEM)).id);
    await engine.insert('sys_approval_request', {
      object_name: 'opportunity',
      record_id: lockedId,
      status: 'pending',
      flow_run_id: 'run_open',
      node_config_json: JSON.stringify({ lockRecord: true }),
    }, SYSTEM);
    await engine.insert('sys_approval_request', {
      object_name: 'opportunity',
      record_id: openNodeId,
      status: 'pending',
      flow_run_id: 'run_other',
      node_config_json: JSON.stringify({ lockRecord: false }),
    }, SYSTEM);

    bindDetailRowLockHook(engine as any);
  });

  const expectLocked = (err: any) => {
    expect(err).not.toBeNull();
    expect(err.code).toBe('RECORD_LOCKED');
    expect(err.statusCode).toBe(409);
    // The master is named by its label, never by its id or API name.
    expect(err.userMessage).toBe(
      'This Opportunity is locked while an approval is in progress, and cannot be edited until that approval is complete',
    );
  };

  it('insert under a locked master is refused; under a free master it lands (CONTROL)', async () => {
    expectLocked(await refusal(() => engine.insert('opportunity_line', { product: 'C', quantity: 2, opportunity: lockedId }, USER)));
    const created = await engine.insert('opportunity_line', { product: 'C', quantity: 2, opportunity: freeId }, USER);
    expect(created?.id).toBeTruthy();
    const underLocked = await engine.find('opportunity_line', { where: { opportunity: lockedId }, context: { isSystem: true } } satisfies EngineQueryOptions);
    expect(underLocked).toHaveLength(1);
  });

  it('a non-scalar FK naming a locked master ({ id }) fails closed: refused, nothing lands', async () => {
    expectLocked(await refusal(() => engine.insert('opportunity_line', { product: 'D', quantity: 1, opportunity: { id: lockedId } }, USER)));
    const lines = await engine.find('opportunity_line', { where: { product: 'D' }, context: { isSystem: true } } satisfies EngineQueryOptions);
    expect(lines).toHaveLength(0);
  });

  it('update of a locked master\'s row is refused and nothing lands; a free master\'s row updates (CONTROL)', async () => {
    expectLocked(await refusal(() => engine.update('opportunity_line', { quantity: 9 }, { where: { id: lineOfLocked }, ...USER })));
    expect((await engine.findOne('opportunity_line', { where: { id: lineOfLocked } }))?.quantity).toBe(1);
    await engine.update('opportunity_line', { quantity: 9 }, { where: { id: lineOfFree }, ...USER });
    expect((await engine.findOne('opportunity_line', { where: { id: lineOfFree } }))?.quantity).toBe(9);
  });

  it('delete of a locked master\'s row is refused; a free master\'s row deletes (CONTROL)', async () => {
    expectLocked(await refusal(() => engine.delete('opportunity_line', { where: { id: lineOfLocked }, ...USER })));
    expect(await engine.findOne('opportunity_line', { where: { id: lineOfLocked } })).toBeTruthy();
    await engine.delete('opportunity_line', { where: { id: lineOfFree }, ...USER });
    expect(await engine.findOne('opportunity_line', { where: { id: lineOfFree } })).toBeFalsy();
  });

  it('reparent is checked at both ends: into a locked master and out of one are both refused', async () => {
    expectLocked(await refusal(() => engine.update('opportunity_line', { opportunity: lockedId }, { where: { id: lineOfFree }, ...USER })));
    expectLocked(await refusal(() => engine.update('opportunity_line', { opportunity: freeId }, { where: { id: lineOfLocked }, ...USER })));
    expect((await engine.findOne('opportunity_line', { where: { id: lineOfFree } }))?.opportunity).toBe(freeId);
    expect((await engine.findOne('opportunity_line', { where: { id: lineOfLocked } }))?.opportunity).toBe(lockedId);
  });

  it('a predicate (multi-row) write touching a locked master\'s row is refused', async () => {
    expectLocked(await refusal(() => engine.update(
      'opportunity_line',
      { quantity: 5 },
      { where: { quantity: 1 }, multi: true, ...USER } as any,
    )));
    expectLocked(await refusal(() => engine.delete(
      'opportunity_line',
      { where: { quantity: 1 }, multi: true, ...USER } as any,
    )));
    expect(await engine.find('opportunity_line', { where: { quantity: 1 }, context: { isSystem: true } } satisfies EngineQueryOptions)).toHaveLength(2);
  });

  it('the batch path (one transaction): a refused row rolls the whole transaction back', async () => {
    const err = await refusal(() => engine.transaction(async (trx: any) => {
      await engine.update('opportunity_line', { quantity: 7 }, { where: { id: lineOfFree }, context: { ...trx, userId: 'u1' } } as any);
      await engine.insert('opportunity_line', { product: 'D', quantity: 1, opportunity: lockedId }, { context: { ...trx, userId: 'u1' } } as any);
    }, { userId: 'u1' } as any, { require: true } as any));
    expectLocked(err);
    expect((await engine.findOne('opportunity_line', { where: { id: lineOfFree } }))?.quantity).toBe(1);
  });

  it('CONTROL — a system write is exempt', async () => {
    await engine.update('opportunity_line', { quantity: 3 }, { where: { id: lineOfLocked }, ...SYSTEM });
    expect((await engine.findOne('opportunity_line', { where: { id: lineOfLocked } }))?.quantity).toBe(3);
  });

  it('CONTROL — the run that opened the approval is exempt; another run is not', async () => {
    const run = (flowRunId: string) => ({ context: { runAs: 'user', userId: 'u1', flowRunId } }) as any;
    expectLocked(await refusal(() => engine.update('opportunity_line', { quantity: 4 }, { where: { id: lineOfLocked }, ...run('run_stranger') })));
    await engine.update('opportunity_line', { quantity: 4 }, { where: { id: lineOfLocked }, ...run('run_open') });
    expect((await engine.findOne('opportunity_line', { where: { id: lineOfLocked } }))?.quantity).toBe(4);
  });

  it('CONTROL — a `lockRecord: false` node does not hold the rows', async () => {
    const created = await engine.insert('opportunity_line', { product: 'E', quantity: 1, opportunity: openNodeId }, USER);
    expect(created?.id).toBeTruthy();
  });

  it('CONTROL — a lookup child of a locked record is not a detail row and is not held', async () => {
    const created = await engine.insert('opportunity_note', { body: 'hi', opportunity: lockedId }, USER);
    expect(created?.id).toBeTruthy();
  });
});

/**
 * Deleting the locked record ITSELF is not refused — the delete lands and its
 * pending request is cancelled (the delete-cancel linkage) — and a
 * `master_detail` cascades, so that delete removes the record's lines through
 * the detail-row lock as the caller. The cascade leg of the held master's own
 * delete yields; a cascade from any OTHER record into a held line does not.
 */
describe('a locked record\'s lines are locked with it — deleting the record itself still lands', () => {
  let engine: ObjectQL;
  let lockedId: string;
  let productId: string;
  const cancelled: string[] = [];

  /** A second cascade-capable relation: deleting the product would cascade into its lines. */
  const product = {
    name: 'product',
    label: 'Product',
    fields: {
      id: { name: 'id', type: 'text' as const, primaryKey: true },
      name: { name: 'name', type: 'text' as const },
    },
  };
  const bundleLine = {
    name: 'bundle_line',
    label: 'Bundle Line',
    fields: {
      id: { name: 'id', type: 'text' as const, primaryKey: true },
      opportunity: { name: 'opportunity', type: 'master_detail' as const, reference: 'opportunity' },
      product: { name: 'product', type: 'lookup' as const, reference: 'product', deleteBehavior: 'cascade' as const },
    },
  };

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  beforeEach(async () => {
    cancelled.length = 0;
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const o of [opportunity, lineItem, product, bundleLine, approvalRequest]) {
      engine.registry.registerObject(o as any, 'com.objectstack.test.detail-row-lock');
    }
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    lockedId = String((await engine.insert('opportunity', { name: 'Locked deal' }, SYSTEM)).id);
    productId = String((await engine.insert('product', { name: 'Widget' }, SYSTEM)).id);
    await engine.insert('opportunity_line', { product: 'A', quantity: 1, opportunity: lockedId }, SYSTEM);
    await engine.insert('opportunity_line', { product: 'B', quantity: 2, opportunity: lockedId }, SYSTEM);
    await engine.insert('bundle_line', { opportunity: lockedId, product: productId }, SYSTEM);
    await engine.insert('sys_approval_request', {
      object_name: 'opportunity',
      record_id: lockedId,
      status: 'pending',
      flow_run_id: 'run_open',
      node_config_json: JSON.stringify({ lockRecord: true }),
    }, SYSTEM);

    bindDetailRowLockHook(engine as any);
    bindRecordDeleteCancelHook(engine as any, {
      cancelForDeletedRecord: async (objectName: string, recordId: string) => {
        cancelled.push(`${objectName}:${recordId}`);
        return { cancelled: [], suspendedRuns: [] };
      },
    });
  });

  const linesOf = async (object: string, opp: string) =>
    engine.find(object, { where: { opportunity: opp }, context: { isSystem: true } } satisfies EngineQueryOptions);

  it('the held record is deleted with its lines by the caller, and its pending request is cancelled', async () => {
    // The bundle line carries a second cascading relation, so it is not this case's: clear it first.
    await engine.delete('bundle_line', { where: { opportunity: lockedId }, multi: true, ...SYSTEM } as any);
    expect(await refusal(() => engine.delete('opportunity', { where: { id: lockedId }, ...USER }))).toBeNull();
    expect(await engine.findOne('opportunity', { where: { id: lockedId } })).toBeFalsy();
    expect(await linesOf('opportunity_line', lockedId)).toHaveLength(0);
    expect(cancelled).toContain(`opportunity:${lockedId}`);
  });

  it('CONTROL — the caller\'s own delete of one of those lines is still refused', async () => {
    const [first] = await linesOf('opportunity_line', lockedId);
    const err: any = await refusal(() => engine.delete('opportunity_line', { where: { id: first.id }, ...USER }));
    expect(err?.code).toBe('RECORD_LOCKED');
    expect(err?.statusCode).toBe(409);
    expect(await linesOf('opportunity_line', lockedId)).toHaveLength(2);
  });

  it('deleting a DIFFERENT record whose cascade would remove a held line is refused, and nothing is removed', async () => {
    const err: any = await refusal(() => engine.delete('product', { where: { id: productId }, ...USER }));
    expect(err?.code).toBe('RECORD_LOCKED');
    expect(err?.statusCode).toBe(409);
    expect(await engine.findOne('product', { where: { id: productId } })).toBeTruthy();
    expect(await linesOf('bundle_line', lockedId)).toHaveLength(1);
  });
});
