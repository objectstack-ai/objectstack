// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23816 — the two pieces of `bootSchemaStack`'s `deferredDdlUnsupported:
 * 'skip-schema-sync'` posture that decide it, pinned without a database:
 *
 *  - `transportRefusesDeferredDdl` answers `true` exactly for the transport
 *    whose driver refuses deferred DDL (a `turso` datasource whose URL
 *    `TursoDriver.detectMode` reads as `remote`), asked of the driver package,
 *    and `false` for every other resolved database;
 *  - `DeferSchemaDdlPlugin({ exemptPrimary: true })` leaves the engine's
 *    DEFAULT driver un-armed and arms every other driver — the ones it finds
 *    at `init()` and the ones registered afterwards — exactly as without the
 *    exemption; without it, a primary that refuses the arm fails the boot.
 *
 * The end-to-end case (a real `sqld`, the real command) is
 * `organization-ownership.remote-face.integration.test.ts`, which runs only
 * where `OS_TEST_SQLD_BIN` names a server binary; these hold the CLI half in
 * every CI run.
 */

import { describe, expect, it, vi } from 'vitest';
import { DeferSchemaDdlPlugin, transportRefusesDeferredDdl, type SqlDriverLike } from './schema-migrate.js';

describe('transportRefusesDeferredDdl', () => {
  it.each([
    ['turso', 'libsql://tenant.example.turso.io', true],
    ['turso', 'libsql://127.0.0.1:8080?tls=0', true],
    ['turso', 'https://tenant.example.turso.io', true],
    ['turso', 'file:/tmp/os-remote-posture.db', false],
    ['turso', ':memory:', false],
    ['sqlite', 'file:/tmp/os-remote-posture.db', false],
    ['postgres', 'postgres://localhost/app', false],
    ['mysql', 'mysql://localhost/app', false],
  ] as const)('%s %s -> %s', async (driver, url, expected) => {
    expect(await transportRefusesDeferredDdl({ driver, url })).toBe(expected);
  });
});

/** A driver whose arm the remote face refuses, as `TursoDriver.setDeferredDdl` does there. */
function refusingDriver(name: string) {
  return {
    name,
    setDeferredDdl: vi.fn((deferred: boolean) => {
      if (deferred) throw Object.assign(new Error('Deferred schema DDL is not supported by the Turso REMOTE transport'), { code: 'NOT_IMPLEMENTED', status: 501 });
    }),
    detectManagedDrift: vi.fn(async () => []),
    applyMigrationEntries: vi.fn(async () => ({ applied: [], skipped: [] })),
  };
}
/** A driver that defers. */
function deferringDriver(name: string) {
  return {
    name,
    setDeferredDdl: vi.fn(),
    detectManagedDrift: vi.fn(async () => []),
    applyMigrationEntries: vi.fn(async () => ({ applied: [], skipped: [] })),
  };
}

/** A plugin ctx over `services`, with an engine whose default driver is `primary`. */
function ctxWith(primary: unknown, others: Record<string, unknown>) {
  const byName: Record<string, unknown> = { primary, ...others };
  const engine = {
    registerDriver: vi.fn(),
    getDefaultDriverName: () => 'primary',
    getDriverByName: (n: string) => byName[n],
    getDriverForObject: () => primary,
    registry: { getAllObjects: () => [{ name: 'sys_job' }] },
  };
  const services = new Map<string, unknown>([
    ['objectql', engine],
    ['driver.com.objectstack.driver.turso', primary],
    ...Object.entries(others).map(([n, d]) => [`driver.${n}`, d] as [string, unknown]),
  ]);
  return {
    engine,
    ctx: {
      getService: (name: string) => {
        if (!services.has(name)) throw new Error(`no service ${name}`);
        return services.get(name);
      },
      getServices: () => services,
      logger: { debug: () => {} },
    },
  };
}

describe('DeferSchemaDdlPlugin — the primary exemption', () => {
  it('exemptPrimary: the primary is left un-armed, every other driver is armed, at init and after', async () => {
    const primary = refusingDriver('remote');
    const other = deferringDriver('telemetry');
    const later = deferringDriver('declared');
    const { ctx, engine } = ctxWith(primary, { other });
    const plugin = new DeferSchemaDdlPlugin({ exemptPrimary: true });

    await plugin.init(ctx);

    expect(primary.setDeferredDdl).not.toHaveBeenCalled();
    expect(other.setDeferredDdl).toHaveBeenCalledWith(true);
    expect(plugin.drivers).toEqual([other]);

    // A driver handed to the engine afterwards is armed before the engine holds
    // it; the primary handed again is still not.
    (engine as unknown as { registerDriver: (d: unknown) => unknown }).registerDriver(later);
    (engine as unknown as { registerDriver: (d: unknown) => unknown }).registerDriver(primary);
    expect(later.setDeferredDdl).toHaveBeenCalledWith(true);
    expect(primary.setDeferredDdl).not.toHaveBeenCalled();
    expect(plugin.drivers).toEqual([other, later] as unknown as SqlDriverLike[]);
    plugin.release();
  });

  it('the control: without the exemption, a primary that refuses the arm fails the boot', async () => {
    const primary = refusingDriver('remote');
    const { ctx } = ctxWith(primary, {});
    const plugin = new DeferSchemaDdlPlugin();

    await expect(plugin.init(ctx)).rejects.toThrow('Deferred schema DDL is not supported by the Turso REMOTE transport');
    expect(primary.setDeferredDdl).toHaveBeenCalledWith(true);
    plugin.release();
  });

  it('exemptPrimary exempts only the engine\'s default driver: another refusing driver still fails the boot', async () => {
    const primary = deferringDriver('local');
    const remoteSibling = refusingDriver('remote');
    const { ctx } = ctxWith(primary, { remoteSibling });
    const plugin = new DeferSchemaDdlPlugin({ exemptPrimary: true });

    await expect(plugin.init(ctx)).rejects.toThrow('Deferred schema DDL is not supported by the Turso REMOTE transport');
    expect(primary.setDeferredDdl).not.toHaveBeenCalled();
    plugin.release();
  });
});
