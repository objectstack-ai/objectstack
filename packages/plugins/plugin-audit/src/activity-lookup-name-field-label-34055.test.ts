// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An object whose `nameField` is a LOOKUP is named, in its activity rows, by
 * the title of the record that lookup points at, not by the stored foreign key.
 *
 * The measured case is an app's join object titled by its person: a project
 * member declares `nameField: 'person'`, a lookup to `sys_user`. The record
 * page header follows that lookup to the user's name (the data door's
 * `$expand`, read as the reader). The CRUD mirror read the stored column and
 * wrote the 32-character user id into `record_label` and into every created /
 * updated / deleted sentence about the record.
 *
 * The writer follows the lookup through the resolver it already has for a
 * referenced record's title inside a summary (`resolveLookupTitles` in
 * `audit-writers.ts`): ADR-0079's title field of the TARGET object, the
 * target's declared API exposure, the credential / `internal` skips, and one
 * `id: { $in }` read projected to the id and that title column.
 *
 * What is pinned:
 *  - the create, update and delete rows are labelled by the target's title,
 *    in `record_label` and in the sentence, and the label still declares the
 *    lookup field as its source (the declaration the read side redacts by);
 *  - a `user`-typed `nameField` (whose target is implied) is followed the same way;
 *  - a multi-value lookup `nameField` is labelled by every title it names;
 *  - an id the target has no row for keeps the stored value, as before;
 *  - READ SCOPE: the title is read as the WRITER. A writer refused the target
 *    read, or served the target row without its title column, gets the stored
 *    value, never a title it could not have read itself. A system write reads
 *    as the system;
 *  - a target whose declared exposure does not serve `get` is not read at all;
 *  - COST: exactly one read of the target per write, projected to the id and
 *    the title column, `$in` over every id the label names; an object whose
 *    `nameField` is not a lookup pays no read for its label at all.
 *
 * A bare engine, the real `installAuditWriters`, and a copy-returning counting
 * driver (the harness `activity-actor-name.test.ts` uses). The read refusals
 * are engine middleware, which is the layer the security service enforces on.
 *
 * ⚠️ No test title states a value.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { installAuditWriters } from './audit-writers.js';
import { singlePostureDefaultOrganization } from './__tests__/single-posture-tenancy.js';

const f = (name: string, type: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, type, ...extra }) as any;

const sysAuditLog = {
  name: 'sys_audit_log', label: 'Audit Log',
  fields: {
    id: f('id', 'text', { primaryKey: true }), action: f('action', 'text'),
    user_id: f('user_id', 'text'), object_name: f('object_name', 'text'),
    record_id: f('record_id', 'text'), old_value: f('old_value', 'textarea'),
    new_value: f('new_value', 'textarea'), tenant_id: f('tenant_id', 'text'),
    actor: f('actor', 'text'), metadata: f('metadata', 'textarea'),
  },
};

const sysActivity = {
  name: 'sys_activity', label: 'Activity',
  fields: {
    id: f('id', 'text', { primaryKey: true }), type: f('type', 'text'),
    timestamp: f('timestamp', 'datetime'), summary: f('summary', 'text'),
    actor_id: f('actor_id', 'text'), actor_name: f('actor_name', 'text'),
    object_name: f('object_name', 'text'), record_id: f('record_id', 'text'),
    record_label: f('record_label', 'text'), metadata: f('metadata', 'textarea'),
  },
};

const sysUser = {
  name: 'sys_user', label: 'User', nameField: 'name',
  fields: { id: f('id', 'text', { primaryKey: true }), name: f('name', 'text'), email: f('email', 'email') },
};

/** A target whose declared exposure serves no `get`: an app's private lookup table. */
const privateCode = {
  name: 'ln_private_code', label: 'Private Code', nameField: 'name',
  enable: { apiEnabled: false },
  fields: { id: f('id', 'text', { primaryKey: true }), name: f('name', 'text') },
};

/** The measured shape: a join object titled by its person. */
const member = {
  name: 'ln_member', label: 'Project Member', nameField: 'person',
  fields: {
    id: f('id', 'text', { primaryKey: true }),
    person: f('person', 'lookup', { reference: 'sys_user' }),
    // [#36290] Values off: the update row is named by the record label, the text these pins read.
    rate: f('rate', 'number', { fieldHistory: false }),
  },
};

