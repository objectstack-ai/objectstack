// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34901] A view over a field a DISABLED package contributes, through the
 * real protocol over the real `ObjectQL` engine and an in-memory driver.
 *
 * Package P extends Q's object with `crm_project`; Q's list view names it as a
 * column and as its sort. Disabling P withholds the field from the served
 * object (and the data door refuses it on every axis), while Q's view keeps
 * naming it. Pinned here:
 *
 *  - the served object read says which names are withheld (`_withheldFields`),
 *    the execution face and the layered read do not, and re-enabling P clears
 *    it with no write;
 *  - the view save door judges a view write against the storage fold, so the
 *    view saves into Q's customization pair while P is off, and a typo'd
 *    column is still refused;
 *  - that fold is for view writes only: an object write whose embedded list
 *    view names the withheld field is still judged against the served object.
 *
 * Test-path resolution: the protocol is `@objectstack/metadata-protocol`'s
 * `dist/`, so a change there is read here after that package is rebuilt.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  return { driver };
}

const Q = 'com.example.expenses';
const P = 'com.example.projects';
const O = 'crm_expense';
const VIEW = 'crm_expense.all';
const PAIR = `${Q}.custom`;

async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(makeMemoryDriver().driver, true);
  await engine.init();
  engine.registry.registerObject(sysMetadataObject, 'test-package');
  for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) engine.registry.registerObject(o as any, 'test-package');
  engine.registerApp({
    id: Q, name: 'expenses', version: '1.0.0', namespace: 'crm', type: 'app',
    objects: [{ name: O, label: 'Expense', fields: { name: { name: 'name', label: 'Name', type: 'text' }, amount: { name: 'amount', label: 'Amount', type: 'number' } } }],
    views: [{
      object: O,
      listViews: {
        all: { label: 'All expenses', type: 'grid', data: { provider: 'object', object: O }, columns: [{ field: 'name' }, { field: 'amount' }, { field: 'crm_project' }], sort: [{ field: 'crm_project', order: 'asc' }] },
        // A code-registered view that never passed a write door, with a typo'd column: the read still warns on it.
        typo: { label: 'Typo', type: 'grid', data: { provider: 'object', object: O }, columns: [{ field: 'name' }, { field: 'crm_projcet' }] },
      },
      formViews: {
        main: { type: 'simple', data: { provider: 'object', object: O }, sections: [{ label: 'Main', columns: 2, fields: ['name', 'crm_project'] }] },
      },
    }],
  } as any);
  engine.registerApp({
    id: P, name: 'projects', version: '1.0.0', namespace: 'crm', type: 'app', dependencies: { [Q]: '^1.0.0' },
    objectExtensions: [{ extend: O, fields: { crm_project: { name: 'crm_project', label: 'Project', type: 'text' } } }],
  } as any);
  const protocol = new ObjectStackProtocolImplementation(engine, () => new Map());
  await (protocol as any).installPackage({ manifest: { id: PAIR, name: 'expenses-custom', version: '0.1.0', type: 'app', namespace: 'crm_custom', dependencies: { [Q]: '^1' } } });
  return { engine, registry: engine.registry as any, protocol: protocol as any };
}

const savedWritable = process.env.OS_METADATA_WRITABLE;
beforeEach(() => { delete process.env.OS_METADATA_WRITABLE; ObjectStackProtocolImplementation.resetEnvWritableCache(); resetEnvWritableMetadataTypes(); });
afterEach(() => {
  if (savedWritable === undefined) delete process.env.OS_METADATA_WRITABLE; else process.env.OS_METADATA_WRITABLE = savedWritable;
  ObjectStackProtocolImplementation.resetEnvWritableCache(); resetEnvWritableMetadataTypes();
});

/** The served view as the console's read-merge-write holds it, ready to PUT into Q's pair. */
async function servedViewBody(protocol: any, edit: (config: any) => any = (c) => c) {
  const item = (await protocol.getMetaItem({ type: 'view', name: VIEW })).item;
  const { _packageId, _provenance, ...body } = item;
  return { ...body, config: edit(body.config), overrides: { package: Q, basedOn: '1.0.0' } };
}

async function outcome(fn: () => Promise<unknown>) {
  try {
    await fn();
    return { ok: true as const };
  } catch (e: any) {
    const issues = e?.issues ?? e?.details?.issues ?? e?.errors;
    return {
      ok: false as const,
      code: e?.code,
      status: e?.status,
      rules: Array.isArray(issues) ? issues.map((i: any) => i?.rule ?? i?.code) : [],
      message: String(e?.message ?? ''),
    };
  }
}

