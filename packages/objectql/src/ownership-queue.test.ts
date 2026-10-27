// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142] The engine's half of the ownership queue: the injected `queue`
 * column and its registration refusal (D3), the by-id write precondition
 * (D4), the assignment seam with its two strategies (D5), the two stack keys
 * and the boot refusal (D1).
 *
 * A stand-in driver rather than `@objectstack/driver-memory`, for the reason
 * `engine-aggregate-rows-ast.test.ts` records (the driver-memory census).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QUEUE_FIELD_DEF } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { applySystemFields, objectQueueColumnRefusal } from './registry.js';
import { OWNERSHIP_QUEUE_SOURCE_SLOT, describeMissingOwnershipQueueService, nextMember } from './assignment-rules.js';

type Row = Record<string, unknown>;

function matchesWhere(row: Row, where: any): boolean {
  if (!where || typeof where !== 'object') return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === '$and' && Array.isArray(v)) {
      if (!v.every((w: any) => matchesWhere(row, w))) return false;
      continue;
    }
    if (k === '$or' && Array.isArray(v)) {
      if (!v.some((w: any) => matchesWhere(row, w))) return false;
      continue;
    }
    if (k.startsWith('$')) continue;
    const a = row[k] === undefined ? null : row[k];
    if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
      if (!(v as any).$in.includes(a)) return false;
      continue;
    }
    if (v && typeof v === 'object' && '$ne' in (v as any)) {
      if (a === (v as any).$ne) return false;
      continue;
    }
    const b = v === undefined ? null : v;
    if (a !== b) return false;
  }
  return true;
}

