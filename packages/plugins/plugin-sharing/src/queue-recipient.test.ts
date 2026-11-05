// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D7] A sharing rule whose recipient is a queue grants the rule's
 * matched records to the queue's members, through the one expander, in the
 * rule's organization. Absent a queue service, it grants nobody.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import { OwnershipQueueService } from './ownership-queue-service.js';

interface Row { [k: string]: any }

const SYS = { isSystem: true, positions: [], permissions: [] } as any;

function matches(row: Row, f: any): boolean {
  if (!f || typeof f !== 'object') return true;
  // A combinator is CONJOINED with its sibling field keys, never a
  // short-circuit that returns before they are read (#7676): `listRules`
  // composes `{object_name, active, $or:[…org scope…]}`, and a matcher that
  // returned on the `$or` alone would match the whole table here while
  // driver-sql and driver-memory conjoin the two. A fake looser than the
  // contract it stands in for is how a green suite ships a broken filter.
  if (Array.isArray(f.$or) && !f.$or.some((x: any) => matches(row, x))) return false;
  if (Array.isArray(f.$and) && !f.$and.every((x: any) => matches(row, x))) return false;
  for (const [k, v] of Object.entries(f)) {
    if (k === '$or' || k === '$and') continue;
    const rv = row[k];
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      const op: any = v;
      if ('$in' in op) { if (!op.$in.includes(rv)) return false; continue; }
      // `descendants()` filters children with `active: { $ne: false }`, so an
      // undefined `active` must PASS — the graph treats absent as active.
      if ('$ne' in op) { if (rv === op.$ne) return false; continue; }
      if ('$gte' in op) { if (!(rv >= op.$gte)) return false; continue; }
    }
    if (rv !== v) return false;
  }
  return true;
}

