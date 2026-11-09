// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28914] `os package export` — a running deployment's whole ontology,
 * written as installable packages.
 *
 * Drives the real command and the real `@objectstack/client`
 * (`packages.exportAll()`, its `fetch` wrapper and unwrap), stubbing only the
 * credential boundary: `createApiClient` hands back a real `ObjectStackClient`
 * whose `fetch` answers one canned response, as
 * `src/commands/meta/delete-json-error-code.test.ts` does.
 *
 * Pinned:
 *  - one directory per package, numbered in the read's order, each holding the
 *    entry exactly as served, and the install commands printed in that order;
 *  - each written file is what `os package install FILE` sends as its inline
 *    `manifest` (the real install command, its POST captured), so the export
 *    round-trips through the command that consumes it;
 *  - a refusal is printed with its status and code, exits 1, and writes nothing;
 *  - an `--out` directory that already holds files is refused before the read;
 *  - an empty bundle writes nothing and says why.
 */

import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ObjectStackClient } from '@objectstack/client';
import PackageExport, { EXPORTED_PACKAGE_FILE, exportedPackageDirectory } from '../src/commands/package/export.js';
import PackageInstall from '../src/commands/package/install.js';

const stub = vi.hoisted(() => ({ client: undefined as any, calls: [] as string[] }));

vi.mock('../src/utils/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/api-client.js')>();
  return {
    ...actual,
    createApiClient: async () => ({ client: stub.client, token: 'test-token', baseUrl: 'https://door.test' }),
  };
});

const BASE = {
  id: 'com.acme.crm', name: 'crm', version: '1.2.0', namespace: 'crm',
  objects: [{ name: 'crm_account', label: 'Account', fields: { name: { type: 'text' } } }],
  connectors: [{ name: 'crm_erp', label: 'ERP', type: 'api', provider: 'rest', auth: { type: 'bearer', credentialRef: 'CRM_ERP_TOKEN' } }],
};
const PAIR = {
  id: 'com.acme.crm.custom', name: 'crm-custom', version: '0.1.0', namespace: 'crm_custom',
  dependencies: { 'com.acme.crm': '^1' },
  dashboards: [{ name: 'crm_pulse', label: 'Pulse (customized)', overrides: { package: 'com.acme.crm', basedOn: '1.2.0' } }],
};
const EXT = {
  id: 'com.acme.billing', name: 'billing', version: '2.0.0', namespace: 'billing',
  dependencies: { 'com.acme.crm': '^1' },
  objectExtensions: [{ extend: 'crm_account', fields: { billing_code: { type: 'text' } } }],
};

/** A client whose `fetch` answers one canned response, recording each URL it was asked for. */
function clientAnswering(status: number, body: unknown): ObjectStackClient {
  return new ObjectStackClient({
    baseUrl: 'https://door.test',
    token: 'test-token',
    fetch: async (url: any) => {
      stub.calls.push(String(url));
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    },
  } as any);
}

