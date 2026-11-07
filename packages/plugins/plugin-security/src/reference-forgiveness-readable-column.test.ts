// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29029, #29062] The update's reference forgiveness compares only stored
 * values the caller may read.
 *
 * A non-system write may name, in a `lookup`, `user` or `master_detail`
 * field, only a record its caller can read; a value it cannot read answers
 * `reference_not_found`. An update that carries back a value the row already
 * stores is not judged again (#29062) — and that comparison reads the stored
 * row as the caller may read it. A column the caller may edit but not read
 * (`{ readable: false, editable: true }`, which the field-write gate admits)
 * holds no stored value for it, so it forgives nothing: the value is refused
 * like any other unreadable reference, and the answer is the same whatever
 * the column holds.
 *
 * ## The rig
 *
 * The real engine and the real security plugin, on a store-backed driver.
 * The caller may read and edit tasks and holds no read on the target object
 * or on `sys_user`, so every target id below is one it cannot read. Two
 * grants differ only in the reference columns' `readable` bit.
 *
 * ## Pins
 *
 *  - for each of the three types, by id and in bulk: a column the caller may
 *    edit but not read answers a value it already stores exactly as it
 *    answers a value it does not (status, code, field and sentence), and the
 *    rows are untouched;
 *  CONTROLS: the same grant edits another column of the same rows; a caller
 *  who can read the column keeps the forgiveness (the stored value carried
 *  back lands) and is refused a new unreadable value; a system write keeps
 *  its exemption.
 *
 * Two more update seams that compare a sent value with the stored row are
 * pinned on the same rule at the end of this file: the stored header a
 * parent-scoped `requiredWhen` pre-check reads, and the `secret` reference a
 * write may keep.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL, SECRET_MASK } from '@objectstack/objectql';
import { resolveThrownHttpError } from '@objectstack/types';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';

import '@objectstack/spec';
import '@objectstack/formula';

const TARGET = 'rfc_target';
const ITEM = 'rfc_item';

const ITEM_OBJECT = {
  name: ITEM,
  fields: {
    title: { type: 'text' },
    duty: { type: 'lookup', reference: TARGET },
    assignee: { type: 'user' },
    header: { type: 'master_detail', reference: TARGET },
  },
};

const REFERENCE_FIELDS = ['duty', 'assignee', 'header'] as const;

/** Edits tasks, and may edit but not read their reference columns; reads no target. */
const HIDDEN_COLUMNS: PermissionSet = {
  name: 'member_default',
  label: 'Task editor who may not read the reference columns',
  objects: { [ITEM]: { allowRead: true, allowCreate: true, allowEdit: true } },
  fields: Object.fromEntries(REFERENCE_FIELDS.map((f) => [`${ITEM}.${f}`, { readable: false, editable: true }])),
} as unknown as PermissionSet;

/** The same grant with the reference columns readable. */
const READABLE_COLUMNS: PermissionSet = {
  name: 'member_default',
  label: 'Task editor who may read the reference columns',
  objects: { [ITEM]: { allowRead: true, allowCreate: true, allowEdit: true } },
  fields: Object.fromEntries(REFERENCE_FIELDS.map((f) => [`${ITEM}.${f}`, { readable: true, editable: true }])),
} as unknown as PermissionSet;

const CALLER = { userId: 'u_editor', tenantId: 'org-1', positions: [], permissions: [], posture: 'MEMBER' };
const SYS_CTX = { isSystem: true, userId: 'usr_system' };

/** What the rows store, per field, and a second id of the same object the caller cannot read either. */
const STORED: Record<(typeof REFERENCE_FIELDS)[number], string> = { duty: 't_stored', assignee: 'u_stored', header: 't_stored' };
const OTHER: Record<(typeof REFERENCE_FIELDS)[number], string> = { duty: 't_other', assignee: 'u_other', header: 't_other' };

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      const cond = v as any;
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        if ('$in' in cond) return Array.isArray(cond.$in) && cond.$in.includes(row?.[k]);
        if ('$eq' in cond) return row?.[k] === cond.$eq;
      }
      return row?.[k] === cond;
    });
  };
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      const bounded = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      const fields: string[] | undefined = ast?.fields;
      if (!fields) return bounded.map((r) => ({ ...r }));
      return bounded.map((r) => {
        const out: any = {};
        for (const f of fields) if (r[f] !== undefined) out[f] = r[f];
        return out;
      });
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return { ...row };
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const hits = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      for (const r of hits) storeFor(object).set(r.id, { ...r, ...data, id: r.id });
      return hits.length;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where)).length;
    },
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

