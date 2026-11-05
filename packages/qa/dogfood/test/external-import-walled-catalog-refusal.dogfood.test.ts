// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D3 · D12 items 7–8 · D11] Under a walled tenancy posture an import
// of a remote table is a write to the environment's metadata catalog, so it is
// the platform operator's at both import doors, on a REAL booted stack:
//
//   - `POST /api/v1/datasources/:name/external/tables/:remote/import`, and
//   - the MCP `import_object` tool.
//
// The catalog refresh, `POST /api/v1/datasources/:name/external/refresh-catalog`,
// rewrites the datasource's cached `external_catalog` snapshot, an item of the
// same catalog, so it is the platform operator's there too.
//
// Each door reads the walled-catalog verdict (`walledCatalogWriteVerdict`,
// `@objectstack/metadata-core`) the metadata save door reads, after the
// federation family's capability rule and before the federation service is
// looked up. Pinned here under `group`, the posture where every organization
// shares the environment's catalog: an organization's administrator, holding
// both federation capabilities inside that organization and below the platform
// operator, is refused at each door with `403 PERMISSION_DENIED` and the save
// door's own sentence for the type written, and nothing is saved. CONTROLS: the
// platform operator imports at both doors and refreshes the catalog under the
// same wall; and under `single` the same kind of administrator, who is not the
// platform operator, does each as before.
//
// The status and the sentence are the save door's. The code is this family's
// spelling of a 403, `PERMISSION_DENIED`, the standard-catalog member; the REST
// `/meta` door answers the grandfathered synonym of that member
// (`STANDARD_SYNONYM_WAIVERS`, ADR-0112 D3), which keeps a wire value and does
// not endorse the spelling for new code.
//
// The verify harness does not mount the federation service or the MCP server,
// so this file mounts both, as `objectstack dev` and `serve` do. The MCP pair is
// registered only for an OAuth agent granted `metadata:write`, and an agent holds
// its user's system capabilities only under `actions:execute`, so each MCP call
// below presents a REAL access token with both scopes (DCR → authorize with the
// MCP resource → consent → token), consented from a session active in the
// organization the agent then acts in. The showcase's
// external datasource names a cwd-relative SQLite file, and every dogfood file
// runs in its own temporary working directory (`per-file-cwd.setup.ts`), so the
// remote tables `onEnable` provisions here are this file's own. The
// datasource's package is read-only, so an import lands in its customization
// package, which under a wall only the platform operator creates: the operator
// ensures it first, so a refusal below is the wall's and never the landing's.

import { createHash, randomBytes } from 'node:crypto';
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
const REFRESH_PATH = `/datasources/${DATASOURCE}/external/refresh-catalog`;
/** The `external_catalog` item a refresh of the datasource stores (`<datasource>_catalog`). */
const CATALOG = `${DATASOURCE}_catalog`;

/** A runtime-authored set carrying both federation capabilities. */
const IMPORTER_SET = 'federation_importer';
const IMPORTER_CAPABILITIES = ['manage_metadata', 'manage_platform_settings'];

/** The operator's dev credentials and A's password. */
const OPERATOR = { email: 'admin@objectos.ai', password: 'admin123' };
const PASSWORD_A = 'Fed-Import-Pass-123';

/** An agent that may author metadata and holds its user's system capabilities. */
const AGENT_SCOPE = 'openid profile email offline_access metadata:write actions:execute';
const REDIRECT_URI = 'http://127.0.0.1:33419/callback';

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
  /** OAuth access tokens for the MCP door, scoped {@link AGENT_SCOPE}. */
  agentOperator: string;
  agentA: string;
}

/**
 * A real OAuth access token for the MCP resource: DCR, a password sign-in, the
 * organization made active on that session when one is named (the consent binds
 * the session's active organization), authorize, consent, token.
 */
