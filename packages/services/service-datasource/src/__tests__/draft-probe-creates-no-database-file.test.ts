// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import type { IDatasourceAdminService, IDatasourceDriverFactory } from '../contracts/index.js';
import { DatasourceAdminServicePlugin } from '../datasource-admin-plugin.js';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';
import { ENTITLED_CREDENTIAL, createSessionAuthService, createGrantsEngine } from './entitled-caller.fixture.js';

// [#10126] Pay the first transform of the dist-resolved workspace deps at module
// load, not inside a clocked `it()` (see `scripts/check-test-source-alias.mjs`).
import '@objectstack/spec/kernel';
import '@objectstack/driver-sql';

/**
 * [#27512] The draft probe — `POST /api/v1/datasources/test`, the wizard's
 * "Test connection" before Save — persists nothing, so it must leave nothing on
 * disk either. For a file-backed SQLite draft it used to open the file the way
 * a writing boot does: the file (and every missing directory above it) was
 * created, although no datasource was saved. Measured on every file-backed
 * SQL-family driver the default factory builds: `sqlite` (better-sqlite3),
 * `sqlite-wasm`, and `turso` with a `file:` url.
 *
 * Driven through the real door: the real `HonoHttpServer`, the real admin
 * routes, the real plugin probe and the default driver factory.
 */

const authService = createSessionAuthService();
const grantsEngine = createGrantsEngine();

async function mountDoor(driverFactory: IDatasourceDriverFactory = createDefaultDatasourceDriverFactory()) {
  let admin: IDatasourceAdminService | undefined;
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'metadata') return { get: async () => undefined, list: async () => [] };
      throw new Error(`no service ${name}`);
    },
    registerService: (name: string, svc: unknown) => {
      if (name === 'datasource-admin') admin = svc as IDatasourceAdminService;
    },
    trigger: async () => {},
    logger: { warn() {}, info() {} },
  };
  await new DatasourceAdminServicePlugin({ driverFactory }).init(ctx);

  const server = new HonoHttpServer(0);
  registerDatasourceAdminRoutes(
    server,
    {
      getService: vi.fn((name: string) =>
        name === 'auth'
          ? authService
          : name === 'objectql' || name === 'data'
            ? grantsEngine
            : name === 'datasource-admin'
              ? admin
              : undefined,
      ),
    } as any,
    '/api/v1',
  );
  const app = server.getRawApp();
  return (draft: Record<string, unknown>) =>
    app.fetch(
      new Request('http://local/api/v1/datasources/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: ENTITLED_CREDENTIAL },
        body: JSON.stringify(draft),
      }),
    );
}

/** Every file-backed SQL-family driver id, and how its draft names the file. */
const FILE_BACKED: Array<{ driver: string; config: (file: string) => Record<string, unknown> }> = [
  { driver: 'sqlite', config: (file) => ({ filename: file }) },
  { driver: 'sqlite3', config: (file) => ({ filename: file }) },
  { driver: 'sqlite-wasm', config: (file) => ({ filename: file }) },
  { driver: 'turso', config: (file) => ({ url: `file:${file}` }) },
  { driver: 'libsql', config: (file) => ({ url: `file:${file}` }) },
];

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ds-draft-probe-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('POST /api/v1/datasources/test — a draft probe leaves no database file (#27512)', () => {
  for (const { driver, config } of FILE_BACKED) {
    for (const where of ['probe.db', 'missing/dir/probe.db']) {
      it(`${driver}: a missing '${where}' is reported, and neither the file nor its directory is created`, async () => {
        const probe = await mountDoor();
        const file = join(root, where);

        const res = await probe({ name: 'draft', driver, config: config(file) });

        // The probe's verdict door: 200 with `result.ok: false`, as for every
        // other probe failure — the draft is refused, not the request.
        expect(res.status).toBe(200);
        const body = (await res.json()) as { success: boolean; data: { result: { ok: boolean; error?: string } } };
        expect(body.success).toBe(true);
        expect(body.data.result.ok).toBe(false);
        // Names the missing file, so the admin knows WHAT the probe refused.
        expect(body.data.result.error).toContain(file);
        expect(body.data.result.error).toContain('does not exist');
        // …and the filesystem is as the probe found it.
        expect(existsSync(file)).toBe(false);
        expect(readdirSync(root)).toEqual([]);
      });
    }
  }

  // Control: the refusal is about ABSENCE, not about file-backed SQLite. A
  // database file that exists probes green, and is the only thing in the
  // directory afterwards, as before.
  it('control: an existing SQLite file still probes ok', async () => {
    const probe = await mountDoor();
    const file = join(root, 'existing.db');
    const { SqlDriver } = await import('@objectstack/driver-sql');
    const seed = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true } as any);
    await seed.connect();
    await seed.disconnect();
    expect(existsSync(file)).toBe(true);

    const res = await probe({ name: 'draft', driver: 'sqlite', config: { filename: file } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { result: { ok: boolean; error?: string } } };
    expect(body.data.result).toMatchObject({ ok: true });
    expect(readdirSync(root)).toEqual(['existing.db']);
  });

  // Control: an in-memory draft names no file, so nothing is refused.
  it('control: a :memory: SQLite draft still probes ok', async () => {
    const probe = await mountDoor();
    const res = await probe({ name: 'draft', driver: 'sqlite', config: { filename: ':memory:' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { result: { ok: boolean } } };
    expect(body.data.result.ok).toBe(true);
  });
});

describe('the judgement is the probe\'s, whichever factory builds (#27512)', () => {
  it('a host factory is never asked to build a draft whose file is missing', async () => {
    const create = vi.fn(async () => ({ connect: async () => {}, ping: async () => {} }));
    const probe = await mountDoor({ supports: () => true, create });
    const file = join(root, 'missing/dir/probe.db');

    for (const { driver, config } of FILE_BACKED) {
      const res = await probe({ name: 'draft', driver, config: config(file) });
      const body = (await res.json()) as { data: { result: { ok: boolean; error?: string } } };
      expect(res.status, driver).toBe(200);
      expect(body.data.result.ok, driver).toBe(false);
    }
    expect(create).not.toHaveBeenCalled();
    expect(readdirSync(root)).toEqual([]);
  });

  it('a path that can be neither opened nor created is refused too, and nothing is written', async () => {
    const probe = await mountDoor();
    writeFileSync(join(root, 'blocker'), 'a regular file');
    const file = join(root, 'blocker/probe.db');

    const res = await probe({ name: 'draft', driver: 'sqlite', config: { filename: file } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { result: { ok: boolean; error?: string } } };
    expect(body.data.result.ok).toBe(false);
    expect(body.data.result.error).toContain(file);
    expect(readdirSync(root)).toEqual(['blocker']);
  });

  // Control: the default factory is untouched — Save, the boot restore and
  // every hot pool build through it and still create the file on connect,
  // which is what a datasource that is being SAVED is owed.
  it('control: the default factory still creates a sqlite target on connect', async () => {
    const factory = createDefaultDatasourceDriverFactory();
    const file = join(root, 'created.db');
    const handle = await factory.create({ driver: 'sqlite', config: { filename: file } });
    await handle.connect?.();
    await handle.disconnect?.();
    expect(existsSync(file)).toBe(true);
  });
});
