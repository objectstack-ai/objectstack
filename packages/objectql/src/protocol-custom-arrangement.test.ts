// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10] A base's paired `.custom` package declares an installed
 * object's whole arrangement, through the real protocol over the real
 * `ObjectQL` engine and an in-memory driver.
 *
 * A code package owns `crm_lead` with field groups and a tab list; another
 * code package extends it and places a field. Pinned here:
 *
 *  - the pair's `object_extension` writing `fieldGroups` / `relatedLists` is
 *    saved, and the served object (by name and in the list read) carries the
 *    replaced arrangement and the `_relatedListsArrangement` decoration; the
 *    execution face does not carry the decoration;
 *  - the same keys in a writable package that is not a `.custom` one are
 *    refused at the save door, once, and nothing is stored or served;
 *  - saving the pair's extension without the keys, or disabling the pair,
 *    serves the owner's arrangement with the placements again.
 *
 * Test-path resolution: the protocol is `@objectstack/metadata-protocol`'s
 * `dist/`, so a change there is read here after that package is rebuilt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveFieldGroupLayout } from '@objectstack/spec/data';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';

const sysMetadataObject: ServiceObject = {
  name: 'sys_metadata', label: 'System Metadata',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
    name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
    organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
    package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
    bundle_member: { name: 'bundle_member', label: 'Bundle Member', type: 'text' as const, maxLength: 100 },
    metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
    draft_changes: { name: 'draft_changes', label: 'Draft Changes', type: 'textarea' as const },
    checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
    state: { name: 'state', label: 'State', type: 'text' as const },
    version: { name: 'version', label: 'Version', type: 'number' as const },
    created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
    updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
  },
};

function makeMemoryDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
  let nextId = 0;
  const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and' && Array.isArray(v)) { if (!v.every((w: any) => matchesWhere(row, w))) return false; continue; }
      if (k === '$or' && Array.isArray(v)) { if (!v.some((w: any) => matchesWhere(row, w))) return false; continue; }
      if (k.startsWith('$')) continue;
      const rowVal = row[k];
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) { if (!(v as any).$in.includes(rowVal === undefined ? null : rowVal)) return false; continue; }
      const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      if ((rowVal === undefined ? null : rowVal) !== (expected === undefined ? null : expected)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(o: string, ast: any) { const rows = Array.from(storeFor(o).values()).filter((r) => matchesWhere(r, ast?.where)); return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows; },
    async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matchesWhere(r, ast?.where)) return r; return null; },
    async create(o: string, data: Record<string, unknown>) { nextId += 1; const id = (data.id as string) ?? `r_${nextId}`; const row = { ...data, id }; storeFor(o).set(id, row); return row; },
    async update(o: string, id: string, data: Record<string, unknown>) { const s = storeFor(o); const cur = s.get(id); if (!cur) throw new Error(`not found ${o}/${id}`); const u = { ...cur, ...data, id }; s.set(id, u); return u; },
    async upsert(o: string, data: Record<string, unknown>) { const id = data.id as string | undefined; if (id && storeFor(o).has(id)) return this.update(o, id, data); return this.create(o, data); },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

const BASE = 'com.example.crm';
const EXT = 'com.example.tax';
const PAIR = `${BASE}.custom`;
const ADDON = 'com.example.addon';
const OBJ = 'crm_lead';

const text = (name: string, label: string, extra: Record<string, unknown> = {}) => ({ name, label, type: 'text', ...extra });
const child = (name: string, label: string) => ({
  name, label,
  fields: { name: text('name', 'Name'), lead: { name: 'lead', label: 'Lead', type: 'lookup', reference: OBJ } },
});

