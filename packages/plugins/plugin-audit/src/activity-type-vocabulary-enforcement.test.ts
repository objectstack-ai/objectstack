// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8203 — the BEHAVIORAL half of the `sys_activity.type` vocabulary pin. Its
 * declarative twin (the writer census, written as literals) is
 * `./objects/sys-activity-type-vocabulary.test.ts`.
 *
 * ## What this file measures
 *
 * #8203 recorded an observation about `sys_audit_log.action`: on a `readonly`
 * field a declared option set is documentation, not a contract, because
 * `validateRecord` skips `readonly` and `system` fields on both the insert and
 * the update branch (`objectql/src/validation/record-validator.ts`), so the
 * `invalid_option` check never runs. The card noted that nothing detects
 * divergence in either direction, and that #8147 caught its near-miss by
 * READING the writer rather than by any instrument.
 *
 * This file turns that prose into a measurement on `sys_activity`, the second
 * object in the same shape (every field `readonly: true`, one declared
 * vocabulary), and runs it against the REAL `SysActivity` definition — not a
 * `type: 'text'` stand-in — because the whole claim is about what a declared
 * `select` does or does not enforce.
 *
 * ## Every "nothing checks this" here has a control
 *
 * An absence proven by "the test passed" is not proven at all. Sections 2 and 3
 * are therefore paired: the SAME insert, of the SAME undeclared value, into a
 * field differing from `sys_activity.type` by exactly one attribute
 * (`readonly`), is REJECTED — same object shape, same options, same name. That
 * control is what makes the acceptance next door a finding rather than a test
 * that forgot to assert.
 *
 * ## The two halves catch different regressions — deliberately
 *
 *   this file            the writers emit what the enum declares
 *   the census file      the enum declares what the writers emit
 *
 * Narrowing the enum away from a live writer is invisible HERE (the writer
 * keeps writing, the row keeps landing, every assertion below stays green) and
 * red THERE. Breaking a writer is red here and green there. Neither file alone
 * covers this object.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL, ValidationError } from '@objectstack/objectql';
import { installAuditWriters } from './audit-writers.js';
import { SysActivity, SysAuditLog } from './objects/index.js';

const OWNER_PACKAGE = 'com.objectstack.test.activity-type-vocabulary';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * A minimal in-memory driver. Returns COPIES on read for the reason
 * `audit-bound-previous.test.ts` states: a driver that hands back live store
 * references lets the engine rewrite the store in place, after which
 * measurements taken around a write describe a store that moved under them.
 */
function makeDriver() {
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
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where)).map(copy);
    },
    async findOne(object: string, ast: any) {
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
  return { driver, storeFor };
}

const f = (name: string, type: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, type, ...extra }) as any;

/**
 * The audited object. Its three milestones are the three shapes the
 * `activityMilestones[].type` escape hatch can take, and each is load-bearing:
 *
 *  - `done` declares a type the enum DOES have (`completed`) — the shipped
 *    showcase shape (`task.object.ts`), and the only reason `completed` is a
 *    written value at all.
 *  - `legal` declares a type the enum does NOT have. `activityMilestones[].type`
 *    is `z.string().optional()` in the spec (`object.zod.ts`), so this parses,
 *    ships, and writes — section 3.
 *  - `plain` declares NO type, which pins the real default.
 */
const bizTicket = {
  name: 'biz_ticket', label: 'Ticket',
  fields: {
    id: f('id', 'text', { primaryKey: true }),
    title: f('title', 'text'),
    stage: f('stage', 'text', { label: 'Stage', trackHistory: true }),
  },
  activityMilestones: [
    { field: 'stage', value: 'done', summary: 'Done: {title}', type: 'completed' },
    { field: 'stage', value: 'legal', summary: 'Legal: {title}', type: 'escalated_to_legal' },
    { field: 'stage', value: 'plain', summary: 'Plain: {title}' },
  ],
};

const UNDECLARED = 'not_a_declared_type';

