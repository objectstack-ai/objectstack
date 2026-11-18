// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34766] The open MCP draft door's admission, its three read tools, its two
 * draft writes, and the publish verdict a save and each listed draft answer with.
 *
 * The effective right is the intersection of the token's consent
 * (`metadata:write`) and the HUMAN's own `manage_metadata` (seat ruling D1 A).
 * The four cells of that intersection are pinned through the real `/mcp`
 * domain (`handleMcpRequest`), with the OAuth envelopes resolved by the real
 * identity door (`resolveExecutionContext`), never written by hand: what an
 * agent's envelope carries is that door's derivation, and it carries no system
 * permission under a `metadata:write`-only grant. The MCP service is a double
 * that records what `handleHttpRequest` is handed; the MCP package's own pins
 * (`mcp-server-runtime.authoring-scope.test.ts`) hold that an injected
 * registry's `getAll()` is exactly what `tools/list` serves under
 * `metadata:write`, and nothing under any other grant.
 *
 * Fail closed: an envelope with no user is injected nothing, and a grant
 * resolution that throws admits nothing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  SysMetadataObject,
  SysMetadataHistoryObject,
  SysMetadataAuditObject,
  SysMetadataCommitObject,
} from '@objectstack/metadata-core';
// The `/mcp` domain reaches the dispatcher, which loads this package lazily;
// paid here, during collection, never inside a clocked case.
import '@objectstack/metadata';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import { PLATFORM_PROVIDED_TOOL_NAMES, PLATFORM_TOOL_FAMILY_PREFIXES } from '@objectstack/spec/system';
import { handleMcpRequest } from './mcp.js';
import {
  OPEN_AUTHORING_READ_TOOL_NAMES,
  OPEN_AUTHORING_WRITE_TOOL_NAMES,
  createOpenAuthoringRegistry,
  resolveOpenAuthoringInjection,
  type OpenAuthoringInjection,
  type OpenAuthoringProtocol,
  type OpenAuthoringReadGateSources,
} from './mcp-authoring.js';
import { resolveExecutionContext } from '../security/resolve-execution-context.js';
import { bindCatalogFromTables } from '../security/security-catalog.testkit.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A data engine whose user `u1` holds one permission set carrying `systemPermissions`. */
function userQl(systemPermissions: string[]) {
  const reads: string[] = [];
  const tables: Record<string, any[]> = {
    sys_member: [{ user_id: 'u1', organization_id: 'orgA', role: 'owner' }],
    sys_organization: [{ id: 'org_default', slug: 'default' }],
    sys_user_permission_set: [{ id: 'ups1', user_id: 'u1', permission_set_id: 'ps_admin', permission_set: 'admin_full_access', organization_id: 'org_default' }],
    sys_permission_set: [{ id: 'ps_admin', name: 'admin_full_access', system_permissions: JSON.stringify(systemPermissions), object_permissions: '{}' }],
    sys_position: [], sys_position_permission_set: [], sys_user_position: [],
  };
  const ql = bindCatalogFromTables({
    async find(object: string, opts: any) {
      reads.push(object);
      const rows = (tables[object] ?? []).filter((row) =>
        Object.entries(opts?.where ?? {}).every(([k, v]) =>
          v !== null && typeof v === 'object'
            ? (Array.isArray((v as any).$in) ? (v as any).$in.includes(row[k]) : true)
            : (v ?? null) === (row[k] ?? null),
        ),
      );
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
  }, tables);
  return { ql, reads };
}

/** The envelope the real `/mcp` identity door resolves for an OAuth token with these scopes. */
async function oauthEnvelope(scopes: string[], systemPermissions: string[]) {
  return resolveExecutionContext({
    acceptOAuthAccessToken: true,
    getService: async (name: string) =>
      name === 'auth' ? { verifyMcpAccessToken: async () => ({ userId: 'u1', scopes, clientId: 'c1' }) } : undefined,
    getQl: async () => userQl(systemPermissions).ql,
    request: { headers: { authorization: 'Bearer a.b.c' } },
  } as never);
}

const ADMIN = ['manage_metadata', 'manage_users'];

/** One publish finding, every member the publish 422 carries. */
const UNROUTABLE_ISSUE = {
  rule: 'flow-trigger-unroutable',
  path: 'flows[0].nodes[0].config.triggerType',
  where: 'flow "lead_intake" › start node',
  message: 'declares type: \'record_change\' but its start node has no triggerType at all',
  hint: 'Set triggerType to record-{before,after}-{create,update,delete,write}',
  severity: 'error' as const,
};
const NOT_AN_AUTHOR = ['manage_users'];

/**
 * `store` serves the gated types' items by type (a list read, and a by-name
 * read of one of them); every other type answers the flow fixtures. Both reads
 * FOLD the requested type first, as the real protocol's reads do
 * (`canonicalizeMetaRequestType`, over `canonicalMetaUrlType`), so a plural
 * reads the gated type here as it does there; `calls` records the request as
 * the door handed it, unfolded.
 */
function fakeProtocol(store: Record<string, any[]> = {}, opts: { listThrows?: string } = {}) {
  const calls: unknown[] = [];
  const protocol: OpenAuthoringProtocol = {
    // The live type set the unknown-type refusal reads: without it the refusal
    // cannot disprove a type and lets it through.
    async getMetaTypes() {
      return { types: ['object', 'flow', 'view', 'dashboard', 'book', 'doc', 'datasource'] } as any;
    },
    async getMetaItems(handed: any) {
      calls.push(['getMetaItems', handed]);
      const request = { ...handed, type: canonicalMetaUrlType(handed.type) };
      if (opts.listThrows === request.type) throw new Error(`the ${request.type} list read failed`);
      if (store[request.type]) return { type: request.type, items: store[request.type] };
      return {
        type: request.type,
        items: [
          { name: 'lead_intake', label: 'Lead intake', _packageId: 'com.acme.crm', _draft: true, nodes: [] },
          { name: 'close_won', label: 'Close won', nodes: [] },
        ],
      };
    },
    async getMetaItem(handed: any) {
      calls.push(['getMetaItem', handed]);
      const request = { ...handed, type: canonicalMetaUrlType(handed.type) };
      if (store[request.type]) {
        const item = store[request.type].find((it) => it.name === request.name);
        return { type: request.type, name: request.name, item };
      }
      if (request.name === 'missing') return { type: request.type, name: request.name, item: undefined };
      return { type: request.type, name: request.name, version: 'v7', item: { name: request.name, label: 'Lead intake', _draft: true } };
    },
    async listDrafts(request: any) {
      calls.push(['listDrafts', request]);
      return { drafts: [{ type: 'flow', name: 'lead_intake', label: 'Lead intake', packageId: 'com.acme.crm', updatedAt: null }] } as any;
    },
    async saveMetaItem(request: any) {
      calls.push(['saveMetaItem', request]);
      return { success: true, version: 'v8', seq: 1, state: 'draft' } as any;
    },
    async deleteMetaItem(request: any) {
      calls.push(['deleteMetaItem', request]);
      return { success: true } as any;
    },
    async draftPublishJudgement(draft: any) {
      calls.push(['draftPublishJudgement', draft]);
      return { refusals: [UNROUTABLE_ISSUE], advisories: [] };
    },
  };
  return { protocol, calls };
}

interface Served {
  status: number;
  authoring: OpenAuthoringInjection | undefined;
  /** Whether `handleHttpRequest` was handed an `authoring` member at all. */
  carried: boolean;
  grantReads: string[];
  protocolCalls: unknown[];
  warnings: unknown[][];
}

/**
 * One `/mcp` request through the real domain. `qlThrows` makes the grant
 * resolution's data-engine lookup throw.
 */
async function serve(
  executionContext: unknown,
  opts: {
    systemPermissions?: string[]; qlThrows?: boolean; store?: Record<string, any[]>; listThrows?: string;
    /** A protocol to serve in place of the recording double (the real one, for the end-to-end pin). */
    protocol?: OpenAuthoringProtocol;
    /** The `tenancy` service the walled refusal reads its posture from. */
    tenancy?: { posture: string };
  } = {},
): Promise<Served> {
  const { ql, reads } = userQl(opts.systemPermissions ?? ADMIN);
  const fake = fakeProtocol(opts.store, { listThrows: opts.listThrows });
  const protocol = opts.protocol ?? fake.protocol;
  const calls = fake.calls;
  // The holdings the docs audience reads: the permission sets on the caller the
  // gate is handed, so a set the human does not hold is not held.
  const security = { resolvePermissionSetNames: async (ctx: any) => (Array.isArray(ctx?.permissions) ? ctx.permissions : []) };
  const warnings: unknown[][] = [];
  let handed: any;
  const mcp = {
    async handleHttpRequest(_request: Request, handedOpts: any) {
      handed = handedOpts;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  const deps = {
    resolveService: async (_ctx: unknown, name: string) => (name === 'mcp' ? mcp : name === 'protocol' ? protocol : name === 'security' ? security : undefined),
    resolveServiceOrLoud: async (_ctx: unknown, name: string) => (name === 'tenancy' ? opts.tenancy : undefined),
    getObjectQL: async () => {
      if (opts.qlThrows) throw new Error('engine lookup failed');
      return ql;
    },
    error: (message: string, status: number) => ({ status, body: { success: false, error: { message } } }),
    errorFromThrown: (e: any, status: number) => ({ status, body: { success: false, error: { message: String(e?.message ?? e) } } }),
    logger: { warn: (...args: unknown[]) => { warnings.push(args); }, debug: () => {}, info: () => {}, error: () => {} },
  };
  const context = {
    environmentId: 'env_1',
    executionContext,
    request: { method: 'POST', url: '/api/v1/mcp', headers: { 'content-type': 'application/json' } },
  };
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  const result: any = await handleMcpRequest(deps as never, body, context as never);
  // The grant reads the door itself made (the envelope above was resolved elsewhere).
  return {
    status: result.response.status,
    authoring: handed?.authoring,
    carried: handed !== undefined && 'authoring' in handed,
    grantReads: reads,
    protocolCalls: calls,
    warnings,
  };
}

const CONTEXT = { door: 'mcp' as const, principal: { userId: 'u1' }, environmentId: 'env_1' };

/**
 * The read gates' ports for a registry built by hand: an author caller, no
 * security service, the protocol's own list read. The door builds its own from
 * the human's grants (pinned below, through the real domain).
 */
const AUTHOR_READ_GATE: OpenAuthoringReadGateSources = (protocol) => ({
  resolveCaller: async () => ({ userId: 'u1', systemPermissions: ADMIN, mayWriteItem: true }),
  resolveSecurityService: async () => undefined,
  listMetaItems: (type) => protocol.getMetaItems?.({ type }),
  serviceProbe: () => null,
  navPruneLogged: new Set<string>(),
});

async function call(authoring: OpenAuthoringInjection, toolName: string, input: unknown, context: any = CONTEXT) {
  const result = await authoring.registry.execute({ toolCallId: `t-${toolName}`, toolName, input }, context);
  return { isError: result.isError === true, body: JSON.parse(result.output.value) };
}

// ---------------------------------------------------------------------------
// The four cells
// ---------------------------------------------------------------------------

describe('the open draft door is served only where the token consents AND the user holds manage_metadata', () => {
  it('a token without metadata:write is handed no authoring registry, and the user\'s grant is never read', async () => {
    const ec = await oauthEnvelope(['data:read', 'data:write'], ADMIN);
    expect(ec.oauthScopes).toEqual(['data:read', 'data:write']);
    const served = await serve(ec);
    expect(served.status).toBe(200);
    expect(served.carried).toBe(false);
    expect(served.grantReads).toEqual([]);
  });

  it('a metadata:write token whose user lacks manage_metadata lists no tool, and a call is refused 403 before any read', async () => {
    const ec = await oauthEnvelope(['metadata:write'], NOT_AN_AUTHOR);
    const served = await serve(ec, { systemPermissions: NOT_AN_AUTHOR });
    expect(served.status).toBe(200);
    expect(served.authoring).toBeDefined();
    // The MCP runtime registers exactly `getAll()`: nothing, so `tools/list` omits the family.
    expect(served.authoring!.registry.getAll()).toEqual([]);
    const refused = await call(served.authoring!, 'list_metadata_items', { type: 'flow' });
    expect(refused.isError).toBe(true);
    expect(refused.body.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(served.protocolCalls).toEqual([]);
  });

  it('a metadata:write token whose user holds manage_metadata lists the five tools, and a read is served', async () => {
    const ec = await oauthEnvelope(['metadata:write'], ADMIN);
    // The envelope itself carries no capability: the door read the human's grant.
    expect(ec.systemPermissions).toEqual([]);
    const served = await serve(ec);
    expect(served.grantReads.length).toBeGreaterThan(0);
    const authoring = served.authoring!;
    expect(authoring.registry.getAll().map((t) => t.name)).toEqual([...OPEN_AUTHORING_READ_TOOL_NAMES, ...OPEN_AUTHORING_WRITE_TOOL_NAMES]);
    expect(authoring.principal).toMatchObject({ userId: 'u1', clientId: 'c1', scopes: ['metadata:write'] });
    expect(authoring.environmentId).toBe('env_1');

    const listed = await call(authoring, 'list_metadata_items', { type: 'flow' });
    expect(listed.isError).toBe(false);
    expect(listed.body).toEqual({
      type: 'flow',
      count: 2,
      items: [
        { name: 'lead_intake', label: 'Lead intake', packageId: 'com.acme.crm', draft: true },
        { name: 'close_won', label: 'Close won', packageId: null, draft: false },
      ],
    });
    expect(served.protocolCalls).toEqual([['getMetaItems', { type: 'flow', previewDrafts: true }]]);
  });

  it('an API key is handed no authoring registry', async () => {
    // An API key's envelope carries no grant (`oauthScopes` undefined); the
    // capability on it changes nothing, since the family needs the token's consent.
    const served = await serve({ userId: 'u1', principalKind: 'human', systemPermissions: ADMIN });
    expect(served.status).toBe(200);
    expect(served.carried).toBe(false);
    expect(served.grantReads).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fail closed
// ---------------------------------------------------------------------------

describe('the open draft door fails closed', () => {
  it('an envelope with no user is injected nothing, and no grant is read', async () => {
    let lookedUp = false;
    const deps = {
      resolveService: async () => undefined,
      getObjectQL: async () => { lookedUp = true; return userQl(ADMIN).ql; },
    };
    const injection = await resolveOpenAuthoringInjection(
      deps as never,
      { environmentId: 'env_1', executionContext: { oauthScopes: ['metadata:write'], systemPermissions: ADMIN } } as never,
      ['metadata:write'],
    );
    expect(injection).toBeUndefined();
    expect(lookedUp).toBe(false);
  });

  it('a grant resolution that throws admits nothing: no tool is listed, a call is refused, and the request is still served', async () => {
    const ec = await oauthEnvelope(['metadata:write'], ADMIN);
    const served = await serve(ec, { qlThrows: true });
    expect(served.status).toBe(200);
    expect(served.authoring!.registry.getAll()).toEqual([]);
    const refused = await call(served.authoring!, 'get_metadata_item', { type: 'flow', name: 'lead_intake' });
    expect(refused.body.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(served.protocolCalls).toEqual([]);
    expect(served.warnings.length).toBe(1);
  });

  it('a call stamped with another user than the one admitted is refused', async () => {
    const { protocol, calls } = fakeProtocol();
    const registry = createOpenAuthoringRegistry({ admitted: true, userId: 'u1', getProtocol: async () => protocol });
    const result = await registry.execute(
      { toolCallId: 't', toolName: 'list_drafts', input: {} },
      { door: 'mcp', principal: { userId: 'u2' } },
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.output.value).error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The read tools
// ---------------------------------------------------------------------------

describe('the read tools answer from the metadata protocol\'s public reads', () => {
  const admitted = () => {
    const { protocol, calls } = fakeProtocol();
    const authoring: OpenAuthoringInjection = {
      registry: createOpenAuthoringRegistry({ admitted: true, userId: 'u1', getProtocol: async () => protocol, readGate: AUTHOR_READ_GATE }),
      principal: { userId: 'u1', scopes: ['metadata:write'] },
    };
    return { authoring, calls };
  };

  it('list_metadata_items with state active reads the published items only; with state draft keeps the drafts only', async () => {
    const { authoring, calls } = admitted();
    await call(authoring, 'list_metadata_items', { type: 'flow', state: 'active' });
    const drafts = await call(authoring, 'list_metadata_items', { type: 'flow', state: 'draft' });
    expect(calls).toEqual([
      ['getMetaItems', { type: 'flow' }],
      ['getMetaItems', { type: 'flow', previewDrafts: true }],
    ]);
    expect(drafts.body.items.map((i: any) => i.name)).toEqual(['lead_intake']);
  });

  it('list_metadata_items refuses a type the platform does not declare, as the /meta list does', async () => {
    const { authoring } = admitted();
    const refused = await call(authoring, 'list_metadata_items', { type: 'no_such_type' });
    expect(refused.isError).toBe(true);
    expect(refused.body.error).toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
  });

  it('an inherited member\'s name, which the fold answers no string for, reaches the protocol as the string sent', async () => {
    const { authoring, calls } = admitted();
    await call(authoring, 'list_metadata_items', { type: 'constructor', state: 'active' });
    await call(authoring, 'get_metadata_item', { type: 'toString', name: 'lead_intake', state: 'active' });
    expect(calls).toEqual([
      ['getMetaItems', { type: 'constructor' }],
      ['getMetaItem', { type: 'toString', name: 'lead_intake' }],
    ]);
  });

  it('get_metadata_item reads a draft in place of the published version by default, and the draft only on state draft', async () => {
    const { authoring, calls } = admitted();
    const read = await call(authoring, 'get_metadata_item', { type: 'flow', name: 'lead_intake' });
    expect(read.body).toEqual({
      type: 'flow', name: 'lead_intake', draft: true, version: 'v7',
      item: { name: 'lead_intake', label: 'Lead intake', _draft: true },
    });
    await call(authoring, 'get_metadata_item', { type: 'flow', name: 'lead_intake', state: 'draft' });
    await call(authoring, 'get_metadata_item', { type: 'flow', name: 'lead_intake', state: 'active' });
    expect(calls).toEqual([
      ['getMetaItem', { type: 'flow', name: 'lead_intake', previewDrafts: true }],
      ['getMetaItem', { type: 'flow', name: 'lead_intake', state: 'draft' }],
      ['getMetaItem', { type: 'flow', name: 'lead_intake' }],
    ]);
  });

  it('get_metadata_item answers 404 for an item the protocol does not have', async () => {
    const { authoring } = admitted();
    const missing = await call(authoring, 'get_metadata_item', { type: 'flow', name: 'missing' });
    expect(missing.body.error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
  });

  it('list_drafts passes the package through as the protocol\'s packageId', async () => {
    const { authoring, calls } = admitted();
    const listed = await call(authoring, 'list_drafts', { package: 'com.acme.crm' });
    await call(authoring, 'list_drafts', {});
    expect(listed.body.count).toBe(1);
    expect(calls.filter((c: any) => c[0] === 'listDrafts')).toEqual([['listDrafts', { packageId: 'com.acme.crm' }], ['listDrafts', {}]]);
  });

  it('a coded protocol refusal keeps its code; an uncoded throw is a fault answered without its text', async () => {
    const coded = Object.assign(new Error('No pending draft for flow lead_intake.'), { code: 'RESOURCE_NOT_FOUND', status: 404 });
    const registry = (thrown: unknown) => createOpenAuthoringRegistry({
      admitted: true,
      userId: 'u1',
      getProtocol: async () => ({ getMetaItem: async () => { throw thrown; } }),
      readGate: AUTHOR_READ_GATE,
      logger: { warn: () => {} },
    });
    const run = async (thrown: unknown) => JSON.parse((await registry(thrown).execute(
      { toolCallId: 't', toolName: 'get_metadata_item', input: { type: 'flow', name: 'lead_intake', state: 'draft' } },
      CONTEXT,
    )).output.value).error;
    expect(await run(coded)).toEqual({ code: 'RESOURCE_NOT_FOUND', status: 404, message: 'No pending draft for flow lead_intake.' });
    expect(await run(new Error('connection reset by peer'))).toEqual({ code: 'INTERNAL_ERROR', status: 500, message: 'Reading the metadata failed.' });
  });
});

// ---------------------------------------------------------------------------
// The /meta read gates, with the human as the caller
// ---------------------------------------------------------------------------

describe('the read tools withhold what every /meta door withholds from this human (not whole-for-author)', () => {
  // The human holds `manage_metadata` and `manage_users` through the set
  // `admin_full_access`, and not `crm_admin` nor `finance.access`.
  const STORE = {
    dashboard: [
      { name: 'finance_board', label: 'Finance', requiredPermissions: ['finance.access'], widgets: [] },
      // Held by the human and by no envelope: served only if the gate read the human.
      { name: 'people_board', label: 'People', requiredPermissions: ['manage_users'], widgets: [] },
    ],
    book: [
      { name: 'admin_guide', label: 'Admin Guide', audience: { permissionSet: 'crm_admin' }, groups: [{ key: 'admin', label: 'Admin', include: 'crm_admin_*' }] },
      { name: 'help_center', label: 'Help Centre', audience: 'org', groups: [{ key: 'start', label: 'Start', include: 'crm_intro' }] },
    ],
    doc: [
      { name: 'crm_intro', label: 'Getting started', content: 'Welcome aboard.' },
      { name: 'crm_admin_runbook', label: 'Admin runbook', content: 'Rotate the signing keys.' },
    ],
  };
  const author = async (opts: { listThrows?: string } = {}) => {
    const ec = await oauthEnvelope(['metadata:write'], ADMIN);
    expect(ec.systemPermissions).toEqual([]);
    const served = await serve(ec, { store: STORE, ...opts });
    return served.authoring!;
  };

  it('a dashboard whose requiredPermissions the human lacks is refused 403 and not listed; one they hold is served', async () => {
    const authoring = await author();
    const refused = await call(authoring, 'get_metadata_item', { type: 'dashboard', name: 'finance_board' });
    expect(refused.isError).toBe(true);
    expect(refused.body.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(JSON.stringify(refused.body)).not.toContain('finance.access');

    const allowed = await call(authoring, 'get_metadata_item', { type: 'dashboard', name: 'people_board' });
    expect(allowed.isError).toBe(false);
    expect(allowed.body.item).toMatchObject({ name: 'people_board' });

    const listed = await call(authoring, 'list_metadata_items', { type: 'dashboard' });
    expect(listed.body.items.map((i: any) => i.name)).toEqual(['people_board']);
  });

  it('a doc outside the human\'s audience is refused 403 and not listed; an org doc is served', async () => {
    const authoring = await author();
    const refused = await call(authoring, 'get_metadata_item', { type: 'doc', name: 'crm_admin_runbook' });
    expect(refused.isError).toBe(true);
    expect(refused.body.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(JSON.stringify(refused.body)).not.toContain('Rotate the signing keys.');

    const allowed = await call(authoring, 'get_metadata_item', { type: 'doc', name: 'crm_intro' });
    expect(allowed.isError).toBe(false);
    expect(allowed.body.item).toMatchObject({ name: 'crm_intro', content: 'Welcome aboard.' });

    const listed = await call(authoring, 'list_metadata_items', { type: 'doc' });
    expect(listed.body.items.map((i: any) => i.name)).toEqual(['crm_intro']);
  });

  it('a plural spelling is folded at the door: `dashboards` and `docs` are refused on the item read and left out of the list', async () => {
    const authoring = await author();
    for (const [type, name, secret] of [
      ['dashboards', 'finance_board', 'finance.access'],
      ['docs', 'crm_admin_runbook', 'Rotate the signing keys.'],
    ] as const) {
      const refused = await call(authoring, 'get_metadata_item', { type, name });
      expect(refused.isError, type).toBe(true);
      expect(refused.body.error, type).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      expect(JSON.stringify(refused.body), type).not.toContain(secret);
    }
    // Served under the plural too, so the refusals above are the gates' verdicts, not a miss.
    const allowed = await call(authoring, 'get_metadata_item', { type: 'dashboards', name: 'people_board' });
    expect(allowed.body).toMatchObject({ type: 'dashboard', item: { name: 'people_board' } });

    const dashboards = await call(authoring, 'list_metadata_items', { type: 'dashboards' });
    expect(dashboards.body).toMatchObject({ type: 'dashboard', items: [{ name: 'people_board' }] });
    expect(dashboards.body.count).toBe(1);
    const docs = await call(authoring, 'list_metadata_items', { type: 'docs' });
    expect(docs.body.items.map((i: any) => i.name)).toEqual(['crm_intro']);
  });

  it('the door hands the protocol the folded type, the one the gates judged', async () => {
    const ec = await oauthEnvelope(['metadata:write'], ADMIN);
    const served = await serve(ec, { store: STORE });
    await call(served.authoring!, 'list_metadata_items', { type: 'docs', state: 'active' });
    await call(served.authoring!, 'get_metadata_item', { type: 'dashboards', name: 'people_board', state: 'active' });
    expect(served.protocolCalls).toEqual(expect.arrayContaining([
      ['getMetaItems', { type: 'doc' }],
      ['getMetaItem', { type: 'dashboard', name: 'people_board' }],
    ]));
    expect(served.protocolCalls.some((c: any) => c[1]?.type === 'docs' || c[1]?.type === 'dashboards')).toBe(false);
  });

  it('a type the caller may not read is refused on item and list reads, on every state, before any protocol read', async () => {
    const store = { ...STORE, datasource: [{ name: 'warehouse', label: 'Warehouse', driver: 'postgres' }] };
    const ec = await oauthEnvelope(['metadata:write'], ADMIN);
    const served = await serve(ec, { store });
    const authoring = served.authoring!;
    for (const state of [undefined, 'active', 'draft'] as const) {
      for (const [toolName, input] of [
        ['get_metadata_item', { type: 'datasource', name: 'warehouse' }],
        ['get_metadata_item', { type: 'datasources', name: 'warehouse' }],
        ['get_metadata_item', { type: 'datasource', name: 'missing' }],
        ['list_metadata_items', { type: 'datasource' }],
      ] as const) {
        const refused = await call(authoring, toolName, { ...input, ...(state ? { state } : {}) });
        const label = `${toolName} ${JSON.stringify(input)} ${state ?? '(default)'}`;
        expect(refused.isError, label).toBe(true);
        expect(refused.body.error, label).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(JSON.stringify(refused.body), label).not.toContain('postgres');
      }
    }
    expect(served.protocolCalls).toEqual([]);

    // The control: a human who holds the type's capability is served the same reads.
    const holder = [...ADMIN, 'manage_platform_settings'];
    const allowed = (await serve(await oauthEnvelope(['metadata:write'], holder), { store, systemPermissions: holder })).authoring!;
    expect((await call(allowed, 'get_metadata_item', { type: 'datasource', name: 'warehouse' })).body.item).toMatchObject({ name: 'warehouse' });
    expect((await call(allowed, 'list_metadata_items', { type: 'datasources' })).body.items.map((i: any) => i.name)).toEqual(['warehouse']);
  });

  it('a gate that cannot evaluate refuses: a books read that throws serves no doc', async () => {
    const authoring = await author({ listThrows: 'book' });
    const refused = await call(authoring, 'get_metadata_item', { type: 'doc', name: 'crm_intro' });
    expect(refused.isError).toBe(true);
    expect(refused.body.error).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
    expect(JSON.stringify(refused.body)).not.toContain('Welcome aboard.');
  });

  it('a registry handed no read gate reads nothing', async () => {
    const { protocol, calls } = fakeProtocol();
    const registry = createOpenAuthoringRegistry({ admitted: true, userId: 'u1', getProtocol: async () => protocol });
    const result = await registry.execute({ toolCallId: 't', toolName: 'get_metadata_item', input: { type: 'flow', name: 'lead_intake' } }, CONTEXT);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.output.value).error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(calls).toEqual([]);
  });
});

describe('the tools\' names', () => {
  it('collide with no hosted platform tool (seat ruling D3: not list_metadata)', () => {
    for (const name of [...OPEN_AUTHORING_READ_TOOL_NAMES, ...OPEN_AUTHORING_WRITE_TOOL_NAMES]) {
      expect(PLATFORM_PROVIDED_TOOL_NAMES.has(name), name).toBe(false);
      expect(PLATFORM_TOOL_FAMILY_PREFIXES.some((prefix) => name.startsWith(prefix)), name).toBe(false);
    }
    expect(PLATFORM_PROVIDED_TOOL_NAMES.has('list_metadata')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The draft writes, and the publish verdict each answers with
// ---------------------------------------------------------------------------

const FLOW_DRAFT = { name: 'lead_intake', label: 'Lead intake', type: 'record_change', nodes: [], edges: [] };

/**
 * An admitted author's injection through the real domain, over `protocol` (the
 * recording double by default). The fixture's user holds `admin_full_access`,
 * which a single-posture resolution anchors as the platform operator; `posture`
 * replaces that rung, as a walled deployment's resolution would not grant it.
 */
async function authorThroughDomain(opts: Parameters<typeof serve>[1] & { posture?: string } = {}) {
  const resolved = await oauthEnvelope(['metadata:write'], ADMIN);
  const ec = opts.posture ? { ...resolved, posture: opts.posture } : resolved;
  const served = await serve(ec, opts);
  return { authoring: served.authoring!, served };
}

describe('save_metadata_draft saves a draft and answers with its publish verdict', () => {
  it('saves through saveMetaItem as an mcp draft by the token\'s client, and the reply carries the verdict whole and the Studio routes', async () => {
    const { authoring, served } = await authorThroughDomain();
    const saved = await call(authoring, 'save_metadata_draft', { type: 'flow', name: 'lead_intake', item: FLOW_DRAFT, package: 'com.acme.crm', ifMatch: 'v7' });

    expect(saved.isError).toBe(false);
    const save = served.protocolCalls.find((c: any) => c[0] === 'saveMetaItem') as any[];
    expect(save[1]).toEqual({
      type: 'flow', name: 'lead_intake', item: FLOW_DRAFT, packageId: 'com.acme.crm',
      mode: 'draft', surface: 'mcp', client: { id: 'c1' }, writeFace: 'meta-dispatch',
      // The languages the real envelope states (`userTextLocalesOf`).
      parentVersion: 'v7', actor: 'u1', userTextLocales: ['en-US', 'en-US'],
    });
    // The verdict is the protocol's judgement of the STORED draft at the saved address.
    expect(served.protocolCalls.find((c: any) => c[0] === 'draftPublishJudgement')).toEqual(
      ['draftPublishJudgement', { type: 'flow', name: 'lead_intake', packageId: 'com.acme.crm', userTextLocales: ['en-US', 'en-US'] }],
    );
    expect(saved.body).toEqual({
      saved: { type: 'flow', name: 'lead_intake', package: 'com.acme.crm', state: 'draft', version: 'v8' },
      verdict: { publishable: false, refusals: [UNROUTABLE_ISSUE], advisories: [] },
      review: {
        changes: '/studio/com.acme.crm/interfaces?changes=review',
        item: '/studio/com.acme.crm/metadata/flow/lead_intake?review=1',
        note: expect.any(String),
      },
    });
  });

  it('a plural type spelling is folded once: the save, the verdict, the discard and the review route name the canonical singular', async () => {
    const { authoring, served } = await authorThroughDomain();
    const saved = await call(authoring, 'save_metadata_draft', { type: 'flows', name: 'lead_intake', item: FLOW_DRAFT, package: 'com.acme.crm' });
    await call(authoring, 'delete_metadata_draft', { type: 'flows', name: 'lead_intake', package: 'com.acme.crm' });
    const typesSent = served.protocolCalls
      .filter((c: any) => ['saveMetaItem', 'draftPublishJudgement', 'deleteMetaItem'].includes(c[0]))
      .map((c: any) => [c[0], c[1].type]);
    expect(typesSent).toEqual([['saveMetaItem', 'flow'], ['draftPublishJudgement', 'flow'], ['deleteMetaItem', 'flow']]);
    expect(saved.body.saved.type).toBe('flow');
    expect(saved.body.review.item).toBe('/studio/com.acme.crm/metadata/flow/lead_intake?review=1');
  });

  it('a type the caller may not write is refused on the save and the discard before anything is written', async () => {
    const { authoring, served } = await authorThroughDomain();
    for (const type of ['datasource', 'datasources']) {
      const saved = await call(authoring, 'save_metadata_draft', { type, name: 'warehouse', item: { name: 'warehouse' }, package: 'com.acme.crm' });
      expect(saved.body.error, type).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      const discarded = await call(authoring, 'delete_metadata_draft', { type, name: 'warehouse', package: 'com.acme.crm' });
      expect(discarded.body.error, type).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    }
    expect(served.protocolCalls.filter((c: any) => ['saveMetaItem', 'deleteMetaItem', 'draftPublishJudgement'].includes(c[0]))).toEqual([]);

    // The control: a human who holds the type's capability writes it.
    const holder = [...ADMIN, 'manage_platform_settings'];
    const ec = await oauthEnvelope(['metadata:write'], holder);
    const allowed = await serve(ec, { systemPermissions: holder });
    expect((await call(allowed.authoring!, 'save_metadata_draft', { type: 'datasource', name: 'warehouse', item: { name: 'warehouse' }, package: 'com.acme.crm' })).isError).toBe(false);
    expect((await call(allowed.authoring!, 'delete_metadata_draft', { type: 'datasource', name: 'warehouse', package: 'com.acme.crm' })).isError).toBe(false);
    expect(allowed.protocolCalls.filter((c: any) => ['saveMetaItem', 'deleteMetaItem'].includes(c[0])).map((c: any) => [c[0], c[1].type])).toEqual(
      [['saveMetaItem', 'datasource'], ['deleteMetaItem', 'datasource']],
    );
  });

  it('a save of a type the caller may not read lands, and its verdict is withheld rather than read', async () => {
    const { authoring, served } = await authorThroughDomain();
    const saved = await call(authoring, 'save_metadata_draft', { type: 'external_catalog', name: 'warehouse_catalog', item: { name: 'warehouse_catalog' }, package: 'com.acme.crm' });
    expect(saved.isError).toBe(false);
    expect(saved.body.saved).toMatchObject({ type: 'external_catalog', name: 'warehouse_catalog' });
    expect(saved.body.verdict).toBeNull();
    expect(saved.body.verdictWithheld).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(served.protocolCalls.filter((c: any) => c[0] === 'draftPublishJudgement')).toEqual([]);
  });

  it('a save naming no package is refused 400 naming the writable packages, and nothing is written (seat ruling D4)', async () => {
    const store = {
      package: [
        { manifest: { id: 'com.acme.crm' }, writable: true },
        { manifest: { id: 'com.objectstack.platform' }, writable: false },
      ],
    };
    const { authoring, served } = await authorThroughDomain({ store });
    const refused = await call(authoring, 'save_metadata_draft', { type: 'flow', name: 'lead_intake', item: FLOW_DRAFT });

    expect(refused.isError).toBe(true);
    expect(refused.body.error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(refused.body.error.message).toContain('com.acme.crm');
    expect(refused.body.error.message).not.toContain('com.objectstack.platform');
    expect(served.protocolCalls.filter((c: any) => c[0] === 'saveMetaItem')).toEqual([]);
  });

  it('under a walled tenancy posture the save is refused 403 before anything is written', async () => {
    const { authoring, served } = await authorThroughDomain({ tenancy: { posture: 'isolated' }, posture: 'TENANT_ADMIN' });
    const refused = await call(authoring, 'save_metadata_draft', { type: 'flow', name: 'lead_intake', item: FLOW_DRAFT, package: 'com.acme.crm' });
    expect(refused.body.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(served.protocolCalls.filter((c: any) => c[0] === 'saveMetaItem')).toEqual([]);
  });

  it('a verdict that cannot be read after the save landed is said beside the saved draft, never as a refused save', async () => {
    const { protocol, calls } = fakeProtocol();
    protocol.draftPublishJudgement = async () => { throw Object.assign(new Error('No pending draft exists for flow/lead_intake.'), { code: 'NO_DRAFT', status: 404 }); };
    const { authoring } = await authorThroughDomain({ protocol });
    const saved = await call(authoring, 'save_metadata_draft', { type: 'flow', name: 'lead_intake', item: FLOW_DRAFT, package: 'com.acme.crm' });
    expect(saved.isError).toBe(false);
    expect(saved.body.saved).toMatchObject({ type: 'flow', name: 'lead_intake', package: 'com.acme.crm' });
    expect(saved.body.verdict).toBeNull();
    expect(saved.body.verdictError).toMatchObject({ code: 'NO_DRAFT', status: 404 });
    expect(calls.filter((c: any) => c[0] === 'saveMetaItem')).toHaveLength(1);
  });

  it('a registry handed no writer writes nothing', async () => {
    const { protocol, calls } = fakeProtocol();
    const registry = createOpenAuthoringRegistry({ admitted: true, userId: 'u1', getProtocol: async () => protocol, readGate: AUTHOR_READ_GATE });
    for (const [toolName, input] of [
      ['save_metadata_draft', { type: 'flow', name: 'lead_intake', item: FLOW_DRAFT, package: 'com.acme.crm' }],
      ['delete_metadata_draft', { type: 'flow', name: 'lead_intake' }],
    ] as const) {
      const result = await registry.execute({ toolCallId: 't', toolName, input }, CONTEXT);
      expect(JSON.parse(result.output.value).error, toolName).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    }
    expect(calls).toEqual([]);
  });
});

describe('delete_metadata_draft discards a pending draft only', () => {
  it('deletes the draft state, at the package named, attributed to the human', async () => {
    const { authoring, served } = await authorThroughDomain();
    const discarded = await call(authoring, 'delete_metadata_draft', { type: 'flow', name: 'lead_intake', package: 'com.acme.crm' });
    expect(discarded.body).toEqual({ discarded: { type: 'flow', name: 'lead_intake', package: 'com.acme.crm' } });
    expect(served.protocolCalls.filter((c: any) => c[0] === 'deleteMetaItem')).toEqual(
      [['deleteMetaItem', { type: 'flow', name: 'lead_intake', state: 'draft', packageId: 'com.acme.crm', actor: 'u1' }]],
    );
  });

  it('under a walled tenancy posture the discard is refused 403 before anything is deleted', async () => {
    const { authoring, served } = await authorThroughDomain({ tenancy: { posture: 'isolated' }, posture: 'TENANT_ADMIN' });
    const refused = await call(authoring, 'delete_metadata_draft', { type: 'flow', name: 'lead_intake' });
    expect(refused.body.error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(served.protocolCalls.filter((c: any) => c[0] === 'deleteMetaItem')).toEqual([]);
  });
});

describe('list_drafts answers each draft with its publish verdict, told where the item gate admits the draft read', () => {
  it('a draft the human may read carries its verdict; one the item gate refuses them is listed with the verdict withheld', async () => {
    const store = {
      dashboard: [{ name: 'finance_board', label: 'Finance', requiredPermissions: ['finance.access'], widgets: [] }],
    };
    const { protocol, calls } = fakeProtocol(store);
    protocol.listDrafts = async () => ({
      drafts: [
        { type: 'flow', name: 'lead_intake', label: 'Lead intake', packageId: 'com.acme.crm', updatedAt: null, updatedBy: null },
        { type: 'dashboard', name: 'finance_board', label: 'Finance', packageId: 'com.acme.crm', updatedAt: null, updatedBy: null },
        { type: 'datasource', name: 'warehouse', label: 'Warehouse', packageId: 'com.acme.crm', updatedAt: null, updatedBy: null },
      ],
    } as any);
    const { authoring } = await authorThroughDomain({ protocol });
    const listed = await call(authoring, 'list_drafts', {});

    expect(listed.body.count).toBe(3);
    const [flow, dashboard, typeRefused] = listed.body.drafts;
    // A type the caller may not read: its body is not read and no verdict is told.
    expect(typeRefused).toMatchObject({ type: 'datasource', name: 'warehouse', verdict: null, verdictWithheld: { code: 'PERMISSION_DENIED', status: 403 } });
    expect(calls.some((c: any) => c[1]?.type === 'datasource')).toBe(false);
    // The list stays ungated, as /meta/_drafts: both drafts are listed.
    expect(flow).toMatchObject({ type: 'flow', name: 'lead_intake', verdict: { publishable: false, refusals: [UNROUTABLE_ISSUE] } });
    expect(dashboard).toMatchObject({ type: 'dashboard', name: 'finance_board', verdict: null, verdictWithheld: { code: 'PERMISSION_DENIED', status: 403 } });
  });
});

// ---------------------------------------------------------------------------
// Done when: the app-crm shape, end to end, on the real metadata protocol
// ---------------------------------------------------------------------------

/**
 * The card's done-when on the `examples/app-crm` shape (its `com.example.crm`
 * code package and its `crm_opportunity` object, declared here: this
 * package's tests read nothing outside it). A booted code package is
 * read-only, so the author saves into a Studio-created base beside it,
 * `com.example.crm_studio`, the writable package the D4 refusal would name. The metadata protocol is the real one over a
 * real SQL store, the envelope is the real identity door's for an OAuth token
 * with `metadata:write` alone, and the door is the real `/mcp` domain: the
 * reply's finding is the publish gate's own, not a fixture's.
 */
describe('done when: an OAuth author saves an app-crm flow draft with no routable trigger and gets that finding in the same reply', () => {
  let cleanup: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanup.reverse()) c();
    cleanup = [];
  });

  async function realProtocol() {
    const dir = mkdtempSync(join(tmpdir(), 'os-34766-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    const platform = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject] as any[];
    await driver.initObjects(platform);
    const engine = new ObjectQL();
    engine.registerDriver(driver as any, true);
    await engine.init();
    for (const o of platform) engine.registry.registerObject(o, '@objectstack/platform-objects');
    engine.registry.registerObject({
      name: 'crm_opportunity',
      label: 'Opportunity',
      sharingModel: 'private',
      fields: { name: { type: 'text', label: 'Name' }, amount: { type: 'currency', label: 'Amount' } },
    } as any, 'com.example.crm');
    engine.registry.installPackage({ id: 'com.example.crm', name: 'CRM', version: '1.0.0', type: 'app', scope: 'project' } as any, 'code' as never);
    engine.registry.installPackage({ id: STUDIO_BASE, name: 'CRM Studio', version: '1.0.0', type: 'app' } as any, 'authored');
    cleanup.push(() => { void engine.destroy(); });
    return new ObjectStackProtocolImplementation(engine as any) as unknown as OpenAuthoringProtocol;
  }

  const STUDIO_BASE = 'com.example.crm_studio';

  /** A record-triggered flow on the opportunity whose start node names no trigger. */
  const unroutable = {
    name: 'crm_opportunity_followup',
    label: 'Opportunity follow-up',
    type: 'record_change',
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: { objectName: 'crm_opportunity' } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
  };

  it('the save answers flow-trigger-unroutable with its rule id, path and hint, and list_drafts lists the draft with the same verdict', async () => {
    const protocol = await realProtocol();
    const { authoring } = await authorThroughDomain({ protocol });
    expect(authoring.registry.getAll().map((t) => t.name)).toEqual([...OPEN_AUTHORING_READ_TOOL_NAMES, ...OPEN_AUTHORING_WRITE_TOOL_NAMES]);

    // Seat ruling D4: a save naming no package is refused, naming the packages the
    // protocol's own writability verdict admits (the base among them).
    const unnamed = await call(authoring, 'save_metadata_draft', { type: 'flow', name: 'crm_opportunity_followup', item: unroutable });
    expect(unnamed.body.error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(unnamed.body.error.message).toContain(STUDIO_BASE);
    expect((await call(authoring, 'list_drafts', {})).body.drafts).toEqual([]);

    const saved = await call(authoring, 'save_metadata_draft', {
      type: 'flow', name: 'crm_opportunity_followup', item: unroutable, package: STUDIO_BASE,
    });
    expect(saved.isError, JSON.stringify(saved.body)).toBe(false);
    expect(saved.body.saved).toMatchObject({ type: 'flow', name: 'crm_opportunity_followup', package: STUDIO_BASE, state: 'draft' });
    const finding = saved.body.verdict.refusals.find((issue: any) => issue.rule === 'flow-trigger-unroutable');
    expect(finding, JSON.stringify(saved.body.verdict)).toBeDefined();
    expect(finding.path).toBe('flows[0].nodes[0].config.triggerType');
    expect(typeof finding.hint === 'string' && finding.hint.length > 0).toBe(true);
    expect(saved.body.verdict.publishable).toBe(false);
    expect(saved.body.review.changes).toBe(`/studio/${STUDIO_BASE}/interfaces?changes=review`);

    // The Studio Changes source: the package's pending drafts.
    const listed = await call(authoring, 'list_drafts', { package: STUDIO_BASE });
    expect(listed.body.drafts.map((d: any) => [d.type, d.name, d.packageId])).toEqual([['flow', 'crm_opportunity_followup', STUDIO_BASE]]);
    expect(listed.body.drafts[0].verdict).toEqual(saved.body.verdict);

    // Discarded, it leaves the list; there was no active item to touch.
    expect((await call(authoring, 'delete_metadata_draft', { type: 'flow', name: 'crm_opportunity_followup', package: STUDIO_BASE })).isError).toBe(false);
    expect((await call(authoring, 'list_drafts', { package: STUDIO_BASE })).body.drafts).toEqual([]);
  });

  it('an inherited member\'s name as `type`, which the fold keeps as sent, is refused and writes nothing', async () => {
    const protocol = await realProtocol();
    const { authoring } = await authorThroughDomain({ protocol });
    for (const type of ['constructor', 'toString']) {
      // Refused, not written. The status is the protocol's answer for such a name,
      // not pinned here: its own fold reads a plain object (Acceptance notes).
      const saved = await call(authoring, 'save_metadata_draft', { type, name: 'crm_opportunity_followup', item: unroutable, package: STUDIO_BASE });
      expect(saved.isError, `${type}: ${JSON.stringify(saved.body)}`).toBe(true);
      expect(saved.body.saved, type).toBeUndefined();
      const discarded = await call(authoring, 'delete_metadata_draft', { type, name: 'crm_opportunity_followup', package: STUDIO_BASE });
      expect(discarded.isError, `${type}: ${JSON.stringify(discarded.body)}`).toBe(true);
    }
    expect((await call(authoring, 'list_drafts', {})).body.drafts).toEqual([]);
  });
});
