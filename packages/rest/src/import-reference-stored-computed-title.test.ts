// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24981] The import matches a lookup cell against a STORED title only
 * (ruling 6308445871, letter A: ADR-0079 addendum item 9, extended to the
 * import). A `formula` title is computed on read and stored nowhere, so no
 * `where` can ask it, and a target titled by one answers
 * `reference_not_found`. The remedy the ruling binds is the producer's: a
 * composite title that must round-trip through import is a STORED computed
 * field, a non-formula field with an `expression`, which the engine computes
 * and stores on every write (#24673).
 *
 * This file pins that remedy end to end, through the REAL import door
 * (`POST /api/v1/data/:object/import`), a REAL ObjectQL engine and a REAL
 * sqlite `:memory:` driver. The target rows are written WITHOUT their title,
 * the engine computes it on write, and the import's title rung (the target's
 * `resolveDisplayField`, after the id and the lookup's own `displayField`)
 * finds the record by one `where` over the stored column.
 *
 * Not repeated here, because the runner's own suite pins it closer to the
 * code (`packages/core/src/utils/import-runner-reference-title.test.ts`): that
 * a formula candidate is never asked by `where`, the exact candidate order,
 * the one metadata read per target, and #22739's exposure check. The formula
 * row below is only this file's control leg: the same title over the same
 * rows, declared as a formula, so the remedy is shown to be what moves the
 * verdict.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

const ACCOUNT_TITLE = { dialect: 'cel', source: 'record.name + " (" + record.region + ")"' };
const CONTACT_TITLE = { dialect: 'cel', source: 'record.first_name + " " + record.last_name' };

/** `Acme (EMEA)`: a stored computed title whose name is NOT on the fallback key list. */
const ACCOUNT = {
  name: 'xt_account', label: 'Account', systemFields: false, nameField: 'display_title',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
    region: { name: 'region', type: 'text' as const, label: 'Region' },
    display_title: { name: 'display_title', type: 'text' as const, label: 'Display Title', expression: ACCOUNT_TITLE },
  },
};

/** The control: the same title over the same rows, declared as a formula. */
const FORMULA_ACCOUNT = {
  ...ACCOUNT,
  name: 'xt_formula_account', label: 'Formula Account',
  fields: {
    ...ACCOUNT.fields,
    display_title: {
      name: 'display_title', type: 'formula' as const, label: 'Display Title', returnType: 'text', expression: ACCOUNT_TITLE,
    },
  },
};

/** `John Smith`: a stored computed title, the shape a contact's composite name takes under the ruling. */
const CONTACT = {
  name: 'xt_contact', label: 'Contact', systemFields: false, nameField: 'full_name',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const, label: 'Job Title' },
    first_name: { name: 'first_name', type: 'text' as const, label: 'First Name' },
    last_name: { name: 'last_name', type: 'text' as const, label: 'Last Name' },
    full_name: { name: 'full_name', type: 'text' as const, label: 'Full Name', expression: CONTACT_TITLE },
  },
};

/** The imported object: one lookup per target, none with a `displayField` of its own. */
const CASE = {
  name: 'xt_case', label: 'Case', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    subject: { name: 'subject', type: 'text' as const, label: 'Subject' },
    account: { name: 'account', type: 'lookup' as const, label: 'Account', reference: 'xt_account' },
    formula_account: { name: 'formula_account', type: 'lookup' as const, label: 'Formula Account', reference: 'xt_formula_account' },
    contact: { name: 'contact', type: 'lookup' as const, label: 'Contact', reference: 'xt_contact' },
  },
};

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

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
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  for (const o of [ACCOUNT, FORMULA_ACCOUNT, CONTACT, CASE]) engine.registry.registerObject(o as any);
  await engine.syncSchemas();
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/import');
  expect(route).toBeDefined();
  const importCases = async (rows: Array<Record<string, unknown>>) => {
    const res = makeRes();
    await route!.handler({ params: { object: 'xt_case' }, body: { format: 'json', rows } } as any, res);
    return res._json;
  };
  return { engine, importCases };
}

const verdicts = (summary: any) =>
  summary.results.map((r: any) => ({ ok: r.ok, code: r.code, field: r.field }));
const OK = { ok: true, code: undefined, field: undefined };

describe('[#24981] the ruling\'s remedy: a stored computed title re-imports through the real door', () => {
  it('a title the engine computed on write resolves its lookup cell; the same title as a formula does not', async () => {
    const { engine, importCases } = await boot();
    // The title is NEVER sent: the engine computes and stores it on write.
    await engine.insert('xt_account', { id: 'a1', name: 'Acme', region: 'EMEA' });
    await engine.insert('xt_formula_account', { id: 'f1', name: 'Acme', region: 'EMEA' });
    await engine.insert('xt_contact', { id: 'c1', title: 'VP of Engineering', first_name: 'John', last_name: 'Smith' });
    expect((await engine.findOne('xt_account', { where: { id: 'a1' } }))?.display_title).toBe('Acme (EMEA)');
    expect((await engine.findOne('xt_contact', { where: { id: 'c1' } }))?.full_name).toBe('John Smith');

    const summary = await importCases([
      { id: 'k1', subject: 'stored, off the fallback list', account: 'Acme (EMEA)' },
      { id: 'k2', subject: 'stored, on the fallback list', contact: 'John Smith' },
      { id: 'k3', subject: 'control: the same title as a formula', formula_account: 'Acme (EMEA)' },
    ]);
    expect(verdicts(summary)).toEqual([OK, OK, { ok: false, code: 'reference_not_found', field: 'formula_account' }]);
    expect((await engine.findOne('xt_case', { where: { id: 'k1' } }))?.account).toBe('a1');
    expect((await engine.findOne('xt_case', { where: { id: 'k2' } }))?.contact).toBe('c1');
    expect(await engine.findOne('xt_case', { where: { id: 'k3' } })).toBeFalsy();
  });

  it('two records whose computed titles collide answer the import\'s ambiguity refusal, and link neither', async () => {
    const { engine, importCases } = await boot();
    await engine.insert('xt_account', { id: 'a1', name: 'Acme', region: 'EMEA' });
    await engine.insert('xt_account', { id: 'a2', name: 'Acme', region: 'EMEA' });
    await engine.insert('xt_account', { id: 'a3', name: 'Acme', region: 'APAC' });

    const summary = await importCases([
      { id: 'k1', subject: 'two records titled alike', account: 'Acme (EMEA)' },
      { id: 'k2', subject: 'one record titled so', account: 'Acme (APAC)' },
    ]);
    expect(verdicts(summary)).toEqual([{ ok: false, code: 'reference_ambiguous', field: 'account' }, OK]);
    expect(await engine.findOne('xt_case', { where: { id: 'k1' } })).toBeFalsy();
    expect((await engine.findOne('xt_case', { where: { id: 'k2' } }))?.account).toBe('a3');
  });
});
