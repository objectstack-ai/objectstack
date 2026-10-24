// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25491] An inline `FieldMappingEntry[]` mapping's per-cell rules
 * (`transform`, `defaultValue`, `required`) are applied by the REAL
 * `POST /data/:object/import` route before the cells are coerced: they used to
 * be accepted and dropped, leaving only the rename. Driven through a real
 * ObjectQL engine + protocol on sqlite `:memory:`, as
 * `import-integration.test.ts` is.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SUPPLIER = {
  name: 'supplier', label: 'Supplier', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
    country: { name: 'country', type: 'text' as const, label: 'Country' },
    credit_code: { name: 'credit_code', type: 'text' as const, label: 'Credit code' },
  },
  validations: [{
    type: 'format' as const, name: 'credit_code_format', field: 'credit_code',
    regex: '^[0-9A-Z]{18}$', message: 'Credit code must be 18 digits or capital letters',
  }],
};

const CONTACT = {
  name: 'contact', label: 'Contact', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    supplier: { name: 'supplier', type: 'text' as const, label: 'Supplier' },
    email: { name: 'email', type: 'email' as const, label: 'Email' },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
  },
};

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
  }), true);
  await engine.init();
  engine.registry.registerObject(SUPPLIER as any);
  engine.registry.registerObject(CONTACT as any);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const noop = () => {};
  const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
  const rest = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/import');
  expect(route).toBeDefined();
  return { engine, route };
}

describe('import route — inline FieldMappingEntry rules (#25491)', () => {
  let engine: any;
  let route: any;
  const call = async (object: string, body: any) => {
    const res = makeRes();
    await route.handler({ params: { object }, body } as any, res);
    return res;
  };

  beforeEach(async () => {
    ({ engine, route } = await boot());
  });

  it('uppercase: a lowercase credit code passes the ^[0-9A-Z]{18}$ rule and is stored upper-cased (the card\'s reproduction)', async () => {
    const res = await call('supplier', {
      format: 'csv',
      csv: '公司全称,国家 / 地区,统一社会信用代码\n示例公司,中国,91000000ma0trial02\n',
      mapping: [
        { sourceField: '公司全称', targetField: 'name' },
        { sourceField: '国家 / 地区', targetField: 'country' },
        { sourceField: '统一社会信用代码', targetField: 'credit_code', transform: 'uppercase' },
      ],
      writeMode: 'upsert', matchFields: ['credit_code'],
    });
    expect(res._json).toMatchObject({ total: 1, ok: 1, errors: 0, created: 1 });
    const stored = await engine.find('supplier', {});
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: '示例公司', country: '中国', credit_code: '91000000MA0TRIAL02' });
  });

  it('lowercase: two spellings of one email merge into one contact under matchFields [supplier, email]', async () => {
    const mapping = [
      { sourceField: 'Supplier', targetField: 'supplier' },
      { sourceField: 'Email', targetField: 'email', transform: 'lowercase' },
      { sourceField: 'Name', targetField: 'name' },
    ];
    const first = await call('contact', {
      format: 'csv', csv: 'Supplier,Email,Name\ns1,ZHOU@X.EXAMPLE.COM,Zhou\n',
      mapping, writeMode: 'upsert', matchFields: ['supplier', 'email'],
    });
    expect(first._json).toMatchObject({ ok: 1, created: 1 });
    const second = await call('contact', {
      format: 'csv', csv: 'Supplier,Email,Name\ns1,zhou@x.example.com,Zhou Wei\n',
      mapping, writeMode: 'upsert', matchFields: ['supplier', 'email'],
    });
    expect(second._json).toMatchObject({ ok: 1, created: 0, updated: 1 });
    const stored = await engine.find('contact', {});
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ supplier: 's1', email: 'zhou@x.example.com', name: 'Zhou Wei' });
  });

  it('trim: strips the cell even when the request turns trimWhitespace off', async () => {
    const res = await call('supplier', {
      format: 'json', trimWhitespace: false,
      rows: [{ N: '  Acme  ', C: '  CN  ' }],
      mapping: [
        { sourceField: 'N', targetField: 'name', transform: 'trim' },
        { sourceField: 'C', targetField: 'country' },
      ],
    });
    expect(res._json).toMatchObject({ ok: 1, created: 1 });
    const [stored] = await engine.find('supplier', {});
    expect(stored).toMatchObject({ name: 'Acme', country: '  CN  ' });
  });

  it('defaultValue: fills a blank cell and a missing column, leaves a filled cell alone', async () => {
    const res = await call('supplier', {
      format: 'csv', csv: 'Name,Country\nA,\nB,JP\n',
      mapping: [
        { sourceField: 'Name', targetField: 'name' },
        { sourceField: 'Country', targetField: 'country', defaultValue: 'CN' },
        { sourceField: 'Code', targetField: 'credit_code', defaultValue: '000000000000000000' },
      ],
    });
    expect(res._json).toMatchObject({ ok: 2, created: 2 });
    const stored = await engine.find('supplier', { orderBy: [{ field: 'name', order: 'asc' }] });
    expect(stored.map((r: any) => [r.name, r.country, r.credit_code])).toEqual([
      ['A', 'CN', '000000000000000000'],
      ['B', 'JP', '000000000000000000'],
    ]);
  });

  it('required: a blank required cell refuses the request before any row, on the dry run and the commit alike', async () => {
    const body = {
      format: 'csv', csv: 'Name,Country\nA,CN\nB,\n',
      mapping: [
        { sourceField: 'Name', targetField: 'name' },
        { sourceField: 'Country', targetField: 'country', required: true },
      ],
    };
    const dry = await call('supplier', { ...body, dryRun: true });
    const commit = await call('supplier', body);
    for (const res of [dry, commit]) {
      expect(res._status).toBe(400);
      expect(res._json?.error?.code ?? res._json?.code).toBe('MISSING_REQUIRED_FIELD');
      expect(JSON.stringify(res._json)).toContain('row 2');
    }
    expect(await engine.find('supplier', {})).toHaveLength(0);
  });

  it('required with a defaultValue is satisfied by the default', async () => {
    const res = await call('supplier', {
      format: 'csv', csv: 'Name,Country\nB,\n',
      mapping: [
        { sourceField: 'Name', targetField: 'name' },
        { sourceField: 'Country', targetField: 'country', required: true, defaultValue: 'CN' },
      ],
    });
    expect(res._json).toMatchObject({ ok: 1, created: 1 });
  });

  it('date_format is refused with 400 UNSUPPORTED_TRANSFORM naming it, and nothing is written', async () => {
    const res = await call('supplier', {
      format: 'csv', csv: 'Name\nA\n',
      mapping: [{ sourceField: 'Name', targetField: 'name', transform: 'date_format' }],
    });
    expect(res._status).toBe(400);
    expect(res._json?.error?.code ?? res._json?.code).toBe('UNSUPPORTED_TRANSFORM');
    expect(JSON.stringify(res._json)).toContain('date_format');
    expect(await engine.find('supplier', {})).toHaveLength(0);
  });

  it('control: a plain { sourceField, targetField } array mapping is the rename it always was', async () => {
    const res = await call('supplier', {
      format: 'csv', csv: 'Name,Country\n  Acme ,cn\n', trimWhitespace: false,
      mapping: [
        { sourceField: 'Name', targetField: 'name' },
        { sourceField: 'Country', targetField: 'country', transform: 'none' },
      ],
    });
    expect(res._json).toMatchObject({ ok: 1, created: 1 });
    const [stored] = await engine.find('supplier', {});
    expect(stored).toMatchObject({ name: '  Acme ', country: 'cn' });
  });
});

