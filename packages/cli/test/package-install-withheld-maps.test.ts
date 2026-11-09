// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28640 ruling ③A] `os package install` prints the connector maps the
 * package export withheld, as the install-local answer names them.
 *
 * `os package export` writes each connector header / environment map it
 * withheld whole into the export's `withheldMaps`, and both install modes of
 * `POST /api/v1/marketplace/install-local` read that list, install the
 * package, and name each map in their answer's `withheldMaps`. Before this
 * change the command dropped the key, so an operator installing an export the
 * documented way (`os package install DIR/NN-ID/objectstack.json`) never
 * learned that the connector sends none of those headers.
 *
 * Pinned, per install mode (managed hot-loaded, managed not hot-loaded,
 * unmanaged) and per source (catalog id, artifact file):
 *   - an answer carrying `withheldMaps` prints one warning, one line per map
 *     (`connector 'NAME' PATH`), and the remedy;
 *   - an answer without the list prints none of those lines;
 *   - the install still succeeds — the warning changes no exit code.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PackageInstall from '../src/commands/package/install.js';

/** Stub the runtime's install POST with the given `data` block. */
function stubRuntime(data: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => ({ success: true, data }),
  }) as any));
}

/** Run the command; return everything it printed and how it exited. */
async function runInstall(args: string[]): Promise<{ out: string; exit: number | undefined }> {
  const lines: string[] = [];
  const capture = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  let exit: number | undefined;
  try {
    await PackageInstall.run([...args, '--url', 'http://runtime.test']);
  } catch (err: any) {
    exit = err?.oclif?.exit ?? err?.code ?? 1;
  }
  return { out: lines.join('\n'), exit };
}

/** The list exactly as install-local answers it: positions only, never a header name. */
const WITHHELD = [
  { type: 'connector', name: 'w5export_erp', path: 'providerConfig.headers' },
  { type: 'connector', name: 'w5export_mcp', path: 'providerConfig.transport.env' },
];

const MANAGED = {
  manifestId: 'com.qa.w5export', version: '1.0.0', versionId: 'ver_1', installedAt: '2026-11-04T00:00:00.000Z',
  hotLoaded: true, storageDir: '/srv/runtime/.objectstack/installed-packages',
};
const MANAGED_NOT_HOT = { ...MANAGED, hotLoaded: false, hotLoadError: 'register threw' };
const UNMANAGED = {
  manifestId: 'com.qa.w5export', version: '1.0.0', versionId: 'ver_1', installMode: 'unmanaged',
  installedAt: '2026-11-04T00:00:00.000Z', targetPackageId: 'com.qa.w5export-copy', copiedCount: 3, copied: [],
};

const WARNING = /2 connector map\(s\) arrived empty — the package export withheld each one whole/;
const REMEDY = 'Re-enter each map where the connector is authored.';

/** An exported package directory's `objectstack.json`, as `os package export` writes it. */
function writeExport(): { file: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'os-install-withheld-'));
  const file = join(dir, 'objectstack.json');
  writeFileSync(file, JSON.stringify({
    id: 'com.qa.w5export', name: 'w5export', version: '1.0.0',
    connectors: [{ name: 'w5export_erp', providerConfig: {} }],
    withheldMaps: WITHHELD.slice(0, 1),
  }));
  return { file, dir };
}

const CASES: Array<[label: string, data: Record<string, unknown>, flags: string[]]> = [
  ['managed, hot-loaded', MANAGED, []],
  ['managed, not hot-loaded', MANAGED_NOT_HOT, []],
  ['unmanaged', UNMANAGED, ['--install-mode', 'unmanaged']],
];

describe('os package install — prints the connector maps the export withheld', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  describe.each(CASES)('%s', (_label, data, flags) => {
    it('names each withheld map with its connector and path, then the remedy (catalog source)', async () => {
      stubRuntime({ ...data, withheldMaps: WITHHELD });

      const { out, exit } = await runInstall(['com.qa.w5export', ...flags]);

      expect(exit).toBeUndefined();
      expect(out).toMatch(WARNING);
      const lines = out.split('\n').map((line) => line.trim());
      expect(lines).toContain("connector 'w5export_erp' providerConfig.headers");
      expect(lines).toContain("connector 'w5export_mcp' providerConfig.transport.env");
      expect(lines).toContain(REMEDY);
    });

    it('names the withheld map for an exported artifact file (the documented export path)', async () => {
      const { file, dir } = writeExport();
      dirs.push(dir);
      stubRuntime({ ...data, withheldMaps: WITHHELD.slice(0, 1) });

      const { out, exit } = await runInstall([file, ...flags]);

      expect(exit).toBeUndefined();
      expect(out).toMatch(/1 connector map\(s\) arrived empty/);
      expect(out.split('\n').map((line) => line.trim())).toContain("connector 'w5export_erp' providerConfig.headers");
      expect(out).toContain(REMEDY);
    });

    it.each([
      ['absent', undefined],
      ['empty', []],
    ])('prints no withheld-map line when the answer\'s list is %s', async (_which, list) => {
      stubRuntime({ ...data, ...(list === undefined ? {} : { withheldMaps: list }) });

      const { out, exit } = await runInstall(['com.qa.w5export', ...flags]);

      expect(exit).toBeUndefined();
      expect(out).not.toContain('arrived empty');
      expect(out).not.toContain('providerConfig.');
      expect(out).not.toContain(REMEDY);
    });
  });
});
