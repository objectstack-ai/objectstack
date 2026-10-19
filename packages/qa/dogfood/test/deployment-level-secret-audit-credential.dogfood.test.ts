// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D7 · 18.x step 2] `sys_secret` and `sys_flow_credential` are
// deployment-level, and the settings audit trail's global rung is
// `sys_platform_setting_audit` (ruling records 6257510973, Q4 A, and
// 6259141885, Q1 A) — the EXPAND step, on the booted showcase, composed the way
// `os serve` composes it: the audit plugin and the ownership boot guard.
//
// Two boots over one SQLite file:
//
//   A. A fresh install (R1). Through the real doors, an operator saves a tenant
//      setting, an encrypted global setting and a flow with two credentials.
//      The new write shape: no secret and no credential row names an
//      organization; the global setting's history row is in the sibling, with
//      no organization; the tenant setting's is in `sys_setting_audit`,
//      stamped.
//   B. The same database with its rows put in the 18.0 shape — what an 18.0
//      install wrote: the secrets and credentials stamped with the Default
//      Organization, and the global setting's history row in
//      `sys_setting_audit`, stamped. The boot guard does not refuse it (the
//      physical organization columns are DECLARED, so this is not the v17
//      shape); the stamped secret opens, the stamped credentials resolve, the
//      global rung's history is served from both tables; and once the stack
//      stops, every 18.0 row still holds its organization (expand-first: only
//      the upgrade ceremony re-stamps, moves or drops).
//
// This file builds its own 18.0-shaped rows; the 18.x line's upgrade harness
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

const FLOW = 'expand_18x_inbound';
/** Placeholders, sealed by the platform like any other value; they open nothing. */
const HOOK_SECRET = 'expand-18x-not-a-real-hook-secret';
const AI_KEY = 'expand-18x-not-a-real-api-key';
const WORKSPACE = 'Expand 18x Workspace';
const SYSTEM = { context: { isSystem: true } };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsOf = (body: any): any[] => (Array.isArray(body) ? body : (body?.records ?? body?.data ?? []));

function boot(databaseFile: string): Promise<VerifyStack> {
  return bootShowcase({ databaseFile, extraPlugins: [new AuditPlugin(), new OrganizationOwnershipBootGuardPlugin()] });
}

function inboundFlow() {
  return {
    name: FLOW,
    label: 'Expand 18x inbound',
    type: 'api',
    status: 'active',
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: { hookId: 'h1', secret: HOOK_SECRET } },
      { id: 'call', type: 'http', label: 'Call', config: { url: 'https://example.invalid/out', method: 'POST', signingSecret: HOOK_SECRET } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'call' },
      { id: 'e2', source: 'call', target: 'end' },
    ],
  };
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

