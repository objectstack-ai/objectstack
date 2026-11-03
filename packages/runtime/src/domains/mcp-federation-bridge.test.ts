// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27745] The MCP federation bridge (`list_remote_tables` / `import_object`)
 * refuses a caller exactly where the REST twins do: the listing needs
 * `FEDERATION_READ_CAPABILITY`, the import [2026-11-03 ruling] BOTH
 * `FEDERATION_READ_CAPABILITY` and `FEDERATION_WRITE_CAPABILITY` — seeing a
 * datasource's remote structure needs the read capability on every door,
 * writes included, and the import answers with the generated definition —
 * all asked before the `external-datasource` service is looked up, and a host
 * with no federation service answers `503 SERVICE_UNAVAILABLE`.
 */

import { describe, it, expect } from 'vitest';
import { FEDERATION_READ_CAPABILITY, FEDERATION_WRITE_CAPABILITY } from '@objectstack/rest';
import { buildMcpBridge } from './mcp.js';
import { resolveExecutionContext } from '../security/resolve-execution-context.js';
import { bindCatalogFromTables } from '../security/security-catalog.testkit.js';

function bridgeFor(systemPermissions: string[], service: unknown) {
  const lookups: string[] = [];
  const deps = {
    resolveService: async (_ctx: unknown, name: string) => {
      lookups.push(name);
      return name === 'external-datasource' ? service : undefined;
    },
  };
  const context = { environmentId: 'env_1', executionContext: { userId: 'u_1', systemPermissions } };
  return { bridge: buildMcpBridge(deps as never, context as never), lookups };
}

function fakeService() {
  const calls: unknown[] = [];
  return {
    calls,
    listRemoteTables: async (...args: unknown[]) => {
      calls.push(['listRemoteTables', ...args]);
      return [{ name: 'Products', columnCount: 6 }];
    },
    importObject: async (...args: unknown[]) => {
      calls.push(['importObject', ...args]);
      return { name: 'products', definition: {}, review: [] };
    },
  };
}

describe('the MCP federation bridge gates on the federation capabilities', () => {
  it('lists through the external-datasource service for a holder of the read capability', async () => {
    const service = fakeService();
    const { bridge } = bridgeFor([FEDERATION_READ_CAPABILITY], service);
    await expect(bridge.listRemoteTables('erp', { schema: 'x' })).resolves.toEqual([{ name: 'Products', columnCount: 6 }]);
    expect(service.calls).toEqual([['listRemoteTables', 'erp', { schema: 'x' }]]);
  });

  it('imports for a holder of the read AND write capabilities, with the options as sent', async () => {
    const service = fakeService();
    const { bridge } = bridgeFor([FEDERATION_READ_CAPABILITY, FEDERATION_WRITE_CAPABILITY], service);
    await bridge.importObject('erp', 'Products', { writable: true });
    expect(service.calls).toEqual([['importObject', 'erp', 'Products', { writable: true }]]);
  });

  it('refuses the import 403 without the write capability, before the service is looked up', async () => {
    const service = fakeService();
    const write = bridgeFor([FEDERATION_READ_CAPABILITY], service);
    await expect(write.bridge.importObject('erp', 'Products', {})).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
      message: expect.stringContaining(FEDERATION_WRITE_CAPABILITY),
    });
    expect(write.lookups).not.toContain('external-datasource');
    expect(service.calls).toEqual([]);
  });

  it('seeing remote structure needs the read capability on every door, writes included: a holder of the write capability alone is carried neither call', async () => {
    // [2026-11-03 ruling] The import answers with the generated definition, so
    // it needs the read capability too; without it no call of the pair can
    // pass, and the bridge carries neither (the #28938 rule: listed exactly
    // where a call is admitted). Until the ruling this holder was carried the
    // pair and its import was served.
    const service = fakeService();
    const { bridge, lookups } = bridgeFor([FEDERATION_WRITE_CAPABILITY], service);
    expect(typeof bridge.listRemoteTables).toBe('undefined');
    expect(typeof bridge.importObject).toBe('undefined');
    expect(lookups).not.toContain('external-datasource');
    expect(service.calls).toEqual([]);
  });

  it('answers 503 on a host with no federation service', async () => {
    const { bridge } = bridgeFor([FEDERATION_READ_CAPABILITY], undefined);
    await expect(bridge.listRemoteTables('erp', {})).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
  });
});

// ── [#28938] the pair is carried only where a call can pass ─────────────────
//
// The envelopes below are resolved by the real `/mcp` door
// (`resolveExecutionContext` with an OAuth token), not written by hand: what an
// agent holds is the door's derivation, and a hand-built envelope would pin the
// test's belief about it instead. The delegating user is an administrator whose
// set carries BOTH federation capabilities.
//
// The door hands an agent the user's system capabilities only under
// `actions:execute`; a `metadata:write`-only grant therefore holds none, and no
// federation call can ever pass for it. Listing the pair there served two tools
// whose every call answered 403 — so the bridge carries the pair only for an
// envelope one of the two calls admits. Nothing a grant can DO changes: every
// call that passes is still carried. [2026-11-03 ruling] Both calls need the
// read capability now, so "one of the two admits" means "holds the read
// capability"; the bridge asks the family's rule, not that shortcut.

