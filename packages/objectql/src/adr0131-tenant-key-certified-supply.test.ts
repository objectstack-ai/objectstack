// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [18.x step 7b-1] The kernel→driver supply seam for "is this database
 * certified", from the ENGINE's side (ADR-0131 D1).
 *
 * A SQL driver reads an earlier release's `COALESCE(<tenant>, '__global__')`
 * key part as the plain tenant column new DDL keys only where the tenant
 * column holds no NULL. A ceremony-upgraded store whose column stayed nullable
 * (a rotation shard, a Turso remote table, a reported table) proves that only
 * by its certificate: the ownership row in `sys_migration`, verified, at this
 * release's shape generation — a birth marker or the ceremony's own marker.
 * The engine reads it; the driver is handed the question. The driver's half
 * is pinned in `@objectstack/driver-sql`
 * (`sql-driver-tenant-key-equivalence.test.ts`).
 *
 * Every way of not knowing answers `false`, the reading under which the differ
 * keeps the two forms distinct and never proposes a rebuild on a guess.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine';
import {
  ORGANIZATION_OWNERSHIP_MIGRATION_ID,
  ORGANIZATION_OWNERSHIP_SHAPE_GENERATION,
} from '@objectstack/spec/system';
import type { IDataDriver } from '@objectstack/spec/contracts';

type Rows = Array<Record<string, unknown>>;

/** Equality only; a combinator read as a field name would answer a silent "no rows". */
function matches(row: Record<string, unknown>, where: any): boolean {
  if (!where || typeof where !== 'object') return true;
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`fake driver: unsupported combinator ${k}`);
    return row[k] === v;
  });
}

interface Sink {
  resolver: (() => Promise<boolean>) | null;
}

function boot(rows: Rows, opts: { sink?: Sink; readThrows?: boolean; withFlagObject?: boolean } = {}): ObjectQL {
  const driver: Record<string, unknown> = {
    name: 'default',
    version: '1.0.0',
    async connect() {},
    async disconnect() {},
    async find(_object: string, ast: any) {
      const found = rows.filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? found.slice(0, ast.limit) : found;
    },
    async findOne(_object: string, ast: any) {
      if (opts.readThrows) throw new Error('relation "sys_migration" does not exist');
      return rows.find((r) => matches(r, ast?.where)) ?? null;
    },
    async count() {
      return rows.length;
    },
    async create(_object: string, data: any) {
      rows.push({ ...data });
      return data;
    },
    async update() {
      return null;
    },
    async delete() {
      return true;
    },
    async syncSchema() {},
    async dropTable() {},
  };
  if (opts.sink) {
    const sink = opts.sink;
    driver.setTenantKeyCertifiedResolver = (resolve: () => Promise<boolean>) => {
      sink.resolver = resolve;
    };
  }
  const engine = new ObjectQL();
  engine.registerDriver(driver as unknown as IDataDriver, true);
  const flagObject = {
    name: 'sys_migration',
    fields: {
      id: { type: 'text' },
      last_run_at: { type: 'datetime' },
      verified_at: { type: 'datetime' },
      blocking: { type: 'number' },
      details: { type: 'textarea' },
    },
  };
  const task = { name: 'showcase_task', fields: { id: { type: 'text' }, title: { type: 'text' } } };
  engine.registerApp({
    id: 'showcase_pkg',
    name: 'Showcase',
    objects: opts.withFlagObject === false ? [task] : [task, flagObject],
  } as any);
  return engine;
}

const NOW = '2026-10-20T04:00:00.000Z';
const certified = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: ORGANIZATION_OWNERSHIP_MIGRATION_ID,
  last_run_at: NOW,
  verified_at: NOW,
  blocking: 0,
  details: JSON.stringify({ checkpoint: { shapeGeneration: ORGANIZATION_OWNERSHIP_SHAPE_GENERATION } }),
  ...over,
});

describe('[ADR-0131 D1] isOrganizationOwnershipCertified()', () => {
  it("the ceremony's verified marker at the current shape generation certifies", async () => {
    expect(await boot([certified()]).isOrganizationOwnershipCertified()).toBe(true);
  });

  it('so does a birth marker', async () => {
    const birth = certified({
      details: JSON.stringify({ birth: { shapeGeneration: ORGANIZATION_OWNERSHIP_SHAPE_GENERATION } }),
    });
    expect(await boot([birth]).isOrganizationOwnershipCertified()).toBe(true);
  });

  it('every way of not knowing answers false', async () => {
    expect(await boot([]).isOrganizationOwnershipCertified(), 'no row').toBe(false);
    expect(await boot([certified({ verified_at: null })]).isOrganizationOwnershipCertified(), 'unverified').toBe(false);
    expect(await boot([certified({ blocking: 3 })]).isOrganizationOwnershipCertified(), 'blocking findings').toBe(false);
    expect(
      await boot([certified({ details: JSON.stringify({ checkpoint: { shapeGeneration: ORGANIZATION_OWNERSHIP_SHAPE_GENERATION - 1 } }) })])
        .isOrganizationOwnershipCertified(),
      'an older shape generation',
    ).toBe(false);
    expect(await boot([certified({ details: null })]).isOrganizationOwnershipCertified(), 'no generation named').toBe(false);
    expect(await boot([certified()], { readThrows: true }).isOrganizationOwnershipCertified(), 'unreadable').toBe(false);
    expect(await boot([certified()], { withFlagObject: false }).isOrganizationOwnershipCertified(), 'no ledger object').toBe(
      false,
    );
  });

  it('registerDriver hands a driver with the seam a closure over the same reading', async () => {
    const rows: Rows = [];
    const sink: Sink = { resolver: null };
    boot(rows, { sink });
    expect(sink.resolver).toBeTypeOf('function');
    expect(await sink.resolver!()).toBe(false);
    // A question, not a value: the answer follows the ledger at the moment it is asked.
    rows.push(certified());
    expect(await sink.resolver!()).toBe(true);
  });

  it('a driver without the seam is left alone', () => {
    expect(() => boot([])).not.toThrow();
  });
});
