// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os serve` loads the cluster gate and its driver AS THE HOST APP DECLARES
 * THEM, not from the CLI's own `node_modules`.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * Measured on a published EE image: with `OS_CLUSTER_DRIVER=redis` set, boot
 * died with
 *
 *     Cannot find package '@objectstack/service-cluster' imported from
 *     /repo/objectstack/packages/cli/dist/commands/serve.js
 *
 * The CLI's own `node_modules/@objectstack/` held 48 packages and NEITHER
 * cluster package; both were installed only under the app, which declares them.
 * `serve.ts` reached them through a bare dynamic `import()`, and Node ESM
 * resolves a bare specifier against the IMPORTER's realpath — the CLI's, inside
 * the framework workspace. So the one hop that could not work was CLI to app,
 * while app-side code loaded the very same packages fine.
 *
 * ── Why this is not fixed by declaring the packages ──────────────────────
 *
 * Adding `@objectstack/service-cluster*` to `packages/cli`'s dependencies would
 * silence this driver and leave the class open: the next app-declared optional
 * package the CLI advertises it will load breaks identically, a third-party
 * cluster driver can never work, and the open-core CLI would take a static
 * dependency on packages that ship with a distribution — the exact coupling the
 * non-literal specifier in `serve.ts` exists to avoid. The fix is to resolve
 * from the host app, which is what `createHostImporter` already does for the
 * organizations / capability loads further down `serve`.
 *
 * ── What is pinned here ──────────────────────────────────────────────────
 *
 * 1. The BOUNDARY, behaviourally and hermetically: a package that exists only
 *    in a host app's `node_modules` is invisible to a bare import from this
 *    file (which sits in `packages/cli`, the same resolution base as the
 *    shipped `dist/commands/serve.js`) and IS loadable through the host
 *    importer. The fixture package is synthetic on purpose — the contract is
 *    "any app-declared optional package", not "these two cluster packages", and
 *    a synthetic one needs nothing built.
 *
 * 2. The ORDERING, by source scan: `importFromHost` must be defined ABOVE the
 *    cluster block. This is the half that actually regressed, twice — the
 *    helper is a `const` in one long boot function, so a load placed above it
 *    is not a compile error, it is a silent fall-back to bare resolution. The
 *    first time it cost the enterprise organizations load (cloud#1013); the
 *    second time it cost EE multi-node boot outright.
 *
 * The source scan reads `serve.ts` from THIS package, so no cross-package test
 * input is declared or needed.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHostImporter } from '@objectstack/types/node';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `packages/cli/src/commands/serve.ts` — same package, no escaping read. */
const SERVE_SOURCE = readFileSync(resolve(HERE, 'serve.ts'), 'utf8');

/**
 * A host app that DECLARES an optional package and carries it in its own
 * `node_modules` — the shape of every EE app that declares
 * `@objectstack/service-cluster`. Nothing here is built or installed: the
 * package is three files written to a temp dir.
 */
function makeHostApp(pkgName: string, declare: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'os-host-app-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture-host-app',
      version: '1.0.0',
      type: 'module',
      ...(declare ? { dependencies: { [pkgName]: '1.0.0' } } : {}),
    }),
  );
  const pkgDir = join(root, 'node_modules', ...pkgName.split('/'));
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: pkgName, version: '1.0.0', type: 'module', main: 'index.js' }),
  );
  // The marker export stands in for `checkMultiNodeAllowed`: proof the module
  // that loaded is the app's copy, not something the CLI happened to resolve.
  writeFileSync(join(pkgDir, 'index.js'), 'export const loadedFrom = "host-app";\n');
  return root;
}

describe('os serve → app-declared optional package resolution', () => {
  // A name no workspace package can satisfy, so a pass cannot come from the
  // CLI's own node_modules by accident.
  const PKG = '@os-fixture/cluster-driver-probe';

  it('reproduces the asymmetry: an app-only package is invisible to a bare import', async () => {
    // This file resolves from `packages/cli`, exactly as `dist/commands/serve.js`
    // does — the failing hop the EE image measured.
    const bare: string = PKG;
    await expect(import(bare)).rejects.toMatchObject({
      code: expect.stringMatching(/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/),
    });
  });

  it('crosses the boundary: the host importer loads what the app declares', async () => {
    const hostRoot = makeHostApp(PKG, true);
    const mod = await createHostImporter(hostRoot)(PKG);
    expect(mod.loadedFrom).toBe('host-app');
  });

  it('still refuses a package the app does not declare (the gate is unchanged)', async () => {
    // Present in the app's node_modules but absent from its package.json.
    // Reachability must not substitute for declaration (#4719) — this fix moves
    // where a module is resolved FROM, it does not widen what serve accepts.
    const hostRoot = makeHostApp(PKG, false);
    await expect(createHostImporter(hostRoot)(PKG)).rejects.toMatchObject({
      code: 'MODULE_NOT_FOUND',
    });
  });
});

describe('os serve → cluster block source shape', () => {
  it('loads the cluster gate and driver through the host importer', () => {
    expect(SERVE_SOURCE).toMatch(/await importFromHost\(__clusterPkg\)/);
    expect(SERVE_SOURCE).toMatch(
      /await importFromHost\(`@objectstack\/service-cluster-\$\{__clusterDriver\}`\)/,
    );
  });

  it('never reaches the cluster packages through a bare dynamic import', () => {
    // The exact regression, in both spellings the block used.
    expect(SERVE_SOURCE).not.toMatch(/await import\(__clusterPkg\)/);
    expect(SERVE_SOURCE).not.toMatch(/await import\(`@objectstack\/service-cluster-/);
  });

  it('defines importFromHost ABOVE the cluster block that consumes it', () => {
    const definition = SERVE_SOURCE.indexOf('const importFromHost = createHostImporter(');
    const clusterUse = SERVE_SOURCE.indexOf('await importFromHost(__clusterPkg)');

    expect(definition, 'importFromHost definition not found — was it renamed?').toBeGreaterThan(-1);
    expect(clusterUse, 'cluster gate no longer loads via importFromHost').toBeGreaterThan(-1);

    // `const` in one long boot function: a use above the definition is a
    // temporal-dead-zone throw at boot, and the load it guards is exactly the
    // one that must not fall back to bare resolution.
    expect(
      definition,
      'importFromHost is defined AFTER the cluster block. That is the defect this file '
      + 'pins: every optional load placed above the helper silently resolves from the '
      + "CLI's own node_modules instead of the host app's. Hoist the helper.",
    ).toBeLessThan(clusterUse);
  });

  it('keeps exactly one host-importer definition, so hoisting cannot fork it', () => {
    const definitions = [...SERVE_SOURCE.matchAll(/const importFromHost\s*=/g)];
    expect(definitions).toHaveLength(1);
  });
});
