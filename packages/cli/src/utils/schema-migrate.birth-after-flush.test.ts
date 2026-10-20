// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D10] The birth half `SchemaStack.flushSchemaDdl` runs once a
 * deferred boot's DDL is performed (`recordBirthOfFlushedStore`), at the seam
 * the real-database pins cannot reach: a birth marker that cannot be written.
 *
 * The tables exist and the marker does not, so the first `os serve` would
 * refuse the database as one an earlier release created. The flush must hand
 * that failure to its caller — `os migrate apply` then exits 1 — naming what
 * was not written and the ceremony that certifies such a database, never
 * report success. The real driver, the real guard and the decision itself
 * are `apply.organization-ownership-birth.integration.test.ts`'s.
 */

import { describe, expect, it, vi } from 'vitest';
import { ORGANIZATION_OWNERSHIP_MIGRATION_ID } from '@objectstack/spec/system';
import { recordBirthOfFlushedStore } from './schema-migrate.js';

/** The ceremony's two steps, as the boot refusal prescribes them. */
const CEREMONY_STEPS = [
  'os migrate organization-ownership --out PLAN',
  'os migrate organization-ownership --apply --plan-file PLAN --backup-taken',
];

const engine = { getDriverForObject: () => ({}) };
const kernelWith = (service: unknown) => ({ getService: (name: string) => (name === 'objectql' ? service : undefined) });

describe('recordBirthOfFlushedStore — the birth half after a deferred flush', () => {
  it('hands the runtime its engine and the logger, and resolves when the birth half does', async () => {
    const logger = { info: vi.fn() };
    const recordBirth = vi.fn(async () => null);
    await expect(recordBirthOfFlushedStore(kernelWith(engine), recordBirth, logger)).resolves.toBeUndefined();
    expect(recordBirth).toHaveBeenCalledWith(engine, logger);
  });

  it('a birth marker that cannot be written fails the flush, naming the row, the cause and the ceremony', async () => {
    const cause = new Error('SQLITE_READONLY: attempt to write a readonly database');
    const recordBirth = vi.fn(async () => { throw cause; });
    const failure = await recordBirthOfFlushedStore(kernelWith(engine), recordBirth, undefined).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure!.cause).toBe(cause);
    expect(failure!.message).toContain(ORGANIZATION_OWNERSHIP_MIGRATION_ID);
    expect(failure!.message).toContain(cause.message);
    for (const step of CEREMONY_STEPS) expect(failure!.message).toContain(step);
  });

  it('a kernel with no engine has no ledger to write: nothing is asked', async () => {
    const recordBirth = vi.fn(async () => null);
    await expect(recordBirthOfFlushedStore(kernelWith(undefined), recordBirth, undefined)).resolves.toBeUndefined();
    await expect(
      recordBirthOfFlushedStore({ getService: () => { throw new Error('not registered'); } }, recordBirth, undefined),
    ).resolves.toBeUndefined();
    expect(recordBirth).not.toHaveBeenCalled();
  });
});
