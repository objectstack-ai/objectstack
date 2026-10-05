// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Credential-shaped configuration of a datasource whose driver the platform
 * ships NO config contract for — on the real showcase composition (ObjectQL
 * over SQLite, security, REST, the metadata service, the datasource admin
 * service, the audit writer), driven through the real doors, across a cold
 * boot on one database file.
 *
 * Before: such a datasource's `config` was validated against nothing, so
 * `apiKey`, `client_secret`, `secretAccessKey`, `privateKey`, `accessToken`, a
 * `Password=` segment inside a connection string, a password inside an array
 * element and an `Authorization` header pair were accepted at publish,
 * stored cleartext in `sys_metadata` and its history, and served back on every
 * administrator read door — only `password` / `token`-style names and URL
 * credentials were withheld.
 *
 * Pinned here:
 *
 *  1. both write doors (`PUT /meta/datasource/:name`, `POST /datasources`)
 *     refuse that material before anything is stored, and accept the same
 *     datasource without it;
 *  2. a row stored BEFORE the refusal existed (seeded at rest, then a cold
 *     boot) is served by every read door with its non-secret configuration and
 *     none of its credentials — `/meta` (item, list, published, layers,
 *     history), the datasource admin routes, the generic data door over
 *     `sys_metadata` / `sys_metadata_history`, and the audit ledger's copy.
 *
 * The harness mounts the datasource admin SERVICE but not its REST routes, and
 * no audit writer; this file mounts both itself, exactly as `os serve` does
 * (`registerDatasourceAdminRoutes(httpServer, ctx, '/api/v1')` from a plugin
 * resolving `http.server`, and `AuditPlugin`).
 *
 * Every value below is a probe sentinel, not a credential.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { registerDatasourceAdminRoutes } from '@objectstack/service-datasource';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NAME = 'zz_contractless_ds';
const DRIVER = 'com.vendor.warehouse';
/** A non-secret value each read door must still serve — the positive control. */
const MARKER = 'wh-legacy-host-5c1e';
const SECRETS = {
  apiKey: 'pin-dogfood-apikey-7a21',
  clientSecret: 'pin-dogfood-clientsecret-3b90',
  secretAccessKey: 'pin-dogfood-sak-e4d2',
  privateKey: 'pin-dogfood-privatekey-91fc',
  accessToken: 'pin-dogfood-accesstoken-06ab',
  connectionPassword: 'pin-dogfood-cspassword-c8e7',
  serverPassword: 'pin-dogfood-serverpw-5d13',
  headerBearer: 'pin-dogfood-headerbearer-a2f6',
} as const;
const ALL = Object.values(SECRETS);
const SYSTEM = { isSystem: true } as const;

/** The datasource as an author wrote it before the refusal existed. */
const LEGACY_BODY = {
  name: NAME,
  label: 'Contractless warehouse',
  driver: DRIVER,
  origin: 'runtime',
  config: {
    host: MARKER,
    apiKey: SECRETS.apiKey,
    oauth: { clientId: 'cid', client_secret: SECRETS.clientSecret },
    secretAccessKey: SECRETS.secretAccessKey,
    privateKey: SECRETS.privateKey,
    accessToken: SECRETS.accessToken,
    connectionString: `Server=${MARKER};User Id=u;Password=${SECRETS.connectionPassword}`,
    servers: [{ host: MARKER, password: SECRETS.serverPassword }],
    headers: [{ name: 'Authorization', value: `Bearer ${SECRETS.headerBearer}` }],
  },
};

/** The same datasource with no credential material — what the write doors accept. */
const CLEAN_BODY = { name: NAME, label: 'Contractless warehouse', driver: DRIVER, config: { host: MARKER } };

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);
const leaked = (text: string): string[] => ALL.filter((secret) => text.includes(secret));

