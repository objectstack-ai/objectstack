// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3, ADR-0066 D1] The curated platform capabilities as declared
 * `capability` metadata, read off a REAL boot of this plugin: what the security
 * catalog read lists, what the boot writes into `sys_capability`, and what the
 * capability seeders report.
 *
 * The boot is the plugin's own — `init`, `start`, then its `kernel:ready`
 * handlers in registration order (both capability seeding passes included) —
 * over a real `ObjectQL` engine on a SQLite file, so a second boot can open the
 * database the first one seeded.
 *
 * ## The scenarios
 *
 * Two postures (`single`, walled), each booted on a fresh database and on a
 * database the seeders already populated, and each with the stack's own
 * capability declared one of two ways:
 *
 *  - `in the registry` — a package manifest's `capabilities`, the way a stack
 *    reaches the engine registry;
 *  - `in the metadata service only` — what the declared-capability seeder
 *    reads when the registry holds no package declaration.
 *
 * ## The expected values
 *
 * Read off the producers, never off a registry: the curated entries from
 * `PLATFORM_CAPABILITIES`, the stack's from its declaration. The census is the
 * one the boot wrote before the curated capabilities were declared — the
 * curated pass's rows plus the stack's package row — which is why an
 * unchanged census is the pin that the declarations changed no row.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { createSecurityCatalogReader, resetPlatformAdminEmailMemo } from '@objectstack/core';
import { PLATFORM_CAPABILITIES } from '@objectstack/spec/security';
import { SysUser, SysAccount, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';

import { SecurityPlugin } from './security-plugin.js';
import { securityObjects, SECURITY_PLUGIN_ID } from './manifest.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { CAPABILITY_PLATFORM_NAME_REFUSED } from './seed-refusal-diagnostics.js';

const SYS = { isSystem: true } as const;
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const STACK_PACKAGE = 'com.example.field';

/** The stack's own capability. `packageId` lets the metadata-service copy name its owner. */
const STACK_CAPABILITY = {
  name: 'field.export',
  label: 'Export Field Data',
  description: 'Export the territory records.',
  scope: 'org',
  packageId: STACK_PACKAGE,
} as const;

type Posture = 'single' | 'isolated';
type Declared = 'in the registry' | 'in the metadata service only';

interface Booted {
  engine: ObjectQL;
  metadata: { get(type: string, name: string): unknown; list(type: string): unknown };
  /** Every line the boot logged at `warn`, through the logger or the console. */
  warnings: string[];
  /** Every `sys_capability` insert and update the boot made, by row name. */
  writes: string[];
}

async function boot(filename: string, posture: Posture, declared: Declared): Promise<Booted> {
  delete process.env[POSTURE_ENV];
  delete process.env[OWNER_ENV];
  if (posture === 'isolated') {
    process.env[POSTURE_ENV] = 'isolated';
    process.env[OWNER_ENV] = 'admin@cap.example';
  }
  resetPlatformAdminEmailMemo();

  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.builtin-capability-boot',
    name: 'Built-in capability boot',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUser, SysAccount, SysMember, SysOrganization, ...securityObjects],
  } as any);
  if (declared === 'in the registry') {
    engine.registerApp({
      id: STACK_PACKAGE,
      name: 'Field',
      version: '1.0.0',
      type: 'app',
      capabilities: [{ ...STACK_CAPABILITY }],
    } as any);
  }
  await engine.syncSchemas();

  const writes: string[] = [];
  const idToName = new Map<string, string>();
  const insert = engine.insert.bind(engine);
  const update = engine.update.bind(engine);
  (engine as any).insert = async (object: string, data: any, opts?: any) => {
    if (object === 'sys_capability') {
      for (const row of Array.isArray(data) ? data : [data]) {
        if (row?.id) idToName.set(String(row.id), String(row.name));
        writes.push(`insert ${row?.name}`);
      }
    }
    return insert(object, data, opts);
  };
  (engine as any).update = async (object: string, data: any, opts?: any) => {
    if (object === 'sys_capability') writes.push(`update ${idToName.get(String(data?.id)) ?? `id:${String(data?.id)}`}`);
    return update(object, data, opts);
  };

  const metadata = {
    get: async (type: string, name: string) =>
      type === 'capability' && declared === 'in the metadata service only' && name === STACK_CAPABILITY.name
        ? { ...STACK_CAPABILITY }
        : null,
    list: async (type: string) => {
      if (type === 'capability') return declared === 'in the metadata service only' ? [{ ...STACK_CAPABILITY }] : [];
      if (type === 'permission') return [...defaultPermissionSets];
      return [];
    },
  };
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata,
    ...(posture === 'isolated'
      ? { 'org-scoping': { name: 'com.objectstack.org-scoping' }, tenancy: { posture: 'isolated' } }
      : {}),
  };
  const warnings: string[] = [];
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
    warnings.push(String(message));
  });
  const hooks = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const ctx: any = {
    logger: {
      info: vi.fn(),
      warn: vi.fn((message: unknown) => warnings.push(String(message))),
      error: vi.fn(),
      debug: vi.fn(),
    },
    hook: (name: string, handler: (...args: unknown[]) => unknown) => {
      hooks.set(name, [...(hooks.get(name) ?? []), handler]);
    },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  try {
    const plugin = new SecurityPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
    const exists = await engine.find('sys_user', { where: { id: 'usr_admin' }, limit: 1, context: SYS });
    if (!Array.isArray(exists) || exists.length === 0) {
      await engine.insert(
        'sys_user',
        { id: 'usr_admin', email: 'admin@cap.example', name: 'admin', created_at: '2025-01-01T00:00:00.000Z', email_verified: true },
        { context: SYS } as any,
      );
    }
    for (const handler of hooks.get('kernel:ready') ?? []) await handler();
  } finally {
    consoleWarn.mockRestore();
  }
  return { engine, metadata, warnings, writes };
}