async function boot(set: PermissionSet) {
  const engine = new ObjectQL();
  const d = makeDriver();
  engine.registerDriver(d.driver, true);
  await engine.init();
  engine.registry.registerObject({ name: TARGET, fields: { name: { type: 'text' } } } as any, 'test-package');
  engine.registry.registerObject({ name: 'sys_user', fields: { name: { type: 'text' }, email: { type: 'text' } } } as any, 'test-package');
  engine.registry.registerObject(ITEM_OBJECT as any, 'test-package');
  for (const id of ['t_stored', 't_other']) d.storeFor(TARGET).set(id, { id, name: id });
  for (const id of ['u_stored', 'u_other']) d.storeFor('sys_user').set(id, { id, name: id, email: `${id}@example.test` });

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [set],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);

  // Two tasks the caller may edit, each storing the same unreadable ids.
  for (const id of ['k1', 'k2']) {
    await engine.insert(ITEM, { id, title: 'stored', ...STORED }, { context: SYS_CTX } as any);
  }
  return { engine, storeFor: d.storeFor };
}

type Door = 'update by id' | 'bulk update';
const DOORS: Door[] = ['update by id', 'bulk update'];

const write = (engine: ObjectQL, door: Door, payload: Record<string, unknown>, context: Record<string, unknown> = CALLER) =>
  door === 'update by id'
    ? engine.update(ITEM, payload, { where: { id: 'k1' }, context } as any)
    : engine.update(ITEM, payload, { where: { id: { $in: ['k1', 'k2'] } }, multi: true, context } as any);

async function refusalOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused, but it succeeded');
}

/**
 * The answer as every HTTP door reads it (ADR-0112) — status, code, each field
 * finding and the sentence — with the id the caller sent written as `ID`, so
 * two answers to two ids compare whole.
 */
function answerOf(err: unknown, sentId: string): string {
  const thrown = resolveThrownHttpError(err);
  const out = (s: unknown) => String(s ?? '').split(sentId).join('ID');
  return JSON.stringify({
    status: thrown.status,
    code: thrown.code,
    message: out((err as Error).message),
    fields: ((err as any)?.fields ?? []).map((f: any) => ({ field: f.field, code: f.code, message: out(f.message) })),
  });
}

const storedItems = (storeFor: (o: string) => Map<string, any>) =>
  [...storeFor(ITEM).values()].map((r) => ({ id: r.id, title: r.title, duty: r.duty, assignee: r.assignee, header: r.header }));

const UNTOUCHED = ['k1', 'k2'].map((id) => ({ id, title: 'stored', ...STORED }));

