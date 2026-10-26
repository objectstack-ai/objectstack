// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D7 · 18.x step 2] The settings audit trail's global rung is the
// deployment-level `sys_platform_setting_audit` (ruling record 6257510973,
// Q4 A) — the expand step, and step 7's retirement of the old home, on the
// booted showcase, composed the way `os serve`
// composes it: the audit plugin and the ownership boot guard.
//
// Two boots over one SQLite file:
//
//   A. A fresh install (R1). Through the real settings door, an operator saves
//      a tenant setting and an encrypted global setting. The new write shape:
//      the global setting's history row is in the sibling, with no
//      organization column; the tenant setting's stays in `sys_setting_audit`,
//      stamped.
//   B. One home (18.x step 7). The upgrade ceremony moves every global-rung
//      row an 18.0 install wrote to `sys_setting_audit` before the database is
//      certified, so that table declares no `global` scope any more. Booted
//      again over the same file, the engine refuses a global-scope row there
//      — through the system context, the writer's own — and admits the same
//      row at the tenant rung (the control).
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

describe('[18.x step 2] the settings audit trail\'s global rung is deployment-level', () => {
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

  describe('B. one home: sys_setting_audit refuses a global-scope row', () => {
    let bootError: unknown;
    const auditRow = (scope: string) => ({
      namespace: 'ai', key: 'gateway_api_key', scope, action: 'set', source: 'api',
      new_hash: 'hmac-sha256:18.0', encrypted: true, created_at: '2026-10-19T00:00:00.000Z',
    });

    beforeAll(async () => {
      try {
        stack = await boot(file);
      } catch (error) {
        bootError = error;
      }
    }, 240_000);

    it('boots again over the same file', () => {
      expect(bootError, String((bootError as Error | undefined)?.stack ?? bootError)).toBeUndefined();
      expect(stack).toBeDefined();
    });

    it('control: the same row at the tenant rung lands', async () => {
      const ql = await stack!.kernel.getServiceAsync<any>('objectql');
      await ql.insert('sys_setting_audit', auditRow('tenant'), SYSTEM);
      const where = { namespace: 'ai', key: 'gateway_api_key', scope: 'tenant' };
      expect(rowsOf(await ql.find('sys_setting_audit', { where }, SYSTEM))).toHaveLength(1);
    });

    it('a global-scope row is refused on scope, and the table still holds none', async () => {
      const ql = await stack!.kernel.getServiceAsync<any>('objectql');
      await expect(ql.insert('sys_setting_audit', auditRow('global'), SYSTEM)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        fields: [expect.objectContaining({ field: 'scope' })],
      });
      await stack?.stop();
      stack = undefined;
      expect(tableRows(file, 'sys_setting_audit').filter((r) => r.scope === 'global')).toEqual([]);
    });
  });
});