/**
 * THE CONTROL (§2). `sys_activity` with exactly one attribute changed: `type`
 * is no longer `readonly`. Same field name, same option list, same object
 * shape, cloned from the real definition rather than hand-written so the two
 * cannot drift apart.
 *
 * Its whole job is to fail where `sys_activity` passes. If this object ever
 * stops rejecting `UNDECLARED`, the acceptance measured in §3 proves nothing
 * and this file is reporting on a validator that is not running at all.
 */
function writableClone(): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(SysActivity)) as any;
  clone.name = 'ctl_activity_writable';
  delete clone.fields.type.readonly;
  // `id` must stay writable too, or the fixture's own primary key would be
  // stripped before the field under test is ever reached.
  delete clone.fields.id.readonly;
  return clone;
}

async function boot() {
  const engine = new ObjectQL();
  const stub = makeDriver();
  engine.registerDriver(stub.driver, true);
  await engine.init();
  for (const o of [SysAuditLog, SysActivity, bizTicket, writableClone()]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }
  installAuditWriters(engine as any, 'test.audit');
  return { engine, ...stub };
}

const activityTypes = (storeFor: (o: string) => Map<string, Record<string, unknown>>) =>
  Array.from(storeFor('sys_activity').values()).map((r) => String(r.type));

/** Option values declared by the real `sys_activity.type` select. */
const DECLARED_TYPES: string[] = (() => {
  const field = (SysActivity as { fields?: Record<string, { options?: unknown }> })
    .fields?.type;
  const options = (field?.options ?? []) as Array<string | { value?: string }>;
  return options.map((o) => (typeof o === 'string' ? o : String(o.value)));
})();

const moveStage = (engine: any, id: string, stage: string) =>
  engine.update('biz_ticket', { stage }, { where: { id } } as any);

// ---------------------------------------------------------------------------
// 1. The writers emit values the enum declares
// ---------------------------------------------------------------------------

describe('[#8203] sys_activity.type — the writers emit declared values', () => {
  it('the CRUD writer emits exactly created / updated / deleted, all declared', async () => {
    const { engine, storeFor } = await boot();
    await engine.insert('biz_ticket', { id: 't1', title: 'One', stage: 'open' });
    await moveStage(engine, 't1', 'in_progress');
    await engine.delete('biz_ticket', { where: { id: 't1' } } as any);

    const emitted = activityTypes(storeFor);
    expect(emitted).toEqual(['created', 'updated', 'deleted']);
    // The half the census file cannot see: what the writer emits is declared.
    for (const t of emitted) {
      expect(
        DECLARED_TYPES,
        `audit-writers.ts wrote sys_activity.type '${t}', which the object does not `
          + 'declare. Nothing rejects it — the field is readonly, so `validateRecord` '
          + 'skips it — so the row lands and the contract denies it (#8203).',
      ).toContain(t);
    }
  });

  it('a milestone `type` overrides the CRUD verb, and the shipped one is declared', async () => {
    const { engine, storeFor } = await boot();
    await engine.insert('biz_ticket', { id: 't2', title: 'Two', stage: 'open' });
    await moveStage(engine, 't2', 'done');

    // 'completed' is written ONLY through this path — it is the reason the
    // value is in the enum's writer census at all (showcase task.object.ts
    // declares exactly this milestone).
    expect(activityTypes(storeFor)).toEqual(['created', 'completed']);
    expect(DECLARED_TYPES).toContain('completed');
  });

  /**
   * The real default when a milestone omits `type`. Pinned because the spec's
   * own field description says otherwise — `object.zod.ts` documents
   * `activityMilestones[].type` as 'Activity type for the emitted row (default
   * "completed")', while the code default is `activityTypeFor(action)` and a
   * milestone can only fire on the UPDATE branch, making it `updated`.
   * Filed separately; pinned here so the divergence is measured rather than
   * argued from either side's prose.
   */
  it('a milestone without `type` emits `updated` — not the "completed" the spec text claims', async () => {
    const { engine, storeFor } = await boot();
    await engine.insert('biz_ticket', { id: 't3', title: 'Three', stage: 'open' });
    await moveStage(engine, 't3', 'plain');

    expect(activityTypes(storeFor)).toEqual(['created', 'updated']);
  });
});

