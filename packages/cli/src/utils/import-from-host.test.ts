// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cloud#1013 — resolving a host-app package from the CLI.
 *
 * The defect: `serve` loaded `@objectstack/organizations` with a BARE
 * `import()`. Node ESM resolves that against the importer's own realpath — the
 * CLI's, inside the framework workspace — while the package is cloud-private
 * and only ever exists in the served app's `node_modules`. It could therefore
 * never resolve, and every walled tenancy posture died on the ADR-0093 D5
 * fail-fast.
 *
 * These cases run against a REAL fixture app on disk (a real `node_modules`,
 * real resolution, nothing mocked): the first two are the issue's own repro,
 * one half per case — the CLI's resolution cannot see the package, the host
 * app's can.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHostImporter, createHostRequire } from './import-from-host.js';

/** The cloud-private package at the heart of cloud#1013. */
const ORGANIZATIONS = '@objectstack/organizations';
/** A package that fails while it EVALUATES — not while it resolves. */
const BROKEN = '@fixture/throws-on-load';

/** `packages/cli` — what a bare `import()` inside the CLI resolves against. */
const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let hostRoot: string;

function writeFixturePackage(root: string, name: string, indexJs: string): void {
  const dir = join(root, 'node_modules', ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '0.0.0-fixture', type: 'module', main: 'index.js' }),
    'utf8',
  );
  writeFileSync(join(dir, 'index.js'), indexJs, 'utf8');
}

beforeAll(() => {
  // A host app exactly as the fix expects one: it DECLARES the enterprise
  // package and has it installed in its own node_modules. The framework
  // workspace the CLI lives in has neither.
  hostRoot = mkdtempSync(join(tmpdir(), 'os-import-from-host-'));
  writeFileSync(
    join(hostRoot, 'package.json'),
    JSON.stringify({
      name: 'host-app-fixture',
      type: 'module',
      dependencies: { [ORGANIZATIONS]: '*' },
    }),
    'utf8',
  );
  writeFixturePackage(
    hostRoot,
    ORGANIZATIONS,
    'export class OrganizationsPlugin { name = "com.objectstack.organizations"; }\n',
  );
  writeFixturePackage(hostRoot, BROKEN, 'throw new Error("fixture package exploded on import");\n');
});

afterAll(() => {
  if (hostRoot) rmSync(hostRoot, { recursive: true, force: true });
});

describe('host-app package resolution (cloud#1013)', () => {
  it('the CLI\'s own resolution cannot see a host-only package — the defect', () => {
    // Literally the issue's repro, from `packages/cli`:
    //   node -e "require.resolve('@objectstack/organizations')" -> MODULE_NOT_FOUND
    // A bare `import()` in serve.ts resolved from exactly here, which is why
    // declaring the dependency in the app changed nothing.
    expect(() => createHostRequire(CLI_ROOT).resolve(ORGANIZATIONS)).toThrow(
      /Cannot find module/,
    );
  });

  it('resolves a package that exists ONLY in the host app', async () => {
    const importFromHost = createHostImporter(createHostRequire(hostRoot));
    const mod = await importFromHost(ORGANIZATIONS);
    // The export `serve` constructs: `new mod.OrganizationsPlugin()`.
    expect(typeof mod.OrganizationsPlugin).toBe('function');
    expect(new mod.OrganizationsPlugin().name).toBe('com.objectstack.organizations');
  });

  it('falls back to the CLI\'s own resolution when the host cannot resolve', async () => {
    // Whatever the host app cannot see must still load from the CLI's own
    // dependencies — that fallback is what keeps every framework-owned load in
    // `serve` (plugin-auth, plugin-security, service-i18n, …) working exactly
    // as before. Modelled with a host `require` that resolves nothing, because
    // a real one cannot: vitest exports NODE_PATH into the test process, so
    // every package in the workspace store resolves from any directory.
    const blindHostRequire = {
      resolve(pkg: string): string {
        throw Object.assign(new Error(`Cannot find module '${pkg}'`), { code: 'MODULE_NOT_FOUND' });
      },
    } as unknown as NodeRequire;
    const mod = await createHostImporter(blindHostRequire)('chalk');
    expect(typeof mod.default.green).toBe('function');
  });

  it('reports a package that neither can resolve as module-not-found', async () => {
    const importFromHost = createHostImporter(createHostRequire(hostRoot));
    // Callers classify "missing vs crashed" off this error (Serve.
    // isModuleNotFoundError), so the absent case must stay recognisable.
    await expect(importFromHost('@fixture/nowhere-at-all')).rejects.toThrow(
      /Cannot find (module|package)|Failed to (load|resolve)/,
    );
  });

  it('propagates an evaluation crash instead of masking it as module-not-found', async () => {
    // A host-resolved package that THROWS while loading is a broken package,
    // not a missing one. Re-importing it bare (the shape this helper replaced)
    // would swap the real cause for a MODULE_NOT_FOUND, which every caller
    // reads as "not installed" — a crash silently downgraded to a skip, or a
    // fatal telling the operator to install what is already installed.
    const importFromHost = createHostImporter(createHostRequire(hostRoot));
    await expect(importFromHost(BROKEN)).rejects.toThrow(/fixture package exploded on import/);
  });
});
