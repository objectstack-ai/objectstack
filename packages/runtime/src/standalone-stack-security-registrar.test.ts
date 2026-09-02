// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #12892 step 2, driven on the REAL boot. `createStandaloneStack` composes the
// artifact door (`MetadataPlugin({ artifactSource })`) and the artifact's
// `AppPlugin` in one plugin list; the kernel orders their `start()`s; and the
// metadata service is what every consumer then reads — `GET /meta/<kind>`, the
// permission evaluator's `list('permission')`, the seeders' fallback reads.
// The two-reader harness (app-plugin-artifact-forward-conversion.test.ts)
// proves the mechanism per reader. Only a kernel boot can prove the
// COMPOSITION, because "which copy is in the registry" is a question about the
// booted service, not about either plugin alone — and it was answered wrongly
// before: the door registered the parsed copy first, `AppPlugin` overwrote it
// with the raw one last, and the boot was green.
//
// The CONTROL is the same kernel with the pre-step-2 composition: the door plus
// an `AppPlugin` constructed WITHOUT the declaration (the default — byte for
// byte what `createStandaloneStack` composed before this change). It has to
// reproduce the defect, or the fixed leg proves nothing.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from './runtime.js';
import { AppPlugin } from './app-plugin.js';
import { createStandaloneStack } from './standalone-stack.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD. Each is reached below through a dynamic `import()` inside an `it()` body
// (the factory and the kernel boot both import lazily) -- vitest clocks those,
// while collection is clocked against nothing. See
// `scripts/check-test-source-alias.mjs` (the clocked-window rule).
import '@objectstack/metadata';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

/**
 * Same probe artifact as the two-reader harness: a legacy shape in every
 * security collection, an `engines.protocol` floor that opens the door's
 * conversion window. The values asserted below are the door's measured output
 * for these bytes (DOOR_COPY in the harness).
 */
const ARTIFACT = {
  manifest: {
    id: 'com.test.issue-12892-boot',
    name: 'Single Registrar Boot',
    type: 'app',
    version: '2.0.0',
    engines: { protocol: '^17.1.0' },
  },
  roles: [{ name: 'sales_rep', label: 'Sales Rep' }],
  permissions: [
    {
      name: 'support_agent',
      label: 'Support Agent',
      objects: {
        crm_ticket: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowRestore: true, allowPurge: false },
      },
      rowLevelSecurity: [
        { name: 'own_tasks', object: 'crm_task', operation: 'select', using: 'assignee == current_user.email', enabled: true, priority: 10 },
      ],
    },
  ],
  capabilities: [{ name: 'crm.export', label: 'Export CRM data' }],
  sharingRules: [
    {
      name: 'share_open_deals',
      type: 'criteria',
      object: 'crm_deal',
      accessLevel: 'full',
      condition: 'record.status == "open"',
      sharedWith: { type: 'role', value: 'sales_mgr' },
    },
  ],
};

const KINDS = ['position', 'permission', 'capability', 'sharing_rule'] as const;
const BOOT_TIMEOUT = 90_000;

async function boot(plugins: readonly unknown[]) {
  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  for (const p of plugins) await kernel.use(p as any);
  await kernel.bootstrap();
  return kernel;
}

/** What the booted metadata service serves for each security kind. */
async function readSecurity(kernel: any): Promise<Record<(typeof KINDS)[number], any[]>> {
  const metadata = kernel.getService('metadata');
  const out: any = {};
  for (const kind of KINDS) {
    const listed = metadata.list(kind);
    out[kind] = typeof listed?.then === 'function' ? await listed : listed;
  }
  return out;
}