describe('the update\'s reference forgiveness compares only stored values the caller may read', () => {
  describe.each(REFERENCE_FIELDS)('the %s column, which the caller may edit but not read', (field) => {
    it.each(DOORS)('%s — a value the rows store answers exactly as a value they do not', async (door) => {
      const { engine, storeFor } = await boot(HIDDEN_COLUMNS);
      const storedValue = await refusalOf(() => write(engine, door, { [field]: STORED[field] }));
      const otherValue = await refusalOf(() => write(engine, door, { [field]: OTHER[field] }));
      const answer = JSON.parse(answerOf(storedValue, STORED[field]));
      expect(answer.status).toBe(400);
      expect(answer.code).toBe('VALIDATION_FAILED');
      expect(answer.fields.map((f: any) => ({ field: f.field, code: f.code }))).toEqual([{ field, code: 'reference_not_found' }]);
      expect(answerOf(storedValue, STORED[field])).toBe(answerOf(otherValue, OTHER[field]));
      expect(storedItems(storeFor)).toEqual(UNTOUCHED);
    });

    it.each(DOORS)('%s — control: the same grant edits another column of the same rows', async (door) => {
      const { engine, storeFor } = await boot(HIDDEN_COLUMNS);
      await write(engine, door, { title: 'renamed' });
      expect(storedItems(storeFor).find((r) => r.id === 'k1')).toEqual({ id: 'k1', title: 'renamed', ...STORED });
    });
  });

  describe.each(REFERENCE_FIELDS)('control: the %s column, which the caller can read', (field) => {
    it.each(DOORS)('%s — the value the rows store, carried back, lands', async (door) => {
      const { engine, storeFor } = await boot(READABLE_COLUMNS);
      await write(engine, door, { title: 'renamed', [field]: STORED[field] });
      expect(storedItems(storeFor).find((r) => r.id === 'k1')).toEqual({ id: 'k1', title: 'renamed', ...STORED });
    });

    it.each(DOORS)('%s — a value the rows do not store is refused as one the caller cannot read', async (door) => {
      const { engine, storeFor } = await boot(READABLE_COLUMNS);
      const err = await refusalOf(() => write(engine, door, { [field]: OTHER[field] }));
      const answer = JSON.parse(answerOf(err, OTHER[field]));
      expect({ status: answer.status, code: answer.code }).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
      expect(answer.fields.map((f: any) => ({ field: f.field, code: f.code }))).toEqual([{ field, code: 'reference_not_found' }]);
      expect(storedItems(storeFor)).toEqual(UNTOUCHED);
    });
  });

  it.each(DOORS)('%s — control: a system write keeps its exemption', async (door) => {
    const { engine, storeFor } = await boot(HIDDEN_COLUMNS);
    await write(engine, door, { duty: OTHER.duty }, SYS_CTX);
    expect(storedItems(storeFor).find((r) => r.id === 'k1')?.duty).toBe(OTHER.duty);
  });
});

/**
 * The same rule on the two other update seams that compare a sent value with
 * the stored row: the master-detail header the ADR-0113 pre-check of a
 * parent-scoped `requiredWhen` reads, and the `secret` reference a write may
 * keep. Each is answered from the stored row only as the caller's own read
 * door serves it, so for a column the caller may edit but not read the answer
 * is the same whatever the column holds.
 *
 * The rig is the one above with its own objects: a header the caller can
 * read, a detail line whose `header` FK carries the grant's `readable` bit,
 * and a vault whose `token` secret does. Rows are seeded straight into the
 * store, so a line can hold a stored state no write would produce (a legacy
 * line that already lacks its required note).
 */
const HEADER = 'rfc_header';
const LINE = 'rfc_line';
const VAULT = 'rfc_vault';

const HEADER_OBJECT = { name: HEADER, fields: { name: { type: 'text' }, status: { type: 'text' } } };
const LINE_OBJECT = {
  name: LINE,
  fields: {
    title: { type: 'text' },
    header: { type: 'master_detail', reference: HEADER },
    note: { type: 'text', requiredWhen: "parent.status == 'paid'" },
  },
};
const SYS_SECRET_OBJECT = {
  name: 'sys_secret', systemFields: { tenant: false },
  fields: {
    namespace: { type: 'text' }, key: { type: 'text' }, kms_key_id: { type: 'text' }, alg: { type: 'text' },
    version: { type: 'number' }, ciphertext: { type: 'text' }, created_at: { type: 'datetime' },
  },
};
const VAULT_OBJECT = { name: VAULT, fields: { name: { type: 'text' }, token: { type: 'secret' } } };

/** Reads headers; edits lines and vaults; `readable` is the one bit two grants differ in. */
function columnGrant(readable: boolean): PermissionSet {
  return {
    name: 'member_default',
    label: readable ? 'Editor who may read the column' : 'Editor who may edit but not read the column',
    objects: {
      [HEADER]: { allowRead: true },
      [LINE]: { allowRead: true, allowCreate: true, allowEdit: true },
      [VAULT]: { allowRead: true, allowCreate: true, allowEdit: true },
    },
    fields: {
      [`${LINE}.header`]: { readable, editable: true },
      [`${VAULT}.token`]: { readable, editable: true },
    },
  } as unknown as PermissionSet;
}

