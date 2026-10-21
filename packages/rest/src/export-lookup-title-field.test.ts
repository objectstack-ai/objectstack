// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A lookup cell in the list export names the referenced record by the TARGET
 * object's declared title field (ADR-0079 `nameField`, deprecated alias
 * `displayNameField`), not by the first hit of a fixed key list.
 *
 * Before this, `displayFromRecord` tried the lookup field's own `displayField`
 * and then `['name', 'title', 'label', 'full_name', …]` against the expanded
 * record. A contact declares `nameField: 'full_name'` and has no `name` column,
 * so its job `title` came first and every case export named the contact by its
 * job title ("VP of Engineering" instead of "John Smith").
 *
 * The route under test is the REAL streaming export (`GET
 * /api/v1/data/:object/export`) over a REAL engine + protocol + sqlite
 * `:memory:` driver: the title field is read off the target schema the
 * protocol serves, and the title value off the record the engine's `$expand`
 * loaded through its own read path (formula titles evaluated there).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';
import { formatCellValue, withReferenceTitleFields, type ExportFieldMeta } from './export-format.js';
import { loadXlsxWorkbook } from './xlsx-test-loader.js';

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/** The measured HotCRM shape: a FORMULA title, a job `title` column, no `name` column. */
const CONTACT = {
  name: 'xt_contact',
  label: 'Contact',
  systemFields: false,
  nameField: 'full_name',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const, label: 'Job Title' },
    first_name: { name: 'first_name', type: 'text' as const, label: 'First Name' },
    last_name: { name: 'last_name', type: 'text' as const, label: 'Last Name' },
    full_name: {
      name: 'full_name', type: 'formula' as const, label: 'Full Name', returnType: 'text',
      expression: { dialect: 'cel', source: 'record.first_name + " " + record.last_name' },
    },
  },
};

/** A title on a stored column, declared through the deprecated alias only. */
const PERSON = {
  name: 'xt_person',
  label: 'Person',
  systemFields: false,
  displayNameField: 'nickname',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const, label: 'Job Title' },
    nickname: { name: 'nickname', type: 'text' as const, label: 'Nickname' },
  },
};

/** A literal `name` column AND a declared title that is not it (HotCRM's account). */
const ACCOUNT = {
  name: 'xt_account',
  label: 'Account',
  systemFields: false,
  nameField: 'display_title',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
    region: { name: 'region', type: 'text' as const, label: 'Region' },
    display_title: {
      name: 'display_title', type: 'formula' as const, label: 'Display Title', returnType: 'text',
      expression: { dialect: 'cel', source: 'record.name + " (" + record.region + ")"' },
    },
  },
};

const CASE = {
  name: 'xt_case',
  label: 'Case',
  systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    subject: { name: 'subject', type: 'text' as const, label: 'Subject' },
    contact: { name: 'contact', type: 'lookup' as const, label: 'Contact', reference: 'xt_contact' },
    person: { name: 'person', type: 'lookup' as const, label: 'Person', reference: 'xt_person' },
    account: { name: 'account', type: 'lookup' as const, label: 'Account', reference: 'xt_account' },
    // CONTROL: the lookup field's own `displayField` is the field author's
    // explicit choice and still wins over the target's title.
    contact_role: {
      name: 'contact_role', type: 'lookup' as const, label: 'Contact Role',
      reference: 'xt_contact', displayField: 'title',
    },
  },
};

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const res: any = {
    write: (s: string) => { chunks.push(typeof s === 'string' ? s : String(s)); return true; },
    end: () => {},
    header: (n: string, v: string) => { headers[n] = v; return res; },
    status: () => res,
    json: (body: any) => { (res as any)._json = body; return res; },
  };
  return { res, chunks, headers };
}

function makeBinRes() {
  const chunks: Buffer[] = [];
  const res: any = {
    write: (c: any) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); return true; },
    end: () => {},
    header: () => res,
    status: () => res,
    json: () => res,
  };
  return { res, getBuffer: () => Buffer.concat(chunks) };
}

async function boot(opts: { protocolOverride?: (protocol: any) => any } = {}) {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }), true);
  await engine.init();
  for (const o of [CONTACT, PERSON, ACCOUNT, CASE]) engine.registry.registerObject(o as any);
  await engine.syncSchemas();
  await engine.insert('xt_contact', { id: 'c1', title: 'VP of Engineering', first_name: 'John', last_name: 'Smith' });
  await engine.insert('xt_person', { id: 'p1', title: 'Chief Procurement Officer', nickname: 'Wren' });
  await engine.insert('xt_account', { id: 'a1', name: 'Acme', region: 'EMEA' });
  await engine.insert('xt_case', {
    id: '1', subject: 'Login issues', contact: 'c1', person: 'p1', account: 'a1', contact_role: 'c1',
  });
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  const real = new ObjectStackProtocolImplementation(engine as any);
  const protocol = opts.protocolOverride ? opts.protocolOverride(real) : real;
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find(
    (r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/export',
  )!;
  return { engine, route };
}

function parseCsv(text: string): string[][] {
  return text.split('\r\n').filter((l) => l.length > 0).map((l) => l.split(','));
}

async function exportCsv(route: any, fields: string): Promise<string[][]> {
  const { res, chunks } = makeRes();
  await route.handler({ params: { object: 'xt_case' }, query: { format: 'csv', fields } } as any, res);
  return parseCsv(chunks.join(''));
}

