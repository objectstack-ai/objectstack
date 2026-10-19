// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D7 · 18.x step 2] The settings audit trail's global rung is the
// deployment-level `sys_platform_setting_audit` (ruling record 6257510973,
// Q4 A) — the EXPAND step, on the booted showcase, composed the way `os serve`
// composes it: the audit plugin and the ownership boot guard.
//
// Two boots over one SQLite file:
//
//   A. A fresh install (R1). Through the real settings door, an operator saves
//      a tenant setting and an encrypted global setting. The new write shape:
//      the global setting's history row is in the sibling, with no
//      organization column; the tenant setting's stays in `sys_setting_audit`,
//      stamped.
//   B. The same database with an 18.0-shaped row added — what an 18.0 install
//      wrote: the global setting's history row in `sys_setting_audit`, stamped
//      with the Default Organization. HEAD boots over it (the boot guard does
//      not refuse); the global rung's history is served from both tables,
//      selected by SCOPE in `sys_setting_audit` (the 18.0 row is stamped, so a
//      NULL-organization selector would miss it); and once the stack stops the
//      18.0 row is still there, stamped (expand-first: only the upgrade
//      ceremony moves it).
//
// This file builds its own 18.0-shaped row; the 18.x line's upgrade harness
// boots a whole 18.0 database, and this step runs it once it lands.
//
// NOT eligible for the shared showcase project: it writes org-wide settings and
// boots twice over its own file.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { OrganizationOwnershipBootGuardPlugin } from '@objectstack/runtime';
import type { VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

/** A placeholder, sealed by the platform like any other value; it opens nothing. */
const AI_KEY = 'expand-18x-not-a-real-api-key';
const WORKSPACE = 'Expand 18x Workspace';
const SYSTEM = { context: { isSystem: true } };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsOf = (body: any): any[] => (Array.isArray(body) ? body : (body?.records ?? body?.data ?? []));

function boot(databaseFile: string): Promise<VerifyStack> {
  return bootShowcase({ databaseFile, extraPlugins: [new AuditPlugin(), new OrganizationOwnershipBootGuardPlugin()] });
}

/** One table's rows, read from the file past every engine. */
function tableRows(file: string, table: string): Array<Record<string, any>> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, any>>;
  } finally {
    db.close();
  }
}

describe('[18.x step 2] the settings audit trail\'s global rung is deployment-level — expand-first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-expand-18x-'));
  const file = join(dir, 'expand.db');
  let stack: VerifyStack | undefined;
  let organizationId = '';

  beforeAll(async () => {
    stack = await boot(file);
    const tok = await stack.signIn();
    const orgs = rowsOf(await (await stack.apiAs(tok, 'GET', '/auth/organization/list')).json());
    const org = orgs.find((o: any) => o?.slug === 'default') ?? orgs[0];
    organizationId = String(org?.id ?? '');
    expect(organizationId, 'the boot created the Default Organization').not.toBe('');
    expect((await stack.apiAs(tok, 'POST', '/auth/organization/set-active', { organizationId })).status).toBe(200);

    const put = (ns: string, body: unknown) =>
      stack!.raw(`/api/settings/${ns}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify(body),
      });
    const branding = await put('branding', { workspace_name: WORKSPACE });
    expect(branding.status, await branding.clone().text()).toBe(200);
    const ai = await put('ai', { gateway_api_key: AI_KEY });
    expect(ai.status, await ai.clone().text()).toBe(200);
    await stack.stop();
    stack = undefined;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('A. the global setting\'s history row is in the sibling, unstamped; the tenant setting\'s stays in sys_setting_audit, stamped', () => {
    // The boot's own global-rung writes (the auth plugin records its API-key
    // policy start) land here too, so the operator's row is found by its key.
    const platform = tableRows(file, 'sys_platform_setting_audit');
    expect(platform.filter((r) => r.namespace === 'ai')).toEqual([
      expect.objectContaining({ key: 'gateway_api_key', scope: 'global', action: 'set' }),
    ]);
    for (const r of platform) expect(Object.keys(r), `sys_platform_setting_audit ${r.id}`).not.toContain('organization_id');

    const audit = tableRows(file, 'sys_setting_audit');
    expect(audit.filter((r) => r.scope === 'global')).toEqual([]);
    expect(audit.filter((r) => r.namespace === 'branding' && r.key === 'workspace_name')).toEqual([
      expect.objectContaining({ scope: 'tenant', organization_id: organizationId }),
    ]);
  });

  describe('B. the same database with an 18.0-shaped global audit row', () => {
    const LEGACY_AUDIT = 'expand18x_legacy_global_audit';
    let bootError: unknown;

    beforeAll(async () => {
      // What an 18.0 install wrote: the global rung's history in
      // sys_setting_audit, stamped with the Default Organization.
      const db = new DatabaseSync(file);
      try {
        db.prepare(
          'INSERT INTO "sys_setting_audit" ("id", "organization_id", "namespace", "key", "scope", "action", "source", "new_hash", "encrypted", "created_at") '
            + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(LEGACY_AUDIT, organizationId, 'ai', 'gateway_api_key', 'global', 'set', 'api', 'hmac-sha256:18.0', 1, '2026-10-19T00:00:00.000Z');
      } finally {
        db.close();
      }
      try {
        stack = await boot(file);
      } catch (error) {
        bootError = error;
      }
    }, 240_000);

    it('boots: nothing about the sibling reads as the v17 shape', () => {
      expect(bootError, String((bootError as Error | undefined)?.stack ?? bootError)).toBeUndefined();
      expect(stack).toBeDefined();
    });

    it('the global rung\'s history is served from both tables: the 18.0 row selected by scope, and the new one', async () => {
      const ql = await stack!.kernel.getServiceAsync<any>('objectql');
      const where = { namespace: 'ai', key: 'gateway_api_key', scope: 'global' };
      const legacy = rowsOf(await ql.find('sys_setting_audit', { where }, SYSTEM));
      const current = rowsOf(await ql.find('sys_platform_setting_audit', { where }, SYSTEM));
      expect(legacy.map((r) => r.id)).toEqual([LEGACY_AUDIT]);
      expect(legacy[0].organization_id).toBe(organizationId);
      expect(current).toHaveLength(1);

      // And through the data API, as the platform admin reads each grid.
      const tok = await stack!.signIn();
      for (const [object, id] of [['sys_setting_audit', LEGACY_AUDIT], ['sys_platform_setting_audit', String(current[0].id)]] as const) {
        const res = await stack!.apiAs(tok, 'GET', `/data/${object}`);
        expect(res.status, object).toBe(200);
        expect(rowsOf(await res.json()).map((r: any) => r.id), object).toContain(id);
      }
    });

    it('the 18.0 row keeps its place and its organization once the stack stops — nothing moved or re-stamped', async () => {
      await stack?.stop();
      stack = undefined;
      expect(tableRows(file, 'sys_setting_audit').find((r) => r.id === LEGACY_AUDIT)).toEqual(
        expect.objectContaining({ organization_id: organizationId, scope: 'global' }),
      );
    });
  });
});
