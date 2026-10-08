// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// One name, one holder for positions, permission sets and capabilities, at the
// two runtime boot paths a package's catalog items arrive through (maintainer
// ruling Q4 = A on #15196; the rule: `@objectstack/objectql`'s
// `security-catalog-namespace.ts`).
//
// ## Why the refusal is asserted at the boot, not inside the in-memory registrars
//
// Positions also reach the metadata service: `AppPlugin`'s security block
// (`registerInMemory`, the `'app-plugin'` registrar) and the artifact door
// (`MetadataPlugin._registerArtifactBodyCollections`, the `'artifact-door'`
// registrar) write them there, in `start()`. But neither runs
// for a package the engine has not installed first: `AppPlugin.init()` registers
// every package of the bundle through the `manifest` service in Phase 1 — a
// multi-package artifact package by package — and the engine's package door
// refuses the second holder there, before any `start()`. So the boot is the
// door, and these cases boot the REAL compositions: the artifact boot
// (`createStandaloneStack`, door + `'artifact-door'` AppPlugin) and the
// door-less one (`new AppPlugin(stack)`, `'app-plugin'` registrar).
//
// Each refusal is asserted by its ADR-0112 envelope (`code` + `status`) and by
// the two holders it names; the control boots the same shapes with distinct
// names and finds each package's position registered by its door, stamped
// with its own package.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NAMESPACE_CONFLICT_CODE } from '@objectstack/objectql';
import { SecurityPlugin, SECURITY_PLUGIN_ID, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { Runtime } from './runtime.js';
import { AppPlugin } from './app-plugin.js';
import { createStandaloneStack } from './standalone-stack.js';

// [#10126] Pay the first transform of the dist-resolved workspace deps the
// boot reaches through a dynamic `import()` at MODULE LOAD, never inside a
// clocked `it` (`scripts/check-test-source-alias.mjs`).
import '@objectstack/metadata';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

const BOOT_TIMEOUT = 90_000;

type Refusal = Error & { code?: string; status?: number; incomingPackageId?: string; existingHolder?: unknown };

type Names = { position: string; permission: string; capability: string };

/** One name of each catalog type, as a stack declares them. */
const collections = (id: string, names: Names) => ({
  positions: [{ name: names.position, label: `${id} position` }],
  permissions: [{ name: names.permission, label: `${id} set`, objects: {} }],
  capabilities: [{ name: names.capability, label: `${id} capability` }],
});

const manifestOf = (id: string) => ({ id, name: id.split('.').pop(), type: 'app', version: '1.0.0' });

/** An assembled package body (ADR-0130 D4): the manifest's fields, its collections written over them. */
const body = (id: string, names: Names) => ({ ...manifestOf(id), ...collections(id, names) });

/** A single-package stack: `manifest` plus its collections. */
const stackOf = (id: string, names: Names) => ({ manifest: manifestOf(id), ...collections(id, names) });

describe('a package\'s security catalog name another holder holds refuses the boot', () => {
  const dirs: string[] = [];
  const kernels: any[] = [];

  afterEach(async () => {
    for (const k of kernels.splice(0)) {
      try { await k.shutdown(); } catch { /* noop */ }
    }
    for (const d of dirs.splice(0)) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  async function artifactStack(artifact: unknown) {
    const dir = mkdtempSync(join(tmpdir(), 'os-catalog-one-holder-'));
    dirs.push(dir);
    const artifactPath = join(dir, 'objectstack.json');
    writeFileSync(artifactPath, JSON.stringify(artifact), 'utf-8');
    return createStandaloneStack({
      artifactPath,
      projectRoot: dir,
      databaseUrl: ':memory:',
      skipSeedData: true,
      runPlatformMigrations: false,
    });
  }

  /** Boots the plugins; answers the refusal, or `undefined` and the kernel. */
  async function boot(plugins: readonly unknown[]): Promise<{ refusal?: Refusal; kernel: any }> {
    const runtime = new Runtime({ cluster: false });
    const kernel = runtime.getKernel();
    kernels.push(kernel);
    for (const p of plugins) await kernel.use(p as any);
    try {
      await kernel.bootstrap();
      return { kernel };
    } catch (e) {
      return { refusal: e as Refusal, kernel };
    }
  }

  function expectRefusal(refusal: Refusal | undefined, incoming: string, holder: unknown) {
    expect(refusal, 'the boot was refused').toBeDefined();
    expect(refusal!.code).toBe(NAMESPACE_CONFLICT_CODE);
    expect(refusal!.status).toBe(422);
    expect(refusal!.incomingPackageId).toBe(incoming);
    expect(refusal!.existingHolder).toEqual(holder);
  }

  it('artifact boot: two packages of one artifact sharing a position, permission set and capability name', async () => {
    const shared = { position: 'regional_manager', permission: 'regional_set', capability: 'regional.export' };
    const stack = await artifactStack({
      manifest: manifestOf('com.test.catalog-project'),
      packages: [{ manifest: body('com.test.first', shared) }, { manifest: body('com.test.second', shared) }],
    });
    expect((stack.plugins.find((p: any) => p?.type === 'app') as AppPlugin).securityMetadataRegistrar).toBe('artifact-door');

    const { refusal } = await boot(stack.plugins);
    expectRefusal(refusal, 'com.test.second', { kind: 'package', packageId: 'com.test.first' });
    // Every conflicting name in one refusal: the position, the permission set
    // and the capability the first package holds.
    expect((refusal as any).conflicts.map((c: any) => `${c.catalogType}/${c.name}`)).toEqual([
      'position/regional_manager',
      'permission/regional_set',
      'capability/regional.export',
    ]);
  }, BOOT_TIMEOUT);

  it('artifact boot: a package declaring a built-in position', async () => {
    const stack = await artifactStack(
      stackOf('com.test.builtin', { position: 'everyone', permission: 'builtin_probe_set', capability: 'builtin_probe.export' }),
    );
    const { refusal } = await boot(stack.plugins);
    expectRefusal(refusal, 'com.test.builtin', { kind: 'built-in' });
  }, BOOT_TIMEOUT);

  it('door-less boot (`app-plugin` registrar): a second stack declaring a name the first holds', async () => {
    const shared = { position: 'shared_position', permission: 'shared_set', capability: 'shared.export' };
    const stack = await artifactStack(stackOf('com.test.first', shared));
    const second = new AppPlugin(stackOf('com.test.second', shared));
    expect(second.securityMetadataRegistrar).toBe('app-plugin');

    const { refusal } = await boot([...stack.plugins, second]);
    expectRefusal(refusal, 'com.test.second', { kind: 'package', packageId: 'com.test.first' });
  }, BOOT_TIMEOUT);

  // The shape the dogfood fixtures used to compose: an app declaring a
  // permission set AND the same set handed to `plugin-security`'s
  // `defaultPermissionSets`, which declares every entry on that plugin's own
  // manifest. One set, two packages: refused, whichever registers second, with
  // both named. (`os serve` never composes this — it hands the plugin the
  // default's NAME only, `appSecurityPluginOptions`.)
  it('a permission set the app declares AND hands to plugin-security\'s defaultPermissionSets: two holders, refused', async () => {
    const names = { position: 'dup_position', permission: 'dup_set', capability: 'dup.export' };
    const stack = await artifactStack(stackOf('com.test.dup', names));
    const security = new SecurityPlugin({
      defaultPermissionSets: [...securityDefaultPermissionSets, { name: 'dup_set', label: 'handed to the plugin', objects: {} } as never],
    });
    const { refusal } = await boot([...stack.plugins, security]);
    // The app's `AppPlugin` registers first here, so the plugin's is the second holder.
    expectRefusal(refusal, SECURITY_PLUGIN_ID, { kind: 'package', packageId: 'com.test.dup' });
  }, BOOT_TIMEOUT);

  it('CONTROL: the same two-package artifact with distinct names boots, and the door registers each package\'s position under its own package', async () => {
    const stack = await artifactStack({
      manifest: manifestOf('com.test.catalog-project'),
      packages: [
        { manifest: body('com.test.first', { position: 'first_position', permission: 'first_set', capability: 'first.export' }) },
        { manifest: body('com.test.second', { position: 'second_position', permission: 'second_set', capability: 'second.export' }) },
      ],
    });
    const { refusal, kernel } = await boot(stack.plugins);
    expect(refusal).toBeUndefined();
    const metadata = kernel.getService('metadata');
    expect(await metadata.get('position', 'first_position')).toMatchObject({ _packageId: 'com.test.first' });
    expect(await metadata.get('position', 'second_position')).toMatchObject({ _packageId: 'com.test.second' });
  }, BOOT_TIMEOUT);
});
