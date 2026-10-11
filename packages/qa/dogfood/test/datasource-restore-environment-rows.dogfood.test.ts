// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22835 · ADR-0131 D6] The datasource-admin plugin reads ENVIRONMENT rows
// only — over the real showcase composition, across a restart.
//
// ## What was broken
//
// Every metadata read serves the environment's `sys_metadata` rows only, and
// the boot report `[metadata_org_scoped_unserved]` names a row stored in a
// legacy organization's layer as served by no read and loaded by no boot. The
// datasource-admin plugin's own reads of stored `datasource` rows carried no
// such predicate: its boot restore registered a legacy organization-scoped
// row, and from there both the datasource-admin door and the metadata read
// door served it, and a live pool was opened from it.
//
// ## What each case pins
//
//   - after a restart over a legacy organization-scoped row and an environment
//     row, neither door serves the legacy row (`404`, absent from both lists)
//     and no pool is opened from it; the environment row is served as before;
//   - the boot report still names the legacy row, and the row is kept as it
//     was — neither deleted nor rewritten;
//   - the plugin's by-name reads behind its writes never reach the legacy row:
//     an admin create and remove under its name write and remove an
//     environment row of their own, and a `/meta` save under its name is what
//     the admin door then serves.
//
// The verify harness composes the datasource-admin service but not its REST
// routes, so this file mounts `registerDatasourceAdminRoutes` the way
// `packages/cli/src/commands/serve.ts` does.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { registerDatasourceAdminRoutes } from '@objectstack/service-datasource';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A fixture datasource stored in a legacy organization's layer. */
const LEGACY = 'dogfood_legacy_ds_22835';
const LEGACY_ORG = 'org_dogfood_legacy_22835';
const LEGACY_LABEL = 'Legacy organization row 22835';
/** A fixture datasource stored in the environment's layer: the control. */
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
  /** The legacy row as it was stored, before the measured boot. */
  let plantedLegacy: Row | undefined;

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
  const legacyRows = async () => (await storedRows(LEGACY)).filter((r) => r.organization_id === LEGACY_ORG);
  const environmentRows = async (name: string) => (await storedRows(name)).filter((r) => r.organization_id == null);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dogfood-22835-'));
    await boot();
    // The rows an earlier release left, written with system context the way
    // that release's store held them: one in a legacy organization's layer,
    // one in the environment's.
    const now = new Date().toISOString();
    for (const [name, organizationId, label] of [
      [LEGACY, LEGACY_ORG, LEGACY_LABEL],
      [ENV, null, 'Environment row 22835'],
    ] as const) {
      await ql().insert('sys_metadata', {
        type: 'datasource', name, organization_id: organizationId, package_id: null, scope: 'platform',
        state: 'active', version: 1, checksum: null, created_at: now, updated_at: now,
        metadata: JSON.stringify({ name, label, driver: 'sqlite', config: { filename: join(dir, `${name}.db`) } }),
      }, { context: SYS });
    }
    [plantedLegacy] = await legacyRows();
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

  it('premise: both rows are at rest, and the boot report names the legacy one', async () => {
    expect(plantedLegacy).toBeDefined();
    expect(await environmentRows(ENV)).toHaveLength(1);
    const report = bootWarnings.filter((line) => line.includes('[metadata_org_scoped_unserved]'));
    expect(report).toHaveLength(1);
    expect(report[0]).toContain(`${LEGACY}@${LEGACY_ORG}`);
  });

  it('neither door serves the legacy row, and no pool is opened from it; the environment row is served', async () => {
    expect((await call('GET', `/datasources/${LEGACY}`)).status).toBe(404);
    expect((await call('GET', `/meta/datasource/${LEGACY}`)).status).toBe(404);
    expect(await adminNames()).not.toContain(LEGACY);
    expect(await metaNames()).not.toContain(LEGACY);
    expect(pooled(LEGACY)).toBe(false);

    expect((await call('GET', `/datasources/${ENV}`)).status).toBe(200);
    expect((await call('GET', `/meta/datasource/${ENV}`)).status).toBe(200);
    expect(await adminNames()).toContain(ENV);
    expect(await metaNames()).toContain(ENV);
    expect(pooled(ENV)).toBe(true);
  });

  it('the writes\' by-name reads never reach the legacy row, and the row is kept as it was', async () => {
    // An admin create under the legacy row's name writes an environment row of
    // its own; its remove takes that row away again.
    const created = await call('POST', '/datasources', {
      name: LEGACY, label: 'Admin create 22835', driver: 'sqlite', config: { filename: join(dir, 'admin.db') },
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    expect(await environmentRows(LEGACY)).toHaveLength(1);
    expect((await call('DELETE', `/datasources/${LEGACY}`)).status).toBe(204);
    expect(await environmentRows(LEGACY)).toHaveLength(0);

    // A `/meta` save under the name: the admin door serves the saved body.
    const saved = await call('PUT', `/meta/datasource/${LEGACY}`, {
      name: LEGACY, label: 'Meta save 22835', driver: 'sqlite', config: { filename: join(dir, 'meta.db') },
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const served = await call('GET', `/datasources/${LEGACY}`);
    expect(served.status, JSON.stringify(served.json)).toBe(200);
    expect(served.json.data?.datasource?.label).toBe('Meta save 22835');

    // Neither deleted nor rewritten.
    expect(await legacyRows()).toEqual([plantedLegacy]);
  });
});
