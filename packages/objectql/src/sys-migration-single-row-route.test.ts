// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20648 — the engine's own `sys_migration` reads are primary-key lookups, and
 * they reach the driver as ONE: `findOne`, never `find` with `limit: 1`.
 *
 * The SQL driver cannot tell `find({ where: { id }, limit: 1 })` from page one
 * of a walk with page size 1. On a table it has not registered — and at boot
 * `sys_migration` is read before the schema pass registers it — an unsorted
 * paged read makes it warn that the walk is not deterministic. The engine's
 * flag reader runs on every boot and on every `os migrate plan`, so every
 * existing deployment printed that warning for a lookup that cannot return two
 * rows. `findOne` is the single-row route the driver already exempts.
 *
 * The three engine readers are pinned here, each driven through the path that
 * reaches it in production: the gate read (`readMigrationFlagVerified`, behind
 * `isFileReferencesMigrationVerified` / `haveFileColumnsMoved` /
 * `isValueShapesMigrationVerified`), the deviation marker a lax-admitted write
 * records, and the revocation of a creation attestation the boot contradicted.
 * The driver's own half — that `findOne` is exempt and an unsorted `find` page
 * still warns — is pinned end to end against a real SQLite table in
 * `packages/runtime/src/sys-migration-point-lookup.integration.test.ts`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from './engine';
import { FILE_REFERENCES_MIGRATION_ID, VALUE_SHAPES_MIGRATION_ID } from '@objectstack/spec/system';
import type { IDataDriver } from '@objectstack/spec/contracts';

type Store = Map<string, Array<Record<string, unknown>>>;

function rowsOf(store: Store, object: string): Array<Record<string, unknown>> {
  let rows = store.get(object);
  if (!rows) {
    rows = [];
    store.set(object, rows);
  }
  return rows;
}

/** Every read the driver was handed for `sys_migration`, by verb. */
type LedgerRead = { verb: 'find' | 'findOne'; ast: any };

/**
 * Equality only — a combinator read as a field name would answer "no rows" for
 * a filter this double does not implement, which reads exactly like an empty
 * ledger.
 */
function matches(row: Record<string, unknown>, where: any): boolean {
  if (!where || typeof where !== 'object') return true;
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`fake driver: unsupported combinator ${k}`);
    return row[k] === v;
  });
}

function makeDriver(
  store: Store,
  reads: LedgerRead[],
  stats: { created: number; existing: number },
): IDataDriver {
  return {
    name: 'default',
    version: '1.0.0',
    async connect() {},
    async disconnect() {},
    getSchemaSyncStats: () => stats,
    async find(object: string, ast: any) {
      if (object === 'sys_migration') reads.push({ verb: 'find', ast });
      const matched = rowsOf(store, object).filter((r) => matches(r, ast?.where));
      // The caller's bound, AFTER the filter and BY PRESENCE.
      return typeof ast?.limit === 'number' ? matched.slice(0, ast.limit) : matched;
    },
    async findOne(object: string, ast: any) {
      if (object === 'sys_migration') reads.push({ verb: 'findOne', ast });
      return rowsOf(store, object).find((r) => matches(r, ast?.where)) ?? null;
    },
    async count(object: string) { return rowsOf(store, object).length; },
    async create(object: string, data: any) {
      const row = { ...data };
      rowsOf(store, object).push(row);
      return row;
    },
    async update(object: string, id: string, data: any) {
      const rows = rowsOf(store, object);
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      rows[idx] = { ...rows[idx], ...data };
      return rows[idx];
    },
    async delete() { return true; },
    async syncSchema() {},
    async dropTable() {},
  } as unknown as IDataDriver;
}

const TASK = {
  name: 'showcase_task',
  fields: {
    id: { type: 'text' },
    title: { type: 'text' },
    cover: { type: 'image' },
  },
};

const FLAG_OBJECT = {
  name: 'sys_migration',
  fields: {
    id: { type: 'text' },
    last_run_at: { type: 'datetime' },
    verified_at: { type: 'datetime' },
    applied_at: { type: 'datetime' },
    blocking: { type: 'number' },
    advisory: { type: 'number' },
    details: { type: 'textarea' },
    deviation_observed_at: { type: 'datetime' },
    deviation_detail: { type: 'textarea' },
    columns_moved_at: { type: 'datetime' },
  },
};

function boot(store: Store, opts: { created: boolean }): { engine: ObjectQL; reads: LedgerRead[] } {
  const reads: LedgerRead[] = [];
  const engine = new ObjectQL();
  engine.registerDriver(
    makeDriver(store, reads, opts.created ? { created: 2, existing: 0 } : { created: 0, existing: 2 }),
    true,
  );
  engine.registerApp({ id: 'showcase_pkg', name: 'Showcase', objects: [TASK, FLAG_OBJECT] } as any);
  return { engine, reads };
}

