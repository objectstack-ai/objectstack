// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D3 · D12 items 7–8 · D11] Under a walled tenancy posture an import
// of a remote table is a write to the environment's metadata catalog, so it is
// the platform operator's at both import doors, on a REAL booted stack:
//
//   - `POST /api/v1/datasources/:name/external/tables/:remote/import`, and
//   - the MCP `import_object` tool.
//
// Both doors read the walled-catalog verdict (`walledCatalogWriteVerdict`,
// `@objectstack/metadata-core`) the metadata save door reads, after the
// federation family's capability rule and before the federation service is
// looked up. Pinned here under `group`, the posture where every organization
// shares the environment's catalog: an organization's administrator, holding
// both federation capabilities inside that organization and below the platform
// operator, is refused at each door with `403 PERMISSION_DENIED` and the save
// door's own sentence for an object, and nothing is saved. CONTROLS: the
// platform operator imports at both doors under the same wall; and under
// `single` the same kind of administrator, who is not the platform operator,
// imports at both doors as before.
//
// The status and the sentence are the save door's. The code is this family's
// spelling of a 403, `PERMISSION_DENIED`, the standard-catalog member; the REST
// `/meta` door answers the grandfathered synonym of that member
// (`STANDARD_SYNONYM_WAIVERS`, ADR-0112 D3), which keeps a wire value and does
// not endorse the spelling for new code.
//
// The verify harness does not mount the federation service or the MCP server,
// so this file mounts both, as `objectstack dev` and `serve` do. The showcase's
// external datasource names a cwd-relative SQLite file, and every dogfood file
// runs in its own temporary working directory (`per-file-cwd.setup.ts`), so the
// remote tables `onEnable` provisions here are this file's own. The
// datasource's package is read-only, so an import lands in its customization
// package, which under a wall only the platform operator creates: the operator
// ensures it first, so a refusal below is the wall's and never the landing's.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { onEnable } from '@objectstack/example-showcase';
import { resolveUserAuthzGrants } from '@objectstack/core';
import { ExternalDatasourceServicePlugin } from '@objectstack/service-datasource';
import { MCPServerPlugin } from '@objectstack/mcp';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { ensurePair } from './customization-pair.js';

const SYS = { isSystem: true } as const;

/** The showcase's external datasource and its package (`examples/app-showcase`, `manifest.id`). */
const DATASOURCE = 'showcase_external';
const BASE = 'com.example.showcase';

const importPath = (remote: string) => `/datasources/${DATASOURCE}/external/tables/${remote}/import`;

/** A runtime-authored set carrying both federation capabilities. */
const IMPORTER_SET = 'federation_importer';
const IMPORTER_CAPABILITIES = ['manage_metadata', 'manage_platform_settings'];

/** A JSON-RPC MCP request over Streamable-HTTP (JSON response mode). */
const mcpBody = (method: string, params?: unknown, id = 1) =>
  ({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });

interface Harness {
  stack: VerifyStack;
  ql: any;
  operator: string;
  tokA: string;
  userA: string;
  orgA?: string;
}