async function mintAgentToken(
  stack: VerifyStack,
  who: { email: string; password: string },
  organizationSlug?: string,
): Promise<string> {
  const authSvc: any = await stack.kernel.getServiceAsync('auth');
  const resource = authSvc.getMcpResourceUrl();
  const reg = await stack.api('/auth/oauth2/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'federation import probe', redirect_uris: [REDIRECT_URI], grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: 'none', application_type: 'native', scope: AGENT_SCOPE,
    }),
  });
  const regBody: any = await reg.json();
  expect(reg.status, JSON.stringify(regBody)).toBe(201);
  const signin = await stack.api('/auth/sign-in/email', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(who),
  });
  expect(signin.status, await signin.clone().text()).toBe(200);
  const cookie = ((signin.headers as any).getSetCookie() as string[]).map((c) => c.split(';')[0]).join('; ');
  if (organizationSlug) {
    const active = await stack.api('/auth/organization/set-active', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost:3000' },
      body: JSON.stringify({ organizationSlug }),
    });
    expect(active.status, await active.clone().text()).toBe(200);
  }
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const qs = new URLSearchParams({
    client_id: regBody.client_id, redirect_uri: REDIRECT_URI, response_type: 'code', scope: AGENT_SCOPE, state: 'st',
    code_challenge: challenge, code_challenge_method: 'S256', resource,
  });
  const az = await stack.api(`/auth/oauth2/authorize?${qs}`, { headers: { cookie }, redirect: 'manual' });
  const loc = az.headers.get('location') ?? '';
  let code = new URL(loc, 'http://localhost:3000').searchParams.get('code');
  if (!code) {
    const consent = await stack.api('/auth/oauth2/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost:3000' },
      body: JSON.stringify({ accept: true, oauth_query: loc.slice(loc.indexOf('?')) }),
    });
    const cb: any = await consent.json().catch(() => null);
    code = new URL(cb?.redirect_uri ?? cb?.url).searchParams.get('code');
  }
  const tok = await stack.api('/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: code!, redirect_uri: REDIRECT_URI, client_id: regBody.client_id, code_verifier: verifier, resource,
    }).toString(),
  });
  const tj: any = await tok.json();
  expect(tok.status, JSON.stringify(tj)).toBe(200);
  return String(tj.access_token);
}

async function boot(posture: 'group' | 'single'): Promise<Harness> {
  const walled = posture !== 'single';
  if (walled) process.env.OS_TENANCY_POSTURE = posture;
  else delete process.env.OS_TENANCY_POSTURE;
  // The OAuth authorization server the MCP door's access tokens come from.
  process.env.OS_OIDC_PROVIDER_ENABLED = 'true';
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
  const tokA = await stack.signUp(email, PASSWORD_A);
  const h: Harness = { stack, ql, operator, tokA, userA: '', agentOperator: '', agentA: '' };
  const slug = `fed-import-a-${posture}`;
  if (walled) {
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
  h.agentOperator = await mintAgentToken(stack, OPERATOR);
  h.agentA = await mintAgentToken(stack, { email, password: PASSWORD_A }, walled ? slug : undefined);
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
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  expect(parsed, `the tool result is a JSON envelope: ${text}`).toBeTypeOf('object');
  return { isError: rpc.result?.isError === true, error: parsed?.error, object: parsed?.object };
}

/** The process environment this file sets, read before a boot and put back after it. */
const ENV_KEYS = ['OS_TENANCY_POSTURE', 'OS_OIDC_PROVIDER_ENABLED'] as const;
const snapshotEnv = () => Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<string, string | undefined>;
function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
}

/** The catalog refresh's answer: status, `error.code`, `error.message` and the snapshot when one came back. */
async function refreshOverRest(h: Harness, token: string) {
  const res = await h.stack.apiAs(token, 'POST', REFRESH_PATH, {});
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, code: json?.error?.code, message: String(json?.error?.message ?? ''), data: json?.data, json };
}

/** Whether the datasource's catalog snapshot is stored: in the metadata registry, and as a `sys_metadata` row. */
async function catalogStored(h: Harness): Promise<{ registry: boolean; rows: number }> {
  const metadata: any = await h.stack.kernel.getServiceAsync('metadata');
  const item = await metadata.get('external_catalog', CATALOG);
  const found: any = await h.ql.find('sys_metadata', { where: { type: 'external_catalog', name: CATALOG }, context: SYS });
  const rows = Array.isArray(found) ? found : Array.isArray(found?.records) ? found.records : [];
  return { registry: item !== undefined && item !== null, rows: rows.length };
}

/** What the platform operator reads at `GET /meta/object/:name`. */
async function storedStatus(h: Harness, name: string): Promise<number> {
  return (await h.stack.apiAs(h.operator, 'GET', `/meta/object/${name}`)).status;
}