/** The row a real `os migrate … --apply` leaves: evidence by scan. */
function scanCertificate(id: string): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id,
    last_run_at: now,
    verified_at: now,
    applied_at: now,
    blocking: 0,
    advisory: 0,
    details: JSON.stringify({ scanned_records: 12_000 }),
    deviation_observed_at: null,
    deviation_detail: null,
    columns_moved_at: null,
  };
}

/** What the fresh-datastore attestation writes when it certifies a store. */
function creationAttestation(id: string): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id,
    last_run_at: now,
    verified_at: now,
    applied_at: null,
    blocking: 0,
    advisory: 0,
    details: JSON.stringify({ attested: 'datastore-created-empty' }),
  };
}

const OFF_SHAPE_COVER = 'https://cdn.example.com/placeholder-cover.png';

/** The ids each read asked for, per verb. */
const idsRead = (reads: LedgerRead[], verb: LedgerRead['verb']) =>
  reads.filter((r) => r.verb === verb).map((r) => r.ast?.where?.id);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('#20648 — the engine reads sys_migration rows through findOne', () => {
  it('the probe is lit: a caller\'s own limit-bound find on sys_migration IS recorded as a find', async () => {
    // Without this, every "no find" below could be a recorder that never sees
    // one. The engine's paging reads still reach the driver as `find`.
    const store: Store = new Map();
    const { engine, reads } = boot(store, { created: false });
    await engine.find('sys_migration', { where: { id: FILE_REFERENCES_MIGRATION_ID }, limit: 1 });
    expect(idsRead(reads, 'find')).toEqual([FILE_REFERENCES_MIGRATION_ID]);
    expect(reads.find((r) => r.verb === 'find')?.ast?.limit).toBe(1);
  });

  it('the gate reads (boot, os migrate plan) are findOne by primary key', async () => {
    const store: Store = new Map();
    rowsOf(store, 'sys_migration').push(
      scanCertificate(FILE_REFERENCES_MIGRATION_ID),
      scanCertificate(VALUE_SHAPES_MIGRATION_ID),
    );
    const { engine, reads } = boot(store, { created: false });

    // `haveFileColumnsMoved` is the read a measured boot and `os migrate plan`
    // reach first; it shares one memoized read with the file gate.
    expect(await engine.haveFileColumnsMoved()).toBe(false);
    expect(await engine.isFileReferencesMigrationVerified()).toBe(true);
    expect(await engine.isValueShapesMigrationVerified()).toBe(true);

    expect(idsRead(reads, 'find')).toEqual([]);
    expect(idsRead(reads, 'findOne')).toEqual([FILE_REFERENCES_MIGRATION_ID, VALUE_SHAPES_MIGRATION_ID]);
  });

  it('the deviation marker a lax-admitted write records reads its row through findOne', async () => {
    const store: Store = new Map();
    rowsOf(store, 'sys_migration').push(scanCertificate(FILE_REFERENCES_MIGRATION_ID));
    const { engine, reads } = boot(store, { created: false });

    vi.stubEnv('OS_ALLOW_LAX_MEDIA_VALUES', '1');
    await expect(
      engine.insert('showcase_task', { id: 't1', title: 'Lax', cover: OFF_SHAPE_COVER }),
    ).resolves.toBeDefined();

    await vi.waitFor(() => {
      const row = rowsOf(store, 'sys_migration').find((r) => r.id === FILE_REFERENCES_MIGRATION_ID);
      expect(row?.deviation_observed_at).toBeTruthy();
    });
    expect(idsRead(reads, 'find')).toEqual([]);
    expect(idsRead(reads, 'findOne')).toContain(FILE_REFERENCES_MIGRATION_ID);
  });

  it('revoking a contradicted creation attestation reads its row through findOne', async () => {
    const store: Store = new Map();
    const { engine, reads } = boot(store, { created: true });
    // The boot reads the ledger before the attestation lands (nothing there),
    // the attestation lands, then the boot admits a value that disproves it.
    await expect(
      engine.insert('showcase_task', { id: 't0', title: 'First', cover: 'file_01H0000000000000000000' }),
    ).resolves.toBeDefined();
    rowsOf(store, 'sys_migration').push(creationAttestation(FILE_REFERENCES_MIGRATION_ID));
    await expect(
      engine.insert('showcase_task', { id: 't1', title: 'Ship it', cover: OFF_SHAPE_COVER }),
    ).resolves.toBeDefined();

    await vi.waitFor(() => {
      const row = rowsOf(store, 'sys_migration').find((r) => r.id === FILE_REFERENCES_MIGRATION_ID);
      expect(row?.verified_at).toBeNull();
    });
    expect(idsRead(reads, 'find')).toEqual([]);
    expect(idsRead(reads, 'findOne')).toContain(FILE_REFERENCES_MIGRATION_ID);
  });
});
