// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6656, Option A+] The audit writer consumes the engine's bound
 * `ctx.previous` and normalises what it records.
 *
 * ## The two halves, and why one without the other was rejected
 *
 * **Half 1 — the read is retired.** `captureBefore` used to issue its own
 * `ql.findOne` on `beforeUpdate` / `beforeDelete`. The engine binds `previous`
 * before every `before*` dispatch and its demand gate is the SAME predicate as
 * its dispatch gate, so that read was redundant on every path; on the predicate
 * path it was worse than redundant, because #5574's per-row `input.id` binding
 * defeated the handler's own `if (!id) return` bulk guard and it read every
 * matched row, then discarded every result.
 *
 * **Half 2 — both sides of the diff get one view.** Half 1 alone (the ruled-out
 * "Option A") would have made both sides same-SOURCE and stopped there — which
 * levels the surface DOWNWARD: single-id delete `old_value` would have started
 * recording the stored `secret:` ref where it records `••••••••` today. So the
 * writer masks the credential classes on BOTH sides, which additionally closes
 * a leak that predates this card: the ref, and for `password` fields the
 * CLEARTEXT, were already reaching `sys_audit_log.new_value` on every create
 * and update.
 *
 * ## What each case measures
 *
 *  1. **the read is gone, single-id** — `update()` and `delete()` each pay
 *     exactly ONE `driver.findOne`: the engine's. Red if `captureBefore`
 *     returns (delta 2).
 *  2. **the read is gone, predicate** — ZERO per-row `findOne`, where the old
 *     code paid one per matched row. This is the larger half of the saving.
 *  3. **the engine still buys the read, and audit still consumes it** — the
 *     saving is a read that disappeared, not a hook that stopped seeing the
 *     prior row. Pinned together with case 1 so "0 reads" can never pass by
 *     audit going blind.
 *  4. **the compliance face** — single-id delete `old_value` still reads
 *     `••••••••` for a `secret` field, byte-identical to before this change.
 *     This is the face the ruling protects explicitly.
 *  5. **the phantom rows** — a write that touches neither the secret, the file
 *     reference nor the formula records a diff for NONE of them. Three field
 *     classes, one case, because one root cause (two pipelines) produced all
 *     three.
 *  6. **a real credential change is still recorded** — the guard against
 *     "fixed the phantom rows by deleting the audit trail". Change detection
 *     runs on the raw values, so a rotation still writes a row; only the
 *     recorded VALUES are masked.
 *  7. **the pre-existing leak** — neither the `secret:` ref nor a `password`
 *     field's cleartext reaches `new_value` on create or update.
 *  8. **non-mutating** — normalising must not rewrite `ctx.result`, which is
 *     the record the caller gets back, nor the row a driver handed out by
 *     reference.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SECRET_MASK } from '@objectstack/objectql/core';
import { installAuditWriters } from './audit-writers.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const f = (name: string, type: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, type, ...extra }) as any;

const sysAuditLog = {
  name: 'sys_audit_log', label: 'Audit Log',
  fields: {
    id: f('id', 'text', { primaryKey: true }), action: f('action', 'text'),
    user_id: f('user_id', 'text'), object_name: f('object_name', 'text'),
    record_id: f('record_id', 'text'), old_value: f('old_value', 'textarea'),
    new_value: f('new_value', 'textarea'), tenant_id: f('tenant_id', 'text'),
  },
};

const sysActivity = {
  name: 'sys_activity', label: 'Activity',
  fields: {
    id: f('id', 'text', { primaryKey: true }), type: f('type', 'text'),
    timestamp: f('timestamp', 'datetime'), summary: f('summary', 'text'),
    actor_id: f('actor_id', 'text'), object_name: f('object_name', 'text'),
    record_id: f('record_id', 'text'), record_label: f('record_label', 'text'),
    metadata: f('metadata', 'textarea'),
  },
};