async function boot() {
  const engine = new ObjectQL();
  const { driver, stores } = makeMemoryDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(sysMetadataObject, 'test-package');
  for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) engine.registry.registerObject(o as any, 'test-package');
  engine.registerApp({
    id: BASE, name: 'crm', version: '1.0.0', namespace: 'crm', type: 'app',
    objects: [
      {
        name: OBJ, label: 'Lead',
        fields: {
          name: text('name', 'Name'), company: text('company', 'Company'), status: text('status', 'Status'),
          email: text('email', 'Email'), phone: text('phone', 'Phone'), fax: text('fax', 'Fax'),
        },
        fieldGroups: [
          { key: 'basic', label: 'Basic', fields: ['name', 'company', 'status'] },
          { key: 'contact', label: 'Contact', fields: ['email', 'phone', 'fax'] },
        ],
        relatedLists: ['crm_task', 'crm_event', 'crm_note'],
      },
      child('crm_task', 'Task'), child('crm_event', 'Event'), child('crm_note', 'Note'),
    ],
  } as any);
  engine.registerApp({
    id: EXT, name: 'tax', version: '1.0.0', namespace: 'crm', type: 'app', dependencies: { [BASE]: '^1.0.0' },
    objectExtensions: [{
      extend: OBJ,
      fields: { crm_tax_id: text('crm_tax_id', 'Tax ID') },
      place: [{ field: 'crm_tax_id', group: 'basic', after: 'company' }],
    }],
  } as any);
  const protocol = new ObjectStackProtocolImplementation(engine, () => new Map());
  await (protocol as any).installPackage({ manifest: { id: PAIR, name: 'crm-custom', version: '0.1.0', type: 'app', namespace: 'crm_custom', dependencies: { [BASE]: '^1' } } });
  await (protocol as any).installPackage({ manifest: { id: ADDON, name: 'addon', version: '0.1.0', type: 'app', namespace: 'addon', dependencies: { [BASE]: '^1' } } });
  return { engine, registry: engine.registry as any, protocol: protocol as any, stores };
}

const savedWritable = process.env.OS_METADATA_WRITABLE;
beforeEach(() => { delete process.env.OS_METADATA_WRITABLE; ObjectStackProtocolImplementation.resetEnvWritableCache(); resetEnvWritableMetadataTypes(); });
afterEach(() => {
  vi.restoreAllMocks();
  if (savedWritable === undefined) delete process.env.OS_METADATA_WRITABLE; else process.env.OS_METADATA_WRITABLE = savedWritable;
  ObjectStackProtocolImplementation.resetEnvWritableCache(); resetEnvWritableMetadataTypes();
});

const AUTHORED = new Set(['name', 'company', 'status', 'email', 'phone', 'fax', 'crm_tax_id', 'region__c']);
/** The derived layout as `[group key | null for the trailing bucket, authored members]`. */
const layout = (body: any): Array<[string | null, string[]]> =>
  (deriveFieldGroupLayout(body) ?? [])
    .map((section): [string | null, string[]] => [section.key ?? null, section.fields.filter((f) => AUTHORED.has(f))])
    // The trailing bucket also carries the object's system fields; with no authored member it is not a reading.
    .filter(([key, members]) => key !== null || members.length > 0);

const servedObject = async (protocol: any) => (await protocol.getMetaItem({ type: 'object', name: OBJ })).item;

/** Steps 1–2: the owner's arrangement with the extension package's placement. */
const STEPS_1_2 = {
  layout: [
    ['basic', ['name', 'company', 'crm_tax_id', 'status']],
    ['contact', ['email', 'phone', 'fax']],
  ],
  relatedLists: ['crm_task', 'crm_event', 'crm_note'],
};

const REGION = text('region__c', 'Region');
const ARRANGEMENT = {
  // The two groups swapped, `status` moved to `contact`, `fax` and the extension package's field left out.
  fieldGroups: [
    { key: 'contact', label: 'Contact', fields: ['email', 'phone', 'status'] },
    { key: 'basic', label: 'Basic', fields: ['name', 'company', 'region__c'] },
  ],
  // Two tabs swapped, one hidden.
  relatedLists: ['crm_event', 'crm_task', { list: 'crm_note', hidden: true }],
};

const saveExtension = (protocol: any, packageId: string, body: Record<string, unknown>) =>
  protocol.saveMetaItem({ type: 'object_extension', name: OBJ, packageId, mode: 'publish', item: { extend: OBJ, ...body } });

async function outcome(fn: () => Promise<unknown>) {
  try {
    await fn();
    return { ok: true as const };
  } catch (e: any) {
    return {
      ok: false as const,
      code: e?.code,
      status: e?.status,
      issues: Array.isArray(e?.issues) ? e.issues.length : 0,
      message: String(e?.message ?? ''),
    };
  }
}