function makeCrypto() {
  let n = 0;
  return {
    async encrypt(plain: string) {
      n += 1;
      return { id: `sec_${n}`, kmsKeyId: 'local', alg: 'test-b64', version: 1, ciphertext: Buffer.from(plain).toString('base64') };
    },
    async decrypt(handle: { ciphertext: string }) { return Buffer.from(handle.ciphertext, 'base64').toString('utf8'); },
    async rotateKey(handle: unknown) { return handle; },
    digest(plain: string) { return `d:${plain.length}`; },
    async keyedDigest(plain: string) { return `k:${plain.length}`; },
  };
}

async function bootStored(set: PermissionSet) {
  const engine = new ObjectQL();
  const d = makeDriver();
  engine.registerDriver(d.driver, true);
  await engine.init();
  for (const object of [HEADER_OBJECT, LINE_OBJECT, SYS_SECRET_OBJECT, VAULT_OBJECT]) {
    engine.registry.registerObject(object as any, 'test-package');
  }
  engine.setCryptoProvider(makeCrypto() as never);
  d.storeFor(HEADER).set('h_paid', { id: 'h_paid', name: 'paid', status: 'paid' });
  d.storeFor(HEADER).set('h_open', { id: 'h_open', name: 'open', status: 'open' });

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [set],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  return { engine, storeFor: d.storeFor };
}

/** The answer a write gets, whole: `ok`, or the status, code, sentence and field findings (ADR-0112). */
async function outcomeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'ok';
  } catch (err) {
    const thrown = resolveThrownHttpError(err);
    return JSON.stringify({
      status: thrown.status,
      code: thrown.code,
      message: (err as Error).message,
      fields: ((err as any)?.fields ?? []).map((f: any) => ({ field: f.field, code: f.code, message: f.message })),
    });
  }
}

describe('a parent-scoped requiredWhen pre-check reads the stored header only through a FK the caller may read', () => {
  /** Two lines that already lack the note, each hanging off `stored`. */
  async function rig(readable: boolean, stored: 'h_paid' | 'h_open') {
    const booted = await bootStored(columnGrant(readable));
    for (const id of ['l1', 'l2']) booted.storeFor(LINE).set(id, { id, title: 'stored', header: stored, note: null });
    return booted;
  }
  const writeLines = (engine: ObjectQL, door: Door, payload: Record<string, unknown>, context: Record<string, unknown> = CALLER) =>
    door === 'update by id'
      ? engine.update(LINE, payload, { where: { id: 'l1' }, context } as any)
      : engine.update(LINE, payload, { where: { id: { $in: ['l1', 'l2'] } }, multi: true, context } as any);
  const linesOf = (storeFor: (o: string) => Map<string, any>) =>
    [...storeFor(LINE).values()].map((r) => ({ id: r.id, title: r.title, header: r.header }));

  it.each(DOORS)('%s — naming a header with the FK hidden answers the same whatever the line stores', async (door) => {
    const answers: string[] = [];
    for (const stored of ['h_paid', 'h_open'] as const) {
      const { engine, storeFor } = await rig(false, stored);
      answers.push(await outcomeOf(() => writeLines(engine, door, { title: 'renamed', header: 'h_paid' })));
      // Refused before the statement: the lines are as stored.
      expect(linesOf(storeFor)).toEqual(['l1', 'l2'].map((id) => ({ id, title: 'stored', header: stored })));
    }
    expect(answers[0]).toBe(answers[1]);
    const answer = JSON.parse(answers[0]);
    expect({ status: answer.status, code: answer.code }).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    expect(answer.fields.map((f: any) => ({ field: f.field, code: f.code }))).toEqual([{ field: 'note', code: 'required' }]);
  });

  it.each(DOORS)('%s — control: with the FK hidden, an edit that does not name it is judged as before', async (door) => {
    const { engine, storeFor } = await rig(false, 'h_paid');
    await writeLines(engine, door, { title: 'renamed' });
    expect(linesOf(storeFor).find((r) => r.id === 'l1')).toEqual({ id: 'l1', title: 'renamed', header: 'h_paid' });
  });

  it.each(DOORS)('%s — control: a caller who reads the FK keeps the legacy rest, and a repoint is judged as before', async (door) => {
    const resting = await rig(true, 'h_paid');
    await writeLines(resting.engine, door, { title: 'renamed', header: 'h_paid' });
    expect(linesOf(resting.storeFor).find((r) => r.id === 'l1')).toEqual({ id: 'l1', title: 'renamed', header: 'h_paid' });

    const repointed = await rig(true, 'h_open');
    const answer = JSON.parse(await outcomeOf(() => writeLines(repointed.engine, door, { title: 'renamed', header: 'h_paid' })));
    expect(answer.fields.map((f: any) => ({ field: f.field, code: f.code }))).toEqual([{ field: 'note', code: 'required' }]);
    expect(linesOf(repointed.storeFor).find((r) => r.id === 'l1')).toEqual({ id: 'l1', title: 'stored', header: 'h_open' });
  });

  it.each(DOORS)('%s — control: a system write is judged on the stored row as before', async (door) => {
    const resting = await rig(false, 'h_paid');
    await writeLines(resting.engine, door, { title: 'renamed', header: 'h_paid' }, SYS_CTX);
    expect(linesOf(resting.storeFor).find((r) => r.id === 'l1')).toEqual({ id: 'l1', title: 'renamed', header: 'h_paid' });

    const repointed = await rig(false, 'h_open');
    const answer = JSON.parse(await outcomeOf(() => writeLines(repointed.engine, door, { title: 'renamed', header: 'h_paid' }, SYS_CTX)));
    expect(answer.fields.map((f: any) => ({ field: f.field, code: f.code }))).toEqual([{ field: 'note', code: 'required' }]);
  });
});

