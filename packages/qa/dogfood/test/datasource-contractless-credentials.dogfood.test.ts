// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Credential-shaped configuration of a datasource whose driver the platform
 * ships NO config contract for — on the real showcase composition (ObjectQL
 * over SQLite, security, REST, the metadata service, the datasource admin
 * service, the audit writer), driven through the real doors, across a cold
 * boot on one database file.
 *
 * Before: such a datasource's `config` was validated against nothing, so
 * `apiKey`, `client_secret`, `secretAccessKey`, `privateKey`, `accessToken` and
 * a `Password=` segment inside a connection string were accepted at publish,
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
 * Every value below is a probe sentinel, not a credential.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
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
    stack = await bootStack(showcaseStack, { databaseFile: dbFile });
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
    const meta = await call('PUT', `/meta/datasource/${NAME}`, LEGACY_BODY);
    expect(meta.status, meta.text).toBe(400);
    const metaError = JSON.parse(meta.text).error;
    expect(metaError?.code, meta.text).toBe('VALIDATION_ERROR');
    expect(meta.text).toContain('config.apiKey');
    expect(leaked(meta.text)).toEqual([]);

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
    const doors = [
      `/meta/datasource/${NAME}`,
      '/meta/datasource',
      `/meta/datasource/${NAME}/published`,
      `/meta/datasource/${NAME}/layers`,
      `/meta/datasource/${NAME}/history`,
      `/datasources/${NAME}`,
      '/datasources',
      `/data/sys_metadata?filter=${filter({ name: NAME })}`,
      `/data/sys_metadata/${active.id}`,
      `/data/sys_metadata_history?filter=${filter({ name: NAME })}`,
    ];
    const report: Record<string, unknown> = {};
    for (const path of doors) {
      const res = await call('GET', path);
      report[path] = { status: res.status, marker: res.text.includes(MARKER), leaked: leaked(res.text) };
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
    for (const path of doors) {
      const r = report[path] as { status: number; marker: boolean; leaked: string[] };
      expect.soft(r.leaked, `${path} serves no credential`).toEqual([]);
      expect.soft(r.status, `${path} answers`).toBe(200);
      expect.soft(r.marker, `${path} serves the row (positive control)`).toBe(true);
    }
  }, 180_000);

  it('3 — the audit ledger records the seeded write without its credentials', async () => {
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    const audit = rowsOf(await ql.find('sys_audit_log', { where: { object_name: 'sys_metadata' }, context: SYSTEM }));
    const ours = audit.filter((row) => JSON.stringify(row).includes(MARKER));
    // eslint-disable-next-line no-console
    console.log('audit rows', audit.length, 'ours', ours.length);
    expect(ours.length, 'the ledger recorded the datasource row').toBeGreaterThan(0);
    expect(leaked(JSON.stringify(ours))).toEqual([]);
  });
});
