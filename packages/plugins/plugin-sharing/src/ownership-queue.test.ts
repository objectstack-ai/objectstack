// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D1/D2/D3/D7] The ownership queue in plugin-sharing: the one
 * expander, the sitting-record access path, the authored-table guards and the
 * queue-recipient recompute.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QUEUE_FIELD_DEF } from '@objectstack/spec/data';
import { METADATA_ACTIVATION_TABLE } from '@objectstack/core';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { OwnershipQueueService, specsReadBusinessUnits } from './ownership-queue-service.js';
import { SharingService } from './sharing-service.js';
import {
  bindQueueGuards,
  bindQueueRecipientRecompute,
  recomputeQueueRecipientRules,
  reportShadowedAuthoredQueues,
  QueueValidationError,
  QUEUE_GUARD_PACKAGE,
} from './queue-hooks.js';
import { ruleRegrantQueue } from './rule-hooks.js';

type Row = Record<string, any>;

/**
 * Equality, `$in`, `$or` and `$and` — every predicate shape the queue reads
 * send. Any other combinator or operator is refused rather than misread.
 */
function matches(row: Row, filter: any): boolean {
  if (!filter || typeof filter !== 'object') return true;
  for (const [k, v] of Object.entries(filter)) {
    if (k === '$or') {
      if (!(v as any[]).some((f) => matches(row, f))) return false;
      continue;
    }
    if (k === '$and') {
      if (!(v as any[]).every((f) => matches(row, f))) return false;
      continue;
    }
    if (k.startsWith('$')) throw new Error(`test double: filter combinator '${k}' is not implemented`);
    const rv = row[k] ?? null;
    if (v != null && typeof v === 'object') {
      const ops = Object.keys(v as object);
      if (ops.length !== 1 || ops[0] !== '$in') throw new Error(`test double: operator ${ops.join(',')} on '${k}' is not implemented`);
      if (!(v as any).$in.includes(rv)) return false;
      continue;
    }
    if (rv !== v) return false;
  }
  return true;
}

