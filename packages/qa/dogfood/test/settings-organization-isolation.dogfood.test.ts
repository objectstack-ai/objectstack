// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Settings values on a two-organization kernel, measured over HTTP — the
 * settings door and the generic data-API read of `sys_setting`.
 *
 * ## What is asserted
 *
 *  1. Two organizations each set and read their own tenant-scope value; one
 *     organization's write, and its reset, leave the other's unchanged.
 *  2. A `global` value is read by both.
 *  3. A tenant-scope write that names no organization, under the walled
 *     posture, is refused — `status` and `error.code` asserted — and writes
 *     nothing. Positive control: the identical write from inside an
 *     organization lands.
 *  4. The generic data-API read of `sys_setting` withholds a namespace's rows
 *     from a principal that lacks the namespace's `readPermission`, on the
 *     list and on the by-id read. Positive control: the same principal reads
 *     the rows of a namespace whose capability it holds, and a holder of the
 *     withheld capability reads the withheld row.
 *
 * ## The harness
 *
 *  - boot: `bootStack(crm, { multiTenant: 'posture-only' })` — a real,
 *    non-degraded `isolated` posture. Its stand-in scopes no row of its own,
 *    which is what this file needs: the settings service reads and writes
 *    under its own system context, so no row wall reaches those calls anyway.
 *    Everything asserted in 1–3 is the service's own `where` and row identity.
 *  - principals: the platform admin (the seeded first user, in no
 *    organization) and two organization owners who each create their OWN
 *    organization, so the two tenants carry different active organizations —
 *    asserted, not assumed.
 *  - namespaces: the shipped `branding` manifest (tenant scope, read
 *    `setup.access`, write `setup.write`) for 1 and 3; two fixture manifests
 *    registered on the booted service for 2 and 4, because no shipped manifest
 *    has a global key an organization may read, or a read capability stricter
 *    than its write capability.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { context: { isSystem: true } };

/** A global key every organization may read; only the platform may write it. */
const GLOBAL_NS = 'dogfood_settings_global_fixture';
/** A tenant key an organization may write but whose read needs a platform capability. */
const GATED_NS = 'dogfood_settings_read_gated_fixture';

interface ApiError { error?: { code?: string; details?: { fields?: Array<{ field?: string; code?: string }> } } }