describe('[#34901] a view over a field a disabled package contributes', () => {
  it('the served object read names the withheld field and its package; the execution face does not; re-enable clears it', async () => {
    const { registry, protocol } = await boot();
    const on = (await protocol.getMetaItem({ type: 'object', name: O })).item;
    expect('_withheldFields' in on, 'nothing disabled ⇒ no marker').toBe(false);

    registry.disablePackage(P);
    const off = (await protocol.getMetaItem({ type: 'object', name: O })).item;
    expect(off._withheldFields).toEqual({ crm_project: { packageId: P } });
    expect(Object.keys(off.fields)).not.toContain('crm_project');
    const listed = ((await protocol.getMetaItems({ type: 'object' })).items as any[]).find((o) => o?.name === O);
    expect(listed?._withheldFields, 'the list read carries it too').toEqual({ crm_project: { packageId: P } });
    const execution = (await protocol.getMetaItemForExecution({ type: 'object', name: O }))?.item;
    expect(execution, 'precondition: the execution face answers').toBeTruthy();
    expect('_withheldFields' in execution, 'the execution face is not decorated').toBe(false);

    registry.enablePackage(P);
    const back = (await protocol.getMetaItem({ type: 'object', name: O })).item;
    expect('_withheldFields' in back).toBe(false);
    expect(Object.keys(back.fields)).toContain('crm_project');
  });

  it('the view saves into the pair while P is off, keeping the withheld column and sort, served as saved once P is back', async () => {
    const { registry, protocol } = await boot();
    registry.disablePackage(P);
    const body = await servedViewBody(protocol, (c) => ({ ...c, columns: c.columns.map((col: any) => (col.field === 'name' ? { ...col, width: 240 } : col)) }));
    const saved = await outcome(() => protocol.saveMetaItem({ type: 'view', name: VIEW, item: body, packageId: PAIR }));
    expect(saved).toEqual({ ok: true });

    registry.enablePackage(P);
    const served = (await protocol.getMetaItem({ type: 'view', name: VIEW })).item;
    expect(served.config.columns.map((c: any) => c.field)).toEqual(['name', 'amount', 'crm_project']);
    expect(served.config.columns[0].width).toBe(240);
    expect(served.config.sort).toEqual([{ field: 'crm_project', order: 'asc' }]);
  });

  it('a typo\'d column is still refused while P is off', async () => {
    const { registry, protocol } = await boot();
    registry.disablePackage(P);
    const body = await servedViewBody(protocol, (c) => ({ ...c, columns: [...c.columns, { field: 'crm_projcet' }] }));
    const saved = await outcome(() => protocol.saveMetaItem({ type: 'view', name: VIEW, item: body, packageId: PAIR }));
    expect(saved).toMatchObject({ ok: false, status: 422 });
    // One issue, on the typo's own position: the withheld column beside it is not refused.
    expect((saved as any).rules).toEqual(['list-view-field-unknown']);
    expect((saved as any).message).toContain('config.columns[3].field');
  });

  it('the fold is for view writes only: a page sorting by the withheld field is still refused while P is off', async () => {
    const { registry, protocol } = await boot();
    const page = (field: string) => ({
      name: 'crm_custom_expenses', label: 'Expenses', type: 'list', object: O,
      interfaceConfig: { source: O, sort: [{ field, order: 'asc' }] },
    });
    const save = (field: string) => outcome(() => protocol.saveMetaItem({ type: 'page', name: 'crm_custom_expenses', item: page(field), packageId: PAIR }));
    expect(await save('crm_project'), 'precondition: with P on the page saves').toEqual({ ok: true });

    registry.disablePackage(P);
    const refused = await save('crm_project');
    expect(refused).toMatchObject({ ok: false, status: 422 });
    expect((refused as any).rules).toEqual(['page-field-unknown']);
    expect(await save('name'), 'control: a served field saves').toEqual({ ok: true });
  });

  // [#34901 L2 N5] Every view rule that reads the object's fields is judged
  // against the same fold, not only the column and the sort. Each position is
  // pinned with its control: the same position spelling a typo is refused,
  // which proves the rule judges that position at all.
  const POSITIONS: Array<[string, (field: string) => (config: any) => any, string]> = [
    ['a filter', (field) => (c) => ({ ...c, filter: [{ field, operator: 'equals', value: 'x' }] }), 'config.filter[0].field'],
    ['a grouping level', (field) => (c) => ({ ...c, grouping: { fields: [{ field }] } }), 'config.grouping.fields[0].field'],
    ['a searchable field', (field) => (c) => ({ ...c, searchableFields: ['name', field] }), 'config.searchableFields[1]'],
  ];
  for (const [label, edit, path] of POSITIONS) {
    it(`${label} naming the withheld field saves while P is off; a typo there is refused`, async () => {
      const { registry, protocol } = await boot();
      registry.disablePackage(P);
      const saved = await outcome(async () => protocol.saveMetaItem({ type: 'view', name: VIEW, item: await servedViewBody(protocol, edit('crm_project')), packageId: PAIR }));
      expect(saved).toEqual({ ok: true });
      const typo = await outcome(async () => protocol.saveMetaItem({ type: 'view', name: VIEW, item: await servedViewBody(protocol, edit('crm_projcet')), packageId: PAIR }));
      expect(typo).toMatchObject({ ok: false, status: 422 });
      expect((typo as any).message).toContain(path);
    });
  }

  // A form section's unknown field is an ADVISORY at the door (`form-field-unknown`
  // never refuses: the field just does not render), carried on the save's 2xx.
  it('a form section naming the withheld field saves while P is off with no advisory on it; a typo is advised', async () => {
    const { registry, protocol } = await boot();
    registry.disablePackage(P);
    const form = async (field: string) => {
      const { _packageId, _provenance, _diagnostics, ...body } = (await protocol.getMetaItem({ type: 'view', name: FORM })).item;
      const config = { ...body.config, sections: [{ label: 'Main', columns: 2, fields: ['name', field] }] };
      return { ...body, config, overrides: { package: Q, basedOn: '1.0.0' } };
    };
    const advised = (result: any) => ((result?.advisories ?? []) as any[]).map((a) => `${a.rule}@${a.path}`);
    const saved = await protocol.saveMetaItem({ type: 'view', name: FORM, item: await form('crm_project'), packageId: PAIR });
    expect(saved.success).toBe(true);
    expect(advised(saved).filter((a) => a.startsWith('form-field-unknown'))).toEqual([]);
    const typo = await protocol.saveMetaItem({ type: 'view', name: FORM, item: await form('crm_projcet'), packageId: PAIR });
    expect(advised(typo).filter((a) => a.startsWith('form-field-unknown')), 'control: the position is judged').toHaveLength(1);
  });
});

