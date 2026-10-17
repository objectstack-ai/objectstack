// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24086] Over the REAL stack — an `ObjectKernel` with `ObjectQLPlugin` (the
 * real `SchemaRegistry`), a real `SqlDriver` (better-sqlite3, on disk), this
 * package's plugin and the real protocol — both halves of the change:
 *
 *  - **the write is refused.** `protocol.installPackage` judges the whole
 *    manifest by the install door's declaration (`PackageInstallManifestSchema`),
 *    so the manifests cloud's AI authoring used to store — `type:
 *    'application'`, `scope: 'environment'` — and a platform scope are each
 *    answered `400` (`VALIDATION_ERROR` at the boundary), and neither the
 *    registry nor `sys_packages` holds anything afterwards;
 *  - **the read is tolerant.** A row written before the change, with those
 *    same values, is data at rest: the boot hydration replays it as stored,
 *    and the registry serves it after a restart. That tolerance is stated at
 *    the hydration seam (`PackageServicePlugin.start`).
 *
 * The row "written before the change" is put in place through the `package`
 * service's own `publish` — the very write the primitive delegated to.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import { PackageServicePlugin, type PackageService } from './index.js';

type Bag = Record<string, any>;
type Line = { level: 'info' | 'warn' | 'error'; text: string };

const dirs: string[] = [];
const kernels: ObjectKernel[] = [];
afterEach(async () => {
  while (kernels.length) {
    const k = kernels.pop()!;
    if (k.getState() === 'running') await k.shutdown();
  }
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function boot(dir: string) {
  const lines: Line[] = [];
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data.sqlite') },
    useNullAsDefault: true,
  });
  const recorder: Plugin = {
    name: 'test.sqlite-and-log-recorder',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.getService<ObjectQL>('objectql').registerDriver(driver as never, true);
    },
    async start(ctx: PluginContext) {
      const logger = ctx.logger as unknown as Bag;
      for (const level of ['info', 'warn', 'error'] as const) {
        logger[level] = (text: unknown) => { lines.push({ level, text: String(text) }); };
      }
    },
  };
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
  kernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(recorder);
  await kernel.use(new PackageServicePlugin());
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  ql.registry.logLevel = 'silent';
  const packages = kernel.getService<PackageService>('package');
  const protocol = new ObjectStackProtocolImplementation(
    ql as never,
    () => new Map<string, unknown>([['package', packages]]),
  );
  return { kernel, ql, lines, packages, protocol };
}

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-install-primitive-declaration-'));
  dirs.push(dir);
  return dir;
}

async function refusalOf(run: () => Promise<unknown>): Promise<Error & { statusCode?: number }> {
  try {
    await run();
  } catch (e) {
    return e as Error & { statusCode?: number };
  }
  throw new Error('expected the install to be refused, but it resolved');
}

/** The shape cloud's AI authoring (`ensureNamedBasePackage`, `ensureAppPackage`) wrote. */
const AI_BASE = { id: 'com.example.ai-base', name: 'AI base', version: '1.0.0', type: 'application', scope: 'environment' };

const REFUSED: ReadonlyArray<readonly [string, Bag, string]> = [
  ["type 'application'", { id: 'com.example.app-typed', name: 'A', version: '1.0.0', type: 'application' }, 'manifest.type'],
  ["scope 'environment'", { id: 'com.example.env-scoped', name: 'E', version: '1.0.0', type: 'app', scope: 'environment' }, 'manifest.scope'],
  ["scope 'cloud'", { id: 'com.example.cloud-scoped', name: 'C', version: '1.0.0', type: 'app', scope: 'cloud' }, 'manifest.scope'],
];

describe('[#24086] the install primitive refuses what the install declaration refuses — real stack', () => {
  for (const [why, manifest, path] of REFUSED) {
    it(`refuses ${why} with 400 VALIDATION_ERROR, and neither the registry nor sys_packages holds it`, async () => {
      const { ql, packages, protocol } = await boot(freshDir());
      const err = await refusalOf(() => protocol.installPackage({ manifest } as never));
      expect(err.statusCode).toBe(400);
      expect(standardErrorCodeForHttpStatus(err.statusCode!)).toBe('VALIDATION_ERROR');
      expect(err.message).toContain(path);
      expect(ql.registry.getPackage(manifest.id)).toBeUndefined();
      expect(await packages.get(manifest.id)).toBeNull();
    });
  }

  it('CONTROL — a versionless { id, name, type } installs, persists 0.1.0, and survives a restart', async () => {
    const dir = freshDir();
    const first = await boot(dir);
    await first.protocol.installPackage({ manifest: { id: 'com.example.leave', name: 'Leave', type: 'app' } } as never);
    expect(first.ql.registry.getPackage('com.example.leave')).toBeDefined();
    await first.kernel.shutdown();

    const second = await boot(dir);
    const row = second.ql.registry.getPackage('com.example.leave');
    expect(row?.manifest).toMatchObject({ id: 'com.example.leave', version: '0.1.0', type: 'app' });
  });
});

describe('[#24086] rows stored before the change keep hydrating (stated tolerance at the read)', () => {
  it("a stored type 'application' / scope 'environment' row hydrates as stored after a restart", async () => {
    const dir = freshDir();
    const first = await boot(dir);
    expect(await first.packages.publish({ manifest: AI_BASE as never, metadata: {} as never })).toEqual({ success: true });
    await first.kernel.shutdown();

    const second = await boot(dir);
    const row = second.ql.registry.getPackage(AI_BASE.id);
    expect(row, 'the pre-change row was not hydrated').toBeDefined();
    expect(row!.source).toBe('authored');
    expect(row!.manifest).toMatchObject({ type: 'application', scope: 'environment' });
    expect(second.lines.filter((l) => l.level === 'error' && l.text.includes(AI_BASE.id))).toEqual([]);

    // The tolerance is the read's only: a fresh write of the same manifest is refused.
    const err = await refusalOf(() => second.protocol.installPackage({
      manifest: { ...AI_BASE, id: 'com.example.ai-base-two' },
    } as never));
    expect(err.statusCode).toBe(400);
    expect(await second.packages.get('com.example.ai-base-two')).toBeNull();
  });

  // `duplicatePackage` is a RE-ENTRY path for a stored manifest: it spreads the
  // source's stored manifest into `installPackage`. A pre-change AI app
  // (`type: 'application'`, `scope: 'environment'`, an undeclared `icon`) is
  // hydrated by the read, but the copy is a new WRITE, so it is refused, and
  // the refusal reaches the caller rather than being swallowed: ⛔ no
  // tolerance at that write. (`scope` is stripped by the duplicate itself.)
  it('duplicating a pre-change stored app is refused and REPORTED, and the copy is written nowhere', async () => {
    const AI_APP = { ...AI_BASE, id: 'com.example.ai-app', name: 'AI app', icon: 'sparkles' };
    const dir = freshDir();
    const first = await boot(dir);
    expect(await first.packages.publish({ manifest: AI_APP as never, metadata: {} as never })).toEqual({ success: true });
    await first.kernel.shutdown();

    const second = await boot(dir);
    expect(second.ql.registry.getPackage(AI_APP.id), 'the pre-change app was not hydrated').toBeDefined();

    const err = await refusalOf(() => second.protocol.duplicatePackage({
      sourcePackageId: AI_APP.id,
      targetPackageId: 'com.example.ai-app-copy',
    }));
    expect(err.statusCode).toBe(400);
    expect(standardErrorCodeForHttpStatus(err.statusCode!)).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('manifest.type');
    expect(err.message).toContain('icon');
    expect(second.ql.registry.getPackage('com.example.ai-app-copy')).toBeUndefined();
    expect(await second.packages.get('com.example.ai-app-copy')).toBeNull();
  });
});
