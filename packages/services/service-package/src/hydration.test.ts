// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { PackageServicePlugin } from './index.js';

/**
 * ADR-0033 package-subsystem consolidation — on boot, the package service
 * reconciles durable `sys_packages` rows back into the in-memory registry so a
 * persisted package (e.g. an AI-authored app package) survives a restart and
 * surfaces in the registry-backed read paths (Studio's selector). It must NOT
 * clobber a package already registered (e.g. from the filesystem).
 */
const SEEDED = { id: 'app.seed', name: 'Seed', version: '1.0.0', type: 'application' };

function sysPackagesRow(manifest: Record<string, unknown> = SEEDED) {
  return {
    id: manifest.id,
    version: manifest.version,
    manifest: JSON.stringify(manifest),
    metadata: '{}',
    hash: 'h',
    created_at: 't',
    updated_at: 't',
  };
}

function makeCtx(
  registry: { installPackage: ReturnType<typeof vi.fn>; getPackage: ReturnType<typeof vi.fn> },
  manifest: Record<string, unknown> = SEEDED,
) {
  const execute = vi.fn(async ({ sql }: { sql: string }) => {
    // The latest-per-id list query backs packageService.list() used by hydration.
    if (/SELECT \* FROM sys_packages/i.test(sql)) return { rows: [sysPackagesRow(manifest)] };
    return { rows: [] }; // CREATE TABLE / INDEX / others
  });
  const engine = { execute, registry } as never;
  const services = new Map<string, unknown>([['objectql', engine]]);
  const ctx = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getService: (n: string) => services.get(n),
    registerService: (n: string, s: unknown) => services.set(n, s),
  } as never;
  return { ctx, execute };
}

describe('PackageServicePlugin boot hydration (ADR-0033 consolidation)', () => {
  it('hydrates a persisted sys_packages row into the registry when absent', async () => {
    const registry = {
      installPackage: vi.fn(),
      getPackage: vi.fn(() => undefined), // not yet in registry
    };
    const { ctx } = makeCtx(registry);

    await new PackageServicePlugin().start(ctx);

    expect(registry.getPackage).toHaveBeenCalledWith('app.seed');
    expect(registry.installPackage).toHaveBeenCalledTimes(1);
    expect(registry.installPackage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'app.seed', version: '1.0.0' }),
      'authored',
    );
  });

  // [#23972] The `sys_packages` rehydrate is the restart half of an authored
  // install: the row it puts back must say `source: 'authored'`, the origin the
  // install stamped, never fall to the registry's other doors' values.
  it('rehydrates a sys_packages row as source authored', async () => {
    const registry = {
      installPackage: vi.fn(),
      getPackage: vi.fn(() => undefined),
    };
    const { ctx } = makeCtx(registry);

    await new PackageServicePlugin().start(ctx);

    expect(registry.installPackage.mock.calls.map((call) => call[1])).toEqual(['authored']);
  });

  it('does NOT overwrite a package already registered (e.g. from the filesystem)', async () => {
    const registry = {
      installPackage: vi.fn(),
      getPackage: vi.fn(() => ({ manifest: SEEDED, status: 'installed' })), // already present
    };
    const { ctx } = makeCtx(registry);

    await new PackageServicePlugin().start(ctx);

    expect(registry.getPackage).toHaveBeenCalledWith('app.seed');
    expect(registry.installPackage).not.toHaveBeenCalled();
  });

  // ADR-0087 D1 — the boot-time rehydration path is a LOAD seam: a durable
  // package whose declared engines.protocol excludes this runtime's major is
  // refused with the structured diagnostic (and boot continues), instead of
  // loading and crashing later deep in a schema parse.
  it('refuses to rehydrate a protocol-incompatible package, with the structured diagnostic', async () => {
    const stale = { ...SEEDED, id: 'app.stale', engines: { protocol: '^10' } };
    const registry = {
      installPackage: vi.fn(),
      getPackage: vi.fn(() => undefined),
    };
    const { ctx } = makeCtx(registry, stale);

    await new PackageServicePlugin().start(ctx);

    expect(registry.installPackage).not.toHaveBeenCalled();
    const errors = (ctx as any).logger.error.mock.calls.map((c: unknown[]) => String(c[0]));
    const refusal = errors.find((e: string) => e.includes('OS_PROTOCOL_INCOMPATIBLE'));
    expect(refusal).toBeDefined();
    expect(refusal).toContain('app.stale');
    expect(refusal).toContain('objectstack migrate meta --from 10');
  });

  it('rehydrates a package with no engines range (grandfathered) with a protocol warning', async () => {
    const registry = {
      installPackage: vi.fn(),
      getPackage: vi.fn(() => undefined),
    };
    const { ctx } = makeCtx(registry); // SEEDED declares no engines range

    await new PackageServicePlugin().start(ctx);

    expect(registry.installPackage).toHaveBeenCalledTimes(1);
    const warnings = (ctx as any).logger.warn.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(warnings.filter((w: string) => w.includes('[protocol]'))).toHaveLength(1);
  });
});