function makeEngine(opts: {
  declared?: Row[];
  tables?: Record<string, Row[]>;
  schemas?: Record<string, any>;
  failOn?: string[];
} = {}) {
  const tables: Record<string, Row[]> = { ...(opts.tables ?? {}) };
  const hooks: Array<{ event: string; object: string; handler: (ctx: any) => any; packageId?: string }> = [];
  const engine = {
    _tables: tables,
    hooks,
    registry: {
      listItems: (type: string) => (type === 'queue' ? (opts.declared ?? []) : []),
      getObject: (name: string) => (name === METADATA_ACTIVATION_TABLE ? { name } : opts.schemas?.[name]),
    },
    getSchema: (name: string) => opts.schemas?.[name],
    async find(object: string, options?: any) {
      if (opts.failOn?.includes(object)) throw new Error(`${object} unavailable`);
      const filter = options?.filter ?? options?.where;
      const rows = (tables[object] ?? []).filter((r) => matches(r, filter));
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
    async insert(object: string, data: any) {
      (tables[object] ??= []).push({ ...data });
      return data;
    },
    async update(_object: string, data: any, options?: any) {
      assertEngineUpdateDispatch(data, options);
      return {};
    },
    async delete(_object: string, options?: any) {
      assertEngineDeleteDispatch(options);
      return {};
    },
    registerHook(event: string, handler: (ctx: any) => any, o?: { object?: string; packageId?: string }) {
      hooks.push({ event, object: String(o?.object), handler, packageId: o?.packageId });
    },
    unregisterHooksByPackage(packageId: string) {
      const before = hooks.length;
      for (let i = hooks.length - 1; i >= 0; i--) if (hooks[i].packageId === packageId) hooks.splice(i, 1);
      return before - hooks.length;
    },
    async fire(event: string, object: string, ctx: any) {
      for (const h of hooks.filter((x) => x.event === event && x.object === object)) await h.handler(ctx);
    },
  };
  return engine;
}

const SUPPORT_DECLARED = [{ name: 'support_tier1', label: 'Support Tier 1', members: [{ type: 'position', value: 'support_agent' }], _packageId: 'com.acme.support' }];

const BASE_TABLES = (): Record<string, Row[]> => ({
  sys_user_position: [
    { position: 'support_agent', user_id: 'u_b', organization_id: 'org_a' },
    { position: 'support_agent', user_id: 'u_a', organization_id: 'org_a' },
    { position: 'support_agent', user_id: 'u_other_org', organization_id: 'org_b' },
    { position: 'billing_clerk', user_id: 'u_c', organization_id: 'org_a' },
  ],
  sys_team_member: [{ team_id: 't_night', user_id: 'u_d' }, { team_id: 't_night', user_id: 'u_a' }],
  sys_queue: [
    { id: 'q1', name: 'billing', label: 'Billing', organization_id: 'org_a' },
    { id: 'q2', name: 'billing', label: 'Billing B', organization_id: 'org_b' },
  ],
  sys_queue_member: [
    { queue: 'billing', recipient_type: 'position', recipient_id: 'billing_clerk', organization_id: 'org_a' },
    { queue: 'billing', recipient_type: 'user', recipient_id: 'u_e', organization_id: 'org_a' },
    { queue: 'support_tier1', recipient_type: 'team', recipient_id: 't_night', organization_id: 'org_a' },
    { queue: 'billing', recipient_type: 'user', recipient_id: 'u_b_only', organization_id: 'org_b' },
  ],
  [METADATA_ACTIVATION_TABLE]: [],
});

function service(engine: ReturnType<typeof makeEngine>, logger?: any) {
  return new OwnershipQueueService({ engine: () => engine as any, logger });
}

describe('[ADR-0142 D1/D2] OwnershipQueueService — resolution', () => {
  it('a declared queue resolves registry-first, with its own positions plus the organization\'s member rows', async () => {
    const svc = service(makeEngine({ declared: SUPPORT_DECLARED, tables: BASE_TABLES() }));
    const q = await svc.resolveQueue('support_tier1', 'org_a');
    expect(q).toMatchObject({ name: 'support_tier1', label: 'Support Tier 1', source: 'declared', organizationId: null, packageId: 'com.acme.support' });
    expect(q?.members).toEqual([{ type: 'position', value: 'support_agent' }, { type: 'team', value: 't_night' }]);
  });

  it('an authored queue resolves in its own organization only', async () => {
    const svc = service(makeEngine({ tables: BASE_TABLES() }));
    expect(await svc.resolveQueue('billing', 'org_a')).toMatchObject({ source: 'authored', label: 'Billing', organizationId: 'org_a' });
    expect((await svc.resolveQueue('billing', 'org_b'))?.members).toEqual([{ type: 'user', value: 'u_b_only' }]);
    expect(await svc.resolveQueue('billing', 'org_c')).toBeNull();
    expect(await svc.resolveQueue('nowhere', 'org_a')).toBeNull();
  });

  it('a declared queue the activation ledger switches off resolves nowhere — not even to an authored row under the name', async () => {
    const tables = BASE_TABLES();
    tables[METADATA_ACTIVATION_TABLE] = [{ metadata_type: 'queue', name: 'support_tier1', active: false }];
    tables.sys_queue.push({ id: 'q3', name: 'support_tier1', label: 'Shadow', organization_id: 'org_a' });
    const svc = service(makeEngine({ declared: SUPPORT_DECLARED, tables }));
    expect(await svc.resolveQueue('support_tier1', 'org_a')).toBeNull();
    expect(await svc.expandMembers('support_tier1', 'org_a')).toEqual([]);
    // Still addressable by the activation door, so it can be switched back on.
    expect(await svc.declaredQueueNamed('support_tier1')).toEqual({ name: 'support_tier1', packageId: 'com.acme.support' });
    // The name stays reserved: the authored-row guard still refuses it.
    expect(svc.isDeclaredQueueName('support_tier1')).toBe(true);
  });

  it('declaredQueueNamed answers the declared queue with its package', async () => {
    const svc = service(makeEngine({ declared: SUPPORT_DECLARED, tables: BASE_TABLES() }));
    expect(await svc.declaredQueueNamed('support_tier1')).toEqual({ name: 'support_tier1', packageId: 'com.acme.support' });
    expect(await svc.declaredQueueNamed('billing')).toBeNull();
  });
});

describe('[ADR-0142 D2] OwnershipQueueService — the one expander', () => {
  it('expands the union, de-duplicated and ordered by user id, scoped to the organization', async () => {
    const svc = service(makeEngine({ declared: SUPPORT_DECLARED, tables: BASE_TABLES() }));
    // support_agent holders in org_a (u_a, u_b) ∪ team t_night (u_a, u_d); u_other_org is org_b's.
    expect(await svc.expandMembers('support_tier1', 'org_a')).toEqual(['u_a', 'u_b', 'u_d']);
    expect(await svc.expandMembers('billing', 'org_a')).toEqual(['u_c', 'u_e']);
  });

  it('an empty queue and an unresolved name both answer []', async () => {
    const svc = service(makeEngine({ declared: [{ name: 'empty_q', label: 'Empty', members: [] }], tables: BASE_TABLES() }));
    expect(await svc.expandMembers('empty_q', 'org_a')).toEqual([]);
    expect(await svc.expandMembers('nowhere', 'org_a')).toEqual([]);
  });

  it('a switched-off position confers nothing on the access paths and still addresses on the approver path', async () => {
    const tables = BASE_TABLES();
    tables[METADATA_ACTIVATION_TABLE] = [{ metadata_type: 'position', name: 'support_agent', active: false }];
    const svc = service(makeEngine({ declared: SUPPORT_DECLARED, tables }));
    expect(await svc.expandMembers('support_tier1', 'org_a')).toEqual(['u_a', 'u_d']);
    expect(await svc.expandMembers('support_tier1', 'org_a', { purpose: 'addressing' })).toEqual(['u_a', 'u_b', 'u_d']);
    expect(await svc.isMember('u_b', 'support_tier1', 'org_a')).toBe(false);
  });

  it('a failed member-table read contributes nobody and is logged once', async () => {
    const warn = vi.fn();
    const svc = service(makeEngine({ tables: BASE_TABLES(), failOn: ['sys_queue_member'] }), { warn });
    expect(await svc.expandMembers('billing', 'org_a')).toEqual([]);
    expect(await svc.expandMembers('billing', 'org_a')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/sys_queue_member read failed/);
  });

  it('a failed ledger read leaves the declared default — on — and says so', async () => {
    const warn = vi.fn();
    const svc = service(makeEngine({ declared: SUPPORT_DECLARED, tables: BASE_TABLES(), failOn: [METADATA_ACTIVATION_TABLE] }), { warn });
    expect(await svc.expandMembers('support_tier1', 'org_a')).toEqual(['u_a', 'u_b', 'u_d']);
    expect(warn).toHaveBeenCalled();
  });

  it('isMember answers by holder checks', async () => {
    const svc = service(makeEngine({ declared: SUPPORT_DECLARED, tables: BASE_TABLES() }));
    expect(await svc.isMember('u_b', 'support_tier1', 'org_a')).toBe(true); // position
    expect(await svc.isMember('u_d', 'support_tier1', 'org_a')).toBe(true); // team
    expect(await svc.isMember('u_e', 'billing', 'org_a')).toBe(true); // user
    expect(await svc.isMember('u_other_org', 'support_tier1', 'org_a')).toBe(false);
    expect(await svc.isMember('u_e', 'billing', 'org_b')).toBe(false);
    expect(await svc.isMember('u_a', 'nowhere', 'org_a')).toBe(false);
    expect(await svc.isMember('', 'support_tier1', 'org_a')).toBe(false);
  });

  it('queuesOf lists every queue the user is in, declared and authored, ordered by name', async () => {
    const tables = BASE_TABLES();
    tables.sys_queue_member.push({ queue: 'billing', recipient_type: 'user', recipient_id: 'u_a', organization_id: 'org_a' });
    const svc = service(makeEngine({ declared: SUPPORT_DECLARED, tables }));
    expect(await svc.queuesOf('u_a', 'org_a')).toEqual(['billing', 'support_tier1']);
    expect(await svc.queuesOf('u_c', 'org_a')).toEqual(['billing']);
    expect(await svc.queuesOf('u_nobody', 'org_a')).toEqual([]);
  });

  it('queuesOf agrees with isMember for every user, queue and organization — `current_user.queues` and the claim gate read one answer', async () => {
    // The security plugin stages `current_user.queues` from `queuesOf`; the
    // claim gate admits through `isMember`. A row-level policy and the claim
    // gate must never disagree about who sits in a queue — including a
    // switched-off position, which confers nothing on either path.
    const tables = BASE_TABLES();
    tables[METADATA_ACTIVATION_TABLE] = [{ metadata_type: 'position', name: 'billing_clerk', active: false }];
    const svc = service(makeEngine({ declared: SUPPORT_DECLARED, tables }));
    const users = ['u_a', 'u_b', 'u_c', 'u_d', 'u_e', 'u_b_only', 'u_other_org', 'u_nobody'];
    const queues = ['support_tier1', 'billing', 'nowhere'];
    const answers = new Set<boolean>();
    for (const org of ['org_a', 'org_b']) {
      for (const user of users) {
        const listed = await svc.queuesOf(user, org);
        for (const queue of queues) {
          const member = await svc.isMember(user, queue, org);
          answers.add(member);
          expect({ user, org, queue, member: listed.includes(queue) }).toEqual({ user, org, queue, member });
        }
      }
    }
    // Both answers occur, so the agreement is not vacuous.
    expect([...answers].sort()).toEqual([false, true]);
  });

  it('queuesNaming looks through from a position or a team to the queues it staffs', async () => {
    const svc = service(makeEngine({ declared: SUPPORT_DECLARED, tables: BASE_TABLES() }));
    expect(await svc.queuesNaming('position', new Set(['support_agent']), 'org_a')).toEqual(['support_tier1']);
    expect(await svc.queuesNaming('position', new Set(['billing_clerk']), 'org_a')).toEqual(['billing']);
    expect(await svc.queuesNaming('team', new Set(['t_night']), 'org_a')).toEqual(['support_tier1']);
    expect(await svc.queuesNaming('team', new Set(['t_day']), 'org_a')).toEqual([]);
  });

  it('specsReadBusinessUnits names the two unit kinds', () => {
    expect(specsReadBusinessUnits([{ type: 'position', value: 'p' }])).toBe(false);
    expect(specsReadBusinessUnits([{ type: 'business_unit', value: 'bu1' }])).toBe(true);
    expect(specsReadBusinessUnits([{ type: 'unit_and_subordinates', value: 'bu1' }])).toBe(true);
  });

  it('no engine yet — every answer is empty, never a throw', async () => {
    const svc = new OwnershipQueueService({ engine: () => null });
    expect(await svc.resolveQueue('x', 'org_a')).toBeNull();
    expect(await svc.expandMembers('x', 'org_a')).toEqual([]);
    expect(await svc.isMember('u', 'x', 'org_a')).toBe(false);
    expect(await svc.queuesOf('u', 'org_a')).toEqual([]);
  });
});

// ─── D3: the sitting-record access path ────────────────────────────────────

const TICKET_SCHEMA = {
  name: 'ticket',
  sharingModel: 'private',
  fields: { id: {}, subject: {}, owner_id: {}, queue: { ...QUEUE_FIELD_DEF } },
};
/** A declared `queue` that is the author's own field, not the platform's column. */
const AUTHOR_QUEUE_SCHEMA = {
  name: 'job',
  sharingModel: 'private',
  fields: { id: {}, owner_id: {}, queue: { type: 'text', label: 'Print queue' } },
};
const OPEN_SCHEMA = {
  name: 'idea',
  sharingModel: 'public_read_write',
  fields: { id: {}, owner_id: {}, queue: { ...QUEUE_FIELD_DEF } },
};

describe('[ADR-0142 D3] SharingService — a record sitting in a queue the caller belongs to', () => {
  let engine: ReturnType<typeof makeEngine>;
  let sharing: SharingService;
  const ctx = (userId: string, extra: Record<string, unknown> = {}) => ({ userId, tenantId: 'org_a', ...extra }) as any;

  beforeEach(() => {
    engine = makeEngine({
      declared: SUPPORT_DECLARED,
      tables: {
        ...BASE_TABLES(),
        ticket: [
          { id: 't1', owner_id: null, queue: 'support_tier1', organization_id: 'org_a' },
          { id: 't2', owner_id: 'u_z', queue: 'support_tier1', organization_id: 'org_a' },
          { id: 't3', owner_id: null, queue: 'support_tier1', organization_id: 'org_b' },
        ],
        job: [{ id: 'j1', owner_id: null, queue: 'support_tier1', organization_id: 'org_a' }],
        idea: [{ id: 'i1', owner_id: null, queue: 'support_tier1', organization_id: 'org_a' }],
        sys_record_share: [],
      },
      schemas: { ticket: TICKET_SCHEMA, job: AUTHOR_QUEUE_SCHEMA, idea: OPEN_SCHEMA, sys_record_share: { name: 'sys_record_share' } },
    });
    const queues = service(engine);
    sharing = new SharingService({ engine: engine as any, ownershipQueues: () => queues });
  });

  it('the read filter carries `owner_id IS NULL AND queue IN current_user.queues` beside the owner match', async () => {
    const filter = await sharing.buildReadFilter('ticket', ctx('u_a'));
    expect(JSON.stringify(filter)).toContain(JSON.stringify({ owner_id: null, queue: 'support_tier1' }));
  });

  it('a caller in no queue gets the owner match alone', async () => {
    const filter = await sharing.buildReadFilter('ticket', ctx('u_nobody'));
    expect(JSON.stringify(filter)).not.toContain('"queue"');
  });

  it('the guest never reaches a queue', async () => {
    const guest = { tenantId: 'org_a', principalKind: 'guest' } as any;
    expect(await sharing.callerQueues(guest)).toEqual([]);
    expect(await sharing.checkEdit('ticket', 't1', guest)).toBe('deny');
  });

  it('an author\'s own `queue` field is not the platform\'s column — no disjunct, no edit', async () => {
    const filter = await sharing.buildReadFilter('job', ctx('u_a'));
    expect(JSON.stringify(filter ?? {})).not.toContain('"queue"');
    expect(await sharing.checkEdit('job', 'j1', ctx('u_a'))).toBe('deny');
  });

  it('checkEdit allows a member on a sitting record and nobody else', async () => {
    expect(await sharing.checkEdit('ticket', 't1', ctx('u_a'))).toBe('allow');
    expect(await sharing.checkEdit('ticket', 't1', ctx('u_nobody'))).toBe('deny');
  });

  it('an owned record does not sit in its home queue — a member gets no edit through it', async () => {
    expect(await sharing.checkEdit('ticket', 't2', ctx('u_a'))).toBe('deny');
  });

  it('a record of another organization is never reached through this organization\'s queue', async () => {
    expect(await sharing.checkEdit('ticket', 't3', ctx('u_a'))).toBe('deny');
  });

  it('the basis never reaches delete', async () => {
    expect(await sharing.checkDelete('ticket', 't1', ctx('u_a'))).toBe('deny');
  });

  it('on an open OWD the basis answers allow ahead of the public abstain', async () => {
    expect(await sharing.checkEdit('idea', 'i1', ctx('u_a'))).toBe('allow');
    expect(await sharing.checkEdit('idea', 'i1', ctx('u_nobody'))).toBe('abstain');
  });

  it('with no queue service the basis fails closed', async () => {
    const bare = new SharingService({ engine: engine as any });
    expect(await bare.checkEdit('ticket', 't1', ctx('u_a'))).toBe('deny');
    expect(JSON.stringify(await bare.buildReadFilter('ticket', ctx('u_a')))).not.toContain('"queue"');
  });

  it('membership is resolved once per request context', async () => {
    const queuesOf = vi.fn(async () => ['support_tier1']);
    const s = new SharingService({ engine: engine as any, ownershipQueues: () => ({ queuesOf, isMember: async () => false }) });
    const c = ctx('u_a');
    await s.buildReadFilter('ticket', c);
    await s.buildReadFilter('ticket', c);
    expect(queuesOf).toHaveBeenCalledTimes(1);
  });
});

// ─── D1: the authored-table guards ─────────────────────────────────────────

describe('[ADR-0142 D1] sys_queue / sys_queue_member guards', () => {
  const engine = makeEngine();
  const queues = { isDeclaredQueueName: (n: string) => n === 'support_tier1' };
  bindQueueGuards(engine as any, queues);

  it('refuses a non-machine name and a declared queue\'s name', async () => {
    await expect(engine.fire('beforeInsert', 'sys_queue', { input: { data: { name: 'Billing Team' } } })).rejects.toBeInstanceOf(QueueValidationError);
    await expect(engine.fire('beforeInsert', 'sys_queue', { input: { data: { name: 'support_tier1' } } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'name', code: 'invalid_value' }],
    });
    await expect(engine.fire('beforeInsert', 'sys_queue', { input: { data: { name: 'billing' } } })).resolves.toBeUndefined();
  });

  it('an update that leaves the name alone is not re-judged', async () => {
    await expect(engine.fire('beforeUpdate', 'sys_queue', { input: { data: { label: 'X' } } })).resolves.toBeUndefined();
    await expect(engine.fire('beforeUpdate', 'sys_queue', { input: { data: { name: 'Bad Name' } } })).rejects.toBeInstanceOf(QueueValidationError);
  });

  it('a member row names its queue by machine name', async () => {
    await expect(engine.fire('beforeInsert', 'sys_queue_member', { input: { data: { queue: 'q1-id' } } })).rejects.toMatchObject({ fields: [{ field: 'queue' }] });
    await expect(engine.fire('beforeInsert', 'sys_queue_member', { input: { data: { queue: 'billing' } } })).resolves.toBeUndefined();
  });

  it('re-binding replaces, never stacks', () => {
    const before = engine.hooks.filter((h) => h.packageId === QUEUE_GUARD_PACKAGE).length;
    bindQueueGuards(engine as any, queues);
    expect(engine.hooks.filter((h) => h.packageId === QUEUE_GUARD_PACKAGE).length).toBe(before);
  });

  it('a boot report names every authored row a declaration now shadows', async () => {
    const e = makeEngine({ tables: { sys_queue: [{ name: 'support_tier1', organization_id: 'org_a' }, { name: 'billing', organization_id: 'org_a' }] } });
    const error = vi.fn();
    await reportShadowedAuthoredQueues(e as any, queues, { error } as any);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][1]).toEqual({ queue: 'support_tier1', organization: 'org_a' });
  });
});

