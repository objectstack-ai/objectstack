// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — a package export names each connector map it withheld
// whole, and both install modes of the import name each one as incomplete
// (#28640 ruling ③A).
//
// ## What was measured before the fix
//
// A package installed into the showcase through `POST /marketplace/install-local`
// with connectors carrying `providerConfig.headers`, `providerConfig.defaultHeaders`
// and `providerConfig.transport.headers` exported (`GET /packages/:id/export`)
// with each of those maps simply absent — the served read's connector redactor
// withholds them whole — and nothing in the manifest said so. Importing that
// export (managed, then unmanaged) answered 200 and named nothing: an
// incomplete map read as one the package never had.
//
// ## What this file pins, on one boot
//
//   1. the export lists each withheld map as `{ type, name, path }`, and only
//      those: the connector with no map is not listed; the exported items stay
//      as served, no header name and no header value in the manifest;
//   2. a MANAGED install of that export (the Studio import button's request)
//      answers 200 and names each map in `withheldMaps`, as the export wrote it;
//   3. an UNMANAGED install of the same export answers 200 and names each map
//      the same way. The export carries no `installModes` (the per-package
//      export writes only its identity and collections, the family the
//      whole-deployment export card carries), so the test adds the key an
//      operator would add before importing it as a copy; the managed install
//      is removed first, because a managed package holds the namespace the
//      copy keeps.
//
// Boots a fixture stack of its own (the install-local plugin mounted), so it
// stays out of `SHARED_SHOWCASE`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { bootShowcase } from './showcase-boot.js';

const PACKAGE_ID = 'com.dogfood.withheldmaps';
const REST_ENTRY = 'withheldmaps_rest';
const MCP_ENTRY = 'withheldmaps_mcp';
const PLAIN_ENTRY = 'withheldmaps_plain';
const HEADER_NAME = 'X-Dogfood-Tenant';
const HEADER_VALUE = 'dogfood-tenant-value';

/** The install body of the SOURCE package: three connectors, two carrying header maps. */
const SOURCE_BODY = {
  manifest: {
    id: PACKAGE_ID,
    namespace: 'withheldmaps',
    name: 'Withheld connector maps',
    version: '1.0.0',
    type: 'app',
    connectors: [
      {
        name: REST_ENTRY,
        label: 'REST with header maps',
        type: 'api',
        provider: 'rest',
        providerConfig: {
          baseUrl: 'http://127.0.0.1:9/',
          headers: { [HEADER_NAME]: HEADER_VALUE },
          defaultHeaders: { Accept: 'application/json' },
        },
      },
      {
        name: MCP_ENTRY,
        label: 'MCP over http with a header map',
        type: 'api',
        provider: 'mcp',
        providerConfig: { transport: { kind: 'http', url: 'http://127.0.0.1:9/mcp', headers: { [HEADER_NAME]: HEADER_VALUE } } },
      },
      {
        name: PLAIN_ENTRY,
        label: 'REST with no map',
        type: 'api',
        provider: 'rest',
        providerConfig: { baseUrl: 'http://127.0.0.1:9/' },
      },
    ],
  },
};

const WITHHELD = [
  { type: 'connector', name: REST_ENTRY, path: 'providerConfig.headers' },
  { type: 'connector', name: REST_ENTRY, path: 'providerConfig.defaultHeaders' },
  { type: 'connector', name: MCP_ENTRY, path: 'providerConfig.transport.headers' },
];

type Answer = { status: number; body: any };

async function json(res: Response): Promise<Answer> {
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('dogfood: a package export names each connector map it withheld, and both install modes name each as incomplete', () => {
  let stack: VerifyStack;
  let storageDir: string;
  let source: Answer;
  let exported: Answer;
  let managed: Answer;
  let removed: Answer;
  let unmanaged: Answer;

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-export-withheld-maps-'));
    stack = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    const token = await stack.signIn();
    source = await json(await stack.apiAs(token, 'POST', '/marketplace/install-local', SOURCE_BODY));
    exported = await json(await stack.apiAs(token, 'GET', `/packages/${encodeURIComponent(PACKAGE_ID)}/export`));
    const manifest = exported.body?.data ?? {};
    managed = await json(await stack.apiAs(token, 'POST', '/marketplace/install-local', { manifest }));
    removed = await json(await stack.apiAs(token, 'DELETE', `/marketplace/install-local/${encodeURIComponent(PACKAGE_ID)}`));
    unmanaged = await json(await stack.apiAs(token, 'POST', '/marketplace/install-local', {
      manifest: { ...manifest, installModes: ['managed', 'unmanaged'] },
      installMode: 'unmanaged',
    }));
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('the source package installs and its export answers 200', () => {
    expect(source.status, JSON.stringify(source.body)).toBe(200);
    expect(exported.status, JSON.stringify(exported.body)).toBe(200);
  });

  it('1. the export lists each withheld map, and only those, and carries no header name or value', () => {
    const manifest = exported.body?.data;
    expect(manifest?.withheldMaps).toEqual(WITHHELD);
    const names = (manifest?.connectors ?? []).map((c: any) => c.name).sort();
    expect(names).toEqual([MCP_ENTRY, PLAIN_ENTRY, REST_ENTRY]);
    const rest = manifest.connectors.find((c: any) => c.name === REST_ENTRY);
    expect(rest.providerConfig).not.toHaveProperty('headers');
    expect(rest.providerConfig).not.toHaveProperty('defaultHeaders');
    const text = JSON.stringify(manifest);
    expect(text).not.toContain(HEADER_NAME);
    expect(text).not.toContain(HEADER_VALUE);
  });

  it('2. a managed install of the export answers 200 and names each map', () => {
    expect(managed.status, JSON.stringify(managed.body)).toBe(200);
    expect(managed.body?.data?.withheldMaps).toEqual(WITHHELD);
  });

  it('3. an unmanaged install of the export answers 200 and names each map', () => {
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(unmanaged.status, JSON.stringify(unmanaged.body)).toBe(200);
    expect(unmanaged.body?.data?.installMode).toBe('unmanaged');
    expect(unmanaged.body?.data?.withheldMaps).toEqual(WITHHELD);
    const copied = (unmanaged.body?.data?.copied ?? []).filter((i: any) => i.type === 'connector').map((i: any) => i.name).sort();
    expect(copied).toEqual([MCP_ENTRY, PLAIN_ENTRY, REST_ENTRY]);
  });
});