/** Backing store for `secret`-typed fields — the engine writes a row per value. */
const sysSecret = {
  name: 'sys_secret', label: 'Secret',
  fields: {
    id: f('id', 'text', { primaryKey: true }), namespace: f('namespace', 'text'),
    key: f('key', 'text'), kms_key_id: f('kms_key_id', 'text'), alg: f('alg', 'text'),
    version: f('version', 'number'), ciphertext: f('ciphertext', 'textarea'),
    created_at: f('created_at', 'datetime'),
  },
};

/** `status: 'committed'` is what the read path's file resolver requires. */
const sysFile = {
  name: 'sys_file', label: 'File',
  fields: {
    id: f('id', 'text', { primaryKey: true }), name: f('name', 'text'),
    url: f('url', 'text'), size: f('size', 'number'), status: f('status', 'text'),
  },
};

/**
 * One object carrying all three classes whose read-path view differs from the
 * stored one, plus a `password` field — ADR-0100 stores those PLAINTEXT at
 * rest and masks them on read, so it is the same class as `secret` for this
 * writer and the worse of the two leaks.
 */
const bizTask = {
  name: 'biz_task', label: 'Task',
  fields: {
    id: f('id', 'text', { primaryKey: true }),
    title: f('title', 'text'),
    status: f('status', 'text'),
    api_key: f('api_key', 'secret'),
    login_pw: f('login_pw', 'password'),
    attachment: f('attachment', 'file'),
    upper_title: f('upper_title', 'formula', { expression: 'record.title + "!"' }),
  },
};

// ---------------------------------------------------------------------------
// A driver that COUNTS reads and returns COPIES
// ---------------------------------------------------------------------------

/**
 * Same contract shape as the counter in `audit-hook-object-scope.test.ts`
 * (`IDataDriver` — object name first), with one deliberate difference:
 * **every read returns a deep copy**.
 *
 * A driver that hands back live store references lets the engine's read-path
 * `maskSecretFields` rewrite the store in place, after which the two views
 * this file is here to distinguish look identical and every assertion below
 * passes for the wrong reason. That contamination is not hypothetical — it
 * produced the OPPOSITE conclusion on the first investigation of this card
 * before it was caught. Real drivers serialise; so does this one.
 */
function makeCountingDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const reads = { findOneOn: {} as Record<string, number>, findOn: {} as Record<string, number> };
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
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      reads.findOn[object] = (reads.findOn[object] ?? 0) + 1;
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where)).map(copy);
    },
    async findOne(object: string, ast: any) {
      reads.findOneOn[object] = (reads.findOneOn[object] ?? 0) + 1;
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return copy(r);
      return null;
    },
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
  return { driver, reads, storeFor };
}

/** Deterministic, reversible stand-in for a KMS — `secret` writes need one. */
const cryptoProvider: any = {
  calls: 0,
  async encrypt(plain: string) {
    cryptoProvider.calls += 1;
    return {
      id: `sec_${cryptoProvider.calls}`, kmsKeyId: 'test-key', alg: 'test',
      version: 1, ciphertext: Buffer.from(plain).toString('base64'),
    };
  },
  async decrypt(handle: any) { return Buffer.from(handle.ciphertext, 'base64').toString(); },
  async rotateKey(handle: any) { return handle; },
  digest(plain: string) { return plain; },
};

const OWNER_PACKAGE = 'com.objectstack.test.audit-bound-previous';

async function boot() {
  const engine = new ObjectQL();
  const stub = makeCountingDriver();
  engine.registerDriver(stub.driver, true);
  await engine.init();
  engine.setCryptoProvider(cryptoProvider);
  for (const o of [sysAuditLog, sysActivity, sysSecret, sysFile, bizTask]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }
  return { engine, ...stub };
}

const auditRowsFor = (
  storeFor: (o: string) => Map<string, Record<string, unknown>>,
  objectName: string,
) => Array.from(storeFor('sys_audit_log').values()).filter((r) => r.object_name === objectName);

