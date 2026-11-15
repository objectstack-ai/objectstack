// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A restart serves the install time the store holds, not the boot time — real
 * stack (ObjectQL + better-sqlite3 on a file + this plugin + the metadata
 * protocol), with the restart a second boot on the same database file.
 *
 * The boot hydrates each `sys_packages` row through `registry.installPackage`,
 * which stamps `installedAt` / `updatedAt` with the moment it runs, as a fresh
 * install must. A row the boot rehydrates is not a fresh install: its install
 * time is the row's `created_at` and its last write is the row's `updated_at`,
 * so the hydrate carries those onto the record the registry serves
 * (`GET /packages/:id` projects that record as-is). `PATCH /packages/:id`
 * already keeps `installedAt`; a restart now keeps it too.
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
  const dir = mkdtempSync(join(tmpdir(), 'os-installed-at-'));
  dirs.push(dir);
  return dir;
}

const ID = 'com.example.qa-pkg-lifecycle-probe';
const manifest = (version: string) => ({ id: ID, name: 'QA Probe', version, scope: 'project', type: 'app' });

/** Pin the clock, so each write carries the instant a test names. */
function at(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

/** The lifecycle stamps the registry record carries — what `GET /packages/:id` serves. */
function stamps(p: Awaited<ReturnType<typeof boot>>) {
  const pkg = p.ql.registry.getPackage(ID) as { installedAt?: string; updatedAt?: string } | undefined;
  return { installedAt: pkg?.installedAt, updatedAt: pkg?.updatedAt };
}

describe('a restart serves the stored install time, not the boot time', () => {
  it('installedAt and updatedAt survive two restarts on the same store', async () => {
    const dir = freshDir();
    at('2026-11-14T10:00:00.000Z');
    const first = await boot(dir);
    await first.protocol.installPackage({ manifest: manifest('1.0.0') });
    expect.soft(stamps(first), 'live, before the restart').toEqual({
      installedAt: '2026-11-14T10:00:00.000Z',
      updatedAt: '2026-11-14T10:00:00.000Z',
    });
    await first.kernel.shutdown();

    at('2026-11-14T11:00:00.000Z');
    const second = await boot(dir);
    expect(stamps(second), 'after the first restart').toEqual({
      installedAt: '2026-11-14T10:00:00.000Z',
      updatedAt: '2026-11-14T10:00:00.000Z',
    });
    await second.kernel.shutdown();

    at('2026-11-14T12:00:00.000Z');
    const third = await boot(dir);
    expect(stamps(third), 'after the second restart').toEqual({
      installedAt: '2026-11-14T10:00:00.000Z',
      updatedAt: '2026-11-14T10:00:00.000Z',
    });
  });

  it('an upgrade restarts as the upgrade: installedAt is the version\'s install, updatedAt its last write', async () => {
    const dir = freshDir();
    at('2026-11-14T10:00:00.000Z');
    const first = await boot(dir);
    await first.protocol.installPackage({ manifest: manifest('1.0.0') });
    at('2026-11-14T10:30:00.250Z');
    await first.protocol.installPackage({ manifest: manifest('2.0.0') });
    expect.soft(stamps(first), 'live, before the restart').toEqual({
      installedAt: '2026-11-14T10:30:00.250Z',
      updatedAt: '2026-11-14T10:30:00.250Z',
    });
    await first.kernel.shutdown();

    at('2026-11-14T11:00:00.000Z');
    const second = await boot(dir);
    // `created_at` is stored to the whole second (`packageRowStamp`), so the
    // install time comes back at that precision; `updated_at` keeps the
    // millisecond (`packageWriteStamp`).
    expect(stamps(second), 'after the restart').toEqual({
      installedAt: '2026-11-14T10:30:00.000Z',
      updatedAt: '2026-11-14T10:30:00.250Z',
    });
  });

  it('a package installed after the restart still stamps its own install time', async () => {
    const dir = freshDir();
    at('2026-11-14T10:00:00.000Z');
    const first = await boot(dir);
    await first.protocol.installPackage({ manifest: manifest('1.0.0') });
    await first.kernel.shutdown();

    at('2026-11-14T11:00:00.000Z');
    const second = await boot(dir);
    at('2026-11-14T11:05:00.000Z');
    await second.protocol.installPackage({ manifest: manifest('2.0.0') });
    expect(stamps(second), 'a fresh install in the second process').toEqual({
      installedAt: '2026-11-14T11:05:00.000Z',
      updatedAt: '2026-11-14T11:05:00.000Z',
    });
  });
});