function makeDriver(opts: { withUpdateMany?: boolean } = {}) {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) stores.set(o, (s = new Map()));
    return s;
  };
  let nextId = 0;
  const calls: string[] = [];
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Row) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Row) {
      calls.push(`update:${object}`);
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) throw new Error(`not found: ${object}/${id}`);
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return { ...updated };
    },
    async upsert(object: string, data: Row) { return this.create(object, data); },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, { where: ast?.where })).length; },
    async bulkCreate(object: string, rows: Row[]) { return Promise.all(rows.map((r) => this.create(object, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  if (opts.withUpdateMany !== false) {
    driver.updateMany = async (object: string, ast: any, data: Row) => {
      calls.push(`updateMany:${object}`);
      let n = 0;
      for (const [id, r] of storeFor(object)) {
        if (!matchesWhere(r, ast?.where)) continue;
        storeFor(object).set(id, { ...r, ...data, id });
        n++;
      }
      return n;
    };
  }
  return { driver, stores, storeFor, calls };
}

const TICKET = {
  name: 'ticket',
  label: 'Ticket',
  fields: {
    subject: { type: 'text', label: 'Subject' },
    status: { type: 'text', label: 'Status' },
    priority: { type: 'text', label: 'Priority' },
  },
};

/** The cursor table as plugin-sharing ships it (only the keys the seam reads). */
const CURSOR = {
  name: 'sys_assignment_cursor',
  label: 'Assignment Cursor',
  managedBy: 'engine-owned',
  fields: {
    rule: { type: 'text', label: 'Rule' },
    entry: { type: 'text', label: 'Entry' },
    last_user_id: { type: 'text', label: 'Last' },
    version: { type: 'number', label: 'Version' },
  },
};

const SYS = { isSystem: true, tenantId: 'org_a', positions: [], permissions: [] } as any;

// ─── D3: the column and its refusal ────────────────────────────────────────

describe('[ADR-0142 D3] the injected `queue` column', () => {
  it('rides with the owner anchor: injected on the user tier, withheld on the others', () => {
    const fieldsOf = (schema: any) => Object.keys(applySystemFields(schema, { multiTenant: true }).fields ?? {});
    expect(fieldsOf({ name: 'ticket', fields: {} })).toEqual(expect.arrayContaining(['owner_id', 'queue']));
    expect(fieldsOf({ name: 'ticket', ownership: 'user', fields: {} })).toContain('queue');
    for (const ownership of ['business_unit', 'org', 'none']) {
      expect(fieldsOf({ name: 'catalog', ownership, fields: {} })).not.toContain('queue');
    }
    expect(fieldsOf({ name: 'sys_widget', fields: {} })).not.toContain('queue');
    const injected = applySystemFields({ name: 'ticket', fields: {} } as any, { multiTenant: true }).fields as any;
    expect(injected.queue).toEqual(QUEUE_FIELD_DEF);
  });

  it('a declared `queue` on an eligible object is refused at registration — INVALID_METADATA, 422', () => {
    const engine = new ObjectQL();
    let thrown: any;
    try {
      engine.registry.registerObject({ name: 'job', fields: { queue: { type: 'text', label: 'Print queue' } } } as any, 'pkg');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ code: 'INVALID_METADATA', status: 422, name: 'ObjectQueueColumnRefusedError', objectName: 'job', fieldName: 'queue' });
    expect(thrown.message).toMatch(/Rename the business field/);
    expect(engine.registry.getObject('job')).toBeUndefined();
  });

  it('the platform\'s own definition coming back passes, and so does `queue` on a tier that carries none', () => {
    expect(objectQueueColumnRefusal({ name: 'ticket', fields: { queue: { ...QUEUE_FIELD_DEF } } })).toBeNull();
    expect(objectQueueColumnRefusal({ name: 'catalog', ownership: 'org', fields: { queue: { type: 'text' } } })).toBeNull();
    expect(objectQueueColumnRefusal({ name: 'sys_job_queue', fields: { queue: { type: 'text' } } })).toBeNull();
  });

  it('an extension\'s own `queue` never replaces the injected column, in either registration order, and is named once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const extension = { name: 'ticket', fields: { queue: { type: 'text', label: 'Print queue' }, region: { type: 'text', label: 'Region' } } };
      for (const extendFirst of [false, true]) {
        const engine = new ObjectQL();
        const register = {
          base: () => engine.registry.registerObject(TICKET as any, 'pkg'),
          ext: () => engine.registry.registerObject(extension as any, 'com.ext', undefined, 'extend'),
        };
        if (extendFirst) { register.ext(); register.base(); } else { register.base(); register.ext(); }
        const served = engine.registry.getObject('ticket') as any;
        expect(served.fields.queue).toEqual(QUEUE_FIELD_DEF);
        expect(served.fields.region).toMatchObject({ label: 'Region' });
        engine.registry.getObject('ticket');
      }
      const named = warn.mock.calls.filter((c: unknown[]) => /An extension of object "ticket" from package "com\.ext" declares a field named `queue`/.test(String(c[0])));
      expect(named).toHaveLength(2); // once per registry, never once per read

      const catalog = new ObjectQL();
      catalog.registry.registerObject({ name: 'catalog', ownership: 'org', fields: {} } as any, 'pkg');
      catalog.registry.registerObject({ name: 'catalog', fields: { queue: { type: 'text', label: 'Print queue' } } } as any, 'com.ext', undefined, 'extend');
      expect((catalog.registry.getObject('catalog') as any).fields.queue).toEqual({ type: 'text', label: 'Print queue' });
    } finally {
      warn.mockRestore();
    }
  });
});

// ─── D4: the by-id write precondition ──────────────────────────────────────