const rowFor = (
  storeFor: (o: string) => Map<string, Record<string, unknown>>,
  objectName: string,
  action: string,
) => auditRowsFor(storeFor, objectName).find((r) => r.action === action);

const parse = (v: unknown): Record<string, any> => JSON.parse(String(v));

/** A committed file the read path would expand, and a fully-populated task. */
async function seedTask(engine: any) {
  await engine.insert('sys_file', {
    id: 'file_abc', name: 'a.png', url: '/f/a.png', size: 12, status: 'committed',
  });
  return engine.insert('biz_task', {
    title: 'Ship it', status: 'todo',
    api_key: 'sk-live-abc123', login_pw: 'hunter2', attachment: 'file_abc',
  });
}

// ---------------------------------------------------------------------------
// 1-3. The read is retired — and audit still sees the prior row
// ---------------------------------------------------------------------------

describe('[#6656] the plugin issues no pre-image read of its own', () => {
  it('single-id update() pays exactly ONE findOne — the engine\'s', async () => {
    const { engine, reads } = await boot();
    installAuditWriters(engine as any);
    const row: any = await seedTask(engine);

    const before = reads.findOneOn['biz_task'] ?? 0;
    await engine.update('biz_task', { status: 'in_progress' }, { where: { id: row.id } } as any);

    // Was 2 (engine + plugin). Restoring `captureBefore` makes this 2 again.
    expect((reads.findOneOn['biz_task'] ?? 0) - before).toBe(1);
  });

  it('single-id delete() pays exactly ONE findOne — the engine\'s (bound since #5272)', async () => {
    const { engine, reads } = await boot();
    installAuditWriters(engine as any);
    const row: any = await seedTask(engine);

    const before = reads.findOneOn['biz_task'] ?? 0;
    await engine.delete('biz_task', { where: { id: row.id } } as any);

    expect((reads.findOneOn['biz_task'] ?? 0) - before).toBe(1);
  });

  it('a predicate update() pays ZERO per-row findOne, where it used to pay one per matched row', async () => {
    const { engine, reads } = await boot();
    installAuditWriters(engine as any);
    for (let i = 0; i < 3; i += 1) await engine.insert('biz_task', { title: `T${i}`, status: 'todo' });

    const before = reads.findOneOn['biz_task'] ?? 0;
    await engine.update('biz_task', { status: 'done' }, { where: { status: 'todo' }, multi: true } as any);

    // Was 3 — one per matched row, every result discarded (`__previous` landed
    // on the per-row BEFORE context; the per-row AFTER contexts never saw it).
    // The engine's own matched-row `find` is untouched and still serves both
    // phases, which is why the ledger below is unchanged.
    expect((reads.findOneOn['biz_task'] ?? 0) - before).toBe(0);
  });

  it('a predicate delete() pays ZERO per-row findOne', async () => {
    const { engine, reads } = await boot();
    installAuditWriters(engine as any);
    for (let i = 0; i < 3; i += 1) await engine.insert('biz_task', { title: `T${i}`, status: 'todo' });

    const before = reads.findOneOn['biz_task'] ?? 0;
    await engine.delete('biz_task', { where: { status: 'todo' }, multi: true } as any);

    expect((reads.findOneOn['biz_task'] ?? 0) - before).toBe(0);
  });

  it('the ledger still records the prior row — the saving is a read, not a blind spot', async () => {
    // The other half of every count above. A writer that stopped consuming the
    // pre-image would satisfy all four and be a regression, so the two claims
    // are asserted on the same runs' worth of behaviour.
    const { engine, storeFor } = await boot();
    installAuditWriters(engine as any);
    const row: any = await engine.insert('biz_task', { title: 'Ship it', status: 'todo' });

    await engine.update('biz_task', { status: 'in_progress' }, { where: { id: row.id } } as any);
    expect(parse(rowFor(storeFor, 'biz_task', 'update')!.old_value)).toEqual({ status: 'todo' });

    await engine.delete('biz_task', { where: { id: row.id } } as any);
    expect(parse(rowFor(storeFor, 'biz_task', 'delete')!.old_value)).toMatchObject({
      title: 'Ship it', status: 'in_progress',
    });

    // Predicate writes keep their per-row rows too — one per matched row.
    for (let i = 0; i < 3; i += 1) await engine.insert('biz_task', { title: `T${i}`, status: 'todo' });
    await engine.delete('biz_task', { where: { status: 'todo' }, multi: true } as any);
    expect(auditRowsFor(storeFor, 'biz_task').filter((r) => r.action === 'delete')).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// 4. The compliance face
// ---------------------------------------------------------------------------

describe('[#6656] single-id delete `old_value` keeps the masked credential view', () => {
  it('records `••••••••` for a secret field — byte-identical to before this change', async () => {
    const { engine, storeFor } = await boot();
    installAuditWriters(engine as any);
    const row: any = await seedTask(engine);

    await engine.delete('biz_task', { where: { id: row.id } } as any);

    const old = parse(rowFor(storeFor, 'biz_task', 'delete')!.old_value);
    // The literal, not just the imported constant: "byte-identical" is a claim
    // about the exact bytes the ledger has always carried on this face.
    expect(old.api_key).toBe('••••••••');
    expect(old.api_key).toBe(SECRET_MASK);
    // The stored ref must not appear under any spelling.
    expect(String(rowFor(storeFor, 'biz_task', 'delete')!.old_value)).not.toContain('secret:');
  });

  it('masks a `password` field the same way — ADR-0100 stores those in cleartext', async () => {
    const { engine, storeFor } = await boot();
    installAuditWriters(engine as any);
    const row: any = await seedTask(engine);

    await engine.delete('biz_task', { where: { id: row.id } } as any);

    const raw = String(rowFor(storeFor, 'biz_task', 'delete')!.old_value);
    expect(parse(raw).login_pw).toBe('••••••••');
    expect(raw).not.toContain('hunter2');
  });

  it('an UNSET credential stays null rather than becoming a mask', async () => {
    // `maskSecretFields`' own rule, mirrored: "a secret is set" and "there is
    // no secret" must stay distinguishable in the ledger.
    const { engine, storeFor } = await boot();
    installAuditWriters(engine as any);
    const row: any = await engine.insert('biz_task', {
      title: 'No creds', status: 'todo', api_key: null, login_pw: null,
    });

    await engine.delete('biz_task', { where: { id: row.id } } as any);

    const old = parse(rowFor(storeFor, 'biz_task', 'delete')!.old_value);
    expect(old.api_key).toBeNull();
    expect(old.login_pw).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5-6. The phantom rows — and the real change that must survive
// ---------------------------------------------------------------------------

describe('[#6656] a write that changes nothing about a field records no diff for it', () => {
  it('secret, file-reference and formula fields all stay out of an unrelated update', async () => {
    const { engine, storeFor } = await boot();
    installAuditWriters(engine as any);
    const row: any = await seedTask(engine);

    // Payload touches ONE field.
    await engine.update('biz_task', { status: 'in_progress' }, { where: { id: row.id } } as any);

    const audit = rowFor(storeFor, 'biz_task', 'update')!;
    // The whole diff, not a subset: any extra key is a phantom row.
    expect(parse(audit.old_value)).toEqual({ status: 'todo' });
    expect(parse(audit.new_value)).toEqual({ status: 'in_progress' });
  });

  it('records a REAL credential rotation — masking the values must not delete the trail', async () => {
    // The failure mode this case exists to forbid: masking both sides BEFORE
    // comparing would make every secret change compare equal and silently
    // vanish from the ledger. Detection runs on the raw values; only the
    // recorded values are masked, so the row is written and says "it changed"
    // without saying to what.
    const { engine, storeFor } = await boot();
    installAuditWriters(engine as any);
    const row: any = await seedTask(engine);

    await engine.update('biz_task', { api_key: 'sk-live-rotated' }, { where: { id: row.id } } as any);

    const audit = rowFor(storeFor, 'biz_task', 'update');
    expect(audit, 'a secret rotation must still produce an audit row').toBeDefined();
    expect(parse(audit!.old_value)).toEqual({ api_key: '••••••••' });
    expect(parse(audit!.new_value)).toEqual({ api_key: '••••••••' });
    expect(String(audit!.new_value)).not.toContain('sk-live-rotated');
  });
});

// ---------------------------------------------------------------------------
// 7. The pre-existing leak, closed
// ---------------------------------------------------------------------------

describe('[#6656] no credential value reaches `new_value` on create or update', () => {
  it('create records the mask, not the stored ref and not the cleartext', async () => {
    const { engine, storeFor } = await boot();
    installAuditWriters(engine as any);
    await seedTask(engine);

    const created = rowFor(storeFor, 'biz_task', 'create')!;
    const raw = String(created.new_value);
    expect(parse(raw).api_key).toBe('••••••••');
    expect(parse(raw).login_pw).toBe('••••••••');
    expect(raw).not.toContain('secret:');   // the ref, leaked before this change
    expect(raw).not.toContain('hunter2');   // the cleartext, leaked before this change
  });

  it('a create snapshot carries no computed field — the diff face never did either', async () => {
    // `ctx.result` hydrates formulas since #5504 while the raw pre-image has no
    // such column, so leaving them in would make the create and delete
    // snapshots disagree with each other and with `diff()`.
    const { engine, storeFor } = await boot();
    installAuditWriters(engine as any);
    await seedTask(engine);

    expect(parse(rowFor(storeFor, 'biz_task', 'create')!.new_value)).not.toHaveProperty('upper_title');
  });

  it('the activity summary never renders a credential either', async () => {
    // `sys_activity.metadata` mirrors the diff and the summary is rendered
    // verbatim in the record feed and Setup dashboards, so the mask has to
    // hold on this face too.
    const { engine, storeFor } = await boot();
    installAuditWriters(engine as any);
    const row: any = await seedTask(engine);

    await engine.update('biz_task', { api_key: 'sk-live-rotated' }, { where: { id: row.id } } as any);

    const activity = Array.from(storeFor('sys_activity').values())
      .filter((r) => r.object_name === 'biz_task');
    const blob = JSON.stringify(activity);
    expect(blob).not.toContain('sk-live-rotated');
    expect(blob).not.toContain('secret:');
    expect(blob).not.toContain('hunter2');
  });
});

// ---------------------------------------------------------------------------
// 8. Non-mutating
// ---------------------------------------------------------------------------

describe('[#6656] normalising the ledger view does not rewrite the record', () => {
  it('the value returned to the caller keeps its real field values', async () => {
    // `ctx.result` IS the record the caller receives. Masking it in place would
    // hand every audited writer a masked row back — and on a driver that
    // returns live references, would mask the store itself.
    const { engine, storeFor } = await boot();
    installAuditWriters(engine as any);
    const created: any = await seedTask(engine);

    expect(created.api_key).toMatch(/^secret:/);
    expect(created.login_pw).toBe('hunter2');

    const updated: any = await engine.update(
      'biz_task', { status: 'in_progress' }, { where: { id: created.id } } as any,
    );
    expect(updated.login_pw).toBe('hunter2');

    // …and the row still on disk is untouched.
    expect(storeFor('biz_task').get(created.id)!.login_pw).toBe('hunter2');

    // The ledger, on the same run, holds the masked view — so the two are
    // genuinely different objects rather than one that was never masked.
    expect(parse(rowFor(storeFor, 'biz_task', 'create')!.new_value).login_pw).toBe('••••••••');
  });
});
