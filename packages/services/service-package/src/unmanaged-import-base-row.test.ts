// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31530] The unmanaged import's `baseInstance` is the base `sys_packages` row
 * as the store holds it after the write — real stack (ObjectQL + better-sqlite3
 * + this plugin + the metadata protocol), measured against a later store read.
 *
 * The import refuses a `targetPackageId` the REGISTRY holds, never one only the
 * store holds, so an import can reach an `(id, version)` row that is already
 * stored. Two ways measured here:
 *
 *  - one process: a stored base the boot did not hydrate (here its
 *    `engines.protocol` excludes this runtime, so the boot refuses it and its
 *    row remains);
 *  - two processes on one store: a second process booted before the first
 *    process's import, so its registry never saw that base.
 *
 * The upsert keeps an existing row's `created_at`, so the answer must name
 * THAT, or the install-local copy record is tied to a stamp the row does not
 * hold and the purge answers 404 for a copy that was installed.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { PackageServicePlugin, type PackageService } from './index.js';

const dirs: string[] = [];
const kernels: ObjectKernel[] = [];
afterEach(async () => {
  vi.useRealTimers();
  while (kernels.length) {
    const k = kernels.pop()!;
    if (k.getState() === 'running') await k.shutdown();
  }
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function boot(dir: string) {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data.sqlite') },
    useNullAsDefault: true,
  });
  const quiet: Plugin = {
    name: 'test.sqlite-quiet',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.getService<ObjectQL>('objectql').registerDriver(driver as never, true);
    },
    async start(ctx: PluginContext) {
      const logger = ctx.logger as unknown as Record<string, unknown>;
      for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = () => {};
    },
  };
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
  kernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(quiet);
  await kernel.use(new PackageServicePlugin());
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  ql.registry.logLevel = 'silent';
  const packages = kernel.getService<PackageService>('package');
  const protocol: any = new ObjectStackProtocolImplementation(
    ql as never,
    () => new Map<string, unknown>([['package', packages]]),
  );
  return { kernel, ql, packages, protocol };
}

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-31530-base-row-'));
  dirs.push(dir);
  return dir;
}

/** A source with no items: the import writes its base and copies nothing. */
const SOURCE = { id: 'com.acme.src', name: 'Source', version: '1.0.0', type: 'app', namespace: 'acme' };
const BASE_ID = 'com.acme.src-copy';

/** Pin the clock to a second, so two writes a test makes carry two stamps. */
function at(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

describe('[#31530] the import names the base row the store holds after its write — real stack', () => {
  it('CONTROL — a new base: baseInstance is what a later store read answers', async () => {
    const { protocol, packages } = await boot(freshDir());
    at('2026-11-08T15:00:00.000Z');
    const result = await protocol.importUnmanagedPackage({ manifest: SOURCE });
    const row = await packages.get(BASE_ID, '1.0.0');
    expect(result.baseInstance).toEqual({ version: '1.0.0', createdAt: '2026-11-08 15:00:00' });
    expect(result.baseInstance).toEqual({ version: row?.version, createdAt: row?.created_at });
  });

  it('one process: a stored base the boot did not hydrate — the import reaches its row, and baseInstance names the row\'s own created_at', async () => {
    const dir = freshDir();
    const first = await boot(dir);
    at('2026-11-08T15:00:00.000Z');
    expect(await first.packages.publish({
      manifest: { id: BASE_ID, name: 'Stale base', version: '1.0.0', type: 'app', engines: { protocol: '^999.0.0' } } as never,
      metadata: {} as never,
    })).toMatchObject({ success: true });
    await first.kernel.shutdown();

    vi.useRealTimers();
    const second = await boot(dir);
    expect(second.ql.registry.getPackage(BASE_ID), 'precondition: the boot refused to hydrate the stored base').toBeUndefined();
    expect((await second.packages.get(BASE_ID, '1.0.0'))?.created_at, 'precondition: its row remains').toBe('2026-11-08 15:00:00');

    at('2026-11-08T16:30:00.000Z');
    const result = await second.protocol.importUnmanagedPackage({ manifest: SOURCE });
    expect(result.targetPackageId).toBe(BASE_ID);
    const row = await second.packages.get(BASE_ID, '1.0.0');
    expect(row?.created_at, 'the upsert keeps the existing row\'s created_at').toBe('2026-11-08 15:00:00');
    expect(result.baseInstance).toEqual({ version: row?.version, createdAt: row?.created_at });
  });

  it('two processes on one store: the second imports the base the first wrote after it booted — baseInstance names the row\'s own created_at', async () => {
    const dir = freshDir();
    const a = await boot(dir);
    const b = await boot(dir);

    at('2026-11-08T15:00:00.000Z');
    const fromA = await a.protocol.importUnmanagedPackage({ manifest: SOURCE });
    expect(fromA.baseInstance).toEqual({ version: '1.0.0', createdAt: '2026-11-08 15:00:00' });
    expect(b.ql.registry.getPackage(BASE_ID), 'precondition: B\'s registry never saw A\'s base').toBeUndefined();

    at('2026-11-08T16:30:00.000Z');
    const fromB = await b.protocol.importUnmanagedPackage({ manifest: SOURCE });
    const row = await b.packages.get(BASE_ID, '1.0.0');
    expect(row?.created_at).toBe('2026-11-08 15:00:00');
    expect(fromB.baseInstance).toEqual({ version: row?.version, createdAt: row?.created_at });
  });
});
