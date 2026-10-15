// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22835 · ADR-0131 D6] The datasource-admin plugin reads ENVIRONMENT rows
// only, over the real showcase composition across a restart. Its reads of
// stored `datasource` rows carried no organization predicate, so a row stored
// in a legacy organization's layer was restored, served by both doors and
// pooled, while the boot report named it as served by no read.
//
// [ADR-0131 D6/D7] The `sys_metadata` family now declares no organization
// column, so no row can sit in an organization's layer (and the runtime refuses
// to boot on a database still holding one). Pinned: the environment row is
// restored across the restart, served by both doors and pooled; the by-name
// reads behind the plugin's writes address the environment's rows; the boot
// prints no legacy-organization line. The routes are mounted the way
// `packages/cli/src/commands/serve.ts` does.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { registerDatasourceAdminRoutes } from '@objectstack/service-datasource';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A datasource name with no stored row, written through the doors below. */
const FRESH = 'dogfood_fresh_ds_22835';
/** A fixture datasource stored in the environment's layer. */
const ENV = 'dogfood_env_ds_22835';

const SYS = { isSystem: true, positions: [], permissions: [] };

type Row = Record<string, unknown>;
interface Answer { status: number; json: Record<string, any> }

describe('[#22835] the datasource-admin plugin reads environment rows only (showcase, restart)', () => {
  let stack: VerifyStack;
  let token: string;
  let dir: string;
  /** Every `console.warn` line the measured boot printed. */
  let bootWarnings: string[] = [];

  const routes = () => ({
    name: 'dogfood.datasource-admin-routes',
    version: '1.0.0',
    optionalDependencies: ['com.objectstack.server.hono'],
    init: async (ctx: { getService?: (name: string) => unknown }) => {
      const httpServer = ctx.getService?.('http.server') ?? ctx.getService?.('http-server');
      registerDatasourceAdminRoutes(httpServer as never, ctx as never, '/api/v1');
    },
  });
  const boot = async () => {
    stack = await bootShowcase({ databaseFile: join(dir, 'showcase.db'), extraPlugins: [routes()] });
    token = await stack.signIn();
  };
  const ql = () => stack.kernel.getService('objectql') as {
    find(object: string, query: unknown): Promise<Row[]>;
    insert(object: string, row: Row, options: unknown): Promise<unknown>;
  };
  const storedRows = (name: string) => ql().find('sys_metadata', { where: { type: 'datasource', name }, context: SYS });
  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
  const adminNames = async () => {
    const listed = await call('GET', '/datasources');
    expect(listed.status, JSON.stringify(listed.json)).toBe(200);
    return (listed.json.data?.datasources ?? []).map((d: Row) => d.name);
  };
  const metaNames = async () => {
    const listed = await call('GET', '/meta/datasource');
    expect(listed.status, JSON.stringify(listed.json)).toBe(200);
    const data = listed.json.data ?? listed.json;
    return ((Array.isArray(data) ? data : data?.items) ?? []).map((d: Row) => d?.name);
  };
  const pooled = (name: string) => {
    const connection = stack.kernel.getService('datasource-connection') as {
      listConnectionStates(): Array<{ name: string; status: string }>;
    };
    return connection.listConnectionStates().some((s) => s.name === name);
  };
  const environmentRows = async (name: string) => storedRows(name);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dogfood-22835-'));
    await boot();
    // The environment's row, written with system context the way the store
    // holds it.
    const now = new Date().toISOString();
    await ql().insert('sys_metadata', {
      type: 'datasource', name: ENV, package_id: null, scope: 'platform',
      state: 'active', version: 1, checksum: null, created_at: now, updated_at: now,
      metadata: JSON.stringify({
        name: ENV, label: 'Environment row 22835', driver: 'sqlite', config: { filename: join(dir, `${ENV}.db`) },
      }),
    }, { context: SYS });
    await stack.stop();

    const warn = vi.spyOn(console, 'warn');
    try {
      await boot();
    } finally {
      bootWarnings = warn.mock.calls.map((args) => args.map(String).join(' '));
      warn.mockRestore();
    }
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('premise: the environment row is at rest, carries no organization column, and the boot names no legacy row', async () => {
    const rows = await environmentRows(ENV);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('organization_id');
    expect(bootWarnings.filter((line) => line.includes('[metadata_org_scoped_unserved]'))).toEqual([]);
  });

  it('the environment row is served by both doors and pooled; a name with no row is served by neither', async () => {
    expect((await call('GET', `/datasources/${FRESH}`)).status).toBe(404);
    expect((await call('GET', `/meta/datasource/${FRESH}`)).status).toBe(404);
    expect(pooled(FRESH)).toBe(false);

    expect((await call('GET', `/datasources/${ENV}`)).status).toBe(200);
    expect((await call('GET', `/meta/datasource/${ENV}`)).status).toBe(200);
    expect(await adminNames()).toContain(ENV);
    expect(await metaNames()).toContain(ENV);
    expect(pooled(ENV)).toBe(true);
  });

  it('the writes\' by-name reads address the environment\'s rows', async () => {
    // An admin create writes an environment row; its remove takes that row
    // away again.
    const created = await call('POST', '/datasources', {
      name: FRESH, label: 'Admin create 22835', driver: 'sqlite', config: { filename: join(dir, 'admin.db') },
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    expect(await environmentRows(FRESH)).toHaveLength(1);
    expect((await call('DELETE', `/datasources/${FRESH}`)).status).toBe(204);
    expect(await environmentRows(FRESH)).toHaveLength(0);

    // A `/meta` save under the name: the admin door serves the saved body.
    const saved = await call('PUT', `/meta/datasource/${FRESH}`, {
      name: FRESH, label: 'Meta save 22835', driver: 'sqlite', config: { filename: join(dir, 'meta.db') },
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const served = await call('GET', `/datasources/${FRESH}`);
    expect(served.status, JSON.stringify(served.json)).toBe(200);
    expect(served.json.data?.datasource?.label).toBe('Meta save 22835');

    expect(await environmentRows(FRESH)).toHaveLength(1);
  });
});
