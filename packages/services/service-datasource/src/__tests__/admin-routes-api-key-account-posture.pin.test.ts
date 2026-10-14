// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23287 — ruling C′ item 3] The datasource-admin family judges an API key by
 * the answer the shared key-admission seam gives for its OWNER.
 *
 * ## What was open
 *
 * The family's door asked the ADR-0069 gate about the session user the
 * identity resolution read. An API key admits its owner without a session, so
 * the door had nothing to ask: a key whose owner owes MFA enrolment was served
 * every route its owner's capability reaches.
 *
 * ## What is pinned, on every mounted route
 *
 *  - a key whose owner holds `MFA_REQUIRED` (scope `account`) → `403
 *    MFA_REQUIRED` with the session's message, nothing dispatched;
 *  - a key whose owner holds only `PASSWORD_EXPIRED` (scope `credential`) →
 *    served, its own success status;
 *  - the refusal is not a revocation: the same key is served once the posture
 *    clears.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashApiKey } from '@objectstack/core';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import { ENTITLED_USER, createSessionAuthService, createGrantsEngine } from './entitled-caller.fixture.js';

const KEY = 'osk_datasource_account_posture_pin';

const MFA_REQUIRED = {
  code: 'MFA_REQUIRED',
  message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};
const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'Your password has expired. Please change it to continue.' };

/** What the posture computation answers for the key's owner; mutated per case. */
const postures: Record<string, Array<{ code: string; message: string }>> = {};

function mountFamily() {
  const service = {
    listDatasources: vi.fn().mockResolvedValue([{ name: 'pg', origin: 'runtime', health: 'ok' }]),
    getDatasource: vi.fn().mockResolvedValue({ name: 'pg', driver: 'sqlite' }),
    createDatasource: vi.fn().mockResolvedValue({ name: 'created', driver: 'sqlite' }),
    updateDatasource: vi.fn().mockResolvedValue({ name: 'pg', driver: 'sqlite' }),
    removeDatasource: vi.fn().mockResolvedValue(undefined),
    migrateCredential: vi.fn().mockResolvedValue({ status: 'migrated' }),
    listRemoteTables: vi.fn().mockResolvedValue([{ name: 'customers' }]),
    generateObjectDraft: vi.fn().mockResolvedValue({ name: 'customer' }),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
  };
  const auth = {
    ...createSessionAuthService(),
    resolveUserAuthGates: async (userId: string) => postures[userId] ?? [],
  };
  // The fixture's grants engine, taught the one key the entitled operator owns.
  const engine: { find: (object: string, opts: any) => Promise<unknown[]> } = createGrantsEngine();
  const grantsFind = engine.find;
  const keyHash = hashApiKey(KEY);
  engine.find = async (object: string, opts: any) => (
    object === 'sys_api_key'
      ? (opts?.where?.key === keyHash ? [{ id: 'key_1', key: keyHash, user_id: ENTITLED_USER, revoked: false, scopes: '[]' }] : [])
      : grantsFind(object, opts)
  );
  const ctx = {
    getService: vi.fn((name: string) => {
      if (name === 'auth') return auth;
      if (name === 'objectql' || name === 'data') return engine;
      return service;
    }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as any;
  const server = new HonoHttpServer(0);
  registerDatasourceAdminRoutes(server, ctx, '/api/v1');
  return { server, app: server.getRawApp(), service };
}

const family = mountFamily();

const CASES: Record<string, { path: string; body?: Record<string, unknown>; okStatus: number }> = {
  'GET /api/v1/datasources': { path: '/api/v1/datasources', okStatus: 200 },
  'GET /api/v1/datasources/drivers': { path: '/api/v1/datasources/drivers', okStatus: 200 },
  'GET /api/v1/datasources/:name': { path: '/api/v1/datasources/pg', okStatus: 200 },
  'GET /api/v1/datasources/:name/remote-tables': { path: '/api/v1/datasources/pg/remote-tables', okStatus: 200 },
  'POST /api/v1/datasources': { path: '/api/v1/datasources', body: { name: 'new_ds', driver: 'sqlite' }, okStatus: 201 },
  'PATCH /api/v1/datasources/:name': { path: '/api/v1/datasources/pg', body: { driver: 'sqlite' }, okStatus: 200 },
  'DELETE /api/v1/datasources/:name': { path: '/api/v1/datasources/pg', okStatus: 204 },
  'POST /api/v1/datasources/test': { path: '/api/v1/datasources/test', body: { driver: 'sqlite' }, okStatus: 200 },
  'POST /api/v1/datasources/:name/test': { path: '/api/v1/datasources/pg/test', body: {}, okStatus: 200 },
  'POST /api/v1/datasources/:name/object-draft': { path: '/api/v1/datasources/pg/object-draft', body: { table: 'customers' }, okStatus: 200 },
  'POST /api/v1/datasources/:name/migrate-credential': { path: '/api/v1/datasources/pg/migrate-credential', body: {}, okStatus: 200 },
};

const census = (family.server.getMountedRoutes?.() ?? []).map((r) => `${r.method} ${r.pattern}`);

async function drive(key: string) {
  const c = CASES[key]!;
  const verb = key.slice(0, key.indexOf(' '));
  const res = await family.app.fetch(
    new Request(`http://local${c.path}`, {
      method: verb,
      headers: { 'content-type': 'application/json', 'x-api-key': KEY },
      body: c.body === undefined ? undefined : JSON.stringify(c.body),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

const serviceCalls = () =>
  Object.entries(family.service).filter(([, fn]) => fn.mock.calls.length > 0).map(([name]) => name);

beforeEach(() => {
  for (const fn of Object.values(family.service)) fn.mockClear();
  for (const k of Object.keys(postures)) delete postures[k];
});

describe('datasource-admin family — a key answers as its owner\'s session does (#23287, ruling C′)', () => {
  it('drives every mounted route', () => {
    expect([...census].sort()).toEqual(Object.keys(CASES).sort());
  });

  it.each(census)('%s · key, owner held by MFA_REQUIRED → 403 MFA_REQUIRED, nothing dispatched', async (key) => {
    postures[ENTITLED_USER] = [MFA_REQUIRED];
    const { status, body } = await drive(key);
    expect(status).toBe(403);
    expect(body?.error?.code).toBe('MFA_REQUIRED');
    expect(body?.error?.message).toBe(MFA_REQUIRED.message);
    expect(serviceCalls()).toEqual([]);
  });

  it.each(census)('%s · key, owner held only by PASSWORD_EXPIRED (credential scope) → served', async (key) => {
    postures[ENTITLED_USER] = [PASSWORD_EXPIRED];
    const { status } = await drive(key);
    expect(status).toBe(CASES[key]!.okStatus);
  });

  it('the refusal is not a revocation: the same key is served once the posture clears', async () => {
    postures[ENTITLED_USER] = [MFA_REQUIRED];
    expect((await drive('GET /api/v1/datasources')).status).toBe(403);
    postures[ENTITLED_USER] = [];
    expect((await drive('GET /api/v1/datasources')).status).toBe(200);
  });
});