async function boot(posture: 'group' | 'single'): Promise<Harness> {
  const walled = posture !== 'single';
  if (walled) process.env.OS_TENANCY_POSTURE = posture;
  else delete process.env.OS_TENANCY_POSTURE;
  // Provision the remote tables, exactly as `os dev` does at boot (the harness
  // imports only the stack's default export, so `onEnable` never runs on its own).
  await onEnable({ logger: { info() {}, warn() {} } } as never);
  const stack = await bootShowcase({
    ...(walled ? { multiTenant: 'posture-only' as const } : {}),
    extraPlugins: [new ExternalDatasourceServicePlugin(), new MCPServerPlugin()],
  } as never);
  const ql: any = await stack.kernel.getServiceAsync('objectql');
  const operator = await stack.signIn();
  const email = `fed-import-a-${posture}@wall.test`;
  const tokA = await stack.signUp(email);
  const h: Harness = { stack, ql, operator, tokA, userA: '' };
  if (walled) {
    const slug = `fed-import-a-${posture}`;
    const created = await stack.apiAs(tokA, 'POST', '/auth/organization/create', { name: slug, slug });
    expect(created.status, await created.clone().text()).toBe(200);
    h.orgA = ((await created.json()) as { id: string }).id;
    const active = await stack.apiAs(tokA, 'POST', '/auth/organization/set-active', { organizationSlug: slug });
    expect(active.status, await active.clone().text()).toBe(200);
  }
  h.userA = String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id);
  // The operator creates the customization package an import over this
  // datasource lands in, and authors the set A holds (inside org A under a wall).
  await ensurePair(stack, operator, BASE);
  const saved = await stack.apiAs(operator, 'PUT', `/meta/permission/${IMPORTER_SET}`, {
    name: IMPORTER_SET, label: IMPORTER_SET, objects: {}, systemPermissions: [...IMPORTER_CAPABILITIES],
  });
  expect(saved.status, await saved.clone().text()).toBe(200);
  await ql.insert(
    'sys_user_permission_set',
    { user_id: h.userA, permission_set: IMPORTER_SET, ...(h.orgA ? { organization_id: h.orgA } : {}) },
    { context: { ...SYS, ...(h.orgA ? { tenantId: h.orgA } : {}) } },
  );
  return h;
}

/** The REST import's answer: status, `error.code`, `error.message` and whether a definition came back. */
async function importOverRest(h: Harness, token: string, remote: string, name: string) {
  const res = await h.stack.apiAs(token, 'POST', importPath(remote), { name });
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, code: json?.error?.code, message: String(json?.error?.message ?? ''), data: json?.data, json };
}

/** The MCP `import_object` answer: the tool result's error envelope, or its object. */
async function importOverMcp(h: Harness, token: string, remote: string, name: string) {
  const res = await h.stack.api('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The transport requires the client to accept both content types.
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(mcpBody('tools/call', { name: 'import_object', arguments: { datasource: DATASOURCE, remoteName: remote, name } })),
  });
  expect(res.status, `tools/call import_object: ${await res.clone().text()}`).toBe(200);
  const rpc: any = await res.json();
  expect(rpc.error, `tools/call import_object JSON-RPC error: ${JSON.stringify(rpc.error)}`).toBeUndefined();
  const text = rpc.result?.content?.[0]?.text;
  expect(typeof text, 'the tool result carries text content').toBe('string');
  const parsed = JSON.parse(text);
  return { isError: rpc.result?.isError === true, error: parsed?.error, object: parsed?.object };
}

/** What the platform operator reads at `GET /meta/object/:name`. */
async function storedStatus(h: Harness, name: string): Promise<number> {
  return (await h.stack.apiAs(h.operator, 'GET', `/meta/object/${name}`)).status;
}

