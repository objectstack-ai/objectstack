// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21197] The ledger's CRUD mirror honours `internal: true` — ruling record
 * 5942811916 (C2): "the ledger's CRUD mirror omits `internal` fields from both
 * snapshot sides, exactly as it already omits credential-typed fields, through
 * the existing objectql collector".
 *
 * The census objects are the REAL platform-object definitions, imported rather
 * than restated, so a declaration dropped from any of them reds the first case
 * below — and the mirror is judged against what each object actually declares.
 *
 * What is pinned, per object:
 *  - the declared `internal` set is the census's (a dropped flag is red here);
 *  - create `new_value`, both sides of an update diff and delete `old_value`
 *    carry none of those fields, while a non-credential CONTROL field of the
 *    same object is recorded on every side it changed — so "nothing recorded"
 *    cannot pass for "nothing leaked";
 *  - the activity row (`metadata`, `summary`, `record_label`) carries none of
 *    their values either;
 *  - an update that touches ONLY an internal field still writes its ledger
 *    row — the change is recorded, the value is not.
 *
 * Judged on the rows AT REST in the store, below every read-time narrowing:
 * a value absent from the stored row is absent for every reader of it, the
 * admin included.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import {
  SysApiKey,
  SysJwks,
  SysOauthAccessToken,
  SysOauthApplication,
  SysOauthRefreshToken,
  SysScimConnectionCredential,
  SysSsoProvider,
  SysTwoFactor,
  SysVerification,
} from '@objectstack/platform-objects/identity';
import { SysEmail } from '@objectstack/platform-objects/audit';
import { installAuditWriters } from './audit-writers.js';

type Row = Record<string, unknown>;
type ObjectDef = { name: string; fields: Record<string, { type?: string; required?: boolean; internal?: unknown; options?: unknown[] }> };

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

/**
 * The census: each object, the `internal` set it must declare, and a
 * non-credential control field whose value the ledger must keep recording.
 */
const CENSUS: Array<{ def: ObjectDef; internal: string[]; control: string }> = [
  { def: SysJwks as unknown as ObjectDef, internal: ['private_key'], control: 'alg' },
  { def: SysVerification as unknown as ObjectDef, internal: ['identifier', 'value'], control: 'expires_at' },
  { def: SysTwoFactor as unknown as ObjectDef, internal: ['backup_codes', 'secret'], control: 'user_id' },
  { def: SysSsoProvider as unknown as ObjectDef, internal: ['oidc_config', 'saml_config'], control: 'issuer' },
  { def: SysOauthAccessToken as unknown as ObjectDef, internal: ['token'], control: 'client_id' },
  { def: SysOauthRefreshToken as unknown as ObjectDef, internal: ['token'], control: 'client_id' },
  { def: SysOauthApplication as unknown as ObjectDef, internal: ['client_secret'], control: 'name' },
  { def: SysScimConnectionCredential as unknown as ObjectDef, internal: ['token_digest'], control: 'label' },
  { def: SysApiKey as unknown as ObjectDef, internal: ['key'], control: 'name' },
  { def: SysEmail as unknown as ObjectDef, internal: ['headers_json'], control: 'subject' },
];

/** In-memory driver that serialises every read, like a real one. */
function makeDriver() {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const copy = <T,>(r: T): T => (r == null ? r : JSON.parse(JSON.stringify(r)));
  const matches = (row: Row, where: any): boolean => {
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
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // The caller's bound, applied after the filter (`check:objectql-double-limit`).
      return (typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows).map(copy);
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return copy(r);
      return null;
    },
    async create(object: string, data: Row) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return copy(row);
    },
    async update(object: string, id: string, data: Row) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return copy(updated);
    },
    async upsert(object: string, data: Row) {
      const id = data.id as string | undefined;
      return id && storeFor(object).has(id) ? this.update(object, id, data) : this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Row[]) { return Promise.all(rows.map((r) => this.create(object, r))); },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany() { return 0; },
    async deleteMany() { return 0; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

const SYS = { context: { isSystem: true } } as const;

async function boot(def: ObjectDef) {
  const engine = new ObjectQL();
  const { driver, storeFor } = makeDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [sysAuditLog, sysActivity, def]) {
    engine.registry.registerObject(o as any, 'com.objectstack.test.audit-internal-field-omission');
  }
  installAuditWriters(engine as any);
  return { engine: engine as any, storeFor };
}

/** A value for a required column, by type — enough for the engine to accept the row. */
function fill(def: { type?: string; options?: unknown[] }, n: number): unknown {
  switch (def.type) {
    case 'datetime':
    case 'date':
      return new Date(Date.UTC(2030, 0, 1 + n)).toISOString();
    case 'boolean':
      return true;
    case 'number':
    case 'currency':
    case 'percent':
      return n;
    case 'select': {
      const first = def.options?.[0] as { value?: unknown } | string | undefined;
      return typeof first === 'object' && first !== null ? first.value : first;
    }
    case 'json':
      return {};
    default:
      return `fill_${n}`;
  }
}

