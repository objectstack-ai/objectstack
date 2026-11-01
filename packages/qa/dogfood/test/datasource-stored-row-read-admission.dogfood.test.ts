// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27884] A datasource definition is served only to datasource
// administrators, at every exit that serves it: the stored row the definition
// lives in admits the same callers the metadata read door
// (`GET /api/v1/meta/datasource`) admits. Pinned at the REST doors of a booted
// stack, with the platform's own security composition:
//
//  - the platform administrator reads the row whole;
//  - a caller below datasource administration and a plain member are served
//    no row, and the metadata door refuses them as before;
//  - parity: for each caller, the stored row is served exactly when the
//    metadata door serves the definition.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { catalogPermissionSet } from './catalog-permission-set.js';

const fixture = defineStack({
  manifest: {
    id: 'com.dogfood.datasource-stored-row-read', namespace: 'dsr', version: '0.0.0', type: 'app',
    name: 'Datasource stored-row read fixture', description: 'An app with one object, for the data and metadata doors.',
  },
  objects: [
    ObjectSchema.create({
      name: 'dsr_note', label: 'Note', pluralLabel: 'Notes',
      fields: { name: Field.text({ label: 'Name', required: true }) },
    }),
  ],
} as never);

const DS = 'dsr_pinned_27884';
const REF = 'sys_secret:dsr_pinned_27884';
const HOST = 'warehouse.dsr-27884.internal';
const ORG_ADMIN = 'dsr-org-admin@verify.test';
const MEMBER = 'dsr-member@verify.test';
const SYS = { isSystem: true };

type Answer = { status: number; json: any; text: string };

describe('[#27884] the stored row of a datasource definition admits only datasource administrators', () => {
  let stack: VerifyStack;
  let ql: any;
  let rowId = '';
  const tokens: Record<'admin' | 'orgAdmin' | 'member', string> = { admin: '', orgAdmin: '', member: '' };

  const call = async (token: string, method: string, path: string, payload?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, payload);
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  const listRows = (a: Answer): any[] => (Array.isArray(a.json?.records) ? a.json.records : []);

  beforeAll(async () => {
    stack = await bootStack(fixture);
    ql = await stack.kernel.getServiceAsync('objectql');
    const protocol: any = await stack.kernel.getServiceAsync('protocol');
    await protocol.saveMetaItem({
      type: 'datasource',
      name: DS,
      item: {
        name: DS, label: 'Pinned', driver: 'postgres',
        config: { host: HOST, port: 5432, database: 'dsr_db', username: 'dsr_user' },
        external: { credentialsRef: REF },
      },
      packageId: null,
      source: 'migrate-stored',
    });
    const [row] = await ql.find('sys_metadata', { where: { type: 'datasource', name: DS }, context: SYS });
    rowId = String(row?.id ?? '');
    expect(rowId).not.toBe('');

    tokens.admin = await stack.signIn();
    tokens.orgAdmin = await stack.signUp(ORG_ADMIN);
    tokens.member = await stack.signUp(MEMBER);
    const set = 'organization_admin_no_bypass';
    expect(await catalogPermissionSet(ql, set), `${set} is served by the catalog`).toBeTruthy();
    const user = await ql.findOne('sys_user', { where: { email: ORG_ADMIN }, context: SYS });
    await ql.insert('sys_user_permission_set', { user_id: String(user?.id ?? ''), permission_set: set }, { context: SYS });
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('the platform administrator reads the row whole', async () => {
    const list = await call(tokens.admin, 'GET', `/data/sys_metadata?type=datasource&name=${DS}&fields=name,type,metadata`);
    expect(list.status, list.text).toBe(200);
    const [row] = listRows(list);
    const served = JSON.parse(String(row?.metadata ?? '{}'));
    expect(served.external?.credentialsRef).toBe(REF);
    expect(served.config).toMatchObject({ host: HOST, port: 5432, database: 'dsr_db', username: 'dsr_user' });
    const got = await call(tokens.admin, 'GET', `/data/sys_metadata/${encodeURIComponent(rowId)}`);
    expect(got.status, got.text).toBe(200);
  });

  for (const who of ['orgAdmin', 'member'] as const) {
    it(`${who === 'orgAdmin' ? 'a caller below datasource administration' : 'a plain member'} is served no row`, async () => {
      const token = tokens[who];
      const list = await call(token, 'GET', `/data/sys_metadata?type=datasource&fields=name,type,metadata`);
      // 403 (the object is not readable at all) or 200 with no datasource row.
      expect([200, 403]).toContain(list.status);
      expect(listRows(list).filter((r) => r.type === 'datasource' || r.name === DS)).toEqual([]);
      const query = await call(token, 'POST', '/data/sys_metadata/query', { where: { name: DS }, fields: ['name', 'metadata'] });
      expect([200, 403]).toContain(query.status);
      expect(listRows(query)).toEqual([]);
      const got = await call(token, 'GET', `/data/sys_metadata/${encodeURIComponent(rowId)}`);
      expect([403, 404]).toContain(got.status);
      for (const answer of [list, query, got]) {
        expect(answer.text).not.toContain(REF);
        expect(answer.text).not.toContain(HOST);
      }
      const meta = await call(token, 'GET', `/meta/datasource/${DS}`);
      expect(meta.status, meta.text).toBe(403);
    });
  }

  it('parity: each caller is served the stored row exactly when the metadata door serves the definition', async () => {
    for (const who of ['admin', 'orgAdmin', 'member'] as const) {
      const meta = await call(tokens[who], 'GET', `/meta/datasource/${DS}`);
      const data = await call(tokens[who], 'GET', `/data/sys_metadata/${encodeURIComponent(rowId)}`);
      expect({ who, data: data.status === 200 }).toEqual({ who, data: meta.status === 200 });
    }
  });
});
