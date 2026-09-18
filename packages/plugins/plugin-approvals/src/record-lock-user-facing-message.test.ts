// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18153] The record lock's per-row refusal is END-USER copy — pinned as such,
 * and pinned APART from the three operator-facing refusals beside it.
 *
 * ## What the card was
 *
 * A record held by a live approval refused the write with
 * `record '<id>' of '<apiName>' is locked while an approval is in progress`.
 * The console toast copies that sentence verbatim, so an end user read an
 * opaque primary key and a machine identifier, and a deny-path toast is exactly
 * the string that reaches screenshots, screen recordings and support tickets.
 *
 * ## The three pins, and why each is here
 *
 * 1. **The user-facing half.** Driven end to end — real {@link ObjectQL}, real
 *    sqlite driver, the real `beforeUpdate` hook — because the defect was about
 *    the string a real refusal produces, not about a helper in isolation. The
 *    assertion is stated as an ABSENCE (no record id, no object API name in the
 *    body) as well as a presence, because the presence alone would stay green
 *    on a sentence that named the record correctly and then appended the id.
 *
 * 2. **The three operator refusals, unchanged.** The cap refusals and the
 *    unanswerable-intersection refusal are raised about a WRITE SHAPE, and
 *    naming the object's API name there is the useful thing to say. The card
 *    ruled them out of scope; this pins that, so a later "harmonise the lock's
 *    messages" sweep goes red instead of quietly sweeping them into the
 *    end-user shape. They are driven through a FAKE engine rather than the real
 *    rig on purpose: two of the three need more than {@link PENDING_LOCK_LIMIT}
 *    locked rows and the third needs the engine's own read to fail, and neither
 *    is a state a sqlite fixture should be bent into to assert a string.
 *
 * 3. **`RECORD_LOCKED` / 409, both directions.** The card moved the human
 *    sentence only; the wire vocabulary is contract (ADR-0112) and the 409 is
 *    pinned across the batch-row protocol surfaces. Both directions means: the
 *    code and status are asserted to BE those values, and the `CODE: message`
 *    envelope is asserted to still be the envelope — a rewording that reached
 *    either would be a widening, not a copy fix.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { bindApprovalLockHook, APPROVALS_HOOK_PACKAGE } from './lifecycle-hooks.js';

const OPPORTUNITY = {
  name: 'opportunity',
  label: 'Opportunity',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    approval_status: { name: 'approval_status', type: 'text' as const },
  },
};

/** Same shape, no title-eligible field at all — the degradation leg. */
const LEDGER_ENTRY = {
  name: 'ledger_entry',
  label: 'Ledger Entry',
  nameField: 'id',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    amount: { name: 'amount', type: 'number' as const },
    approval_status: { name: 'approval_status', type: 'text' as const },
  },
};

const APPROVAL_REQUEST = {
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

const NODE_CONFIG = JSON.stringify({ lockRecord: true, approvalStatusField: 'approval_status' });

describe('[#18153] the per-row refusal is user-facing copy', () => {
  let engine: ObjectQL;
  let opportunityId: string;
  let ledgerId: string;

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
    // `packageId` is REQUIRED by `registerObject` — passed rather than elided so
    // this file adds no raw `tsc` error to the package's TEST_DEBT ledger.
    for (const o of [OPPORTUNITY, LEDGER_ENTRY, APPROVAL_REQUEST]) {
      engine.registry.registerObject(o as any, 'com.objectstack.test.18153');
    }
    await engine.syncSchemas();

    opportunityId = String((await engine.insert('opportunity', { name: 'Acme renewal', amount: 100 })).id);
    ledgerId = String((await engine.insert('ledger_entry', { amount: 100 })).id);
    for (const [object, recordId] of [['opportunity', opportunityId], ['ledger_entry', ledgerId]] as const) {
      await engine.insert('sys_approval_request', {
        object_name: object, record_id: recordId, status: 'pending',
        flow_run_id: 'run_1', node_config_json: NODE_CONFIG,
      }, { context: { isSystem: true } } as any);
    }

    bindApprovalLockHook(engine as any);
  });

  async function refusal(object: string, id: string): Promise<any> {
    let thrown: any = null;
    try {
      await engine.update(object, { amount: 999 }, { where: { id } } as any);
    } catch (e) { thrown = e; }
    expect(thrown).not.toBeNull();
    return thrown;
  }

  it('names the record by its label and leaks neither the id nor the API name', async () => {
    const thrown = await refusal('opportunity', opportunityId);

    expect(thrown.message).toBe(
      "RECORD_LOCKED: Opportunity 'Acme renewal' is locked while an approval is in progress, " +
      'and cannot be edited until that approval is complete',
    );
    // Stated as an absence too: a sentence that named the record correctly and
    // then appended the id would satisfy the equality above only by accident,
    // and these two are what the card actually asked for.
    expect(thrown.message).not.toContain(opportunityId);
    expect(thrown.message).not.toContain(OPPORTUNITY.name);
  });

  it('degrades to the object label — ⛔ never back to the id — when no title resolves', async () => {
    // `nameField: 'id'` is the pointer a title-less object ends up with, and it
    // is exactly the shape that would re-introduce the defect if the resolver
    // trusted the pointer.
    const thrown = await refusal('ledger_entry', ledgerId);

    expect(thrown.message).toBe(
      'RECORD_LOCKED: This Ledger Entry is locked while an approval is in progress, ' +
      'and cannot be edited until that approval is complete',
    );
    expect(thrown.message).not.toContain(ledgerId);
    expect(thrown.message).not.toContain(LEDGER_ENTRY.name);
  });

  it('keeps the id and the API name reachable on the CONSOLE for support', async () => {
    engine.unregisterHooksByPackage(APPROVALS_HOOK_PACKAGE);
    const info: string[] = [];
    bindApprovalLockHook(engine as any, { warn: () => {}, info: (m: any) => info.push(String(m)) });

    await refusal('opportunity', opportunityId);

    // The card's own remedy: "moved to the console … not simply deleted if a
    // support path still needs them".
    expect(info.some((line) => line.includes(opportunityId) && line.includes('opportunity'))).toBe(true);
  });

  it('pins `RECORD_LOCKED` and 409 in both directions', async () => {
    const thrown = await refusal('opportunity', opportunityId);

    expect(thrown.code).toBe('RECORD_LOCKED');
    expect(thrown.statusCode).toBe(409);
    // The other direction: the wire vocabulary did not acquire a second
    // spelling, and the `CODE: message` envelope is still the envelope.
    expect(thrown.status).toBeUndefined();
    expect(String(thrown.message).startsWith('RECORD_LOCKED: ')).toBe(true);
  });
});