/** A `user` field as the title: its target is implied, not restated. */
const assignment = {
  name: 'ln_assignment', label: 'Assignment', nameField: 'assignee',
  fields: { id: f('id', 'text', { primaryKey: true }), assignee: f('assignee', 'user'), note: f('note', 'text') },
};

/** A multi-value lookup as the title. */
const crew = {
  name: 'ln_crew', label: 'Crew', nameField: 'people',
  fields: {
    id: f('id', 'text', { primaryKey: true }),
    people: f('people', 'lookup', { reference: 'sys_user', multiple: true }),
  },
};

/** Titled by a lookup whose target does not serve `get`. */
const coded = {
  name: 'ln_coded', label: 'Coded', nameField: 'code',
  fields: { id: f('id', 'text', { primaryKey: true }), code: f('code', 'lookup', { reference: 'ln_private_code' }) },
};

/** The control: titled by a text field. */
const plain = {
  name: 'ln_plain', label: 'Plain', nameField: 'title',
  fields: { id: f('id', 'text', { primaryKey: true }), title: f('title', 'text'), owner: f('owner', 'lookup', { reference: 'sys_user' }) },
};

function makeCountingDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const copy = <T,>(r: T): T => (r == null ? r : JSON.parse(JSON.stringify(r)));
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries<any>(where)) {
      if (k === '$and' && Array.isArray(v)) {
        if (!v.every((sub) => matches(row, sub))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      if (v && typeof v === 'object' && '$in' in v) {
        if (!(v.$in as unknown[]).includes(row[k])) return false;
        continue;
      }
      const expected = (v && typeof v === 'object' && '$eq' in v) ? v.$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const select = (object: string, where: any, limit?: number) => {
    const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, where));
    const page = typeof limit === 'number' ? rows.slice(0, limit) : rows;
    return page.map(copy);
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) { return select(object, ast?.where, ast?.limit); },
    async findOne(object: string, ast: any) { return select(object, ast?.where, 1)[0] ?? null; },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return copy(row);
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return copy(updated);
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && storeFor(object).has(id) ? this.update(object, id, data) : this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(object, ast);
      const s = storeFor(object);
      for (const r of rows) s.set(r.id as string, { ...s.get(r.id as string), ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(object: string, ast: any) {
      const rows = await this.find(object, ast);
      for (const r of rows) storeFor(object).delete(r.id as string);
      return rows.length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  const findSpy = vi.spyOn(driver, 'find');
  /** The query of every `find` that read `object`, in call order. */
  const queriesOf = (object: string): Array<{ fields?: string[]; where?: any }> =>
    findSpy.mock.calls.filter(([o]) => o === object).map(([, ast]) => ast as { fields?: string[]; where?: any });
  return { driver, queriesOf, storeFor };
}

const OWNER_PACKAGE = 'com.objectstack.test.activity-lookup-name-field-label';
const ADA = 'usr_ada_lovelace_000000000000000';
const GRACE = 'usr_grace_hopper_00000000000000';
const ALAN = 'usr_alan_turing_000000000000000';
/**
 * A writer the security layer refuses any `sys_user` read that asks for the
 * `name` column (the predicate/projection guard's 403). The engine's own
 * lookup-integrity read asks for no such column, so the write itself lands.
 */
const REFUSED_WRITER = 'usr_refused_writer';
/** A writer served `sys_user` rows without the `name` column. */
const NAMELESS_WRITER = 'usr_nameless_writer';

/** The label read: the projection `resolveLookupTitles` asks of a title target. */
const isTitleRead = (q: { fields?: string[] }) =>
  Array.isArray(q.fields) && q.fields.length === 2 && q.fields.includes('id') && q.fields.includes('name');

async function boot() {
  const engine = new ObjectQL();
  const stub = makeCountingDriver();
  engine.registerDriver(stub.driver, true);
  await engine.init();
  for (const o of [sysAuditLog, sysActivity, sysUser, privateCode, member, assignment, crew, coded, plain]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }
  installAuditWriters(engine as any, 'test.audit', { getDefaultOrganizationId: singlePostureDefaultOrganization });
  // The security layer's two answers for the two restricted writers, at the
  // layer it enforces on: refused outright, and served without the column.
  engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
    const userId = op.context && !op.context.isSystem ? op.context.userId : undefined;
    const projected: unknown = op.ast?.fields ?? op.options?.fields;
    if (op.operation === 'find' && userId === REFUSED_WRITER && Array.isArray(projected) && projected.includes('name')) {
      throw Object.assign(new Error('PERMISSION_DENIED: no read on sys_user'), { code: 'PERMISSION_DENIED', status: 403 });
    }
    await next();
    if (op.operation === 'find' && userId === NAMELESS_WRITER && Array.isArray(op.result)) {
      op.result = op.result.map(({ name: _hidden, ...rest }: Record<string, unknown>) => rest);
    }
  }, { object: 'sys_user' });
  await engine.insert('sys_user', { id: ADA, name: 'Ada Lovelace', email: 'ada@example.com' });
  await engine.insert('sys_user', { id: GRACE, name: 'Grace Hopper', email: 'grace@example.com' });
  await engine.insert('sys_user', { id: ALAN, name: 'Alan Turing', email: 'alan@example.com' });
  await engine.insert('ln_private_code', { id: 'code_1', name: 'Internal Code Name' });
  return { engine, ...stub };
}

const as = (userId: string) => ({ context: { userId } });

const activityFor = (storeFor: (o: string) => Map<string, Record<string, unknown>>, recordId: string) =>
  Array.from(storeFor('sys_activity').values()).filter((r) => r.record_id === recordId);

const labelSources = (row: Record<string, unknown>): unknown =>
  JSON.parse(String(row.metadata)).text_sources?.record_label;

describe('an object whose nameField is a lookup is named by the target record\'s title', () => {
  it('the create, update and delete rows carry the target title in record_label and in the sentence', async () => {
    const { engine, storeFor } = await boot();

    await engine.insert('ln_member', { id: 'm1', person: GRACE, rate: 100 }, as(ADA) as any);
    await engine.update('ln_member', { rate: 120 }, { where: { id: 'm1' }, ...as(ADA) } as any);
    await engine.delete('ln_member', { where: { id: 'm1' }, ...as(ADA) } as any);

    const rows = activityFor(storeFor, 'm1');
    expect(rows.map((r) => r.type)).toEqual(['created', 'updated', 'deleted']);
    for (const row of rows) {
      expect(row.record_label).toBe('Grace Hopper');
      expect(String(row.summary)).toContain('"Grace Hopper"');
      expect(String(row.summary)).not.toContain(GRACE);
      // The label is still a value of the lookup field, and says so.
      expect(labelSources(row)).toEqual(['person']);
    }
    expect(rows.map((r) => r.summary)).toEqual([
      'Created Project Member "Grace Hopper"',
      'Updated Project Member "Grace Hopper": rate',
      'Deleted Project Member "Grace Hopper"',
    ]);
  });

  it('a user-typed nameField is followed to the user\'s name, its target implied', async () => {
    const { engine, storeFor } = await boot();

    await engine.insert('ln_assignment', { id: 'a1', assignee: ALAN, note: 'x' }, as(ADA) as any);

    const [row] = activityFor(storeFor, 'a1');
    expect(row.record_label).toBe('Alan Turing');
    expect(row.summary).toBe('Created Assignment "Alan Turing"');
  });

  it('a multi-value lookup nameField names every target it holds', async () => {
    const { engine, storeFor } = await boot();

    await engine.insert('ln_crew', { id: 'c1', people: [GRACE, ALAN] }, as(ADA) as any);

    const [row] = activityFor(storeFor, 'c1');
    expect(row.record_label).toBe('Grace Hopper, Alan Turing');
  });

  it('a target row whose title is blank keeps the stored value', async () => {
    const { engine, storeFor } = await boot();
    await engine.insert('sys_user', { id: 'usr_blank_name', name: '   ', email: 'blank@example.com' });

    await engine.insert('ln_member', { id: 'm2', person: 'usr_blank_name', rate: 1 }, as(ADA) as any);

    const [row] = activityFor(storeFor, 'm2');
    expect(row.record_label).toBe('usr_blank_name');
  });
});

describe('the title is read as the writer: no label names a title the writer could not read', () => {
  it('control: a writer who may read the target gets its title', async () => {
    const { engine, storeFor } = await boot();

    await engine.insert('ln_member', { id: 's0', person: GRACE, rate: 1 }, as(ADA) as any);

    expect(activityFor(storeFor, 's0')[0].record_label).toBe('Grace Hopper');
  });

  it('a writer the security layer refuses the target read gets the stored value, not the title', async () => {
    const { engine, storeFor } = await boot();

    await engine.insert('ln_member', { id: 's1', person: GRACE, rate: 1 }, as(REFUSED_WRITER) as any);

    const [row] = activityFor(storeFor, 's1');
    expect(row.record_label).toBe(GRACE);
    expect(String(row.summary)).not.toContain('Grace Hopper');
    // The write itself, and its activity row, still landed.
    expect(storeFor('ln_member').has('s1')).toBe(true);
  });

  it('a writer served the target row without its title column gets the stored value', async () => {
    const { engine, storeFor } = await boot();

    await engine.insert('ln_member', { id: 's2', person: GRACE, rate: 1 }, as(NAMELESS_WRITER) as any);

    const [row] = activityFor(storeFor, 's2');
    expect(row.record_label).toBe(GRACE);
    expect(String(row.summary)).not.toContain('Grace Hopper');
  });

  it('a system write reads the target as the system', async () => {
    const { engine, storeFor } = await boot();

    await engine.insert('ln_member', { id: 's3', person: GRACE, rate: 1 }, { context: { isSystem: true } } as any);

    expect(activityFor(storeFor, 's3')[0].record_label).toBe('Grace Hopper');
  });

  it('a target whose declared exposure serves no get is never read for a label', async () => {
    const { engine, storeFor, queriesOf } = await boot();
    const titleReads = () => queriesOf('ln_private_code').filter(isTitleRead).length;
    const before = titleReads();

    await engine.insert('ln_coded', { id: 'k1', code: 'code_1' }, as(ADA) as any);

    const [row] = activityFor(storeFor, 'k1');
    expect(row.record_label).toBe('code_1');
    expect(titleReads() - before).toBe(0);
  });
});

describe('the label costs one batched read of the target per write', () => {
  it('a create reads the target once, projected to the id and the title column', async () => {
    const { engine, queriesOf } = await boot();
    const before = queriesOf('sys_user').filter(isTitleRead).length;

    await engine.insert('ln_member', { id: 'r1', person: GRACE, rate: 1 }, { context: { isSystem: true } } as any);

    const reads = queriesOf('sys_user').filter(isTitleRead).slice(before);
    expect(reads).toHaveLength(1);
    expect(reads[0].where).toEqual({ id: { $in: [GRACE] } });
  });

  it('a multi-value lookup nameField costs one read for all of its targets', async () => {
    const { engine, queriesOf } = await boot();
    const before = queriesOf('sys_user').filter(isTitleRead).length;

    await engine.insert('ln_crew', { id: 'r2', people: [GRACE, ALAN, ADA] }, { context: { isSystem: true } } as any);

    const reads = queriesOf('sys_user').filter(isTitleRead).slice(before);
    expect(reads).toHaveLength(1);
    expect(reads[0].where?.id?.$in).toEqual([GRACE, ALAN, ADA]);
  });

  it('control: an object titled by a text field reads nothing for its label, a lookup field beside it included', async () => {
    const { engine, queriesOf } = await boot();
    const titleReads = () => queriesOf('sys_user').filter(isTitleRead).length;
    const before = titleReads();

    await engine.insert('ln_plain', { id: 'r3', title: 'Plain One', owner: GRACE }, { context: { isSystem: true } } as any);
    await engine.update('ln_plain', { title: 'Plain Two' }, { where: { id: 'r3' }, context: { isSystem: true } } as any);

    expect(titleReads() - before).toBe(0);
  });
});
