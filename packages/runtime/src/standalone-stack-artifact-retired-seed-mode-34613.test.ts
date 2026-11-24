// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#34613] A compiled artifact built before the seed modes `insert` and
// `replace` were retired still boots, and only that dataset is refused.
//
// The composition is the one `os serve` / `os start` / `os dev` boot
// (`createStandaloneStack`): the artifact door (`MetadataPlugin`), which
// strict-parses the definition, and the `AppPlugin` that seeds from the same
// bytes. `SeedSchema.mode` refuses both retired values, so before the door
// withheld such a dataset from its parse, one stale seed dataset aborted the
// whole boot: no object registered, no other dataset loaded (L2 review M1 on
// PR #34791). Ruling 6942780880 item 2 asks for the opposite, and this file
// drives the real boot to the seeder:
//
//   - the artifact's object registers and its keyed dataset lands, once;
//   - the retired dataset writes nothing, with `insert` and with `replace`;
//   - CONTROL: a mode that was never a seed mode is still the door's parse
//     refusal, for the whole boot, exactly as before.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ObjectQL } from '@objectstack/objectql';
import { Runtime } from './runtime.js';
import { createStandaloneStack } from './standalone-stack.js';

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/metadata';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

const BOOT_TIMEOUT = 90_000;
const SYSTEM = { context: { isSystem: true } } as const;

const artifact = (staleMode: string) => ({
  manifest: { id: 'com.test.retired-seed-mode', name: 'retired_seed_mode', type: 'app', version: '1.0.0', namespace: 'rsm' },
  objects: [
    { name: 'rsm_region', label: 'Region', tenancy: { enabled: false }, fields: { name: { type: 'text', label: 'Name' } } },
    { name: 'rsm_source', label: 'Source', tenancy: { enabled: false }, fields: { name: { type: 'text', label: 'Name' } } },
  ],
  data: [
    { object: 'rsm_region', externalId: 'name', records: [{ name: 'emea' }, { name: 'apac' }] },
    { object: 'rsm_source', mode: staleMode, records: [{ name: 'web' }] },
  ],
});

describe('#34613 — a compiled artifact carrying a retired seed mode boots; only that dataset is refused', () => {
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

  async function bootOverArtifact(staleMode: string) {
    const dir = mkdtempSync(join(tmpdir(), 'os-retired-seed-mode-'));
    dirs.push(dir);
    const artifactPath = join(dir, 'objectstack.json');
    writeFileSync(artifactPath, JSON.stringify(artifact(staleMode)), 'utf-8');
    const stack = await createStandaloneStack({
      artifactPath,
      projectRoot: dir,
      databaseUrl: ':memory:',
      runPlatformMigrations: false,
    });
    const runtime = new Runtime({ cluster: false });
    const kernel = runtime.getKernel();
    kernels.push(kernel);
    for (const p of stack.plugins) await kernel.use(p as any);
    await kernel.bootstrap();
    return kernel;
  }

  it.each([['insert'], ['replace']])('`%s`: the boot completes, the object registers, the keyed dataset lands, the stale one writes nothing', async (staleMode) => {
    const kernel = await bootOverArtifact(staleMode);
    const ql = kernel.getService<ObjectQL>('objectql');

    expect(ql.registry.getObject('rsm_source'), 'the object of the refused dataset still registers').toBeDefined();
    const regions = await ql.find('rsm_region', { where: {}, ...SYSTEM } as never);
    expect((regions as Array<{ name: string }>).map((r) => r.name).sort()).toEqual(['apac', 'emea']);
    expect(await ql.find('rsm_source', { where: {}, ...SYSTEM } as never)).toEqual([]);
  }, BOOT_TIMEOUT);

  it('CONTROL: a mode that was never a seed mode is still the artifact door’s parse refusal', async () => {
    await expect(bootOverArtifact('merge')).rejects.toThrow(/mode/);
  }, BOOT_TIMEOUT);
});