/**
 * [#25611] A cell the request declares null (`nullValues`) stays blank whatever
 * case `transform` its entry declares: the blank test reads the raw cell, so a
 * sentinel is never rewritten out of being one (`n/a` upper-cased to `N/A`
 * would no longer match `nullValues: ['n/a']` and be stored as a value).
 */
describe('import route — a nullValues sentinel survives an inline case transform (#25611)', () => {
  let engine: any;
  let route: any;
  const call = async (object: string, body: any) => {
    const res = makeRes();
    await route.handler({ params: { object }, body } as any, res);
    return res;
  };
  const countryOf = async (name: string) => {
    const [row] = await engine.find('supplier', { where: { name } });
    return row?.country;
  };

  beforeEach(async () => {
    ({ engine, route } = await boot());
  });

  for (const [transform, sentinel] of [['uppercase', 'n/a'], ['lowercase', 'N/A']] as const) {
    it(`${transform}: the sentinel cell is stored unset, a non-sentinel cell is still transformed`, async () => {
      const res = await call('supplier', {
        format: 'csv', csv: `Name,Country\nA,${sentinel}\nB,Jp\n`, nullValues: [sentinel],
        mapping: [
          { sourceField: 'Name', targetField: 'name' },
          { sourceField: 'Country', targetField: 'country', transform },
        ],
      });
      expect(res._json).toMatchObject({ ok: 2, created: 2 });
      expect(await countryOf('A')).toBeNull();
      expect(await countryOf('B')).toBe(transform === 'uppercase' ? 'JP' : 'jp');
    });

    it(`${transform}: the sentinel cell takes the entry's defaultValue`, async () => {
      const res = await call('supplier', {
        format: 'csv', csv: `Name,Country\nA,${sentinel}\n`, nullValues: [sentinel],
        mapping: [
          { sourceField: 'Name', targetField: 'name' },
          { sourceField: 'Country', targetField: 'country', transform, defaultValue: 'cn-default' },
        ],
      });
      expect(res._json).toMatchObject({ ok: 1, created: 1 });
      expect(await countryOf('A')).toBe('cn-default');
    });

    it(`${transform}: a required entry refuses the sentinel cell as blank, nothing written`, async () => {
      const res = await call('supplier', {
        format: 'csv', csv: `Name,Country\nA,${sentinel}\n`, nullValues: [sentinel],
        mapping: [
          { sourceField: 'Name', targetField: 'name' },
          { sourceField: 'Country', targetField: 'country', transform, required: true },
        ],
      });
      expect(res._status).toBe(400);
      expect(res._json?.error?.code ?? res._json?.code).toBe('MISSING_REQUIRED_FIELD');
      expect(await engine.find('supplier', {})).toHaveLength(0);
    });
  }
});