/** Every warning a served view's `_diagnostics` carries, as `path: message`. */
function warningsOf(item: any): string[] {
  return ((item?._diagnostics?.warnings ?? []) as any[]).map((w) => `${w.path}: ${w.message}`);
}

const FORM = 'crm_expense.main';

describe('[#34901 L2 S1] a served view judges the withheld field as the save door does', () => {
  it('a view the door accepts reads back with no field warning on the withheld name; a typo still warns', async () => {
    const { registry, protocol } = await boot();
    registry.disablePackage(P);
    const body = await servedViewBody(protocol, (c) => ({
      ...c,
      filter: [{ field: 'crm_project', operator: 'equals', value: 'x' }],
      grouping: { fields: [{ field: 'crm_project' }] },
      searchableFields: ['name', 'crm_project'],
    }));
    expect(await outcome(() => protocol.saveMetaItem({ type: 'view', name: VIEW, item: body, packageId: PAIR }))).toEqual({ ok: true });

    const served = (await protocol.getMetaItem({ type: 'view', name: VIEW })).item;
    expect(served.config.columns.map((c: any) => c.field), 'precondition: the saved view still names it').toContain('crm_project');
    expect(warningsOf(served).filter((w) => w.includes('crm_project'))).toEqual([]);
    expect(warningsOf(served).filter((w) => w.includes('list-view-field-unknown') || w.includes('is not a field'))).toEqual([]);

    const layered = await protocol.getMetaItemLayered({ type: 'view', name: VIEW });
    expect(warningsOf({ _diagnostics: layered._diagnostics }).filter((w) => w.includes('crm_project')), 'the layered read too').toEqual([]);

    const typo = (await protocol.getMetaItem({ type: 'view', name: 'crm_expense.typo' })).item;
    expect(warningsOf(typo).filter((w) => w.includes('crm_projcet')), 'control: a typo still warns').toHaveLength(1);
  });

  it('a form section naming the withheld field reads back with no form-field-unknown; with P on there was none either', async () => {
    const { registry, protocol } = await boot();
    const on = (await protocol.getMetaItem({ type: 'view', name: FORM })).item;
    expect(on.config.sections[0].fields, 'precondition: the form names it').toContain('crm_project');
    expect(warningsOf(on).filter((w) => w.includes('crm_project'))).toEqual([]);

    registry.disablePackage(P);
    const off = (await protocol.getMetaItem({ type: 'view', name: FORM })).item;
    expect(warningsOf(off).filter((w) => w.includes('crm_project'))).toEqual([]);
  });
});