describe('[ADR-0142 D4] the by-id write precondition', () => {
  async function boot(withUpdateMany = true) {
    const engine = new ObjectQL();
    const d = makeDriver({ withUpdateMany });
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject(TICKET as any, 'pkg');
    // The ownership gate's stand-in: a claim sets `{ owner_id: null }`.
    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      if (opCtx.operation === 'update' && opCtx.context?.claim) opCtx.writePrecondition = { owner_id: null };
      await next();
    });
    d.storeFor('ticket').set('t1', { id: 't1', subject: 'Printer', owner_id: null, queue: 'support' });
    return { engine, ...d };
  }

  it('the first claim wins and is read back; the second answers 409 CONCURRENT_UPDATE', async () => {
    const { engine, calls } = await boot();
    const won = await engine.update('ticket', { id: 't1', owner_id: 'u_a' }, { context: { ...SYS, claim: true } });
    expect(won).toMatchObject({ id: 't1', owner_id: 'u_a', queue: 'support' });
    expect(calls).toContain('updateMany:ticket');
    await expect(engine.update('ticket', { id: 't1', owner_id: 'u_b' }, { context: { ...SYS, claim: true } })).rejects.toMatchObject({
      code: 'CONCURRENT_UPDATE',
      status: 409,
      name: 'ConcurrentUpdateError',
      message: expect.stringMatching(/The record was taken/),
    });
  });

  it('two claims at once produce exactly one owner', async () => {
    const { engine, storeFor } = await boot();
    const results = await Promise.allSettled([
      engine.update('ticket', { id: 't1', owner_id: 'u_a' }, { context: { ...SYS, claim: true } }),
      engine.update('ticket', { id: 't1', owner_id: 'u_b' }, { context: { ...SYS, claim: true } }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').map((r: any) => r.reason.code)).toEqual(['CONCURRENT_UPDATE']);
    expect(['u_a', 'u_b']).toContain(storeFor('ticket').get('t1')!.owner_id);
  });

  it('a write without a precondition takes the ordinary by-id branch', async () => {
    const { engine, calls } = await boot();
    await engine.update('ticket', { id: 't1', subject: 'Printer jam' }, { context: SYS });
    expect(calls).toEqual(['update:ticket']);
  });

  it('a driver with no updateMany degrades: the write goes through, warned once per process', async () => {
    const { engine, storeFor } = await boot(false);
    const warn = vi.spyOn((engine as any).logger, 'warn');
    await engine.update('ticket', { id: 't1', owner_id: 'u_a' }, { context: { ...SYS, claim: true } });
    await engine.update('ticket', { id: 't1', owner_id: 'u_b' }, { context: { ...SYS, claim: true } });
    expect(storeFor('ticket').get('t1')!.owner_id).toBe('u_b');
    expect(warn.mock.calls.filter((c) => /no conditional update/.test(String(c[0])))).toHaveLength(1);
  });
});

// ─── D5: the assignment seam ───────────────────────────────────────────────

describe('[ADR-0142 D5] the assignment seam', () => {
  let members: Record<string, string[]>;
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;
  let warn: ReturnType<typeof vi.spyOn>;

  async function boot(rules: unknown[], queues: unknown[] = [{ name: 'support', label: 'Support', members: [] }]) {
    engine = new ObjectQL();
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject(TICKET as any, 'pkg');
    engine.registry.registerObject(CURSOR as any, 'plugin-sharing');
    engine.registerApp({ id: 'com.acme.support', name: 'support', queues, assignmentRules: rules });
    (engine as any)[OWNERSHIP_QUEUE_SOURCE_SLOT] = () => ({
      resolveQueue: async (name: string, org: string | null) =>
        name in members && org === 'org_a' ? { name, label: name, source: 'declared', organizationId: null, members: [] } : null,
      expandMembers: async (name: string) => [...(members[name] ?? [])].sort(),
    });
    warn = vi.spyOn((engine as any).logger, 'warn');
  }

  const insert = (data: Row, context: any = SYS) => engine.insert('ticket', { organization_id: 'org_a', ...data }, { context });
  const rule = (entries: unknown[], extra: Row = {}) => ({ name: 'ticket_intake', label: 'Intake', object: 'ticket', active: true, entries, ...extra });

  beforeEach(() => {
    members = { support: ['u_c', 'u_a', 'u_b'] };
  });

  it('the two stack keys reach the registry with their package', async () => {
    await boot([rule([{ name: 'all', assignTo: { type: 'queue', value: 'support' } }])]);
    expect(engine.registry.listItems('queue').map((q: any) => q.name)).toEqual(['support']);
    expect((engine.registry.listItems('assignment_rule')[0] as any)._packageId).toBe('com.acme.support');
  });

  it('no strategy parks the row in the queue, ownerless', async () => {
    await boot([rule([{ name: 'all', assignTo: { type: 'queue', value: 'support' } }])]);
    const row = await insert({ subject: 'A' });
    expect(row).toMatchObject({ queue: 'support' });
    expect(row.owner_id ?? null).toBeNull();
  });

  it('round_robin walks the members in user-id order and wraps', async () => {
    await boot([rule([{ name: 'all', assignTo: { type: 'queue', value: 'support' }, strategy: 'round_robin' }])]);
    const owners = [];
    for (const s of ['A', 'B', 'C', 'D']) owners.push((await insert({ subject: s })).owner_id);
    expect(owners).toEqual(['u_a', 'u_b', 'u_c', 'u_a']);
    const cursor = [...d.storeFor('sys_assignment_cursor').values()];
    expect(cursor).toHaveLength(1);
    expect(cursor[0]).toMatchObject({ rule: 'ticket_intake', entry: 'all', organization_id: 'org_a', last_user_id: 'u_a', version: 4 });
  });

  it('round_robin under concurrent inserts never hands two rows the same turn', async () => {
    await boot([rule([{ name: 'all', assignTo: { type: 'queue', value: 'support' }, strategy: 'round_robin' }])]);
    await insert({ subject: 'seed' }); // the cursor row exists
    const rows = await Promise.all(['A', 'B', 'C'].map((s) => insert({ subject: s })));
    expect(rows.map((r: any) => r.owner_id).sort()).toEqual(['u_a', 'u_b', 'u_c']);
  });

  it('least_loaded counts each member\'s open rows, breaks a tie by user id, and adjusts within a batch', async () => {
    await boot([rule([{ name: 'all', assignTo: { type: 'queue', value: 'support' }, strategy: 'least_loaded', load: 'record.status != "closed"' }])]);
    const t = d.storeFor('ticket');
    t.set('o1', { id: 'o1', owner_id: 'u_a', status: 'open', organization_id: 'org_a' });
    t.set('o2', { id: 'o2', owner_id: 'u_a', status: 'open', organization_id: 'org_a' });
    t.set('o3', { id: 'o3', owner_id: 'u_b', status: 'open', organization_id: 'org_a' });
    t.set('o4', { id: 'o4', owner_id: 'u_c', status: 'closed', organization_id: 'org_a' });
    t.set('o5', { id: 'o5', owner_id: 'u_c', status: 'open', organization_id: 'org_b' });
    // u_c: 0 open here (closed and another org do not count); u_b: 1; u_a: 2.
    const batch = await engine.insert('ticket', [
      { subject: 'A', status: 'open', organization_id: 'org_a' },
      { subject: 'B', status: 'open', organization_id: 'org_a' },
      { subject: 'C', status: 'open', organization_id: 'org_a' },
    ], { context: SYS });
    expect((batch as any[]).map((r) => r.owner_id)).toEqual(['u_c', 'u_b', 'u_c']);
  });

  it('an empty pool parks the row and warns once per rule', async () => {
    members = { support: [] };
    await boot([rule([{ name: 'all', assignTo: { type: 'queue', value: 'support' }, strategy: 'round_robin' }])]);
    const a = await insert({ subject: 'A' });
    await insert({ subject: 'B' });
    expect(a).toMatchObject({ queue: 'support' });
    expect(a.owner_id ?? null).toBeNull();
    expect(warn.mock.calls.filter((c: unknown[]) => /has no members/.test(String(c[0])))).toHaveLength(1);
  });

  it('a target that resolves nowhere in the row\'s organization leaves it ownerless, in no queue, and warns', async () => {
    await boot([rule([{ name: 'all', assignTo: { type: 'queue', value: 'support' }, strategy: 'round_robin' }])]);
    const row = await engine.insert('ticket', { subject: 'A', organization_id: 'org_b' }, { context: { ...SYS, tenantId: 'org_b' } });
    expect(row.owner_id ?? null).toBeNull();
    expect(row.queue ?? null).toBeNull();
    expect(warn.mock.calls.some((c: unknown[]) => /does not resolve in organization 'org_b'/.test(String(c[0])))).toBe(true);
  });

  it('a row that arrives with an owner or a queue is not evaluated', async () => {
    await boot([rule([{ name: 'all', assignTo: { type: 'queue', value: 'support' }, strategy: 'round_robin' }])]);
    expect(await insert({ subject: 'A', owner_id: 'u_z' })).toMatchObject({ owner_id: 'u_z' });
    expect((await insert({ subject: 'B', queue: 'billing' })).owner_id ?? null).toBeNull();
    expect(d.storeFor('sys_assignment_cursor').size).toBe(0);
  });

  it('the first entry whose criteria match decides; a user target names the owner', async () => {
    await boot([rule([
      { name: 'vip', criteria: 'record.priority == "high"', assignTo: { type: 'user', value: 'u_lead' } },
      { name: 'rest', assignTo: { type: 'queue', value: 'support' } },
    ])]);
    const vip = await insert({ subject: 'A', priority: 'high' });
    expect(vip.owner_id).toBe('u_lead');
    expect(vip.queue ?? null).toBeNull();
    expect(await insert({ subject: 'B', priority: 'low' })).toMatchObject({ queue: 'support' });
  });

  it('a `criteria` that cannot be evaluated does not match, warns once, and the next entry decides', async () => {
    await boot([rule([
      { name: 'vip', criteria: 'record.priority == (', assignTo: { type: 'user', value: 'u_lead' } },
      { name: 'rest', assignTo: { type: 'queue', value: 'support' } },
    ])]);
    const a = await insert({ subject: 'A', priority: 'high' });
    await insert({ subject: 'B', priority: 'high' });
    expect(a.owner_id ?? null).toBeNull();
    expect(a).toMatchObject({ queue: 'support' });
    expect(warn.mock.calls.filter((c: unknown[]) => /criteria of rule 'ticket_intake' entry 'vip' could not be evaluated/.test(String(c[0])))).toHaveLength(1);
  });

  it('a `load` the compiler cannot lower parks the row in the queue and warns; it never counts every row', async () => {
    await boot([rule([{ name: 'all', assignTo: { type: 'queue', value: 'support' }, strategy: 'least_loaded', load: 'size(record.subject) > 3' }])]);
    const row = await insert({ subject: 'A' });
    expect(row).toMatchObject({ queue: 'support' });
    expect(row.owner_id ?? null).toBeNull();
    expect(warn.mock.calls.filter((c: unknown[]) => /has no `load` the platform can count by/.test(String(c[0])))).toHaveLength(1);
  });

  it('a rule switched off — `active: false`, or in the activation ledger — routes nothing', async () => {
    await boot([rule([{ name: 'all', assignTo: { type: 'queue', value: 'support' } }], { active: false })]);
    expect((await insert({ subject: 'A' })).queue ?? null).toBeNull();

    await boot([rule([{ name: 'all', assignTo: { type: 'queue', value: 'support' } }])]);
    engine.registry.registerObject({ name: 'sys_metadata_activation', managedBy: 'platform', fields: {
      metadata_type: { type: 'text', label: 'Type' }, name: { type: 'text', label: 'Name' }, active: { type: 'boolean', label: 'Active' },
    } } as any, 'platform');
    d.storeFor('sys_metadata_activation').set('a1', { id: 'a1', metadata_type: 'assignment_rule', name: 'ticket_intake', active: false });
    expect((await insert({ subject: 'B' })).queue ?? null).toBeNull();
  });

  it('a failed read never refuses the insert', async () => {
    await boot([rule([{ name: 'all', assignTo: { type: 'queue', value: 'support' }, strategy: 'round_robin' }])]);
    (engine as any)[OWNERSHIP_QUEUE_SOURCE_SLOT] = () => ({
      resolveQueue: async () => ({ name: 'support' }),
      expandMembers: async () => { throw new Error('down'); },
    });
    const row = await insert({ subject: 'A' });
    expect(row).toMatchObject({ queue: 'support' });
    expect(row.owner_id ?? null).toBeNull();
  });
});

describe('[ADR-0142 D5] nextMember', () => {
  it('takes the member after the last one by id, wrapping, and survives a changed member set', () => {
    expect(nextMember(['a', 'b', 'c'], null)).toBe('a');
    expect(nextMember(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextMember(['a', 'b', 'c'], 'c')).toBe('a');
    expect(nextMember(['a', 'c'], 'b')).toBe('c'); // b left the queue
  });
});

describe('[ADR-0142 D1] the boot refusal', () => {
  it('names the declared keys and the ownership-queue service, never the job queue', () => {
    const err = describeMissingOwnershipQueueService({ queues: [{}], assignmentRules: [{}, {}] }, false);
    expect(err?.message).toMatch(/queues \(1\) and assignmentRules \(2\)/);
    expect(err?.message).toMatch(/'ownership-queue'/);
    expect(describeMissingOwnershipQueueService({ queues: [{}], assignmentRules: [] }, true)).toBeNull();
    expect(describeMissingOwnershipQueueService({ queues: [], assignmentRules: [] }, false)).toBeNull();
  });
});