describe('contractless-driver datasource credentials: refused at write, withheld on every read door', () => {
  let stack: VerifyStack;
  let token: string;
  let prevCwd: string;
  let dir: string;
  let dbFile: string;

  const boot = async () => {
    // The `/api/v1/datasources` routes, mounted the way `os serve` mounts them.
    const adminRoutes = {
      name: 'dogfood.datasource-admin-routes',
      version: '1.0.0',
      optionalDependencies: ['com.objectstack.server.hono'],
      init: async (ctx: any) => {
        const httpServer = ctx.getService?.('http.server') ?? ctx.getService?.('http-server');
        registerDatasourceAdminRoutes(httpServer, ctx, '/api/v1');
      },
    };
    stack = await bootStack(showcaseStack, {
      databaseFile: dbFile,
      extraPlugins: [new AuditPlugin(), adminRoutes as never],
    });
    token = await stack.signIn();
  };

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, text: await res.text() };
  };

  const stored = async (object: string): Promise<any[]> => {
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    return rowsOf(await ql.find(object, { where: { name: NAME }, context: SYSTEM }));
  };

  beforeAll(async () => {
    prevCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'dogfood-contractless-ds-'));
    process.chdir(dir);
    dbFile = join(dir, 'showcase.db');
    await boot();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    if (prevCwd) process.chdir(prevCwd);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('1 — both write doors refuse the credential material before anything is stored', async () => {
    // The metadata save door: the spec gate's refusal, every position named.
    const meta = await call('PUT', `/meta/datasource/${NAME}`, LEGACY_BODY);
    expect(meta.status, meta.text).toBe(422);
    const metaBody = JSON.parse(meta.text);
    expect(metaBody.code, meta.text).toBe('INVALID_METADATA');
    expect((metaBody.issues as Array<{ path: string }>).map((issue) => issue.path).sort()).toEqual([
      'config.accessToken',
      'config.apiKey',
      'config.connectionString',
      'config.headers.0.value',
      'config.oauth.client_secret',
      'config.privateKey',
      'config.secretAccessKey',
      'config.servers.0.password',
    ]);
    expect(leaked(meta.text)).toEqual([]);

    // The Setup → Datasources create door.
    const admin = await call('POST', '/datasources', LEGACY_BODY);
    expect(admin.status, admin.text).toBe(400);
    expect(admin.text).toContain('config.apiKey');
    expect(leaked(admin.text)).toEqual([]);

    expect(await stored('sys_metadata')).toEqual([]);
  });

  it('1b — control: the same datasource without credential material saves', async () => {
    const meta = await call('PUT', `/meta/datasource/${NAME}`, CLEAN_BODY);
    expect(meta.status, meta.text).toBe(200);
    expect(await stored('sys_metadata')).toHaveLength(1);
  });

  it('2 — a row stored before the refusal existed is served by every read door without its credentials', async () => {
    // Seed the pre-refusal state AT REST: the active row and every history
    // row hold the legacy body, exactly as an earlier release stored it.
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    for (const object of ['sys_metadata', 'sys_metadata_history']) {
      for (const row of await stored(object)) {
        await ql.update(object, { metadata: JSON.stringify(LEGACY_BODY) }, { where: { id: row.id }, context: SYSTEM });
      }
    }
    // Precondition: the cleartext really is at rest (else nothing below is measured).
    expect(leaked(JSON.stringify(await stored('sys_metadata')))).toEqual(ALL);
    expect(leaked(JSON.stringify(await stored('sys_metadata_history')))).toEqual(ALL);

    // A cold boot on the same file, so every in-memory view is rebuilt from the stored rows.
    await stack.stop();
    await boot();

    const [active] = await stored('sys_metadata');
    expect(active?.id, 'the seeded row survived the restart').toBeTruthy();
    const filter = (where: Record<string, unknown>) => encodeURIComponent(JSON.stringify(where));
    // `serves`: what the answer must contain — the positive control that the
    // door read the seeded row at all. A door serving the body must carry the
    // non-secret MARKER from its config; the admin list serves summaries (no
    // config) and must name the row; the history list serves versions only.
    const doors: Array<{ path: string; serves?: string }> = [
      { path: `/meta/datasource/${NAME}`, serves: MARKER },
      { path: '/meta/datasource', serves: MARKER },
      { path: `/meta/datasource/${NAME}/published`, serves: MARKER },
      { path: `/meta/datasource/${NAME}/layers`, serves: MARKER },
      { path: `/meta/datasource/${NAME}/history` },
      { path: `/datasources/${NAME}`, serves: MARKER },
      { path: '/datasources', serves: NAME },
      { path: `/data/sys_metadata?filter=${filter({ name: NAME })}`, serves: MARKER },
      { path: `/data/sys_metadata/${active.id}`, serves: MARKER },
      { path: `/data/sys_metadata_history?filter=${filter({ name: NAME })}`, serves: MARKER },
    ];
    for (const { path, serves } of doors) {
      const res = await call('GET', path);
      expect.soft(res.status, `${path} answers`).toBe(200);
      expect.soft(leaked(res.text), `${path} serves no credential`).toEqual([]);
      if (serves) expect.soft(res.text.includes(serves), `${path} serves the row (positive control)`).toBe(true);
    }

    // The admin edit form's view names what it withheld and keeps the rest.
    const form = JSON.parse((await call('GET', `/datasources/${NAME}`)).text);
    const config = (form.datasource ?? form.data?.datasource ?? form).config;
    expect(config).toEqual({
      host: MARKER,
      oauth: { clientId: 'cid' },
      connectionString: `Server=${MARKER};User Id=u`,
      servers: [{ host: MARKER }],
      headers: [{ name: 'Authorization' }],
    });
  }, 180_000);

  it('3 — the audit ledger records the seeded write without its credentials', async () => {
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    // The writer copies the audited row at write time — the seeding update
    // above included — so this is the at-rest copy, read straight from the
    // table, and then through the data door an administrator reads it by.
    const audit = rowsOf(await ql.find('sys_audit_log', { where: { object_name: 'sys_metadata' }, context: SYSTEM }));
    const ours = audit.filter((row) => JSON.stringify(row).includes(MARKER));
    expect(ours.length, 'the ledger recorded the datasource row').toBeGreaterThan(0);
    expect(leaked(JSON.stringify(audit))).toEqual([]);

    const door = await call('GET', `/data/sys_audit_log?filter=${encodeURIComponent(JSON.stringify({ object_name: 'sys_metadata' }))}`);
    expect(door.status, door.text).toBe(200);
    expect(leaked(door.text)).toEqual([]);
  });
});