describe('[ADR-0131 D12 items 7–8] group: an import is a write to the environment\'s catalog, and it is the platform operator\'s at both import doors', () => {
  let h: Harness;
  const previous = process.env.OS_TENANCY_POSTURE;

  beforeAll(async () => { h = await boot('group'); }, 180_000);
  afterAll(async () => {
    await h?.stack?.stop?.();
    if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = previous;
  });

  it('guard the guard: a real walled posture; A holds both federation capabilities in org A and is not the platform operator', async () => {
    const tenancy = await h.stack.kernel.getServiceAsync<{ posture: string; degraded: boolean }>('tenancy');
    expect(tenancy.posture).toBe('group');
    expect(tenancy.degraded).toBe(false);
    const a = await resolveUserAuthzGrants(h.ql as never, h.userA, { tenantId: h.orgA });
    expect(a.systemPermissions).toEqual(expect.arrayContaining(IMPORTER_CAPABILITIES));
    expect(a.posture).not.toBe('PLATFORM_ADMIN');
  });

  it('REST: A\'s import is refused with the save door\'s status and sentence for an object, and nothing is saved', async () => {
    const name = 'showcase_custom_wall_rest_cust';
    const imported = await importOverRest(h, h.tokA, 'customers', name);
    expect({ status: imported.status, code: imported.code }, JSON.stringify(imported.json)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    expect(imported.message).toContain('\'group\' tenancy posture');
    expect(imported.message).toContain('ADR-0131 D3, D12 items 7–8, D11');
    expect(imported.data, 'a refused import answers no definition').toBeUndefined();

    // The metadata save door refuses A the same object with the same status and
    // the same sentence: one verdict.
    const savedByA = await h.stack.apiAs(h.tokA, 'PUT', `/meta/object/${name}`, {
      name, label: 'By A', fields: { title: { type: 'text', label: 'Title' } },
    });
    const saveBody: any = await savedByA.json().catch(() => ({}));
    expect(savedByA.status, JSON.stringify(saveBody)).toBe(imported.status);
    expect(saveBody?.error?.message).toBe(imported.message);

    expect(await storedStatus(h, name)).toBe(404);
  });

  it('MCP: A\'s `import_object` is refused with the same code and sentence, and nothing is saved', async () => {
    const name = 'showcase_custom_wall_mcp_cust';
    const rest = await importOverRest(h, h.tokA, 'customers', 'showcase_custom_wall_rest_probe');
    const imported = await importOverMcp(h, h.tokA, 'customers', name);
    expect(imported.isError, JSON.stringify(imported)).toBe(true);
    expect({ code: imported.error?.code, status: imported.error?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(imported.error?.message).toBe(rest.message);
    expect(imported.object).toBeUndefined();
    expect(await storedStatus(h, name)).toBe(404);
  });

  it('control: the platform operator imports at both doors under the same wall, and each object is saved', async () => {
    const restName = 'showcase_custom_wall_op_rest';
    const rest = await importOverRest(h, h.operator, 'customers', restName);
    expect(rest.status, JSON.stringify(rest.json)).toBe(201);
    expect(rest.data?.object?.name).toBe(restName);
    expect(await storedStatus(h, restName)).toBe(200);

    const mcpName = 'showcase_custom_wall_op_mcp';
    const mcp = await importOverMcp(h, h.operator, 'orders', mcpName);
    expect(mcp.isError, JSON.stringify(mcp)).toBe(false);
    expect(mcp.object?.name).toBe(mcpName);
    expect(await storedStatus(h, mcpName)).toBe(200);
  });
});

describe('[ADR-0131 D11] single: the wall is not enforced, and an administrator below the platform operator imports at both doors as before', () => {
  let h: Harness;
  const previous = process.env.OS_TENANCY_POSTURE;

  beforeAll(async () => { h = await boot('single'); }, 180_000);
  afterAll(async () => {
    await h?.stack?.stop?.();
    if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = previous;
  });

  it('guard the guard: no wall, and A holds both federation capabilities and is not the platform operator', async () => {
    const tenancy = await h.stack.kernel.getServiceAsync<{ posture: string; defaultOrgId(): Promise<string | null> }>('tenancy');
    expect(tenancy.posture).toBe('single');
    // The organization a `single` session is active in: the Default
    // Organization, which an organization-less grant is stamped with.
    const a = await resolveUserAuthzGrants(h.ql as never, h.userA, { tenantId: (await tenancy.defaultOrgId()) ?? undefined });
    expect(a.systemPermissions).toEqual(expect.arrayContaining(IMPORTER_CAPABILITIES));
    expect(a.posture).not.toBe('PLATFORM_ADMIN');
  });

  it('control: A imports over REST and over MCP, and each object is saved', async () => {
    const restName = 'showcase_custom_open_rest';
    const rest = await importOverRest(h, h.tokA, 'customers', restName);
    expect(rest.status, JSON.stringify(rest.json)).toBe(201);
    expect(await storedStatus(h, restName)).toBe(200);

    const mcpName = 'showcase_custom_open_mcp';
    const mcp = await importOverMcp(h, h.tokA, 'orders', mcpName);
    expect(mcp.isError, JSON.stringify(mcp)).toBe(false);
    expect(mcp.object?.name).toBe(mcpName);
    expect(await storedStatus(h, mcpName)).toBe(200);
  });
});
