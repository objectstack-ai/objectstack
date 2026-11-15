// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The manifest a restart serves is the last one written — real stack (ObjectQL
 * + better-sqlite3 on a file + this plugin + the metadata protocol), with the
 * restart a second boot on the same database file.
 *
 * `sys_packages` keeps one row per `(id, version)`, so an overwrite re-install
 * of a version the package already had (a rollback) UPDATES that old row, and
 * a fresh version INSERTS one beside it. The live process serves the manifest
 * it just installed; a restart serves whichever row the "latest" read picks
 * (the boot hydrates the registry from `list()`). That read used to pick by
 * `created_at`, which an update keeps and which has whole-second precision:
 * a rollback never became latest, and writes within one second tied. It now
 * picks by `updated_at`, the write stamp every write sets, with millisecond
 * precision and strictly increasing within a process (`nextPackageWriteStamp`).
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

/** Stop a booted process, as a restart does. */
async function stop(kernel: ObjectKernel): Promise<void> {
  await kernel.shutdown();
}

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-latest-row-'));
  dirs.push(dir);
  return dir;
}

const ID = 'com.example.qa-rollback';
const manifest = (version: string) => ({ id: ID, name: 'QA rollback', version, scope: 'project', type: 'app' });

/** Pin the clock, so each write carries the instant a test names. */
function at(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

/** What a process serves for the package: the registry (the live read doors) and the store's own latest row. */
async function served(p: Awaited<ReturnType<typeof boot>>) {
  const listed = (await p.packages.list()).filter((r) => r.id === ID);
  return {
    registry: (p.ql.registry.getPackage(ID) as { manifest?: { version?: string } } | undefined)?.manifest?.version,
    latest: (await p.packages.get(ID))?.version,
    listed: listed.map((r) => r.version),
  };
}

describe('the manifest a restart serves is the last one written', () => {
  it('a rollback re-install of a version the package already had survives a restart', async () => {
    const dir = freshDir();
    const first = await boot(dir);

    at('2026-11-14T10:00:00.000Z');
    await first.protocol.installPackage({ manifest: manifest('1.0.0') });
    at('2026-11-14T10:00:02.000Z');
    await first.protocol.installPackage({ manifest: manifest('2.0.0') });
    at('2026-11-14T10:00:04.000Z');
    await first.protocol.installPackage({ manifest: manifest('1.0.0') });
    expect.soft(await served(first), 'live, before the restart').toEqual({ registry: '1.0.0', latest: '1.0.0', listed: ['1.0.0'] });
    await stop(first.kernel);

    at('2026-11-14T10:05:00.000Z');
    const second = await boot(dir);
    expect(await served(second), 'after the restart').toEqual({ registry: '1.0.0', latest: '1.0.0', listed: ['1.0.0'] });
  });

  it('several writes within one second: the restart serves the last of them', async () => {
    const dir = freshDir();
    const first = await boot(dir);

    at('2026-11-14T10:00:00.100Z');
    await first.protocol.installPackage({ manifest: manifest('1.0.0') });
    at('2026-11-14T10:00:00.400Z');
    await first.protocol.installPackage({ manifest: manifest('2.0.0') });
    at('2026-11-14T10:00:00.700Z');
    await first.protocol.installPackage({ manifest: manifest('3.0.0') });
    expect.soft(await served(first), 'live, before the restart').toEqual({ registry: '3.0.0', latest: '3.0.0', listed: ['3.0.0'] });
    await stop(first.kernel);

    at('2026-11-14T10:05:00.000Z');
    const second = await boot(dir);
    expect(await served(second), 'after the restart').toEqual({ registry: '3.0.0', latest: '3.0.0', listed: ['3.0.0'] });
  });

  it('writes within one millisecond still order: the clock standing still does not tie them', async () => {
    const dir = freshDir();
    const first = await boot(dir);

    at('2026-11-14T10:00:00.000Z');
    await first.protocol.installPackage({ manifest: manifest('1.0.0') });
    await first.protocol.installPackage({ manifest: manifest('2.0.0') });
    await first.protocol.installPackage({ manifest: manifest('1.0.0') });
    expect.soft(await served(first), 'live, before the restart').toEqual({ registry: '1.0.0', latest: '1.0.0', listed: ['1.0.0'] });
    await stop(first.kernel);

    const second = await boot(dir);
    expect(await served(second), 'after the restart').toEqual({ registry: '1.0.0', latest: '1.0.0', listed: ['1.0.0'] });
  });
});
