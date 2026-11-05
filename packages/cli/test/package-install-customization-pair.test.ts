// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D3] `os package install` of a base's paired customization
 * package (`BASE.custom`, what `os package export` writes for the overrides
 * an administrator authored).
 *
 * The runtime writes the pair's items into its own writable pair and answers
 * `customizationPair`. Before, a pair was registered as code, and this
 * command printed "Package installed into the running kernel" while none of
 * its overrides was served. Pinned:
 *   - an answer carrying `customizationPair` prints the pair it wrote into and
 *     the items written, and none of the managed install's lines;
 *   - a pair answered as a managed install (a runtime that predates the pair
 *     install, which registered it as code) prints an error naming the way
 *     back, and exits 1, never success.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PackageInstall from '../src/commands/package/install.js';

const PAIR = 'com.example.showcase.custom';

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
    await PackageInstall.run([...args, '--runtime', 'http://runtime.test']);
  } catch (err: any) {
    exit = err?.oclif?.exit ?? err?.code ?? 1;
  }
  return { out: lines.join('\n'), exit };
}

/** The pair's `objectstack.json`, as `os package export` writes it. */
function writePairExport(): { file: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'os-install-pair-'));
  const file = join(dir, 'objectstack.json');
  writeFileSync(file, JSON.stringify({
    viewItems: [{ name: 'showcase_task.in_progress', label: 'Ours', overrides: { package: 'com.example.showcase', basedOn: '0.1.0' } }],
    id: PAIR, name: 'Showcase (custom)', version: '0.1.0', namespace: 'showcase_custom',
    dependencies: { 'com.example.showcase': '^0' },
  }));
  return { file, dir };
}

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('os package install — a paired customization package', () => {
  it('prints the writable pair its items were written into, and none of the managed lines', async () => {
    const exported = writePairExport();
    dir = exported.dir;
    stubRuntime({
      manifestId: PAIR, version: '0.1.0', versionId: 'local', installedAt: '2026-11-05T00:00:00.000Z',
      customizationPair: { basePackageId: 'com.example.showcase', packageId: PAIR, created: true, writable: true },
      writtenCount: 1, written: [{ type: 'view', name: 'showcase_task.in_progress' }],
    });
    const { out, exit } = await runInstall([exported.file]);
    expect(exit).toBeUndefined();
    expect(out).toContain("Customization package installed into the writable pair of 'com.example.showcase'");
    expect(out).toContain(`${PAIR} (created by this install)`);
    expect(out).toMatch(/Items written:?\s+1/);
    expect(out).not.toContain('running kernel');
    expect(out).not.toContain('installed-packages');
  });

  it('prints a pair answered as a managed install as the failure it is, and exits 1', async () => {
    const exported = writePairExport();
    dir = exported.dir;
    stubRuntime({
      manifestId: PAIR, version: '0.1.0', versionId: 'local', installedAt: '2026-11-05T00:00:00.000Z',
      hotLoaded: true, storageDir: '/srv/runtime/.objectstack/installed-packages',
    });
    const { out, exit } = await runInstall([exported.file]);
    expect(exit).toBe(1);
    expect(out).toContain(`installed ${PAIR} as code, not into its writable pair`);
    expect(out).toContain(`DELETE http://runtime.test/api/v1/marketplace/install-local/${PAIR}`);
    expect(out).not.toContain('Package installed into the running kernel');
  });
});
