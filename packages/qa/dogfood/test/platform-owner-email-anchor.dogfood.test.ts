// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26571] `access-security.platform-owner-email-anchor`, acceptance[0] to
// acceptance[3], the live leg of acceptance[4], and negative[0]'s declaration,
// over HTTP on the stock `single` showcase.
//
// `OS_PLATFORM_OWNER_EMAIL` names the deployment's configured platform
// administrators (packages/core/src/security/platform-admin.ts). It confers
// standing only on a caller whose OWN stored `sys_user` row carries a listed
// address AND reads verified; a malformed entry refuses the whole variable,
// once, loudly on the process log. The unit pins
// (`resolve-authz-context.platform-admin-config.test.ts`, `platform-admin.test.ts`)
// run that derivation in-process; this file drives the same verdicts through
// the mounted server.
//
// The item's steps RESTART one deployment per value, and so does this file:
// one database file, one boot per variant, in the steps' order. The order is
// load-bearing. The first boot runs with the variable unset, so first-user
// promotion anchors the seeded admin on the Default Organization's
// `admin_full_access` grant; a FRESH database booted with a well-formed
// variable promotes only the declared owner (bootstrap-platform-admin.ts), so
// the admin's 200 contrast would not exist there.
//
// Probes, as member M and as the seeded admin:
//   - `GET /datasources` (its routes mounted as `serve` mounts them) — the
//     `manage_platform_settings` floor answers 403 `PERMISSION_DENIED` before
//     any service is resolved, so it discriminates platform-admin standing;
//   - `GET /auth/me/permissions` — `systemPermissions` carries
//     `manage_platform_settings` only with that standing.
//
// M's `email_verified` is stamped through a system-context engine update: no
// HTTP door verifies a second account (the item's knownGaps), and the seed
// verifies the dev admin through the same doorway. The stamp lives on this
// file's own temporary database.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type VerifyStack } from '@objectstack/verify';
import { ADMIN_STANDING_NON_TABLE_INPUTS, resetPlatformAdminEmailMemo } from '@objectstack/core';
import { ADMIN_FULL_ACCESS_CAPABILITIES } from '@objectstack/spec';
import { registerDatasourceAdminRoutes } from '@objectstack/service-datasource';
import { bootShowcase } from './showcase-boot.js';

const ENV = 'OS_PLATFORM_OWNER_EMAIL';
const SYS = { isSystem: true } as const;
const M = 'owner-anchor-m@verify.test';
const M_PASSWORD = 'owner-anchor-m-Passw0rd!';
const NOBODY = 'owner-anchor-nobody@verify.test';
const MALFORMED_ENTRY = 'not an address';
const CAPABILITY = 'manage_platform_settings';
const REFUSED = { datasources: 403, code: 'PERMISSION_DENIED' };

interface Probe { datasources: number; code: unknown; systemPermissions: string[] }

/**
 * The verify harness composes the datasource-admin service but not its REST
 * routes; `objectstack serve` mounts them from a plugin's `init`, and so does
 * this one (the `datasource-meta-door-reaches-admin-door` recipe).
 */
const datasourceRoutes = () => ({
  name: 'dogfood.datasource-admin-routes',
  version: '1.0.0',
  optionalDependencies: ['com.objectstack.server.hono'],
  init: async (ctx: { getService?: (name: string) => unknown }) => {
    const httpServer = ctx.getService?.('http.server') ?? ctx.getService?.('http-server');
    registerDatasourceAdminRoutes(httpServer as never, ctx as never, '/api/v1');
  },
});

async function probe(stack: VerifyStack, token: string): Promise<Probe> {
  const ds = await stack.apiAs(token, 'GET', '/datasources');
  const dsBody = (await ds.json().catch(() => ({}))) as any;
  const perms = await stack.apiAs(token, 'GET', '/auth/me/permissions');
  expect(perms.status, 'me/permissions answers').toBe(200);
  const p = (await perms.json()) as any;
  return {
    datasources: ds.status,
    code: dsBody?.error?.code ?? dsBody?.code ?? null,
    systemPermissions: ((p?.data ?? p)?.systemPermissions ?? []) as string[],
  };
}