describe('createStandaloneStack — the artifact boot serves ONE copy of each security item, the door\'s (#12892 step 2)', () => {
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

  function writeArtifact(tag: string): { dir: string; artifactPath: string } {
    const dir = mkdtempSync(join(tmpdir(), `os-12892-${tag}-`));
    dirs.push(dir);
    const artifactPath = join(dir, 'objectstack.json');
    writeFileSync(artifactPath, JSON.stringify(ARTIFACT), 'utf-8');
    return { dir, artifactPath };
  }

  it('fixed: after a real boot the metadata service holds the parsed, defaulted, provenance-stamped copy of every item', async () => {
    const { dir, artifactPath } = writeArtifact('fixed');
    const stack = await createStandaloneStack({
      artifactPath,
      projectRoot: dir,
      databaseUrl: 'memory://issue-12892-fixed',
      skipSeedData: true,
      runPlatformMigrations: false,
    });
    const app = stack.plugins.find((p: any) => p?.type === 'app') as AppPlugin;
    expect(app.securityMetadataRegistrar).toBe('artifact-door');

    const kernel = await boot(stack.plugins);
    kernels.push(kernel);
    const got = await readSecurity(kernel);

    // One item per kind — the door's, and nothing shadowing it.
    for (const kind of KINDS) expect(got[kind].map((i: any) => i.name), kind).toHaveLength(1);

    // The read a consumer can make today: the predicate is an OBJECT.
    expect(got.sharing_rule[0].condition).toEqual({ dialect: 'cel', source: 'record.status == "open"' });
    expect(got.sharing_rule[0]).toMatchObject({
      name: 'share_open_deals', active: true, accessLevel: 'edit',
      sharedWith: { type: 'position', value: 'sales_mgr' },
      _packageId: 'com.test.issue-12892-boot', _packageVersion: '2.0.0', _provenance: 'package',
    });
    // The four keys the raw copy lacked on a capability (#12892 step 1).
    expect(got.capability[0]).toMatchObject({
      name: 'crm.export', scope: 'platform',
      _packageId: 'com.test.issue-12892-boot', _packageVersion: '2.0.0', _provenance: 'package',
    });
    expect(got.position[0]).toMatchObject({ name: 'sales_rep', delegatable: false, _packageVersion: '2.0.0' });
    expect(got.permission[0]).toMatchObject({ name: 'support_agent', isDefault: false, _packageVersion: '2.0.0' });
    expect(got.permission[0].objects.crm_ticket).not.toHaveProperty('allowRestore');
    expect(got.permission[0].objects.crm_ticket).toMatchObject({ allowTransfer: false, viewAllRecords: false, modifyAllRecords: false });
    expect(got.permission[0].rowLevelSecurity[0]).not.toHaveProperty('priority');
  }, BOOT_TIMEOUT);

  it('control: the pre-step-2 composition (door + a default AppPlugin) reproduces the raw copy winning', async () => {
    const { dir, artifactPath } = writeArtifact('control');
    const stack = await createStandaloneStack({
      artifactPath,
      projectRoot: dir,
      databaseUrl: 'memory://issue-12892-control',
      skipSeedData: true,
      runPlatformMigrations: false,
    });
    // Swap in the AppPlugin every door-less composition constructs — over the
    // same bytes `loadArtifactBundle` handed the factory — and keep the door.
    const plugins = stack.plugins.map((p: any) =>
      p?.type === 'app' ? new AppPlugin(JSON.parse(readFileSync(artifactPath, 'utf-8'))) : p,
    );
    expect((plugins.find((p: any) => p?.type === 'app') as AppPlugin).securityMetadataRegistrar).toBe('app-plugin');

    const kernel = await boot(plugins);
    kernels.push(kernel);
    const got = await readSecurity(kernel);

    // Still one item per kind — two WRITERS, not two items; the last one wins.
    for (const kind of KINDS) expect(got[kind].map((i: any) => i.name), kind).toHaveLength(1);
    // …and the survivor is the raw copy: the defect this change removes, by
    // type. `_packageVersion` and `scope` are the two keys no other seam can
    // supply (the ObjectQL registry stamps `_packageId`/`_provenance` on the
    // same object during package install, which is why only these two are
    // asserted absent).
    expect(typeof got.sharing_rule[0].condition).toBe('string');
    expect(got.capability[0].scope).toBeUndefined();
    expect(got.capability[0]._packageVersion).toBeUndefined();
  }, BOOT_TIMEOUT);
});