/** The `sys_capability` rows, one string per row. */
async function census(engine: ObjectQL): Promise<string[]> {
  const rows = (await engine.find('sys_capability', { where: {}, limit: 5000, context: SYS })) as any[];
  return rows
    .map((r) => [r.name, r.managed_by, r.package_id ?? '-', r.label, r.description ?? '-', r.scope, r.active].join(' | '))
    .sort();
}

/** The census the boot writes, read off the producers (module doc). */
const EXPECTED_CENSUS = [
  ...PLATFORM_CAPABILITIES.map((c) => [c.name, 'platform', '-', c.label, c.description, c.scope, true].join(' | ')),
  [STACK_CAPABILITY.name, 'package', STACK_PACKAGE, STACK_CAPABILITY.label, STACK_CAPABILITY.description, STACK_CAPABILITY.scope, true].join(' | '),
].sort();

const SCENARIOS: ReadonlyArray<{ posture: Posture; declared: Declared }> = [
  { posture: 'single', declared: 'in the registry' },
  { posture: 'single', declared: 'in the metadata service only' },
  { posture: 'isolated', declared: 'in the registry' },
  { posture: 'isolated', declared: 'in the metadata service only' },
];

describe.each(SCENARIOS)('a $posture boot, the stack capability $declared', ({ posture, declared }) => {
  let dir: string;
  let fresh: Booted;
  let reseeded: Booted;
  const envBefore = { posture: process.env[POSTURE_ENV], owner: process.env[OWNER_ENV] };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-builtin-capabilities-'));
    const filename = join(dir, 'boot.sqlite');
    fresh = await boot(filename, posture, declared);
    // The same database, opened by a second boot after the first one seeded it.
    reseeded = await boot(filename, posture, declared);
  }, 120_000);

  afterAll(async () => {
    for (const b of [fresh, reseeded]) {
      try { await b?.engine.destroy(); } catch { /* noop */ }
    }
    rmSync(dir, { recursive: true, force: true });
    if (envBefore.posture === undefined) delete process.env[POSTURE_ENV];
    else process.env[POSTURE_ENV] = envBefore.posture;
    if (envBefore.owner === undefined) delete process.env[OWNER_ENV];
    else process.env[OWNER_ENV] = envBefore.owner;
  });

  it('the catalog read lists every curated capability, from the registry, owned by this plugin, with its curated fields', async () => {
    for (const booted of [fresh, reseeded]) {
      const reader = createSecurityCatalogReader({ registry: (booted.engine as any).registry, metadata: booted.metadata as any });
      const listed = await reader.list('capability');
      expect(listed.map((e) => e.name).sort()).toEqual([...PLATFORM_CAPABILITIES.map((c) => c.name), STACK_CAPABILITY.name].sort());
      for (const curated of PLATFORM_CAPABILITIES) {
        const entry = await reader.resolve('capability', curated.name);
        expect(entry?.source, curated.name).toBe('registry');
        expect(entry?.packageId, curated.name).toBe(SECURITY_PLUGIN_ID);
        const definition = entry?.definition as Record<string, unknown> | undefined;
        expect(
          { name: definition?.name, label: definition?.label, description: definition?.description, scope: definition?.scope },
          curated.name,
        ).toEqual({ ...curated });
      }
    }
  });

  it('the boot writes the census it wrote before the declarations, on a fresh and on a seeded database', async () => {
    expect(await census(fresh.engine)).toEqual(EXPECTED_CENSUS);
    expect(await census(reseeded.engine)).toEqual(EXPECTED_CENSUS);
    // The seeded database needs no write at all: every row already reads as declared.
    expect(reseeded.writes).toEqual([]);
  });

  it('no capability seeder refuses or reports the platform’s own declarations', () => {
    for (const booted of [fresh, reseeded]) {
      expect(booted.warnings.filter((w) => w.includes(CAPABILITY_PLATFORM_NAME_REFUSED))).toEqual([]);
      expect(booted.warnings.filter((w) => w.includes('capabilit'))).toEqual([]);
    }
  });
});
