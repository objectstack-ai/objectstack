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
import { OWNERSHIP_QUEUE_SOURCE_SLOT, assignmentExpressionRefusals, describeMissingOwnershipQueueService, nextMember } from './assignment-rules.js';

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

/** The organization membership table, as the platform ships it (only the keys the seam reads). */
const MEMBER = {
  name: 'sys_member',
  label: 'Member',
  fields: {
    user_id: { type: 'text', label: 'User' },
    role: { type: 'text', label: 'Role' },
  },
};

/** The user table's ban columns, which a user target's standing reads. */
const USER = {
  name: 'sys_user',
  label: 'User',
  fields: {
    name: { type: 'text', label: 'Name' },
    banned: { type: 'boolean', label: 'Banned' },
    ban_expires: { type: 'datetime', label: 'Ban Expires' },
  },
};

/** An organization's own assignment rules, as plugin-sharing ships them (only the keys the seam reads). */
const AUTHORED_RULE = {
  name: 'sys_assignment_rule',
  label: 'Assignment Rule',
  fields: {
    name: { type: 'text', label: 'Name' },
    object_name: { type: 'text', label: 'Object' },
    criteria: { type: 'textarea', label: 'Condition' },
    sort_order: { type: 'number', label: 'Order' },
    recipient_type: { type: 'text', label: 'Assign To' },
    recipient_id: { type: 'text', label: 'Queue or User' },
    strategy: { type: 'text', label: 'Strategy' },
    load: { type: 'textarea', label: 'Open Work' },
    active: { type: 'boolean', label: 'Active' },
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

  it('[#29673] `objectRegistrationRefusal` answers the throw `registerObject` makes, and registers nothing', () => {
    const engine = new ObjectQL();
    const declared = { name: 'job', fields: { queue: { type: 'text', label: 'Print queue' } } } as any;
    const asked = engine.registry.objectRegistrationRefusal(declared, 'pkg');
    expect(asked).toMatchObject({ code: 'INVALID_METADATA', status: 422, name: 'ObjectQueueColumnRefusedError', objectName: 'job' });
    expect(engine.registry.getObject('job')).toBeUndefined();
    let thrown: any;
    try { engine.registry.registerObject(declared, 'pkg'); } catch (err) { thrown = err; }
    expect(thrown?.name).toBe(asked?.name);
    expect(thrown?.message).toBe(asked?.message);
    // The field-type door, the other body door, answers the same way.
    expect(engine.registry.objectRegistrationRefusal({ name: 'job', fields: { x: { label: 'X' } } } as any, 'pkg'))
      .toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    // The platform's own definition coming back, and an ordinary body: no refusal, and still nothing registered.
    expect(engine.registry.objectRegistrationRefusal({ name: 'job', fields: { queue: { ...QUEUE_FIELD_DEF } } } as any, 'pkg')).toBeNull();
    expect(engine.registry.objectRegistrationRefusal({ name: 'job', fields: { title: { type: 'text' } } } as any, 'pkg')).toBeNull();
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
    engine.registry.registerObject(MEMBER as any, 'platform');
    d.storeFor('sys_member').set('m_lead', { id: 'm_lead', user_id: 'u_lead', organization_id: 'org_a' });
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

// ─── D5: user targets, and an organization's own rules ─────────────────────

describe('[ADR-0142 D5] a user target owns the row only while the user is an active member', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;
  let warn: ReturnType<typeof vi.spyOn>;

  async function boot(opts: { members?: boolean; users?: boolean } = {}) {
    engine = new ObjectQL();
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject(TICKET as any, 'pkg');
    if (opts.members !== false) engine.registry.registerObject(MEMBER as any, 'platform');
    if (opts.users !== false) engine.registry.registerObject(USER as any, 'platform');
    engine.registerApp({
      id: 'com.acme.support', name: 'support', queues: [],
      assignmentRules: [{ name: 'ticket_owner', object: 'ticket', active: true, entries: [{ name: 'all', assignTo: { type: 'user', value: 'u_lead' } }] }],
    });
    warn = vi.spyOn((engine as any).logger, 'warn');
  }

  const insert = (org = 'org_a') => engine.insert('ticket', { subject: 'A', organization_id: org }, { context: { ...SYS, tenantId: org } });

  it('a member of the row\'s organization, not banned, owns it', async () => {
    await boot();
    d.storeFor('sys_member').set('m1', { id: 'm1', user_id: 'u_lead', organization_id: 'org_a' });
    d.storeFor('sys_user').set('u_lead', { id: 'u_lead', banned: false });
    expect((await insert()).owner_id).toBe('u_lead');
  });

  it('a user who is not a member of the row\'s organization owns nothing, the insert lands, and the lapse warns once', async () => {
    await boot();
    d.storeFor('sys_member').set('m1', { id: 'm1', user_id: 'u_lead', organization_id: 'org_b' });
    d.storeFor('sys_user').set('u_lead', { id: 'u_lead', banned: false });
    const a = await insert();
    await insert();
    expect(a.owner_id ?? null).toBeNull();
    expect(a.queue ?? null).toBeNull();
    expect(warn.mock.calls.filter((c: unknown[]) => /assigns to user 'u_lead', who is not a member of organization 'org_a'/.test(String(c[0])))).toHaveLength(1);
    // The other organization, where the user is a member, still routes.
    expect((await insert('org_b')).owner_id).toBe('u_lead');
  });

  it('a banned member owns nothing; a ban whose expiry passed binds no longer', async () => {
    await boot();
    d.storeFor('sys_member').set('m1', { id: 'm1', user_id: 'u_lead', organization_id: 'org_a' });
    d.storeFor('sys_user').set('u_lead', { id: 'u_lead', banned: true });
    expect((await insert()).owner_id ?? null).toBeNull();
    expect(warn.mock.calls.some((c: unknown[]) => /whose account is banned/.test(String(c[0])))).toBe(true);
    d.storeFor('sys_user').set('u_lead', { id: 'u_lead', banned: true, ban_expires: '2000-01-01T00:00:00Z' });
    expect((await insert()).owner_id).toBe('u_lead');
  });

  it('no membership table registered: no user can be confirmed, so none is assigned, and it says why once', async () => {
    await boot({ members: false });
    const a = await insert();
    await insert();
    expect(a.owner_id ?? null).toBeNull();
    expect(warn.mock.calls.filter((c: unknown[]) => /no organization membership table \('sys_member'\) is registered/.test(String(c[0])))).toHaveLength(1);
  });

  it('a membership read that fails writes the row as it stood, never refused', async () => {
    await boot();
    const find = d.driver.find.bind(d.driver);
    d.driver.find = async (object: string, ast: any) => {
      if (object === 'sys_member') throw new Error('members down');
      return find(object, ast);
    };
    const a = await insert();
    expect(a.owner_id ?? null).toBeNull();
    expect(warn.mock.calls.some((c: unknown[]) => /membership could not be read/.test(String(c[0])))).toBe(true);
  });
});

describe('[ADR-0142 D5] an organization\'s own rules (`sys_assignment_rule`) go first, the declared rules are the fallback', () => {
  let members: Record<string, string[]>;
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;
  let warn: ReturnType<typeof vi.spyOn>;

  async function boot(declared: unknown[] = [], opts: { authoredTable?: boolean } = {}) {
    engine = new ObjectQL();
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject(TICKET as any, 'pkg');
    engine.registry.registerObject(CURSOR as any, 'plugin-sharing');
    engine.registry.registerObject(MEMBER as any, 'platform');
    if (opts.authoredTable !== false) engine.registry.registerObject(AUTHORED_RULE as any, 'plugin-sharing');
    engine.registerApp({
      id: 'com.acme.support', name: 'support',
      queues: [{ name: 'support', label: 'Support', members: [] }, { name: 'vip', label: 'VIP', members: [] }],
      assignmentRules: declared,
    });
    (engine as any)[OWNERSHIP_QUEUE_SOURCE_SLOT] = () => ({
      resolveQueue: async (name: string, org: string | null) =>
        name in members && (org === 'org_a' || org === 'org_b') ? { name, label: name, source: 'declared', organizationId: null, members: [] } : null,
      expandMembers: async (name: string) => [...(members[name] ?? [])].sort(),
    });
    warn = vi.spyOn((engine as any).logger, 'warn');
  }

  const author = (id: string, row: Row) =>
    d.storeFor('sys_assignment_rule').set(id, { id, organization_id: 'org_a', object_name: 'ticket', active: true, sort_order: 0, ...row });
  const insert = (data: Row, org = 'org_a') =>
    engine.insert('ticket', { organization_id: org, ...data }, { context: { ...SYS, tenantId: org } });
  const fallback = [{ name: 'ticket_intake', object: 'ticket', active: true, entries: [{ name: 'all', assignTo: { type: 'queue', value: 'support' } }] }];

  beforeEach(() => {
    members = { support: ['u_a', 'u_b'], vip: ['u_v1', 'u_v2'] };
  });

  it('an organization rule wins over a declared rule that also matches; an unmatched row falls back to the declared rule', async () => {
    await boot(fallback);
    author('r1', { name: 'vip_tickets', criteria: 'record.priority == "high"', recipient_type: 'queue', recipient_id: 'vip' });
    expect(await insert({ subject: 'A', priority: 'high' })).toMatchObject({ queue: 'vip' });
    expect(await insert({ subject: 'B', priority: 'low' })).toMatchObject({ queue: 'support' });
  });

  it('routes with no declared rule at all, and only for the organization that authored it', async () => {
    await boot();
    author('r1', { name: 'all_tickets', recipient_type: 'queue', recipient_id: 'vip' });
    expect(await insert({ subject: 'A' })).toMatchObject({ queue: 'vip' });
    const other = await insert({ subject: 'B' }, 'org_b');
    expect(other.queue ?? null).toBeNull();
    expect(other.owner_id ?? null).toBeNull();
  });

  it('several organization rules are tried by `sort_order`, then by name; an inactive one is skipped', async () => {
    await boot(fallback);
    author('r1', { name: 'b_rule', sort_order: 1, recipient_type: 'queue', recipient_id: 'support' });
    author('r2', { name: 'a_rule', sort_order: 1, recipient_type: 'queue', recipient_id: 'vip' });
    author('r3', { name: 'z_rule', sort_order: 0, recipient_type: 'queue', recipient_id: 'support', active: false });
    expect(await insert({ subject: 'A' })).toMatchObject({ queue: 'vip' }); // a_rule before b_rule; z_rule is off
    author('r4', { name: 'first', sort_order: -5, criteria: 'record.priority == "low"', recipient_type: 'queue', recipient_id: 'support' });
    expect(await insert({ subject: 'B', priority: 'low' })).toMatchObject({ queue: 'support' });
  });

  it('a strategy rotates over the queue, its cursor keyed by the rule, its one entry (named after it) and the organization', async () => {
    await boot();
    author('r1', { name: 'rotate', recipient_type: 'queue', recipient_id: 'vip', strategy: 'round_robin' });
    const owners = [];
    for (const s of ['A', 'B', 'C']) owners.push((await insert({ subject: s })).owner_id);
    expect(owners).toEqual(['u_v1', 'u_v2', 'u_v1']);
    const cursor = [...d.storeFor('sys_assignment_cursor').values()];
    expect(cursor).toHaveLength(1);
    expect(cursor[0]).toMatchObject({ rule: 'rotate', entry: 'rotate', organization_id: 'org_a' });
  });

  it('a user target of an organization rule owns the row only while the user is a member there', async () => {
    await boot(fallback);
    author('r1', { name: 'to_lead', recipient_type: 'user', recipient_id: 'u_lead' });
    const lapsed = await insert({ subject: 'A' });
    expect(lapsed.owner_id ?? null).toBeNull();
    expect(lapsed.queue ?? null).toBeNull(); // the first match decides, even lapsed — no fall-through
    d.storeFor('sys_member').set('m1', { id: 'm1', user_id: 'u_lead', organization_id: 'org_a' });
    expect((await insert({ subject: 'B' })).owner_id).toBe('u_lead');
  });

  it('an organization rule under a declared rule\'s name is not evaluated — one name, one rule — and warns once', async () => {
    await boot(fallback);
    author('r1', { name: 'ticket_intake', recipient_type: 'queue', recipient_id: 'vip' });
    expect(await insert({ subject: 'A' })).toMatchObject({ queue: 'support' });
    await insert({ subject: 'B' });
    expect(warn.mock.calls.filter((c: unknown[]) => /named 'ticket_intake', which is the name of a rule an installed app declares/.test(String(c[0])))).toHaveLength(1);
  });

  it('organization rules that cannot be read route the row by no rule — never by the fallback they overtake', async () => {
    await boot(fallback);
    const find = d.driver.find.bind(d.driver);
    d.driver.find = async (object: string, ast: any) => {
      if (object === 'sys_assignment_rule') throw new Error('rules down');
      return find(object, ast);
    };
    const row = await insert({ subject: 'A' });
    expect(row.queue ?? null).toBeNull();
    expect(row.owner_id ?? null).toBeNull();
    expect(warn.mock.calls.some((c: unknown[]) => /assignment rules of organization 'org_a' could not be read/.test(String(c[0])))).toBe(true);
  });

  it('a stored row that does not read as a rule routes nothing and warns once; the next rule decides', async () => {
    await boot(fallback);
    author('r1', { name: 'broken', recipient_type: 'team', recipient_id: 'x' });
    expect(await insert({ subject: 'A' })).toMatchObject({ queue: 'support' });
    await insert({ subject: 'B' });
    expect(warn.mock.calls.filter((c: unknown[]) => /rule 'broken' that does not read as a rule/.test(String(c[0])))).toHaveLength(1);
  });

  it('the cheap path: with no table and no declared rule, an insert reads no rule at all', async () => {
    await boot([], { authoredTable: false });
    const seen: string[] = [];
    const find = d.driver.find.bind(d.driver);
    d.driver.find = async (object: string, ast: any) => { seen.push(object); return find(object, ast); };
    const row = await insert({ subject: 'A' });
    expect(row.queue ?? null).toBeNull();
    expect(seen).not.toContain('sys_assignment_rule');
    expect((engine as any).assignment().mayRoute('ticket')).toBe(false);
  });
});

describe('[ADR-0142 D5] assignmentExpressionRefusals — the save guard compiles by the paths the seam evaluates by', () => {
  it('a condition and an open-work predicate the engine can run are not refused; absent ones neither', () => {
    expect(assignmentExpressionRefusals({ criteria: 'record.priority == "high"', load: 'record.status != "closed"' })).toEqual([]);
    expect(assignmentExpressionRefusals({ criteria: { dialect: 'cel', source: 'record.priority == "high"' } })).toEqual([]);
    expect(assignmentExpressionRefusals({})).toEqual([]);
  });

  it('a condition that does not parse is refused at `criteria`', () => {
    expect(assignmentExpressionRefusals({ criteria: 'record.priority == (' })).toEqual([
      { field: 'criteria', message: expect.any(String) },
    ]);
  });

  it('an open-work predicate the pushdown compiler cannot lower is refused at `load` — the shape the seam would park on', () => {
    expect(assignmentExpressionRefusals({ load: 'size(record.subject) > 3' })).toEqual([
      { field: 'load', message: expect.any(String) },
    ]);
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