/** A marker no generated value can produce by accident, one per field and phase. */
const marker = (object: string, field: string, phase: string) => `MARKER-${object}-${field}-${phase}`;

function seedRow(def: ObjectDef, internal: string[], control: string, phase: string): Row {
  const row: Row = {};
  let n = 0;
  for (const [name, fd] of Object.entries(def.fields)) {
    if (name === 'id' || fd.type === 'formula' || fd.type === 'autonumber') continue;
    if (fd.required) row[name] = fill(fd, (n += 1));
  }
  for (const field of internal) row[field] = marker(def.name, field, phase);
  // A control value that differs per phase, in the column's own type.
  const controlDef = def.fields[control];
  const textual = !controlDef.type || ['text', 'textarea', 'email', 'url', 'lookup'].includes(controlDef.type);
  row[control] = textual ? `control-${phase}` : fill(controlDef, phase === 'create' ? 7 : 8);
  return row;
}

const ledgerRows = (storeFor: (o: string) => Map<string, Row>, object: string) =>
  Array.from(storeFor('sys_audit_log').values()).filter((r) => r.object_name === object);
const activityRows = (storeFor: (o: string) => Map<string, Row>, object: string) =>
  Array.from(storeFor('sys_activity').values()).filter((r) => r.object_name === object);
const parse = (v: unknown): Row => (v == null ? {} : JSON.parse(String(v)));

describe('[#21197] the ledger CRUD mirror omits `internal` fields from both snapshot sides', () => {
  describe.each(CENSUS.map((c) => [c.def.name, c] as const))('%s', (_name, { def, internal, control }) => {
    it('declares the census `internal` set', () => {
      const declared = Object.entries(def.fields)
        .filter(([, fd]) => fd.internal === true)
        .map(([name]) => name)
        .sort();
      expect(declared).toEqual([...internal].sort());
    });

    it('create, update and delete record the control field and none of the internal fields', async () => {
      const { engine, storeFor } = await boot(def);
      const created = await engine.insert(def.name, seedRow(def, internal, control, 'create'), SYS);
      const id = String(created.id);
      const changed = seedRow(def, internal, control, 'update');
      const patch: Row = { [control]: changed[control] };
      for (const field of internal) patch[field] = changed[field];
      await engine.update(def.name, patch, { where: { id }, ...SYS } as any);
      await engine.delete(def.name, { where: { id }, ...SYS } as any);

      const rows = ledgerRows(storeFor, def.name);
      const byAction = (a: string) => rows.filter((r) => r.action === a);
      expect(byAction('create'), 'one create row').toHaveLength(1);
      expect(byAction('update'), 'one update row').toHaveLength(1);
      expect(byAction('delete'), 'one delete row').toHaveLength(1);

      const createNew = parse(byAction('create')[0].new_value);
      const updateOld = parse(byAction('update')[0].old_value);
      const updateNew = parse(byAction('update')[0].new_value);
      const deleteOld = parse(byAction('delete')[0].old_value);

      // The control: the mirror still records this object's ordinary fields.
      expect(createNew[control]).toEqual(seedRow(def, internal, control, 'create')[control]);
      expect(updateOld[control]).toEqual(seedRow(def, internal, control, 'create')[control]);
      expect(updateNew[control]).toEqual(changed[control]);
      expect(deleteOld[control]).toEqual(changed[control]);

      for (const field of internal) {
        for (const [side, snapshot] of Object.entries({ createNew, updateOld, updateNew, deleteOld })) {
          expect(snapshot, `${def.name}.${field} on ${side}`).not.toHaveProperty(field);
        }
      }

      // Nothing at rest — audit or activity, any column — carries a value.
      const atRest = JSON.stringify([...rows, ...activityRows(storeFor, def.name)]);
      for (const field of internal) {
        for (const phase of ['create', 'update']) {
          expect(atRest, `${def.name}.${field} (${phase}) at rest`).not.toContain(marker(def.name, field, phase));
        }
      }
      expect(activityRows(storeFor, def.name).length, 'the activity mirror ran').toBeGreaterThan(0);
    });

    it('an update of ONLY an internal field still writes its row, with neither value', async () => {
      const { engine, storeFor } = await boot(def);
      const created = await engine.insert(def.name, seedRow(def, internal, control, 'create'), SYS);
      const field = internal[0];
      await engine.update(def.name, { [field]: marker(def.name, field, 'rotate') }, { where: { id: String(created.id) }, ...SYS } as any);

      const updates = ledgerRows(storeFor, def.name).filter((r) => r.action === 'update');
      expect(updates, 'the change is recorded').toHaveLength(1);
      expect(parse(updates[0].old_value)).not.toHaveProperty(field);
      expect(parse(updates[0].new_value)).not.toHaveProperty(field);
      const atRest = JSON.stringify([...ledgerRows(storeFor, def.name), ...activityRows(storeFor, def.name)]);
      expect(atRest).not.toContain(marker(def.name, field, 'create'));
      expect(atRest).not.toContain(marker(def.name, field, 'rotate'));
    });
  });
});