// ---------------------------------------------------------------------------
// 2. The control — the same value IS rejected when the field is writable
// ---------------------------------------------------------------------------

describe('[#8203] CONTROL — a writable select rejects the undeclared value', () => {
  it('rejects with VALIDATION_FAILED / invalid_option naming the allowed set', async () => {
    const { engine, storeFor } = await boot();

    const attempt = engine.insert('ctl_activity_writable', {
      id: 'c1', type: UNDECLARED, timestamp: new Date().toISOString(), summary: 's',
    }, { context: { isSystem: true } } as any);

    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    const err = await attempt.catch((e: any) => e);
    // The envelope, not just the throw: the code AND the field-level verdict.
    // (`status` is deliberately not asserted — the engine-level ValidationError
    // carries none; the ADR-0112 HTTP status is applied at the REST boundary,
    // which this engine-level write never crosses.)
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields?.[0]?.field).toBe('type');
    expect(err.fields?.[0]?.code).toBe('invalid_option');
    expect(err.fields?.[0]?.options).toEqual(DECLARED_TYPES);
    // Rejected means NOT WRITTEN — the other half of the control.
    expect(Array.from(storeFor('ctl_activity_writable').values())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. The finding — the identical write is ACCEPTED when the field is readonly
// ---------------------------------------------------------------------------

describe('[#8203] the declared vocabulary is unenforceable while the field is readonly', () => {
  /**
   * ⚠️ These two cases assert a DEFECT, characterized. They are the card's
   * observation made mechanical, and they are written to go red the day it is
   * fixed — which is the correct signal, not a false alarm.
   *
   * If one fails with "expected 'not_a_declared_type' … received a rejection",
   * enforcement has landed (the engine-wide direction #8203 names, in
   * `record-validator.ts`). That is the fix: delete these two cases, keep §1
   * and the census file, and close #8203.
   */
  it('a direct write of an undeclared type into sys_activity is accepted verbatim', async () => {
    const { engine, storeFor } = await boot();

    await engine.insert('sys_activity', {
      id: 'a1', type: UNDECLARED, timestamp: new Date().toISOString(), summary: 's',
    }, { context: { isSystem: true } } as any);

    expect(DECLARED_TYPES).not.toContain(UNDECLARED);
    expect(
      activityTypes(storeFor),
      'sys_activity.type no longer accepts an undeclared option. If this is because '
        + 'readonly-field option enforcement landed, that is the fix #8203 describes — '
        + 'retire this case and its neighbour and close the card.',
    ).toEqual([UNDECLARED]);
  });

  /**
   * The same hole reached through a REAL, shipped authoring surface rather than
   * a hand-made insert: `activityMilestones[].type` is `z.string().optional()`
   * in the spec, so any metadata author can name any string, and it lands in a
   * column whose enum denies it. This is the authoring-time version of the
   * defect and the one an AI-written metadata app would hit first.
   */
  it('a milestone declaring an undeclared type writes it — the authoring-surface hole', async () => {
    const { engine, storeFor } = await boot();
    await engine.insert('biz_ticket', { id: 't4', title: 'Four', stage: 'open' });
    await moveStage(engine, 't4', 'legal');

    expect(DECLARED_TYPES).not.toContain('escalated_to_legal');
    expect(
      activityTypes(storeFor),
      'a milestone-declared `type` outside the sys_activity.type enum no longer reaches '
        + 'the row. If option enforcement (or a spec-level constraint on '
        + '`activityMilestones[].type`) landed, that is the fix #8203 describes — retire '
        + 'this case and close the card.',
    ).toEqual(['created', 'escalated_to_legal']);
  });
});