describe('export — a lookup cell names the target record by its declared title field', () => {
  it('a target with `nameField` and no `name` column exports the title, not the job title (CSV)', async () => {
    const { route } = await boot();
    const rows = await exportCsv(route, 'id,contact');
    expect(rows[0]).toEqual(['ID', 'Contact']);
    expect(rows[1]).toEqual(['1', 'John Smith']);
  });

  it('the same cell through xlsx and json', async () => {
    const { route } = await boot();
    const bin = makeBinRes();
    await route.handler({ params: { object: 'xt_case' }, query: { format: 'xlsx', fields: 'id,contact' } } as any, bin.res);
    const ws = (await loadXlsxWorkbook(bin.getBuffer())).worksheets[0];
    expect((ws.getRow(2).values as any[]).slice(1).map(String)).toEqual(['1', 'John Smith']);

    const json = makeRes();
    await route.handler({ params: { object: 'xt_case' }, query: { format: 'json', fields: 'id,contact' } } as any, json.res);
    expect(JSON.parse(json.chunks.join(''))).toEqual([{ id: '1', contact: 'John Smith' }]);
  });

  it('the deprecated `displayNameField` alias is honoured the same way', async () => {
    const { route } = await boot();
    const rows = await exportCsv(route, 'id,person');
    expect(rows[1]).toEqual(['1', 'Wren']);
  });

  it('a declared title outranks a literal `name` column (account → display_title)', async () => {
    const { route } = await boot();
    const rows = await exportCsv(route, 'id,account');
    expect(rows[1]).toEqual(['1', 'Acme (EMEA)']);
  });

  it('CONTROL: the lookup field\'s own `displayField` still wins', async () => {
    const { route } = await boot();
    const rows = await exportCsv(route, 'id,contact_role');
    expect(rows[1]).toEqual(['1', 'VP of Engineering']);
  });

  it('CONTROL: a target whose schema declares neither keeps the key-list fallback', async () => {
    // The target schema is served WITHOUT a title pointer (a registry object
    // always carries one: the registry designates it at registration), so the
    // only way to an undeclared target through the real route is a served body
    // that lacks both keys. The key list then answers as before: `title`.
    const { route } = await boot({
      protocolOverride: (real) => new Proxy(real, {
        get(target, prop, receiver) {
          if (prop !== 'getMetaItem') return Reflect.get(target, prop, receiver);
          return async (req: any) => {
            const out = await target.getMetaItem(req);
            if (req?.name !== 'xt_contact') return out;
            const { nameField: _n, displayNameField: _d, ...item } = (out as any).item;
            return { ...(out as any), item };
          };
        },
      }),
    });
    const rows = await exportCsv(route, 'id,contact');
    expect(rows[1]).toEqual(['1', 'VP of Engineering']);
  });

  it('a title field the caller cannot read is not exported, and the key list does not stand in for it', async () => {
    const { engine, route } = await boot();
    // The FieldMasker's delete-key semantics on the TARGET object: the `$expand`
    // sub-read is a `find` on `xt_contact`, so the mask applies to it.
    engine.registerHook(
      'afterFind',
      (ctx: any) => { if (Array.isArray(ctx.result)) for (const r of ctx.result) { if (r) delete r.full_name; } },
      { object: 'xt_contact' },
    );
    const rows = await exportCsv(route, 'id,contact');
    // Neither the masked title nor the job title passing for a name — the
    // record's id, the cell's final floor.
    expect(rows[1]).toEqual(['1', 'c1']);
    const json = makeRes();
    await route.handler({ params: { object: 'xt_case' }, query: { format: 'json', fields: 'id,contact' } } as any, json.res);
    expect(json.chunks.join('')).not.toContain('John Smith');
  });
});

describe('withReferenceTitleFields + formatCellValue — the precedence, unit level', () => {
  const lookup = (name: string, reference: string, displayField?: string): ExportFieldMeta =>
    ({ name, type: 'lookup', reference, ...(displayField ? { displayField } : {}) });

  it('reads each target schema once per export and stamps only reference fields', async () => {
    const reads: string[] = [];
    const meta = new Map<string, ExportFieldMeta>([
      ['subject', { name: 'subject', type: 'text' }],
      ['contact', lookup('contact', 'xt_contact')],
      ['backup_contact', lookup('backup_contact', 'xt_contact')],
    ]);
    const out = await withReferenceTitleFields(meta, async (object) => {
      reads.push(object);
      return { name: object, nameField: 'full_name', fields: { full_name: { type: 'text' } } };
    });
    expect(reads).toEqual(['xt_contact']);
    expect(out.get('contact')?.titleField).toBe('full_name');
    expect(out.get('backup_contact')?.titleField).toBe('full_name');
    expect(out.get('subject')).toEqual({ name: 'subject', type: 'text' });
  });

  it('a target schema read that throws leaves that column on the key list, and does not throw', async () => {
    const meta = new Map<string, ExportFieldMeta>([['contact', lookup('contact', 'xt_contact')]]);
    const out = await withReferenceTitleFields(meta, async () => { throw new Error('metadata offline'); });
    expect(out.get('contact')?.titleField).toBeUndefined();
    const rec = { id: 'c1', title: 'VP of Engineering', full_name: 'John Smith' };
    expect(formatCellValue(rec, out.get('contact'))).toBe('VP of Engineering');
  });

  it('displayField, then titleField, then the id — the key list only without a titleField', () => {
    const rec = { id: 'c1', title: 'VP of Engineering', full_name: 'John Smith' };
    const titled = { ...lookup('contact', 'xt_contact'), titleField: 'full_name' };
    expect(formatCellValue(rec, titled)).toBe('John Smith');
    expect(formatCellValue(rec, { ...titled, displayField: 'title' })).toBe('VP of Engineering');
    expect(formatCellValue({ id: 'c1', title: 'VP of Engineering' }, titled)).toBe('c1');
    expect(formatCellValue([rec, { id: 'c2', full_name: 'Ann Lee' }], { ...titled, multiple: true }))
      .toBe('John Smith, Ann Lee');
  });
});