function makeEngine() {
  const tables: Record<string, Row[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  /** Tables whose reads fail, as an outage of that table does (#29604). */
  const failing = new Set<string>();
  let seq = 0;
  return {
    _tables: tables,
    failing,
    getSchema() { return undefined; },
    seed(object: string, rows: Row[]) { ensure(object).push(...rows.map((r) => ({ ...r }))); },
    async find(o: string, opts?: any) {
      if (failing.has(o)) throw new Error(`${o} unavailable`);
      const f = opts?.filter ?? opts?.where;
      return ensure(o).filter((r) => matches(r, f)).slice(0, opts?.limit ?? 10000);
    },
    async insert(o: string, data: any) {
      const row = { id: data.id ?? `${o}_${++seq}`, ...data };
      ensure(o).push(row);
      return row;
    },
    // Both write verbs open with the PRODUCER's own dispatch predicate
    // (#4550 / #5480 / #6277) rather than a hand-mirrored guard, so a fixture
    // that drifts to a call shape `ObjectQL` would refuse fails loudly here
    // instead of collecting a green from a check that never ran.
    async update(o: string, data: any, options?: any) {
      const verdict = assertEngineUpdateDispatch(data, options);
      const t = ensure(o);
      const targets = verdict.kind === 'by-id'
        ? t.filter((r) => r.id === verdict.id)
        : t.filter((r) => matches(r, options?.where));
      for (const r of targets) Object.assign(r, data);
      return verdict.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    async delete(o: string, opts?: any) {
      assertEngineDeleteDispatch(opts);
      const t = ensure(o);
      const where = opts?.where ?? (opts?.id != null ? { id: opts.id } : {});
      for (let i = t.length - 1; i >= 0; i--) if (matches(t[i], where)) t.splice(i, 1);
      return { ok: true };
    },
  };
}

const RULE = 'billing_reads_invoices';

describe('[ADR-0142 D7] the queue recipient', () => {
  let engine: ReturnType<typeof makeEngine>;
  const granteesOf = (recordId: string): string[] =>
    (engine._tables.sys_record_share ?? [])
      .filter((r) => r.record_id === recordId && r.source === 'rule')
      .map((r) => String(r.recipient_id))
      .sort();

  beforeEach(() => {
    engine = makeEngine();
    engine.seed('invoice', [{ id: 'inv1', status: 'open', owner_id: 'author', organization_id: 'org_a' }]);
    engine.seed('sys_sharing_rule', [{
      id: 'srule_q', organization_id: 'org_a', name: RULE, label: 'Invoices → Billing queue',
      object_name: 'invoice', criteria_json: JSON.stringify({ status: 'open' }),
      recipient_type: 'queue', recipient_id: 'billing', access_level: 'read', active: true,
    }]);
  });

  it('grants each member the expander returns, asked in the rule\'s organization', async () => {
    const expandMembers = vi.fn(async () => ['u_c', 'u_e']);
    const rules = new SharingRuleService({
      engine: engine as any,
      sharing: new SharingService({ engine: engine as any }),
      ownershipQueues: () => ({ expandMembers, isMember: async (u: string) => u === 'u_c' || u === 'u_e' }),
    });
    await rules.evaluateRule(RULE, SYS);
    expect(granteesOf('inv1')).toEqual(['u_c', 'u_e']);
    // [#29604] On the recompute answer: a failed member read refuses, never "nobody".
    expect(expandMembers).toHaveBeenCalledWith('billing', 'org_a', { onFailedRead: 'refuse' });
  });

  it('a member who left loses the grant on the next recompute', async () => {
    let members = ['u_c', 'u_e'];
    const rules = new SharingRuleService({
      engine: engine as any,
      sharing: new SharingService({ engine: engine as any }),
      ownershipQueues: () => ({ expandMembers: async () => members, isMember: async (u: string) => members.includes(u) }),
    });
    await rules.evaluateRule(RULE, SYS);
    members = ['u_c'];
    const [rule] = await rules.listRules({ activeOnly: true }, SYS);
    await rules.revokeRuleGrantsForRetiredRecipients(rule);
    expect(granteesOf('inv1')).toEqual(['u_c']);
  });

  it('with no queue service the rule grants nobody', async () => {
    const rules = new SharingRuleService({ engine: engine as any, sharing: new SharingService({ engine: engine as any }) });
    await rules.evaluateRule(RULE, SYS);
    expect(granteesOf('inv1')).toEqual([]);
  });

  it('defineRule holds a queue recipient to a machine name', async () => {
    const rules = new SharingRuleService({ engine: engine as any, sharing: new SharingService({ engine: engine as any }) });
    await expect(rules.defineRule({
      name: 'bad_queue_rule', label: 'Bad', object: 'invoice', criteria: { status: 'open' },
      recipientType: 'queue', recipientId: 'Billing Team', accessLevel: 'read',
    } as any, SYS)).rejects.toThrow(/machine name/);
  });
});

/**
 * [ADR-0142 D2 as amended, D7; #29604] The grant recompute asks the queue
 * service for its refusal, so a member read that fails leaves the rule's
 * grants as they were — the whole-rule pass, the recipient-axis revoke and the
 * per-user pass alike — where "nobody" revoked every grant behind the failed
 * read. Driven through the registered `OwnershipQueueService` over the same
 * engine, so the refusal is the service's own, not a stub's.
 */
describe('[ADR-0142 D7] a failed queue-member read keeps the queue-recipient rule\'s grants (#29604)', () => {
  let engine: ReturnType<typeof makeEngine>;
  let warn: ReturnType<typeof vi.fn>;
  let rules: SharingRuleService;
  const REFUSAL = /\[queue\] queue 'billing' in organization 'org_a' does not answer its members, because a read behind it failed/;
  const granteesOf = (recordId: string): string[] =>
    (engine._tables.sys_record_share ?? [])
      .filter((r) => r.record_id === recordId && r.source === 'rule')
      .map((r) => String(r.recipient_id))
      .sort();
  const theRule = async () => (await rules.listRules({ activeOnly: true }, SYS))[0];

  beforeEach(async () => {
    engine = makeEngine();
    engine.seed('invoice', [{ id: 'inv1', status: 'open', owner_id: 'author', organization_id: 'org_a' }]);
    engine.seed('sys_sharing_rule', [{
      id: 'srule_q', organization_id: 'org_a', name: RULE, label: 'Invoices → Billing queue',
      object_name: 'invoice', criteria_json: JSON.stringify({ status: 'open' }),
      recipient_type: 'queue', recipient_id: 'billing', access_level: 'read', active: true,
    }]);
    // billing = user u_c + team t_night (u_d).
    engine.seed('sys_queue', [{ id: 'q1', name: 'billing', label: 'Billing', organization_id: 'org_a' }]);
    engine.seed('sys_queue_member', [
      { id: 'qm_1', queue: 'billing', recipient_type: 'user', recipient_id: 'u_c', organization_id: 'org_a' },
      { id: 'qm_2', queue: 'billing', recipient_type: 'team', recipient_id: 't_night', organization_id: 'org_a' },
    ]);
    engine.seed('sys_team_member', [{ id: 'tm_1', team_id: 't_night', user_id: 'u_d' }]);
    warn = vi.fn();
    const logger = { warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const queues = new OwnershipQueueService({ engine: () => engine as any, logger });
    rules = new SharingRuleService({
      engine: engine as any,
      sharing: new SharingService({ engine: engine as any }),
      ownershipQueues: () => queues,
      logger: logger as any,
    });
    await rules.evaluateRule(RULE, SYS);
    expect(granteesOf('inv1')).toEqual(['u_c', 'u_d']);
  });

  it('⛔ the whole-rule pass refuses and revokes nothing — the queue\'s own member rows or a member table', async () => {
    for (const table of ['sys_queue_member', 'sys_team_member']) {
      engine.failing.add(table);
      await expect(rules.evaluateRule(RULE, SYS), table).rejects.toThrow(REFUSAL);
      expect(granteesOf('inv1'), table).toEqual(['u_c', 'u_d']);
      engine.failing.delete(table);
    }
  });

  it('⛔ the recipient-axis revoke refuses and retires nobody', async () => {
    engine.failing.add('sys_team_member');
    await expect(rules.revokeRuleGrantsForRetiredRecipients(await theRule())).rejects.toThrow(REFUSAL);
    expect(granteesOf('inv1')).toEqual(['u_c', 'u_d']);
  });

  it('⛔ the per-user pass refuses for a member it cannot read, and still answers the member it can', async () => {
    engine.failing.add('sys_team_member');
    const rule = await theRule();
    await expect(rules.reconcileRuleForUser(rule, 'u_d')).rejects.toThrow(REFUSAL);
    expect(granteesOf('inv1')).toEqual(['u_c', 'u_d']);
    // u_c is reached by a read that succeeded: a fact, answered as one.
    await expect(rules.reconcileRuleForUser(rule, 'u_c')).resolves.toMatchObject({ grantsRevoked: 0 });
    expect(granteesOf('inv1')).toEqual(['u_c', 'u_d']);
  });

  it('⛔ the record pass keeps the rule\'s grants and reports it, per rule (#29362)', async () => {
    engine.failing.add('sys_team_member');
    await expect(rules.evaluateAllForRecord('invoice', 'inv1', SYS)).resolves.toEqual([]);
    expect(granteesOf('inv1')).toEqual(['u_c', 'u_d']);
    expect(warn.mock.calls.some(([line, meta]) =>
      /record reconcile failed for rule/.test(String(line)) && REFUSAL.test(String((meta as any)?.error)))).toBe(true);
  });

  it('after the refusal, once the read succeeds, the next recompute converges: a member who left loses the grant', async () => {
    engine.failing.add('sys_team_member');
    await expect(rules.evaluateRule(RULE, SYS)).rejects.toThrow(REFUSAL);
    engine.failing.delete('sys_team_member');
    engine._tables.sys_team_member.splice(0);
    await rules.evaluateRule(RULE, SYS);
    expect(granteesOf('inv1')).toEqual(['u_c']);
  });
});
