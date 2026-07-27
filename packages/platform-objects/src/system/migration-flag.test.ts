// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  readDataMigrationFlag,
  isDataMigrationVerified,
  recordDataMigrationRun,
  type MigrationFlagEngine,
} from './migration-flag.js';

const MIGRATION = 'adr-0104-file-references';

function fakeEngine(rows: Array<Record<string, unknown>> = [], opts: { registered?: boolean } = {}) {
  const tables: Record<string, Array<Record<string, unknown>>> = { sys_migration: rows };
  const engine: MigrationFlagEngine & { tables: typeof tables } = {
    getObject: (name) =>
      name === 'sys_migration' && opts.registered !== false ? { name: 'sys_migration' } : undefined,
    async find(object, options: any) {
      const id = options?.where?.id;
      return (tables[object] ?? []).filter((r) => id === undefined || r.id === id);
    },
    async insert(object, data: any) {
      (tables[object] ??= []).push({ ...data });
      return data;
    },
    async update(object, data: any) {
      const row = (tables[object] ?? []).find((r) => r.id === data.id);
      if (row) Object.assign(row, data);
      return row;
    },
    tables,
  };
  return engine;
}

describe('deployment-level data-migration flags (#3617)', () => {
  it('reads null when no row exists, and the gate stays closed', async () => {
    const engine = fakeEngine();
    expect(await readDataMigrationFlag(engine, MIGRATION)).toBeNull();
    expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(false);
  });

  it('reads null when sys_migration is not registered (bare kernel)', async () => {
    const engine = fakeEngine([{ id: MIGRATION, blocking: 0, verified_at: 'x' }], { registered: false });
    expect(await readDataMigrationFlag(engine, MIGRATION)).toBeNull();
  });

  it('a failing read closes the gate rather than opening it', async () => {
    const engine = fakeEngine();
    engine.find = async () => {
      throw new Error('db down');
    };
    expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(false);
  });

  it('records a passing run: verified_at set, blocking 0 — gate opens', async () => {
    const engine = fakeEngine();
    const flag = await recordDataMigrationRun(engine, {
      migrationId: MIGRATION,
      passed: true,
      blocking: 0,
      advisory: 3,
      applied: true,
      details: { converted: 5 },
    });

    expect(flag.verified_at).toBeTruthy();
    expect(engine.tables.sys_migration).toHaveLength(1);
    expect(engine.tables.sys_migration[0]).toMatchObject({ id: MIGRATION, blocking: 0, advisory: 3 });
    expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(true);
  });

  it('records a failing run: verified_at stays null — gate stays closed', async () => {
    const engine = fakeEngine();
    await recordDataMigrationRun(engine, { migrationId: MIGRATION, passed: false, blocking: 4, applied: true });

    expect(engine.tables.sys_migration[0].verified_at).toBeNull();
    expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(false);
  });

  /**
   * A deployment whose data regressed since it last verified must close its
   * own gate — a later failing run CLEARS verified_at, it does not coast on
   * the earlier pass.
   */
  it('a failing run after a passing one closes the gate again', async () => {
    const engine = fakeEngine();
    await recordDataMigrationRun(engine, { migrationId: MIGRATION, passed: true, blocking: 0, applied: true });
    expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(true);

    await recordDataMigrationRun(engine, { migrationId: MIGRATION, passed: false, blocking: 2 });

    expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(false);
    expect(engine.tables.sys_migration).toHaveLength(1); // upsert, not a second row
  });

  it('preserves applied_at across a verify-only re-run', async () => {
    const engine = fakeEngine();
    await recordDataMigrationRun(engine, { migrationId: MIGRATION, passed: true, blocking: 0, applied: true });
    const appliedAt = engine.tables.sys_migration[0].applied_at;
    expect(appliedAt).toBeTruthy();

    await recordDataMigrationRun(engine, { migrationId: MIGRATION, passed: true, blocking: 0, applied: false });

    expect(engine.tables.sys_migration[0].applied_at).toBe(appliedAt);
  });

  it('a malformed blocking count reads as not-verified, never as zero', async () => {
    const engine = fakeEngine([
      { id: MIGRATION, last_run_at: 'x', verified_at: 'x', blocking: 'garbage' },
    ]);
    expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(false);
  });
});
