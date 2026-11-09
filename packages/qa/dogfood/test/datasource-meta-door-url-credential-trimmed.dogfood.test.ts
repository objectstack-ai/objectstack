// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The datasource metadata door `PUT /api/v1/meta/datasource/:name` and its
// read `GET /api/v1/meta/datasource/:name`, on a booted stack: a driver
// config URL is judged after trimming its leading and trailing C0 control
// characters and spaces and deleting every tab, newline and carriage return
// in it — as a URL parser reads it — at both doors:
//
//  - WRITE: a `config.url` holding a userinfo password is refused with the
//    `422 INVALID_METADATA` envelope located at `config.url`, whatever
//    surrounds it, and nothing is stored.
//  - CONTROL: a bare username in the same position, and a credential-free
//    URL, save and are stored exactly as written.
//  - READ: a stored row whose URL holds a userinfo password (seeded through
//    the system context, the only way such a row is written now) is served
//    with the password removed at the position the write door judges, every
//    other character — the surrounding ones included — as stored. The stored
//    row is never touched: redaction is a serving act.
//
// Every credential below is an obviously-fake placeholder, and every
// assertion on one is its absence from what a door served or stored, or its
// presence at rest on a seeded row.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const fixture = defineStack({
  manifest: {
    id: 'com.dogfood.datasource-url-credential-trimmed', namespace: 'duct', version: '0.0.0', type: 'app',
    name: 'Datasource URL credential fixture', description: 'An app with one object, for its metadata door.',
  },
  objects: [
    ObjectSchema.create({
      name: 'duct_note', label: 'Note', pluralLabel: 'Notes',
      fields: { name: Field.text({ label: 'Name', required: true }) },
    }),
  ],
} as never);

const PLACEHOLDER = 'TEST_PLACEHOLDER_DUCT_URL_PASSWORD';
const TAB = String.fromCharCode(0x09);
const LF = String.fromCharCode(0x0a);
const SYS = { isSystem: true };
const CR = String.fromCharCode(0x0d);
const SEEDED = 'duct_seeded_row';
const SEEDED_PG = 'duct_seeded_pg_row';

type Answer = { status: number; json: any; text: string };

