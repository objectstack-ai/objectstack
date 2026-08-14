// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8570] The record lock's refusal, as a BATCH ROW — driven through the REAL
 * hook, a real {@link ObjectQL} and a real sqlite driver.
 *
 * ## The row this file exists for
 *
 * Measured on the real stack while #8502 was being verified, a bulk update of a
 * record this plugin holds locked answered:
 *
 * ```json
 * { "code": "RECORD_LOCKED", "message": "RECORD_LOCKED: record 'ok1' of 'm8502_task' is locked while an approval is in progress" }
 * ```
 *
 * — a deliberate **409** shipping with no `httpStatus` at all, while sibling
 * rows of the same response carried one. `toRowApiError` read `err.status`, and
 * {@link lockedError} spells its refusal `statusCode`, which is the same
 * single-spelling defect that made `/api/v1/data` answer 500 to this very
 * refusal until #7525.
 *
 * ## Why the pin lives HERE
 *
 * `metadata-protocol` cannot import this plugin, and its own pins therefore
 * stand in for this producer with a double whose shape was measured. This file
 * is the half that needs no double: the error is raised by the actual
 * `beforeUpdate` hook `bindApprovalLockHook` binds, against an actual pending
 * `sys_approval_request` row, and the response row is built by the actual
 * `updateManyData` loop. If the hook ever re-spells its refusal — `.status`,
 * or a plain `Error` — this file goes red where a double would happily keep
 * asserting the old shape.
 *
 * The rig is `record-lock-multi-update.integration.test.ts`'s, for the same
 * reason it gives: the store is better-sqlite3 through `@objectstack/driver-sql`,
 * so the predicates are compiled and executed by the SQL builder rather than by
 * fixture code written by the same author as the assertion.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { resolveThrownHttpError } from '@objectstack/types';
import { bindApprovalLockHook } from './lifecycle-hooks.js';

const opportunity = {
  name: 'opportunity',
  label: 'Opportunity',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    approval_status: { name: 'approval_status', type: 'text' as const },
  },
};

/** The lock hook reads pending requests off this object. */
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

describe('[#8570] a locked record\'s batch row carries the 409 the hook declared', () => {
  let engine: ObjectQL;
  let protocol: any;
  /** Held by a pending approval. */
  let lockedId: string;
  /** Same object, no approval — the row that must still succeed. */
  let freeId: string;

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
    // `packageId` is REQUIRED by `registerObject` — passed rather than elided
    // so this file adds no raw `tsc` error to the package's TEST_DEBT ledger,
    // which is measured with the test layer in the program (the package's own
    // `typecheck` script excludes `**/*.test.ts`, so it cannot see this).
    for (const o of [opportunity, approvalRequest]) {
      engine.registry.registerObject(o as any, 'com.objectstack.test.8570');
    }
    // Real DDL through the real path.
    await engine.syncSchemas();

    lockedId = String((await engine.insert('opportunity', { name: 'Deal', amount: 100 })).id);
    freeId = String((await engine.insert('opportunity', { name: 'Other', amount: 100 })).id);
    await engine.insert('sys_approval_request', {
      object_name: 'opportunity',
      record_id: lockedId,
      status: 'pending',
      flow_run_id: 'run_1',
      node_config_json: JSON.stringify({ lockRecord: true, approvalStatusField: 'approval_status' }),
    }, { context: { isSystem: true } } as any);

    bindApprovalLockHook(engine as any);
    protocol = new ObjectStackProtocolImplementation(engine as any);
  });

  it('the card\'s second row, verbatim, now carrying 409', async () => {
    const res: any = await protocol.updateManyData({
      object: 'opportunity',
      records: [{ id: lockedId, data: { amount: 999 } }],
    });

    expect(res.results[0].success).toBe(false);
    expect(res.results[0].errors[0]).toEqual({
      code: 'RECORD_LOCKED',
      message: `RECORD_LOCKED: record '${lockedId}' of 'opportunity' is locked while an approval is in progress`,
      httpStatus: 409,
    });

    // The refusal was a refusal: nothing reached the store.
    expect((await engine.findOne('opportunity', { where: { id: lockedId } }))?.amount).toBe(100);
  });

  it('the hook really declares its 409 in the `statusCode` spelling ONLY', async () => {
    // Non-vacuity for the row above, taken off the REAL producer rather than
    // asserted about it: if `lockedError` ever grew a `.status`, the row would
    // be green against the pre-#8570 limb too, and this file would stop
    // measuring anything.
    let thrown: any = null;
    try {
      await engine.update('opportunity', { amount: 999 }, { where: { id: lockedId } } as any);
    } catch (e) { thrown = e; }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('RECORD_LOCKED');
    expect(thrown.statusCode).toBe(409);
    expect(thrown.status).toBeUndefined();
    expect(Object.getOwnPropertyNames(thrown)).toEqual(['stack', 'message', 'code', 'statusCode']);
    // The production recogniser, on the real throw — and the field the row's
    // limb reads, which is what separates a declared refusal from a fault.
    expect(resolveThrownHttpError(thrown).declaredStatus).toBe(409);
  });

  it('an unlocked row in the SAME batch still succeeds and carries no error', async () => {
    // The asymmetry the card is about is per-row, so the mixed response is the
    // shape a caller actually has to reconcile.
    const res: any = await protocol.updateManyData({
      object: 'opportunity',
      records: [
        { id: freeId, data: { amount: 555 } },
        { id: lockedId, data: { amount: 999 } },
      ],
      options: { continueOnError: true },
    });

    expect(res.results[0].success).toBe(true);
    expect(res.results[0].errors).toBeUndefined();
    expect(res.results[1].errors[0].httpStatus).toBe(409);
    expect((await engine.findOne('opportunity', { where: { id: freeId } }))?.amount).toBe(555);
  });

  it('the batchData upsert loop answers the same way — not just updateManyData', async () => {
    const res: any = await protocol.batchData({
      object: 'opportunity',
      request: { operation: 'upsert', records: [{ id: lockedId, data: { amount: 999 } }] },
    });

    expect(res.results[0].errors[0].code).toBe('RECORD_LOCKED');
    expect(res.results[0].errors[0].httpStatus).toBe(409);
  });
});
