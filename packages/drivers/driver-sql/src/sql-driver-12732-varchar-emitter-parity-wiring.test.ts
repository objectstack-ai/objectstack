// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12732 — the WIRING half. `schema-drift.12732-varchar-emitter-parity.test.ts`
 * pins `diffManagedTable`'s predicate directly; this file pins that
 * `SqlDriver.detectTableDrift` actually RESOLVES `keyedColumns` (via
 * `indexedKeyColumns`, from the object's own field-level `unique` /
 * `declaredIndexes`) and BINDS `varcharColumnChars` to the real emitter
 * mirror before calling `diffManagedTable` — the half a purely
 * `diffManagedTable`-level test cannot see, since it takes both as
 * already-resolved inputs.
 *
 * `introspectColumns` / `introspectIndexes` are mocked to a fixed physical
 * shape so this stays a unit test of the wiring, not a live-DB test —
 * `varcharColumnChars` and `indexedKeyColumns` are dialect-independent pure
 * logic (confirmed by reading both), so a real Postgres/MySQL connection
 * would exercise the SAME code path this file already reaches, at DB-call
 * cost. `dialectName` is overridden directly rather than faking a `pg`
 * client config, for the same reason.
 */

import { describe, it, expect, vi } from 'vitest';
import { SqlDriver, type SqlDialectName } from './index.js';

class FakePostgresDriver extends SqlDriver {
  protected get dialectName(): SqlDialectName {
    return 'postgres';
  }
}

const makeDriver = () => {
  const d = new FakePostgresDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  (d as any).logger = { warn: vi.fn(), info: vi.fn() };
  vi.spyOn(d as any, 'introspectColumns').mockResolvedValue([
    { name: 'body', type: 'varchar', nullable: true, maxLength: 255 },
  ]);
  vi.spyOn(d as any, 'introspectIndexes').mockResolvedValue([]);
  return d;
};

describe('SqlDriver.detectTableDrift — threads keyedColumns + varcharColumnChars into diffManagedTable (#12732)', () => {
  it('an UNKEYED bounded text-family field reports no narrow_varchar (Case A, fixed)', async () => {
    const driver = makeDriver();
    const drift = await (driver as any).detectTableDrift('widget', { body: { type: 'text', maxLength: 50 } }, undefined);
    expect(drift.filter((d: any) => d.op.type === 'narrow_varchar')).toHaveLength(0);
  });

  it('the SAME field, declared unique (KEYED via indexedKeyColumns), still reports narrow_varchar', async () => {
    const driver = makeDriver();
    const drift = await (driver as any).detectTableDrift(
      'widget',
      { body: { type: 'text', maxLength: 50, unique: true } },
      undefined,
    );
    const narrow = drift.filter((d: any) => d.op.type === 'narrow_varchar');
    expect(narrow).toHaveLength(1);
    expect(narrow[0].expected).toBe('varchar(50)');
    expect(narrow[0].category).toBe('destructive');
  });

  it('keyedness from a DECLARED composite index (not field-level unique) also threads through', async () => {
    const driver = makeDriver();
    const drift = await (driver as any).detectTableDrift(
      'widget',
      { body: { type: 'signature', maxLength: 80 }, other: { type: 'string' } },
      [{ fields: ['body', 'other'], unique: true }],
    );
    const narrow = drift.filter((d: any) => d.op.type === 'narrow_varchar');
    expect(narrow).toHaveLength(1);
    expect(narrow[0].expected).toBe('varchar(80)');
  });

  it('a base string-family field past the varchar ceiling reports no widen_varchar (Case B, fixed)', async () => {
    const driver = makeDriver();
    const drift = await (driver as any).detectTableDrift('widget', { body: { type: 'email', maxLength: 100000 } }, undefined);
    expect(drift.filter((d: any) => d.op.type === 'widen_varchar')).toHaveLength(0);
  });

  it('a base string-family field AT the ceiling boundary (16383) still reports widen_varchar', async () => {
    const driver = makeDriver();
    const drift = await (driver as any).detectTableDrift('widget', { body: { type: 'email', maxLength: 16383 } }, undefined);
    const widen = drift.filter((d: any) => d.op.type === 'widen_varchar');
    expect(widen).toHaveLength(1);
    expect(widen[0].op).toMatchObject({ to: 16383, from: 255 });
  });
});