describe('[18.x step 2] sys_secret, sys_flow_credential and the global audit rung are deployment-level — expand-first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-expand-18x-'));
  const file = join(dir, 'expand.db');
  let stack: VerifyStack | undefined;
  let organizationId = '';
  let secretIds: string[] = [];
  let credentialIds: string[] = [];

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
    const flow = await stack.apiAs(tok, 'PUT', `/meta/flow/${FLOW}`, inboundFlow());
    expect([200, 201], await flow.clone().text()).toContain(flow.status);
    await stack.stop();
    stack = undefined;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('A. a fresh install writes the new shape: no secret and no credential names an organization', () => {
    const secrets = tableRows(file, 'sys_secret');
    secretIds = secrets.map((r) => String(r.id));
    // The ai key's ciphertext, and one per flow credential.
    expect(secrets.filter((r) => r.namespace === 'ai' && r.key === 'gateway_api_key')).toHaveLength(1);
    expect(secrets.filter((r) => r.namespace === 'sys_flow_credential')).toHaveLength(2);
    for (const r of secrets) expect(r.organization_id, `sys_secret ${r.id}`).toBeNull();

    const credentials = tableRows(file, 'sys_flow_credential').filter((r) => r.flow_name === FLOW);
    credentialIds = credentials.map((r) => String(r.id));
    expect(credentials).toHaveLength(2);
    for (const r of credentials) expect(r.organization_id, `sys_flow_credential ${r.id}`).toBeNull();
  });

  it('A. the global setting\'s history row is in the sibling, unstamped; the tenant setting\'s stays in sys_setting_audit, stamped', () => {
    const platform = tableRows(file, 'sys_platform_setting_audit');
    expect(platform).toEqual([expect.objectContaining({ namespace: 'ai', key: 'gateway_api_key', scope: 'global', action: 'set' })]);
    expect(Object.keys(platform[0]!)).not.toContain('organization_id');

    const audit = tableRows(file, 'sys_setting_audit');
    expect(audit.filter((r) => r.scope === 'global')).toEqual([]);
    expect(audit.filter((r) => r.namespace === 'branding' && r.key === 'workspace_name')).toEqual([
      expect.objectContaining({ scope: 'tenant', organization_id: organizationId }),
    ]);
  });

  describe('B. the same database with its rows in the 18.0 shape', () => {
    const LEGACY_AUDIT = 'expand18x_legacy_global_audit';
    let bootError: unknown;

    beforeAll(async () => {
      // What an 18.0 install wrote: the Default Organization's stamp on every
      // secret and credential, and the global rung's history in sys_setting_audit.
      const db = new DatabaseSync(file);
      try {
        db.prepare('UPDATE "sys_secret" SET "organization_id" = ?').run(organizationId);
        db.prepare('UPDATE "sys_flow_credential" SET "organization_id" = ?').run(organizationId);
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

    it('boots: the boot guard does not read the declared, unread organization columns as the v17 shape', () => {
      expect(bootError, String((bootError as Error | undefined)?.stack ?? bootError)).toBeUndefined();
      expect(stack).toBeDefined();
    });

    it('the stamped secret opens, and the stamped credentials resolve', async () => {
      const settings = await stack!.kernel.getServiceAsync<any>('settings');
      const got = await settings.get('ai', 'gateway_api_key', { tenantId: organizationId });
      expect(got?.value).toBe(AI_KEY);

      const ql = await stack!.kernel.getServiceAsync<any>('objectql');
      for (const id of credentialIds) {
        expect(await ql.resolveSecretField('sys_flow_credential', id, 'value'), `credential ${id}`).toBe(HOOK_SECRET);
      }
    });

    it('the global rung\'s history is served from both tables: the 18.0 row and the new one', async () => {
      const ql = await stack!.kernel.getServiceAsync<any>('objectql');
      const where = { namespace: 'ai', key: 'gateway_api_key', scope: 'global' };
      const legacy = rowsOf(await ql.find('sys_setting_audit', { where }, SYSTEM));
      const current = rowsOf(await ql.find('sys_platform_setting_audit', { where }, SYSTEM));
      expect(legacy.map((r) => r.id)).toEqual([LEGACY_AUDIT]);
      expect(current).toHaveLength(1);

      // And through the data API, as the platform admin reads each grid.
      const tok = await stack!.signIn();
      for (const [object, id] of [['sys_setting_audit', LEGACY_AUDIT], ['sys_platform_setting_audit', String(current[0].id)]] as const) {
        const res = await stack!.apiAs(tok, 'GET', `/data/${object}`);
        expect(res.status, object).toBe(200);
        expect(rowsOf(await res.json()).map((r: any) => r.id), object).toContain(id);
      }
    });

    it('every 18.0 row keeps its organization once the stack stops — nothing re-stamped, moved or dropped', async () => {
      await stack?.stop();
      stack = undefined;
      const secrets = tableRows(file, 'sys_secret');
      for (const id of secretIds) {
        expect(secrets.find((r) => String(r.id) === id)?.organization_id, `sys_secret ${id}`).toBe(organizationId);
      }
      const credentials = tableRows(file, 'sys_flow_credential');
      for (const id of credentialIds) {
        expect(credentials.find((r) => String(r.id) === id)?.organization_id, `sys_flow_credential ${id}`).toBe(organizationId);
      }
      expect(tableRows(file, 'sys_setting_audit').find((r) => r.id === LEGACY_AUDIT)).toEqual(
        expect.objectContaining({ organization_id: organizationId, scope: 'global' }),
      );
    });
  });
});