describe('datasource metadata door: a driver config URL is judged after trimming surrounding whitespace, at the write and at the read', () => {
  let stack: VerifyStack;
  let ql: any;
  let token = '';

  const call = async (method: string, path: string, payload?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, payload);
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  const storedRows = async (name: string): Promise<Array<Record<string, unknown>>> =>
    ql.find('sys_metadata', { where: { type: 'datasource', name }, context: SYS });
  const storedBody = async (name: string): Promise<Record<string, any>> => {
    const [row] = await storedRows(name);
    const raw = row?.metadata;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, any>;
  };
  const body = (name: string, driver: string, url: string) => ({ name, label: `DUCT ${name}`, driver, config: { url } });
  const storedPgUrl = () => `postgre${TAB}sql://svc:${PLACEHOLDER}@db.internal:5432/app?sslmode=require&pass${CR}word=${PLACEHOLDER}`;

  beforeAll(async () => {
    stack = await bootStack(fixture);
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    // A row stored before the refusal: a clean save, then the system context
    // writes the password over it.
    const clean = await call('PUT', `/meta/datasource/${SEEDED}`, body(SEEDED, 'mysql', ' mysql://svc@db.internal:3306/app'));
    expect(clean.status, clean.text).toBe(200);
    const [row] = await storedRows(SEEDED);
    const seeded = body(SEEDED, 'mysql', ` mysql://svc:${PLACEHOLDER}@db.internal:3306/app${LF}`);
    await ql.update('sys_metadata', { id: row!.id, metadata: JSON.stringify(seeded) }, { context: SYS });
    const cleanPg = await call('PUT', `/meta/datasource/${SEEDED_PG}`, body(SEEDED_PG, 'postgres', 'postgresql://svc@db.internal:5432/app'));
    expect(cleanPg.status, cleanPg.text).toBe(200);
    const [pgRow] = await storedRows(SEEDED_PG);
    await ql.update('sys_metadata', { id: pgRow!.id, metadata: JSON.stringify(body(SEEDED_PG, 'postgres', storedPgUrl())) }, { context: SYS });
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  describe('WRITE: a URL holding a userinfo password is refused whatever surrounds it, and nothing is stored', () => {
    it.each([
      ['a mysql `config.url` behind a leading space', 'duct_w_mysql', 'mysql', ` mysql://svc:${PLACEHOLDER}@db.internal:3306/app`],
      ['a postgres `config.url` behind a leading tab', 'duct_w_postgres', 'postgres', `${TAB}postgresql://svc:${PLACEHOLDER}@db.internal:5432/app`],
      ['a mongo `config.url` between a leading space and a trailing newline', 'duct_w_mongo', 'mongodb', ` mongodb://svc:${PLACEHOLDER}@db.internal:27017/app${LF}`],
      ['a postgres `config.url` with a tab inside its scheme', 'duct_w_pg_scheme_tab', 'postgres', `postgre${TAB}sql://svc:${PLACEHOLDER}@db.internal:5432/app`],
    ])('%s', async (_label, name, driver, url) => {
      const answer = await call('PUT', `/meta/datasource/${name}`, body(name, driver, url));
      expect(answer.status, answer.text.slice(0, 300)).toBe(422);
      expect(answer.json.code ?? answer.json.error?.code).toBe('INVALID_METADATA');
      const issues: any[] = answer.json.issues ?? answer.json.error?.issues ?? [];
      const atUrl = issues.filter((i) => (Array.isArray(i.path) ? i.path.join('.') : i.path) === 'config.url');
      expect(atUrl.some((i) => String(i.message).includes('embeds a password in its userinfo')), answer.text.slice(0, 600)).toBe(true);
      expect(answer.text.includes(PLACEHOLDER), 'the refusal echoes no credential').toBe(false);
      expect(await storedRows(name), `${name}: nothing stored`).toEqual([]);
    });
  });

  it('WRITE: a postgres `config.url` whose `password` query parameter holds a tab inside its name is refused, and nothing is stored', async () => {
    const name = 'duct_w_pg_key_tab';
    const answer = await call('PUT', `/meta/datasource/${name}`, body(name, 'postgres', `postgresql://svc@db.internal:5432/app?pass${TAB}word=${PLACEHOLDER}`));
    expect(answer.status, answer.text.slice(0, 300)).toBe(422);
    expect(answer.json.code ?? answer.json.error?.code).toBe('INVALID_METADATA');
    const issues: any[] = answer.json.issues ?? answer.json.error?.issues ?? [];
    const atUrl = issues.filter((i) => (Array.isArray(i.path) ? i.path.join('.') : i.path) === 'config.url');
    expect(atUrl.some((i) => String(i.message).includes('`?password=`')), answer.text.slice(0, 600)).toBe(true);
    expect(answer.text.includes(PLACEHOLDER), 'the refusal echoes no credential').toBe(false);
    expect(await storedRows(name), `${name}: nothing stored`).toEqual([]);
  });

  describe('CONTROL: a bare username or a credential-free URL saves and is stored as written', () => {
    it.each([
      ['a bare username behind a leading space', 'duct_c_bare_user', 'mysql', ' mysql://svc@db.internal:3306/app'],
      ['a credential-free URL between a leading tab and a trailing newline', 'duct_c_clean', 'mysql', `${TAB}mysql://db.internal:3306/app${LF}`],
      ['a postgres bare username with a tab inside the scheme', 'duct_c_pg_scheme_tab', 'postgres', `postgre${TAB}sql://svc@db.internal:5432/app`],
      ['a postgres ordinary query parameter with a tab inside its name', 'duct_c_pg_key_tab', 'postgres', `postgresql://svc@db.internal:5432/app?connect${TAB}_timeout=10`],
    ])('%s', async (_label, name, driver, url) => {
      const answer = await call('PUT', `/meta/datasource/${name}`, body(name, driver, url));
      expect(answer.status, answer.text.slice(0, 300)).toBe(200);
      expect((await storedBody(name)).config.url).toBe(url);
    });
  });

  describe('READ: a stored URL\'s password is withheld at the position the write door judges', () => {
    it('guard the guard: the stored row holds the seeded password', async () => {
      expect((await storedBody(SEEDED)).config.url).toBe(` mysql://svc:${PLACEHOLDER}@db.internal:3306/app${LF}`);
    });

    it('the item read serves the URL with the password removed and every other character as stored', async () => {
      const read = await call('GET', `/meta/datasource/${SEEDED}`);
      expect(read.status, read.text.slice(0, 300)).toBe(200);
      expect(read.text.includes(PLACEHOLDER), 'the read withholds the password').toBe(false);
      const item = (read.json.item ?? read.json.data?.item ?? read.json.data ?? read.json) as Record<string, any>;
      expect(item.config.url).toBe(` mysql://svc@db.internal:3306/app${LF}`);
    });

    it('a stored postgres URL is served with its password and its `password` query parameter removed where the write door judges them, every other character as stored', async () => {
      expect((await storedBody(SEEDED_PG)).config.url, 'guard the guard').toBe(storedPgUrl());
      const read = await call('GET', `/meta/datasource/${SEEDED_PG}`);
      expect(read.status, read.text.slice(0, 300)).toBe(200);
      expect(read.text.includes(PLACEHOLDER), 'the read withholds both').toBe(false);
      const item = (read.json.item ?? read.json.data?.item ?? read.json.data ?? read.json) as Record<string, any>;
      expect(item.config.url).toBe(`postgre${TAB}sql://svc@db.internal:5432/app?sslmode=require`);
    });

    it('the stored row is never redacted: redaction is a serving act', async () => {
      expect((await storedBody(SEEDED)).config.url).toContain(PLACEHOLDER);
      expect((await storedBody(SEEDED_PG)).config.url).toBe(storedPgUrl());
    });
  });
});