describe('settings values are per organization, and the generic read door applies each namespace\'s readPermission', () => {
  let stack: VerifyStack;
  let adminToken: string;
  let tenantAToken: string;
  let tenantBToken: string;
  let orgAId: string;
  let orgBId: string;
  let ql: any;

  const settingsCall = (token: string, method: string, path: string, body?: unknown) =>
    stack.raw(`/api/settings/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const readValue = async (token: string, ns: string, key: string) => {
    const res = await settingsCall(token, 'GET', ns);
    const text = await res.clone().text();
    expect(res.status, `GET /api/settings/${ns}: ${text}`).toBe(200);
    const body = (await res.json()) as { data: { values: Record<string, { value: unknown; source: string }> } };
    return body.data.values[key];
  };

  const storedRows = async (namespace: string) =>
    (await ql.find('sys_setting', { where: { namespace }, limit: 50 }, SYS)) as Array<Record<string, unknown>>;

  beforeAll(async () => {
    stack = await bootStack(crmStack as never, { multiTenant: 'posture-only' });
    adminToken = await stack.signIn();
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    const settings = await stack.kernel.getServiceAsync<any>('settings');
    settings.registerManifest({
      namespace: GLOBAL_NS, label: 'Global fixture', scope: 'global',
      readPermission: 'setup.access', writePermission: 'manage_platform_settings',
      specifiers: [{ type: 'text', key: 'banner', label: 'Banner', required: false }],
    });
    settings.registerManifest({
      namespace: GATED_NS, label: 'Read-gated fixture', scope: 'tenant',
      readPermission: 'manage_platform_settings', writePermission: 'setup.write',
      specifiers: [{ type: 'text', key: 'note', label: 'Note', required: false }],
    });

    tenantAToken = await stack.signUp('settings-org-a-owner@dogfood.test');
    tenantBToken = await stack.signUp('settings-org-b-owner@dogfood.test');
    for (const [token, name, slug] of [
      [tenantAToken, 'Settings Org A', 'settings-org-a'],
      [tenantBToken, 'Settings Org B', 'settings-org-b'],
    ] as const) {
      const created = await stack.apiAs(token, 'POST', '/auth/organization/create', { name, slug });
      expect(created.status, `org create ${slug}: ${await created.clone().text()}`).toBe(200);
      const id = ((await created.json()) as { id: string }).id;
      if (slug === 'settings-org-a') orgAId = id; else orgBId = id;
      const active = await stack.apiAs(token, 'POST', '/auth/organization/set-active', { organizationSlug: slug });
      expect(active.status, `set-active ${slug}: ${await active.clone().text()}`).toBe(200);
    }
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('guard: a real walled posture, two distinct organizations, and an organization-less platform admin', async () => {
    const tenancy = await stack.kernel.getServiceAsync<{ posture: string; degraded: boolean }>('tenancy');
    expect(tenancy.posture).toBe('isolated');
    expect(tenancy.degraded).toBe(false);
    expect(orgAId).toBeTruthy();
    expect(orgBId).toBeTruthy();
    expect(orgAId).not.toBe(orgBId);

    const activeOrg = async (token: string) => {
      const res = await stack.apiAs(token, 'GET', '/auth/get-session');
      expect(res.status).toBe(200);
      return ((await res.json()) as { session: { activeOrganizationId: string | null } }).session.activeOrganizationId;
    };
    expect(await activeOrg(tenantAToken)).toBe(orgAId);
    expect(await activeOrg(tenantBToken)).toBe(orgBId);
    expect(await activeOrg(adminToken)).toBeFalsy();
  });

  it('two organizations each set and read their own tenant-scope value', async () => {
    const putA = await settingsCall(tenantAToken, 'PUT', 'branding', { workspace_name: 'Org A Workspace' });
    expect(putA.status, await putA.clone().text()).toBe(200);
    // Organization B has written nothing: it does not read A's value.
    expect((await readValue(tenantBToken, 'branding', 'workspace_name')).source).toBe('default');

    const putB = await settingsCall(tenantBToken, 'PUT', 'branding', { workspace_name: 'Org B Workspace' });
    expect(putB.status, await putB.clone().text()).toBe(200);

    expect((await readValue(tenantAToken, 'branding', 'workspace_name')).value).toBe('Org A Workspace');
    expect((await readValue(tenantBToken, 'branding', 'workspace_name')).value).toBe('Org B Workspace');

    // Two stored rows, each carrying the organization that wrote it.
    const rows = (await storedRows('branding')).filter((r) => r.key === 'workspace_name');
    expect(rows.map((r) => [r.organization_id, r.value]).sort()).toEqual(
      [[orgAId, 'Org A Workspace'], [orgBId, 'Org B Workspace']].sort(),
    );
  });

  it('one organization\'s write, and its reset, leave the other\'s value unchanged', async () => {
    const putA = await settingsCall(tenantAToken, 'PUT', 'branding', { workspace_name: 'Org A Renamed' });
    expect(putA.status, await putA.clone().text()).toBe(200);
    expect((await readValue(tenantBToken, 'branding', 'workspace_name')).value).toBe('Org B Workspace');

    const reset = await settingsCall(tenantAToken, 'POST', 'branding/reset', {});
    expect(reset.status, await reset.clone().text()).toBe(200);
    expect((await readValue(tenantAToken, 'branding', 'workspace_name')).source).toBe('default');

    const other = await readValue(tenantBToken, 'branding', 'workspace_name');
    expect(other.value).toBe('Org B Workspace');
    expect(other.source).toBe('tenant');
  });

  it('a global value is read by both organizations', async () => {
    const put = await settingsCall(adminToken, 'PUT', GLOBAL_NS, { banner: 'Platform banner' });
    expect(put.status, await put.clone().text()).toBe(200);

    for (const token of [tenantAToken, tenantBToken]) {
      const got = await readValue(token, GLOBAL_NS, 'banner');
      expect(got.value).toBe('Platform banner');
      expect(got.source).toBe('global');
    }
  });

  it('a tenant-scope write that names no organization is refused under the walled posture, and writes nothing; the same write from an organization lands', async () => {
    const before = (await storedRows('branding')).length;

    const refused = await settingsCall(adminToken, 'PUT', 'branding', { workspace_name: 'No Organization' });
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as ApiError;
    expect(body.error?.code).toBe('SETTINGS_VALIDATION');
    expect(body.error?.details?.fields?.[0]).toMatchObject({ field: 'workspace_name', code: 'invalid_value' });
    expect((await storedRows('branding')).length).toBe(before);
    expect((await storedRows('branding')).some((r) => r.value === 'No Organization')).toBe(false);

    // Positive control: the identical write, from inside an organization.
    const landed = await settingsCall(tenantAToken, 'PUT', 'branding', { workspace_name: 'No Organization' });
    expect(landed.status, await landed.clone().text()).toBe(200);
    expect((await readValue(tenantAToken, 'branding', 'workspace_name')).value).toBe('No Organization');
  });

  it('the generic data-API read of sys_setting withholds a namespace\'s rows from a principal lacking its readPermission', async () => {
    const put = await settingsCall(tenantAToken, 'PUT', GATED_NS, { note: 'gated' });
    expect(put.status, await put.clone().text()).toBe(200);
    const [gatedRow] = await storedRows(GATED_NS);
    expect(gatedRow?.organization_id).toBe(orgAId);

    // The settings door refuses this principal the namespace — the rule the
    // generic door now applies too.
    const door = await settingsCall(tenantAToken, 'GET', GATED_NS);
    expect(door.status).toBe(403);
    expect(((await door.json()) as ApiError).error?.code).toBe('SETTINGS_FORBIDDEN');

    const list = await stack.apiAs(tenantAToken, 'GET', `/data/sys_setting?namespace=${GATED_NS}`);
    expect(list.status, await list.clone().text()).toBe(200);
    const listed = ((await list.json()) as { data?: unknown[]; records?: unknown[] });
    expect((listed.data ?? listed.records ?? []).length).toBe(0);

    const byId = await stack.apiAs(tenantAToken, 'GET', `/data/sys_setting/${String(gatedRow.id)}`);
    expect(byId.status).toBe(404);

    // Positive control 1: the same principal reads its own row of a namespace
    // whose read capability it holds.
    const own = await stack.apiAs(tenantAToken, 'GET', '/data/sys_setting?namespace=branding');
    expect(own.status, await own.clone().text()).toBe(200);
    const ownRows = ((await own.json()) as { data?: Array<Record<string, unknown>>; records?: Array<Record<string, unknown>> });
    expect((ownRows.data ?? ownRows.records ?? []).some((r) => r.organization_id === orgAId)).toBe(true);

    // Positive control 2: a holder of the withheld capability reads the
    // withheld row.
    const held = await stack.apiAs(adminToken, 'GET', `/data/sys_setting/${String(gatedRow.id)}`);
    expect(held.status, await held.clone().text()).toBe(200);
  });
});