describe('ADR-0146 D10 — the paired `.custom` package arranges an installed object, through the protocol', () => {
  it('control: before any `.custom` arrangement the served object is the owner\'s with the placement, undecorated', async () => {
    const { protocol } = await boot();
    const item = await servedObject(protocol);
    expect(layout(item)).toEqual(STEPS_1_2.layout);
    expect(item.relatedLists).toEqual(STEPS_1_2.relatedLists);
    expect('_relatedListsArrangement' in item).toBe(false);
  });

  it('the pair\'s extension is saved, and the by-name and list reads serve the replaced arrangement with its decoration', async () => {
    const { protocol } = await boot();
    expect(await outcome(() => saveExtension(protocol, PAIR, { fields: { region__c: REGION }, ...ARRANGEMENT }))).toEqual({ ok: true });

    const item = await servedObject(protocol);
    expect(layout(item)).toEqual([
      ['contact', ['email', 'phone', 'status']],
      ['basic', ['name', 'company', 'region__c']],
      // Unlisted, never dropped: the owner's `fax` and the extension package's placed field, after the last group.
      [null, ['fax', 'crm_tax_id']],
    ]);
    expect(item.relatedLists).toEqual(['crm_event', 'crm_task']);
    expect(item._relatedListsArrangement).toEqual({ packageId: PAIR, hidden: ['crm_note'], unlisted: 'hidden' });

    const listed = ((await protocol.getMetaItems({ type: 'object' })).items as any[]).find((o) => o?.name === OBJ);
    expect(listed?.relatedLists, 'the list read serves the same tabs').toEqual(['crm_event', 'crm_task']);
    expect(listed?._relatedListsArrangement, 'and carries the decoration').toEqual(item._relatedListsArrangement);

    const execution = (await protocol.getMetaItemForExecution({ type: 'object', name: OBJ }))?.item;
    expect(execution, 'precondition: the execution face answers').toBeTruthy();
    expect('_relatedListsArrangement' in execution, 'the execution face is not decorated').toBe(false);
  });

  it('only `relatedLists` written: the field groups keep the owner\'s arrangement with the placement', async () => {
    const { protocol } = await boot();
    expect(await outcome(() => saveExtension(protocol, PAIR, { relatedLists: ARRANGEMENT.relatedLists }))).toEqual({ ok: true });
    const item = await servedObject(protocol);
    expect(layout(item)).toEqual(STEPS_1_2.layout);
    expect(item.relatedLists).toEqual(['crm_event', 'crm_task']);
  });

  it('a writable package that is not a `.custom` one is refused at the save door, once, and nothing is stored or served', async () => {
    const { protocol, stores } = await boot();
    for (const [key, body] of [
      ['fieldGroups', { fieldGroups: [{ key: 'addon', label: 'Addon', fields: ['name'] }] }],
      ['relatedLists', { relatedLists: ['crm_event'] }],
    ] as const) {
      const refused = await outcome(() => saveExtension(protocol, ADDON, body));
      expect(refused, key).toMatchObject({ ok: false, code: 'VALIDATION_ERROR', status: 400, issues: 1 });
      expect((refused as any).message, key).toContain(`\`${key}\``);
      expect((refused as any).message, 'prescribes `place`').toContain('`place`');
    }
    const rows = Array.from(stores.get('sys_metadata')?.values() ?? []).filter((r) => r.type === 'object_extension' && r.package_id === ADDON);
    expect(rows, 'no row was written').toEqual([]);
    const item = await servedObject(protocol);
    expect(layout(item)).toEqual(STEPS_1_2.layout);
    expect(item.relatedLists).toEqual(STEPS_1_2.relatedLists);

    // Control: the same package's extension without the keys is admitted by the same door.
    expect(await outcome(() => saveExtension(protocol, ADDON, { fields: { addon_score: text('addon_score', 'Score') } }))).toEqual({ ok: true });
  });

  it('saving the pair\'s extension without the keys restores the owner\'s arrangement with the placement', async () => {
    const { protocol } = await boot();
    await saveExtension(protocol, PAIR, { fields: { region__c: REGION }, ...ARRANGEMENT });
    expect((await servedObject(protocol)).relatedLists).toEqual(['crm_event', 'crm_task']);

    await saveExtension(protocol, PAIR, { fields: { region__c: REGION } });
    const item = await servedObject(protocol);
    expect(item.relatedLists).toEqual(STEPS_1_2.relatedLists);
    expect('_relatedListsArrangement' in item).toBe(false);
    // The pair's own field stays, ungrouped; the owner's groups are back.
    expect(layout(item)).toEqual([...STEPS_1_2.layout, [null, ['region__c']]]);
  });

  it('disabling the pair restores it too, with no write, and enabling brings the arrangement back', async () => {
    const { registry, protocol } = await boot();
    await saveExtension(protocol, PAIR, { fields: { region__c: REGION }, ...ARRANGEMENT });

    registry.disablePackage(PAIR);
    const off = await servedObject(protocol);
    expect(layout(off)).toEqual(STEPS_1_2.layout);
    expect(off.relatedLists).toEqual(STEPS_1_2.relatedLists);
    expect('_relatedListsArrangement' in off).toBe(false);

    registry.enablePackage(PAIR);
    const on = await servedObject(protocol);
    expect(on.relatedLists).toEqual(['crm_event', 'crm_task']);
    expect(on._relatedListsArrangement).toEqual({ packageId: PAIR, hidden: ['crm_note'], unlisted: 'hidden' });
  });
});
