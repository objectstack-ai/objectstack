// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23618] The record lock's per-row refusal names the record by a title the
 * WRITER may be served, or by the object's label alone.
 *
 * ## The contract
 *
 * The refusal (`RECORD_LOCKED`, #18153) names the record from the engine's
 * update pre-image (`ctx.previous`). That pre-image is the row as STORED — a raw
 * driver read (`readUpdatePriorRow` in `@objectstack/objectql`), shaped to the
 * declared columns and narrowed by no caller's field-level security. The
 * sentence is served to the writer, so it answers to the rule every other
 * approval-path title answers to (`payload-redaction.ts`, #10749: keyed on the
 * caller): the served-fields answer (`resolveReadableSnapshotFields`, readable
 * and not masked for this caller), asked as the writer, with the writer's own
 * execution envelope — the one riding on the operation — never one rebuilt from
 * the hook session. A display field the writer may not be served gives no
 * title: the sentence degrades to the object's label, ⛔ never to the id.
 *
 * ## What this pins
 *
 * Driven end to end — real `ObjectQL`, real sqlite driver, the real
 * `beforeUpdate` hook — with a field-visibility source in place of
 * `plugin-security`'s:
 *
 *  (a) a writer who may not read the display field is refused without the
 *      title, on a by-id write and on a predicate write (the per-row dispatch);
 *  (a-masked) a display field served MASKED to the writer is withheld the same
 *      way (#20964);
 *  (b) the control: a writer who may read the field is told the title;
 *  (c) one ask per refusal, made with the writer's own envelope, and none for
 *      a write the lock does not refuse.
 *
 * `RECORD_LOCKED` / 409 is asserted on every refusal: the wire vocabulary does
 * not move (ADR-0112).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { bindApprovalLockHook } from './lifecycle-hooks.js';
import type { FieldVisibilitySource } from './payload-redaction.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
/** The writer's envelope carries `permissions`, which the hook session does not. */
const asUser = (userId: string) => ({ userId, positions: [], permissions: [`grant_${userId}`] }) as any;

/** May not read the display field. */
const RESTRICTED = 'u_restricted';
/** Served the display field MASKED: readable, not queryable (#20964). */
const MASKED = 'u_masked';
/** May read every field (the control). */
const WRITER = 'u_writer';

const TITLE = 'Acme secret renewal';
const LOCKED_SENTENCE = 'is locked while an approval is in progress, and cannot be edited until that approval is complete';

const OPPORTUNITY = {
  name: 'opportunity',
  label: 'Opportunity',
  nameField: 'name',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
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

const ALL = ['id', 'name', 'amount', 'approval_status'];
/** writer → [readable, queryable] on `opportunity`. */
const ANSWERS: Record<string, [string[], string[]]> = {
  [RESTRICTED]: [['id', 'amount', 'approval_status'], ['id', 'amount', 'approval_status']],
  [MASKED]: [ALL, ['id', 'amount', 'approval_status']],
  [WRITER]: [ALL, ALL],
};

interface Ask { object: string; userId?: string; permissions?: unknown }

/** Stands in for `plugin-security`: the system context reads every field, as its `isSystem` bypass does. */
function makeVisibility(): FieldVisibilitySource & { calls: Ask[] } {
  const calls: Ask[] = [];
  const answer = (context: any, which: 0 | 1) => {
    if (context?.isSystem) return ALL;
    return ANSWERS[String(context?.userId ?? '')]?.[which] ?? [];
  };
  return {
    calls,
    async getReadableFields(object: string, context?: any) {
      calls.push({ object, userId: context?.userId, permissions: context?.permissions });
      return answer(context, 0);
    },
    async getQueryableFields(_object: string, context?: any) {
      return answer(context, 1);
    },
  };
}

describe('[#23618] the RECORD_LOCKED refusal names the record from what its writer may read', () => {
  let engine: ObjectQL;
  let vis: ReturnType<typeof makeVisibility>;
  let lockedId: string;
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
    for (const o of [OPPORTUNITY, APPROVAL_REQUEST]) {
      engine.registry.registerObject(o as any, 'com.objectstack.test.23618');
    }
    await engine.syncSchemas();

    lockedId = String((await engine.insert('opportunity', { name: TITLE, amount: 100 }, { context: SYSTEM } as any)).id);
    freeId = String((await engine.insert('opportunity', { name: 'Unlocked deal', amount: 5 }, { context: SYSTEM } as any)).id);
    await engine.insert('sys_approval_request', {
      object_name: 'opportunity', record_id: lockedId, status: 'pending', flow_run_id: 'run_1',
      node_config_json: JSON.stringify({ lockRecord: true, approvalStatusField: 'approval_status' }),
    }, { context: SYSTEM } as any);

    vis = makeVisibility();
    bindApprovalLockHook(engine as any, { warn: () => {}, info: () => {} }, () => vis);
  });

  async function refusal(writer: string, options: Record<string, unknown> = { where: { id: lockedId } }): Promise<any> {
    let thrown: any = null;
    try {
      await engine.update('opportunity', { amount: 999 }, { ...options, context: asUser(writer) } as any);
    } catch (e) { thrown = e; }
    expect(thrown, `${writer} was not refused`).not.toBeNull();
    expect(thrown.code).toBe('RECORD_LOCKED');
    expect(thrown.statusCode).toBe(409);
    return thrown;
  }

  it('(a) a writer who may not read the display field is refused without the title — by-id write', async () => {
    const thrown = await refusal(RESTRICTED);
    expect(thrown.message).toBe(`RECORD_LOCKED: This Opportunity ${LOCKED_SENTENCE}`);
    expect(thrown.message).not.toContain(TITLE);
    expect(thrown.message).not.toContain(lockedId);
  });

  it('(a) …and on a predicate write, where the hook runs once per matched row', async () => {
    const thrown = await refusal(RESTRICTED, { where: { amount: 100 }, multi: true });
    expect(thrown.message).toBe(`RECORD_LOCKED: This Opportunity ${LOCKED_SENTENCE}`);
    expect(thrown.message).not.toContain(TITLE);
  });

  it('(a-masked) a display field served MASKED to the writer is withheld the same way (#20964)', async () => {
    const thrown = await refusal(MASKED);
    expect(thrown.message).toBe(`RECORD_LOCKED: This Opportunity ${LOCKED_SENTENCE}`);
    expect(thrown.message).not.toContain(TITLE);
  });

  it('(b) control: a writer who may read the display field is told the title', async () => {
    const thrown = await refusal(WRITER);
    expect(thrown.message).toBe(`RECORD_LOCKED: Opportunity '${TITLE}' ${LOCKED_SENTENCE}`);
  });

  it('(c) one ask per refusal, with the writer\'s own envelope — and none for a write the lock does not refuse', async () => {
    vis.calls.length = 0;
    await engine.update('opportunity', { amount: 6 }, { where: { id: freeId }, context: asUser(RESTRICTED) } as any);
    expect(vis.calls).toEqual([]);

    await refusal(RESTRICTED);
    expect(vis.calls).toEqual([{ object: 'opportunity', userId: RESTRICTED, permissions: [`grant_${RESTRICTED}`] }]);
  });
});
