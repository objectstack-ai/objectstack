// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DDL gate tests (ADR-0015 §5.1).
 *
 * A SqlDriver constructed with `schemaMode !== 'managed'` must reject every
 * schema-mutating DDL operation, while a default ('managed') driver behaves
 * exactly as before. This guards the "ObjectStack never mutates an external
 * database's schema" invariant at the single driver choke-point.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { ExternalSchemaModeViolationError } from '@objectstack/spec/shared';

function makeDriver(schemaMode?: 'managed' | 'external' | 'validate-only') {
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    ...(schemaMode ? { schemaMode } : {}),
  });
}

describe('SqlDriver DDL gate (ADR-0015)', () => {
  let driver: SqlDriver;

  afterEach(async () => {
    await driver.disconnect();
  });

  it('defaults to managed mode and allows DDL', async () => {
    driver = makeDriver();
    await expect(
      driver.initObjects([{ name: 'widgets', fields: { sku: { type: 'text' } } }]),
    ).resolves.toBeUndefined();
    // Table actually created.
    const k = (driver as any).knex;
    expect(await k.schema.hasTable('widgets')).toBe(true);
  });

  it('does not pass schemaMode through to Knex config', () => {
    driver = makeDriver('external');
    expect((driver as any).config.schemaMode).toBeUndefined();
    expect((driver as any).config.client).toBe('better-sqlite3');
  });

  it('blocks initObjects (createTable/alterTable) on external mode', async () => {
    driver = makeDriver('external');
    await expect(
      driver.initObjects([{ name: 'widgets', fields: { sku: { type: 'text' } } }]),
    ).rejects.toBeInstanceOf(ExternalSchemaModeViolationError);
    const k = (driver as any).knex;
    expect(await k.schema.hasTable('widgets')).toBe(false);
  });

  it('blocks syncSchema on external mode (delegates to initObjects)', async () => {
    driver = makeDriver('external');
    await expect(
      driver.syncSchema('widgets', { name: 'widgets', fields: {} }),
    ).rejects.toBeInstanceOf(ExternalSchemaModeViolationError);
  });

  it('blocks dropTable on external mode', async () => {
    driver = makeDriver('external');
    await expect(driver.dropTable('widgets')).rejects.toBeInstanceOf(
      ExternalSchemaModeViolationError,
    );
  });

  it('registerExternalObject is DDL-free: does not throw on external mode and creates no table', async () => {
    driver = makeDriver('external');
    expect(() =>
      driver.registerExternalObject!({
        name: 'ext_widget',
        external: { remoteName: 'widgets' },
        fields: { sku: { type: 'text' } },
      }),
    ).not.toThrow();
    const k = (driver as any).knex;
    // No DDL ran — neither the object name nor the remote name was created.
    expect(await k.schema.hasTable('ext_widget')).toBe(false);
    expect(await k.schema.hasTable('widgets')).toBe(false);
  });

  it('also blocks DDL in validate-only mode', async () => {
    driver = makeDriver('validate-only');
    await expect(
      driver.initObjects([{ name: 'widgets', fields: {} }]),
    ).rejects.toBeInstanceOf(ExternalSchemaModeViolationError);
  });

  it('error carries the stable code and reports the schemaMode', async () => {
    driver = makeDriver('external');
    await driver.dropTable('widgets').catch((err: any) => {
      expect(err.code).toBe('EXTERNAL_SCHEMA_MODE_VIOLATION');
      expect(err.message).toContain('external');
    });
  });
});