// ─── D7: the queue-recipient recompute ─────────────────────────────────────

describe('[ADR-0142 D7] queue-recipient rules recompute on a queue-membership write', () => {
  function ruleService() {
    return {
      listRules: vi.fn(async () => [
        { id: 'r1', name: 'tier1_reads', recipient_type: 'queue', recipient_id: 'support_tier1' },
        { id: 'r2', name: 'billing_reads', recipient_type: 'queue', recipient_id: 'billing' },
        { id: 'r3', name: 'team_reads', recipient_type: 'team', recipient_id: 'support_tier1' },
      ] as any[]),
      revokeRuleGrantsForRetiredRecipients: vi.fn(async () => 0),
      evaluateRule: vi.fn(async () => ({})),
    };
  }

  it('revokes synchronously and re-grants on the shared queue, for the queue-recipient rules naming the queue only', async () => {
    const svc = ruleService();
    await recomputeQueueRecipientRules(svc, new Set(['support_tier1']), undefined, { object: 'sys_queue_member', event: 'afterInsert' });
    expect(svc.revokeRuleGrantsForRetiredRecipients).toHaveBeenCalledTimes(1);
    expect((svc.revokeRuleGrantsForRetiredRecipients.mock.calls[0] as any[])[0]).toMatchObject({ id: 'r1' });
    await ruleRegrantQueue.whenIdle();
    expect(svc.evaluateRule).toHaveBeenCalledWith('r1', expect.anything());
    expect(svc.evaluateRule).toHaveBeenCalledTimes(1);
  });

  it('a member-row write recomputes the queue before and after the write', async () => {
    const engine = makeEngine();
    const svc = ruleService();
    bindQueueRecipientRecompute(engine as any, svc);
    await engine.fire('afterUpdate', 'sys_queue_member', {
      previous: { queue: 'support_tier1' },
      result: { queue: 'billing' },
      input: { data: { queue: 'billing' } },
    });
    const revoked = svc.revokeRuleGrantsForRetiredRecipients.mock.calls.map((c: any[]) => c[0].id).sort();
    expect(revoked).toEqual(['r1', 'r2']);
    await ruleRegrantQueue.whenIdle();
  });

  it('a failing recompute never fails the operator\'s write', async () => {
    const engine = makeEngine();
    const warn = vi.fn();
    bindQueueRecipientRecompute(engine as any, {
      listRules: async () => { throw new Error('down'); },
      revokeRuleGrantsForRetiredRecipients: async () => 0,
      evaluateRule: async () => ({}),
    }, { warn });
    await expect(engine.fire('afterDelete', 'sys_queue', { previous: { name: 'billing' } })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('a declared queue switched in the activation ledger recomputes the rules naming it; other ledger rows do not', async () => {
    const engine = makeEngine();
    const svc = ruleService();
    bindQueueRecipientRecompute(engine as any, svc);
    // The update patch carries no type or name: they come from the pre-image.
    await engine.fire('afterUpdate', METADATA_ACTIVATION_TABLE, {
      previous: { id: 'a1', metadata_type: 'queue', name: 'support_tier1', active: true },
      result: { id: 'a1', active: false },
      input: { data: { active: false } },
    });
    expect(svc.revokeRuleGrantsForRetiredRecipients.mock.calls.map((c: any[]) => c[0].id)).toEqual(['r1']);
    await engine.fire('afterInsert', METADATA_ACTIVATION_TABLE, {
      result: { metadata_type: 'sharing_rule', name: 'support_tier1', active: false },
    });
    expect(svc.revokeRuleGrantsForRetiredRecipients).toHaveBeenCalledTimes(1);
    await ruleRegrantQueue.whenIdle();
  });
});
