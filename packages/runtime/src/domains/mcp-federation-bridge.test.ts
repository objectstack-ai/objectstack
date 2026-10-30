// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27745] The MCP federation bridge (`list_remote_tables` / `import_object`)
 * refuses a caller exactly where the REST twins do: the listing needs
 * `FEDERATION_READ_CAPABILITY`, the import `FEDERATION_WRITE_CAPABILITY`, both
 * asked before the `external-datasource` service is looked up, and a host with
 * no federation service answers `503 SERVICE_UNAVAILABLE`.
 */

import { describe, it, expect } from 'vitest';
import { FEDERATION_READ_CAPABILITY, FEDERATION_WRITE_CAPABILITY } from '@objectstack/rest';
import { buildMcpBridge } from './mcp.js';

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

  it('imports for a holder of the write capability, with the options as sent', async () => {
    const service = fakeService();
    const { bridge } = bridgeFor([FEDERATION_WRITE_CAPABILITY], service);
    await bridge.importObject('erp', 'Products', { writable: true });
    expect(service.calls).toEqual([['importObject', 'erp', 'Products', { writable: true }]]);
  });

  it('refuses 403 without the capability, before the service is looked up', async () => {
    const service = fakeService();
    const read = bridgeFor([FEDERATION_WRITE_CAPABILITY], service);
    await expect(read.bridge.listRemoteTables('erp', {})).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
      message: expect.stringContaining(FEDERATION_READ_CAPABILITY),
    });
    const write = bridgeFor([FEDERATION_READ_CAPABILITY], service);
    await expect(write.bridge.importObject('erp', 'Products', {})).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
      message: expect.stringContaining(FEDERATION_WRITE_CAPABILITY),
    });
    expect(read.lookups).not.toContain('external-datasource');
    expect(write.lookups).not.toContain('external-datasource');
    expect(service.calls).toEqual([]);
  });

  it('answers 503 on a host with no federation service', async () => {
    const { bridge } = bridgeFor([FEDERATION_READ_CAPABILITY], undefined);
    await expect(bridge.listRemoteTables('erp', {})).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
  });
});