function capableUserQl(systemPermissions: string[]) {
  const tables: Record<string, any[]> = {
    sys_member: [{ user_id: 'u1', organization_id: 'orgA', role: 'owner' }],
    sys_organization: [{ id: 'org_default', slug: 'default' }],
    sys_user_permission_set: [{ id: 'ups1', user_id: 'u1', permission_set_id: 'ps_admin', permission_set: 'admin_full_access', organization_id: 'org_default' }],
    sys_permission_set: [{ id: 'ps_admin', name: 'admin_full_access', system_permissions: JSON.stringify(systemPermissions), object_permissions: '{}' }],
    sys_position: [], sys_position_permission_set: [], sys_user_position: [],
  };
  return bindCatalogFromTables({
    async find(object: string, opts: any) {
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
}

async function oauthEnvelope(scopes: string[], systemPermissions: string[]) {
  return resolveExecutionContext({
    acceptOAuthAccessToken: true,
    getService: async (name: string) =>
      name === 'auth' ? { verifyMcpAccessToken: async () => ({ userId: 'u1', scopes, clientId: 'c1' }) } : undefined,
    getQl: async () => capableUserQl(systemPermissions),
    request: { headers: { authorization: 'Bearer a.b.c' } },
  } as never);
}

function bridgeOver(executionContext: unknown, service: unknown) {
  const lookups: string[] = [];
  const deps = {
    resolveService: async (_ctx: unknown, name: string) => {
      lookups.push(name);
      return name === 'external-datasource' ? service : undefined;
    },
  };
  const context = { environmentId: 'env_1', executionContext };
  return { bridge: buildMcpBridge(deps as never, context as never), lookups };
}

const ADMIN_CAPS = [FEDERATION_READ_CAPABILITY, FEDERATION_WRITE_CAPABILITY, 'manage_users'];

describe('the federation pair rides the bridge only for an envelope that can call it', () => {
  it('a metadata:write-only grant for an administrator carries neither member: no call of it could pass', async () => {
    const ec = await oauthEnvelope(['metadata:write'], ADMIN_CAPS);
    expect(ec.principalKind).toBe('agent');
    expect(ec.oauthScopes).toEqual(['metadata:write']);
    // The door's derivation, measured: no `actions:execute`, no capability.
    expect(ec.systemPermissions).toEqual([]);
    const service = fakeService();
    const { bridge, lookups } = bridgeOver(ec, service);
    // `wireBridgeTools` registers the pair only on a bridge carrying both
    // members, so absence here is `tools/list` omitting them.
    expect(typeof bridge.listRemoteTables).toBe('undefined');
    expect(typeof bridge.importObject).toBe('undefined');
    expect(lookups).not.toContain('external-datasource');
    expect(service.calls).toEqual([]);
  });

  it('the same administrator under metadata:write + actions:execute keeps the pair, and both calls reach the service', async () => {
    const ec = await oauthEnvelope(['metadata:write', 'actions:execute'], ADMIN_CAPS);
    expect(ec.systemPermissions).toEqual(expect.arrayContaining([FEDERATION_READ_CAPABILITY, FEDERATION_WRITE_CAPABILITY]));
    const service = fakeService();
    const { bridge } = bridgeOver(ec, service);
    await expect(bridge.listRemoteTables('erp', {})).resolves.toEqual([{ name: 'Products', columnCount: 6 }]);
    await bridge.importObject('erp', 'Products', {});
    expect(service.calls).toEqual([
      ['listRemoteTables', 'erp', {}],
      ['importObject', 'erp', 'Products', {}],
    ]);
  });

  it('a delegating user holding only the write capability is carried neither member: both calls need the read capability', async () => {
    // [2026-11-03 ruling] FLIPPED: this envelope kept the pair until then, its
    // listing refused and its import served. Seeing remote structure needs the
    // read capability on every door, writes included, so neither call can pass
    // and the pair is not listed — the same answer a `metadata:write`-only grant
    // gets above.
    const ec = await oauthEnvelope(['metadata:write', 'actions:execute'], [FEDERATION_WRITE_CAPABILITY]);
    expect(ec.systemPermissions).toEqual([FEDERATION_WRITE_CAPABILITY]);
    const service = fakeService();
    const { bridge, lookups } = bridgeOver(ec, service);
    expect(typeof bridge.listRemoteTables).toBe('undefined');
    expect(typeof bridge.importObject).toBe('undefined');
    expect(lookups).not.toContain('external-datasource');
    expect(service.calls).toEqual([]);
  });

  it('a delegating user holding only the read capability keeps the pair: the listing is served and the import refuses 403', async () => {
    const ec = await oauthEnvelope(['metadata:write', 'actions:execute'], [FEDERATION_READ_CAPABILITY]);
    const service = fakeService();
    const { bridge } = bridgeOver(ec, service);
    await expect(bridge.listRemoteTables('erp', {})).resolves.toEqual([{ name: 'Products', columnCount: 6 }]);
    await expect(bridge.importObject('erp', 'Products', {})).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(service.calls).toEqual([['listRemoteTables', 'erp', {}]]);
  });

  it('a delegating user holding neither capability is carried neither member', async () => {
    const ec = await oauthEnvelope(['metadata:write', 'actions:execute'], ['manage_users']);
    expect(ec.systemPermissions).toEqual(['manage_users']);
    const { bridge } = bridgeOver(ec, fakeService());
    expect(typeof bridge.listRemoteTables).toBe('undefined');
    expect(typeof bridge.importObject).toBe('undefined');
  });
});