describe('OS_PLATFORM_OWNER_EMAIL on the stock `single` showcase: the config anchor over HTTP', () => {
  const previous = process.env[ENV];
  let dir: string;
  let stack: VerifyStack | undefined;
  let admin: string;
  let m: string;
  let ql: any;

  /** Restart the deployment with the variable at `value`; the database file is kept. */
  const restart = async (value: string | undefined, first = false) => {
    await stack?.stop();
    stack = undefined;
    if (value === undefined) delete process.env[ENV];
    else process.env[ENV] = value;
    resetPlatformAdminEmailMemo();
    stack = await bootShowcase({ databaseFile: join(dir, 'owner-anchor.db'), extraPlugins: [datasourceRoutes()] });
    ql = await stack.kernel.getServiceAsync('objectql');
    admin = await stack.signIn();
    m = first ? await stack.signUp(M, M_PASSWORD) : await stack.signIn(M, M_PASSWORD);
    return stack;
  };

  const mRow = async () => ql.findOne('sys_user', { where: { email: M }, context: SYS });

  /** M refused at the floor, and the admin's identical probe served (negative[2]). */
  const expectBaseline = async (s: VerifyStack) => {
    const mp = await probe(s, m);
    expect({ datasources: mp.datasources, code: mp.code }, 'M is refused at the datasource floor').toEqual(REFUSED);
    expect(mp.systemPermissions, `M holds no ${CAPABILITY}`).not.toContain(CAPABILITY);
    const ap = await probe(s, admin);
    expect(ap.datasources, 'the seeded admin\'s identical probe answers 200 (the grant anchor)').toBe(200);
    expect(ap.systemPermissions).toContain(CAPABILITY);
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'dogfood-owner-anchor-'));
  });

  afterAll(async () => {
    await stack?.stop();
    if (previous === undefined) delete process.env[ENV];
    else process.env[ENV] = previous;
    resetPlatformAdminEmailMemo();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('acceptance[0]: unset — M is refused, the admin stands on the grant anchor', async () => {
    const s = await restart(undefined, true);
    expect(Boolean((await mRow())?.email_verified), 'a fresh sign-up reads unverified').toBe(false);
    await expectBaseline(s);
  }, 120_000);

  it('acceptance[1]: the variable names M while M is UNVERIFIED — M is refused exactly as at baseline', async () => {
    const s = await restart(M);
    expect(Boolean((await mRow())?.email_verified), 'M is still unverified').toBe(false);
    await expectBaseline(s);
  }, 120_000);

  it('acceptance[2]: the variable names an address no row holds — nothing changes for anyone', async () => {
    const s = await restart(NOBODY);
    expect(await ql.findOne('sys_user', { where: { email: NOBODY }, context: SYS }), 'no row holds it').toBeFalsy();
    await expectBaseline(s);
  }, 120_000);

  it('acceptance[4] live leg: the variable names M and M is VERIFIED — M holds the declared admin envelope', async () => {
    const s = await restart(M);
    const row = await mRow();
    await ql.update('sys_user', { id: row.id, email_verified: true }, { context: SYS });
    expect(Boolean((await mRow())?.email_verified), 'M now reads verified').toBe(true);
    const mp = await probe(s, m);
    expect(mp.datasources, 'M clears the datasource floor').toBe(200);
    for (const cap of ADMIN_FULL_ACCESS_CAPABILITIES.systemPermissions ?? []) {
      expect(mp.systemPermissions, `M's envelope carries ${cap}`).toContain(cap);
    }
  }, 120_000);

  it('acceptance[3]: a malformed list refuses the WHOLE variable, loudly once — the well-formed, VERIFIED sibling confers nothing', async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    try {
      const s = await restart(`${M}, ${MALFORMED_ENTRY}`);
      const row = await mRow();
      expect(Boolean(row?.email_verified), 'M is STILL verified, so the refusal is the malformed entry\'s alone').toBe(true);
      // M holds no grant of its own, so a 200 here could only be the config anchor's.
      const grants = await ql.find('sys_user_permission_set', { where: { user_id: row.id }, context: SYS });
      expect(grants.map((g: any) => g.permission_set), 'M holds no admin_full_access grant').not.toContain('admin_full_access');
      await expectBaseline(s);
    } finally {
      console.error = original;
    }
    const refusals = lines.filter((l) => l.includes('[authz]') && l.includes(ENV));
    expect(refusals, 'the [authz] refusal prints once for the value').toHaveLength(1);
    expect(refusals[0], 'it names the offending entry verbatim').toContain(JSON.stringify(` ${MALFORMED_ENTRY}`));
    expect(refusals[0]).toContain('WHOLE variable is refused');
    expect(refusals[0]).toContain('ZERO config-derived platform administrators');
  }, 120_000);

  it('negative[0]: the variable is declared a NON-TABLE derivation input — no runtime write reaches the anchor', () => {
    expect(ADMIN_STANDING_NON_TABLE_INPUTS).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'env', name: ENV })]),
    );
  });
});