/**
 * CONTROL — the three operator-facing refusals, byte for byte.
 *
 * A fake engine, because these three are reached by write SHAPES, not by record
 * states: two need more locked rows than {@link PENDING_LOCK_LIMIT} and the
 * third needs the intersection read to throw. Each refusal is driven through
 * the REAL handler `bindApprovalLockHook` registers.
 */
describe('[#18153] CONTROL — the operator-facing refusals are untouched', () => {
  const LIMIT = 1_000;

  /** Captures the handler the real binder registers, then drives it directly. */
  function bindAgainst(find: (object: string, args: any) => Promise<any[]>) {
    let handler!: (ctx: any) => Promise<void>;
    bindApprovalLockHook({
      registerHook: (_event: string, h: any) => { handler = h; },
      unregisterHooksByPackage: () => 0,
      find: find as any,
    } as any);
    return handler;
  }

  async function refusalFrom(handler: (ctx: any) => Promise<void>, ctx: any): Promise<any> {
    let thrown: any = null;
    try { await handler(ctx); } catch (e) { thrown = e; }
    expect(thrown).not.toBeNull();
    return thrown;
  }

  it('the named-id cap refusal still names the object', async () => {
    const handler = bindAgainst(async () => []);
    const ids = Array.from({ length: LIMIT + 1 }, (_v, i) => `r${i}`);

    const thrown = await refusalFrom(handler, {
      object: 'leave_request',
      input: { id: { $in: ids }, data: { amount: 1 } },
    });

    expect(thrown.message).toBe(
      `RECORD_LOCKED: refusing to authorize an update naming more than ${LIMIT} records of 'leave_request' — ` +
      'the approval lock cannot check them row by row; scope the write',
    );
    expect(thrown.code).toBe('RECORD_LOCKED');
    expect(thrown.statusCode).toBe(409);
  });

  it('the predicate cap refusal still names the object', async () => {
    const pending = Array.from({ length: LIMIT + 1 }, (_v, i) => ({ record_id: `r${i}`, status: 'pending' }));
    const handler = bindAgainst(async () => pending);

    const thrown = await refusalFrom(handler, {
      object: 'leave_request',
      input: { data: { amount: 1 }, options: { where: { status: 'draft' } } },
    });

    expect(thrown.message).toBe(
      `RECORD_LOCKED: refusing a predicate update on 'leave_request': more than ${LIMIT} of its records carry a ` +
      'pending approval, so the lock cannot decide row by row; scope the write to the rows you mean',
    );
    expect(thrown.code).toBe('RECORD_LOCKED');
    expect(thrown.statusCode).toBe(409);
  });

  it('the unanswerable-intersection refusal still names the object', async () => {
    const handler = bindAgainst(async (object: string) => {
      if (object === 'sys_approval_request') return [{ record_id: 'r1', status: 'pending' }];
      throw new Error('driver exploded');
    });

    const thrown = await refusalFrom(handler, {
      object: 'leave_request',
      input: { data: { amount: 1 }, options: { where: { status: 'draft' } } },
    });

    expect(thrown.message).toBe(
      "RECORD_LOCKED: cannot determine which rows a predicate update on 'leave_request' would touch " +
      '(driver exploded); 1 record(s) of it carry a pending approval, so the write is refused',
    );
    expect(thrown.code).toBe('RECORD_LOCKED');
    expect(thrown.statusCode).toBe(409);
  });
});