async function run(command: typeof PackageExport | typeof PackageInstall, argv: string[]): Promise<{ out: string; exit: number | undefined }> {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  let exit: number | undefined;
  try {
    await command.run(argv);
  } catch (err: any) {
    exit = err?.oclif?.exit ?? 1;
  }
  return { out: lines.join('\n').replace(/\x1b\[[0-9;]*m/g, ''), exit };
}

describe('os package export', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'os-package-export-'));
    stub.calls = [];
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('writes one directory per package, numbered in the order served, each holding its entry as served', async () => {
    stub.client = clientAnswering(200, { success: true, data: { packages: [BASE, PAIR, EXT] } });
    const out = join(root, 'ontology');

    const r = await run(PackageExport, ['--out', out]);

    expect(r.exit, r.out).toBeUndefined();
    expect(stub.calls).toEqual(['https://door.test/api/v1/packages/export']);
    expect(readdirSync(out)).toEqual(['01-com.acme.crm', '02-com.acme.crm.custom', '03-com.acme.billing']);
    for (const [i, entry] of [BASE, PAIR, EXT].entries()) {
      const file = join(out, exportedPackageDirectory(i, 3, entry.id), EXPORTED_PACKAGE_FILE);
      expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual(entry);
    }
    // The credential stays the reference it is: written as served, nothing resolved.
    expect(readFileSync(join(out, '01-com.acme.crm', EXPORTED_PACKAGE_FILE), 'utf-8')).toContain('"credentialRef": "CRM_ERP_TOKEN"');
    // The install commands, in the order served.
    const installs = r.out.split('\n').filter((l) => l.trim().startsWith('os package install '));
    expect(installs.map((l) => l.trim())).toEqual([BASE, PAIR, EXT].map((e, i) =>
      `os package install ${join(out, exportedPackageDirectory(i, 3, e.id), EXPORTED_PACKAGE_FILE)}`));
  }, 60_000);

  it('each written file is the manifest `os package install FILE` sends, unchanged', async () => {
    stub.client = clientAnswering(200, { success: true, data: { packages: [BASE, PAIR, EXT] } });
    const out = join(root, 'ontology');
    expect((await run(PackageExport, ['--out', out])).exit).toBeUndefined();
    vi.restoreAllMocks();

    for (const [i, entry] of [BASE, PAIR, EXT].entries()) {
      const posted: any[] = [];
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
        posted.push(JSON.parse(init.body));
        // [ADR-0146 D3] A pair is answered as the runtime installs it: into
        // its writable pair, never as code (which the command prints as the
        // failure it is).
        const answered = entry === PAIR
          ? { manifestId: entry.id, version: entry.version, customizationPair: { basePackageId: BASE.id, packageId: entry.id, created: true, writable: true }, writtenCount: 0, written: [] }
          : { manifestId: entry.id, version: entry.version, hotLoaded: true };
        return new Response(JSON.stringify({ success: true, data: answered }), { status: 200 });
      }));
      const file = join(out, exportedPackageDirectory(i, 3, entry.id), EXPORTED_PACKAGE_FILE);
      const r = await run(PackageInstall, [file, '--url', 'http://target.test']);
      expect(r.exit, r.out).toBeUndefined();
      expect(posted).toHaveLength(1);
      expect(posted[0].manifest).toEqual(entry);
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  }, 60_000);

  it('prints a refusal with its status and code, exits 1, and writes nothing', async () => {
    const message = "The export of package 'com.acme.crm.custom' could not be assembled, so no bundle is answered: metadata store unavailable";
    stub.client = clientAnswering(503, { success: false, error: { code: 'SERVICE_UNAVAILABLE', message } });
    const out = join(root, 'ontology');

    const r = await run(PackageExport, ['--out', out]);

    expect(r.exit).toBe(1);
    expect(r.out).toContain(`Export refused (503 SERVICE_UNAVAILABLE): ${message}`);
    expect(existsSync(out)).toBe(false);
  }, 60_000);

  it('refuses an --out directory that already holds files, before reading anything', async () => {
    stub.client = clientAnswering(200, { success: true, data: { packages: [BASE] } });
    const out = join(root, 'ontology');
    mkdirSync(out);
    writeFileSync(join(out, 'older.json'), '{}');

    const r = await run(PackageExport, ['--out', out]);

    expect(r.exit).toBe(1);
    expect(r.out).toContain('already holds files');
    expect(stub.calls).toEqual([]);
    expect(readdirSync(out)).toEqual(['older.json']);
  }, 60_000);

  it('writes nothing for an empty bundle, and says the deployment\'s own code carries every package', async () => {
    stub.client = clientAnswering(200, { success: true, data: { packages: [] } });
    const out = join(root, 'ontology');

    const r = await run(PackageExport, ['--out', out]);

    expect(r.exit).toBeUndefined();
    expect(r.out).toContain('Nothing to export');
    expect(existsSync(out)).toBe(false);
  }, 60_000);

  it('refuses an entry that names no package id, writing nothing', async () => {
    stub.client = clientAnswering(200, { success: true, data: { packages: [BASE, { name: 'no-id', version: '1.0.0' }] } });
    const out = join(root, 'ontology');

    const r = await run(PackageExport, ['--out', out]);

    expect(r.exit).toBe(1);
    expect(r.out).toContain('Entry 2 of the export names no package id');
    expect(existsSync(out)).toBe(false);
  }, 60_000);
});