describe('a secret reference on a non-system update is answered the same whatever the column holds', () => {
  /** Two vault rows sealed by a system write; `v1` and `v2` hold different refs. */
  async function rig(readable: boolean) {
    const booted = await bootStored(columnGrant(readable));
    for (const id of ['v1', 'v2']) await booted.engine.insert(VAULT, { id, name: id, token: `${id}-value` }, { context: SYS_CTX } as any);
    const refOf = (id: string) => booted.storeFor(VAULT).get(id)?.token as string;
    return { ...booted, refOf };
  }
  const writeVault = (engine: ObjectQL, door: Door, payload: Record<string, unknown>, context: Record<string, unknown> = CALLER) =>
    door === 'update by id'
      ? engine.update(VAULT, payload, { where: { id: 'v1' }, context } as any)
      : engine.update(VAULT, payload, { where: { id: { $in: ['v1'] } }, multi: true, context } as any);

  describe.each([false, true])('the caller reads the column: %s', (readable) => {
    it.each(DOORS)('%s — the ref the row holds, another row\'s and one naming nothing get one answer', async (door) => {
      const { engine, storeFor, refOf } = await rig(readable);
      const before = [...storeFor(VAULT).values()].map((r) => ({ ...r }));
      const own = await outcomeOf(() => writeVault(engine, door, { name: 'renamed', token: refOf('v1') }));
      const other = await outcomeOf(() => writeVault(engine, door, { name: 'renamed', token: refOf('v2') }));
      const none = await outcomeOf(() => writeVault(engine, door, { name: 'renamed', token: 'secret:sec_none' }));
      expect(own).toBe(other);
      expect(own).toBe(none);
      expect(JSON.parse(own)).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      expect([...storeFor(VAULT).values()]).toEqual(before);
    });

    it.each(DOORS)('%s — control: a new value is sealed, and the echoed mask leaves the column alone', async (door) => {
      const { engine, storeFor, refOf } = await rig(readable);
      const held = refOf('v1');
      await writeVault(engine, door, { name: 'masked', token: SECRET_MASK });
      expect(storeFor(VAULT).get('v1')).toMatchObject({ name: 'masked', token: held });
      await writeVault(engine, door, { token: 'v1-next' });
      expect(refOf('v1')).toMatch(/^secret:/);
      expect(refOf('v1')).not.toBe(held);
      expect(await engine.resolveSecretField(VAULT, 'v1', 'token')).toBe('v1-next');
    });
  });

  it.each(DOORS)('%s — control: a system write keeps the pass-through', async (door) => {
    const { engine, refOf } = await rig(false);
    await writeVault(engine, door, { token: refOf('v2') }, SYS_CTX);
    expect(refOf('v1')).toBe(refOf('v2'));
  });
});