describe('[ADR-0131 D12 items 7–8] group: an import and a catalog refresh are writes to the environment\'s catalog, and they are the platform operator\'s at every door', () => {
  let h: Harness;
  const previous = snapshotEnv();

  beforeAll(async () => { h = await boot('group'); }, 180_000);
  afterAll(async () => {
    await h?.stack?.stop?.();
    restoreEnv(previous);
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
    const imported = await importOverMcp(h, h.agentA, 'customers', name);
    expect(imported.isError, JSON.stringify(imported)).toBe(true);
    expect({ code: imported.error?.code, status: imported.error?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(imported.error?.message).toBe(rest.message);
    expect(imported.object).toBeUndefined();
    expect(await storedStatus(h, name)).toBe(404);
  });

  it('REST: A\'s catalog refresh is refused with the save door\'s status and sentence for an external catalog, and nothing is stored', async () => {
    expect(await catalogStored(h), 'no snapshot is stored before the refresh').toEqual({ registry: false, rows: 0 });

    const refreshed = await refreshOverRest(h, h.tokA);
    expect({ status: refreshed.status, code: refreshed.code }, JSON.stringify(refreshed.json)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    expect(refreshed.message).toContain('\'group\' tenancy posture');
    expect(refreshed.message).toContain('ADR-0131 D3, D12 items 7–8, D11');
    expect(refreshed.data, 'a refused refresh answers no snapshot').toBeUndefined();

    // The metadata save door refuses A the same item with the same status and
    // the same sentence: one verdict.
    const savedByA = await h.stack.apiAs(h.tokA, 'PUT', `/meta/external_catalog/${CATALOG}`, {
      name: CATALOG, datasource: DATASOURCE, snapshotAt: new Date().toISOString(), tables: [],
    });
    const saveBody: any = await savedByA.json().catch(() => ({}));
    expect(savedByA.status, JSON.stringify(saveBody)).toBe(refreshed.status);
    expect(saveBody?.error?.message).toBe(refreshed.message);

    expect(await catalogStored(h)).toEqual({ registry: false, rows: 0 });
  });

  it('control: the platform operator refreshes the catalog under the same wall, and the snapshot is stored', async () => {
    const refreshed = await refreshOverRest(h, h.operator);
    expect(refreshed.status, JSON.stringify(refreshed.json)).toBe(200);
    expect(refreshed.data?.catalog?.name).toBe(CATALOG);
    expect(await catalogStored(h)).toEqual({ registry: true, rows: 1 });
  });

  it('control: the platform operator imports at both doors under the same wall, and each object is saved', async () => {
    const restName = 'showcase_custom_wall_op_rest';
    const rest = await importOverRest(h, h.operator, 'customers', restName);
    expect(rest.status, JSON.stringify(rest.json)).toBe(201);
    expect(rest.data?.object?.name).toBe(restName);
    expect(await storedStatus(h, restName)).toBe(200);

    const mcpName = 'showcase_custom_wall_op_mcp';
    const mcp = await importOverMcp(h, h.agentOperator, 'orders', mcpName);
    expect(mcp.isError, JSON.stringify(mcp)).toBe(false);
    expect(mcp.object?.name).toBe(mcpName);
    expect(await storedStatus(h, mcpName)).toBe(200);
  });
});

describe('[ADR-0131 D11] single: the wall is not enforced, and an administrator below the platform operator imports at both doors and refreshes the catalog as before', () => {
  let h: Harness;
  const previous = snapshotEnv();

  beforeAll(async () => { h = await boot('single'); }, 180_000);
  afterAll(async () => {
    await h?.stack?.stop?.();
    restoreEnv(previous);
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
    const mcp = await importOverMcp(h, h.agentA, 'orders', mcpName);
    expect(mcp.isError, JSON.stringify(mcp)).toBe(false);
    expect(mcp.object?.name).toBe(mcpName);
    expect(await storedStatus(h, mcpName)).toBe(200);
  });

  it('control: A refreshes the catalog, and the snapshot is stored', async () => {
    const refreshed = await refreshOverRest(h, h.tokA);
    expect(refreshed.status, JSON.stringify(refreshed.json)).toBe(200);
    expect(refreshed.data?.catalog?.name).toBe(CATALOG);
    expect(await catalogStored(h)).toEqual({ registry: true, rows: 1 });
  });
});
