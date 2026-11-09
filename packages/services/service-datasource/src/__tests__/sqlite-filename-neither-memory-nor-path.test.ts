// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import type { IDatasourceAdminService } from '../contracts/index.js';
import { DatasourceAdminServicePlugin } from '../datasource-admin-plugin.js';
import { registerDatasourceAdminRoutes } from '../admin-routes.js';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';
import { ENTITLED_CREDENTIAL, createSessionAuthService, createGrantsEngine } from './entitled-caller.fixture.js';

// [#10126] Pay the first transform of the dist-resolved workspace deps at module
// load, not inside a clocked `it()` (see `scripts/check-test-source-alias.mjs`).
import '@objectstack/spec/kernel';
import '@objectstack/driver-sql';

/**
 * [#30331] A SQLite `config.filename` that is neither exactly `:memory:` nor a
 * usable file path is refused by Test connection and by Save, with a message
 * that names the value and says why.
 *
 * The value the card measured is `:memory:/…/parts.db`: the dialog's
 * `:memory:` with a typed path after it. Test connection answered `ok: true`.
 * Every layer reads a `:`-prefixed name as fileless, so the draft probe's
 * missing-file refusal skipped it; better-sqlite3 then opened it as a relative
 * path whose directory does not exist (every query fails, the health check
 * answers `false`), and sqlite-wasm opened an ephemeral database that loses
 * everything at the next connect.
 *
 * Driven through the real door: the real `HonoHttpServer`, the real admin
 * routes, the real plugin (its probe and its service) and the default driver
 * factory. The metadata service is a map, so a Save is observable.
 */

const authService = createSessionAuthService();
const grantsEngine = createGrantsEngine();

async function mountDoor() {
  let admin: IDatasourceAdminService | undefined;
  const rows = new Map<string, unknown>();
  const metadata = {
    get: async (_type: string, name: string) => rows.get(name),
    list: async () => [...rows.values()],
    register: async (_type: string, name: string, record: unknown) => {
      rows.set(name, record);
    },
    unregister: async (_type: string, name: string) => {
      rows.delete(name);
    },
  };
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'metadata') return metadata;
      throw new Error(`no service ${name}`);
    },
    registerService: (name: string, svc: unknown) => {
      if (name === 'datasource-admin') admin = svc as IDatasourceAdminService;
    },
    trigger: async () => {},
    logger: { warn() {}, info() {} },
  };
  await new DatasourceAdminServicePlugin({ driverFactory: createDefaultDatasourceDriverFactory() }).init(ctx);

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
  const send = async (method: string, path: string, body: unknown) => {
    const res = await app.fetch(
      new Request(`http://local/api/v1/datasources${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: ENTITLED_CREDENTIAL },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as any };
  };
  return {
    rows,
    test: async (draft: Record<string, unknown>) => {
      const res = await send('POST', '/test', { name: 'draft', ...draft });
      expect(res.status).toBe(200);
      return res.body.data.result as { ok: boolean; error?: string };
    },
    create: (draft: Record<string, unknown>) => send('POST', '', draft),
    update: (name: string, patch: Record<string, unknown>) => send('PATCH', `/${name}`, patch),
  };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ds-30331-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Both drivers that open `config.filename`. */
const DRIVERS = ['sqlite', 'sqlite-wasm'] as const;

function expectRefusal(res: { status: number; body: any }, value: string, why: RegExp) {
  expect(res.status).toBe(400);
  expect(res.body.success).toBe(false);
  // The envelope and code every bad config already answers with (#4410).
  expect(res.body.error.code).toBe('DATASOURCE_ADMIN_ERROR');
  expect(res.body.error.message).toContain('Invalid configuration for driver');
  expect(res.body.error.message).toContain(value);
  expect(res.body.error.message).toMatch(why);
}

describe('#30331 — a filename that is neither `:memory:` nor a usable path is refused', () => {
  for (const driver of DRIVERS) {
    describe(driver, () => {
      it('`:memory:/…` is refused by Test connection, naming the value and why', async () => {
        const door = await mountDoor();
        const value = `:memory:${join(root, 'parts.db')}`;

        const result = await door.test({ driver, config: { filename: value } });

        expect(result.ok).toBe(false);
        expect(result.error).toContain(value);
        expect(result.error).toMatch(/neither ':memory:' nor a file path/);
        expect(readdirSync(root)).toEqual([]);
      });

      it('`:memory:/…` is refused by Save (create and update), and nothing is stored', async () => {
        const door = await mountDoor();
        const value = `:memory:${join(root, 'parts.db')}`;

        expectRefusal(await door.create({ name: 'parts', driver, config: { filename: value } }), value, /neither ':memory:' nor a file path/);
        expect(door.rows.has('parts')).toBe(false);

        const created = await door.create({ name: 'parts', driver, config: { filename: ':memory:' } });
        expect(created.status).toBe(201);
        expectRefusal(await door.update('parts', { config: { filename: value } }), value, /neither ':memory:' nor a file path/);
        expect((door.rows.get('parts') as any).config.filename).toBe(':memory:');
      });

      it('an unusable path is refused by Test connection and by Save', async () => {
        const door = await mountDoor();
        writeFileSync(join(root, 'blocker'), 'a regular file');
        const value = join(root, 'blocker/parts.db');

        const result = await door.test({ driver, config: { filename: value } });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(value);
        expect(result.error).toMatch(/cannot be/);

        expectRefusal(await door.create({ name: 'parts', driver, config: { filename: value } }), value, /cannot be/);
        expect(door.rows.has('parts')).toBe(false);
        expect(readdirSync(root)).toEqual(['blocker']);
      });

      it('an empty filename is refused by Test connection and by Save', async () => {
        const door = await mountDoor();
        const result = await door.test({ driver, config: { filename: '' } });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/'' is empty and names no database file/);
        expectRefusal(await door.create({ name: 'parts', driver, config: { filename: '' } }), "''", /is empty/);
      });

      // Controls: what was right stays right.
      it('control: exactly `:memory:` still tests ok and saves', async () => {
        const door = await mountDoor();
        expect((await door.test({ driver, config: { filename: ':memory:' } })).ok).toBe(true);
        expect((await door.create({ name: 'scratch', driver, config: { filename: ':memory:' } })).status).toBe(201);
      });

      it('control: an existing database file still tests ok and saves', async () => {
        const door = await mountDoor();
        const file = join(root, 'existing.db');
        const { SqlDriver } = await import('@objectstack/driver-sql');
        const seed = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true } as any);
        await seed.connect();
        await seed.disconnect();

        expect((await door.test({ driver, config: { filename: file } })).ok).toBe(true);
        expect((await door.create({ name: 'existing', driver, config: { filename: file } })).status).toBe(201);
      });

      it('control: a creatable path that does not exist keeps today\'s answers', async () => {
        const door = await mountDoor();
        const file = join(root, 'missing/dir/new.db');

        // Test connection: refused, and nothing created (#27512).
        const result = await door.test({ driver, config: { filename: file } });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('does not exist');
        expect(existsSync(file)).toBe(false);

        // Save: accepted.
        expect((await door.create({ name: 'fresh', driver, config: { filename: file } })).status).toBe(201);
        expect((door.rows.get('fresh') as any).config.filename).toBe(file);
      });
    });
  }
});
