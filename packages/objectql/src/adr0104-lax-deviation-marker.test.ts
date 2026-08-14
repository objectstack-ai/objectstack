// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0104 / #4797 — a scanned certificate that its own deployment overturned.
 *
 * #4769 closed the case where a boot certifies a store it then contradicts.
 * This is the other half, and it starts from a certificate that was earned
 * honestly: `os migrate … --apply` walked the whole store and found it clean.
 *
 * Nothing should be able to make that certificate stale, because once it
 * holds the write path is strict and a non-conforming value is refused. The
 * `OS_ALLOW_LAX_*` escape hatches are the exception, and they exist precisely
 * to relax a deployment that has ALREADY verified. With one on: the value is
 * admitted and persisted, `sys_migration` still reads `verified_at` non-null
 * with `blocking: 0`, and the moment the switch goes off — or another process
 * runs without it — strict returns and rejects the very data this deployment
 * stored. Worse, the same row governs reclamation of released field files, so
 * bytes keep being deleted on the strength of a certificate that is now false.
 *
 * The ruling is to withdraw authority IN PROPORTION TO REVERSIBILITY. A
 * certificate is not a boolean; it is authority over a set of behaviours. One
 * admitted write is not evidence of the same order as a full scan, so it does
 * not revoke the certificate (that would make an explicitly temporary switch a
 * one-way door). It does record a deviation, and while that marker stands the
 * unrecoverable half — deleting bytes — is withheld while everything
 * recoverable keeps running.
 *
 * So each test below names which half it is pinning, and the NEGATIVE pins
 * matter as much as the positive ones: a marker anything but the admit path
 * can set is a foot-gun, not a safety device.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from './engine';
import {
  authorisesIrreversibleAction,
  isDataMigrationFlagVerified,
  FILE_REFERENCES_MIGRATION_ID,
  VALUE_SHAPES_MIGRATION_ID,
  type DataMigrationFlag,
} from '@objectstack/spec/system';
import type { IDataDriver } from '@objectstack/spec/contracts';

type Store = Map<string, Array<Record<string, unknown>>>;

const newStore = (): Store => new Map();

function rowsOf(store: Store, object: string): Array<Record<string, unknown>> {
  let rows = store.get(object);
  if (!rows) {
    rows = [];
    store.set(object, rows);
  }
  return rows;
}

/** Counts the ledger updates a run issues, so the cost pin can be measured. */
interface DriverProbe {
  migrationUpdates: number;
  migrationInserts: number;
}

function makeDriver(store: Store, probe: DriverProbe): IDataDriver {
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return row[k] === v;
    });
  };
  return {
    name: 'default',
    version: '1.0.0',
    async connect() {},
    async disconnect() {},
    // A store that already existed: this boot created nothing, so the
    // fresh-datastore path of #4769 is out of scope by construction and every
    // ledger row here is evidence by SCAN.
    getSchemaSyncStats: () => ({ created: 0, existing: 2 }),
    async find(object: string, ast: any) {
      return rowsOf(store, object).filter((r) => matches(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      return rowsOf(store, object).find((r) => matches(r, ast?.where)) ?? null;
    },
    async count(object: string) { return rowsOf(store, object).length; },
    async create(object: string, data: any) {
      if (object === 'sys_migration') probe.migrationInserts += 1;
      const row = { ...data };
      rowsOf(store, object).push(row);
      return row;
    },
    async update(object: string, id: string, data: any) {
      if (object === 'sys_migration') probe.migrationUpdates += 1;
      const rows = rowsOf(store, object);
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      rows[idx] = { ...rows[idx], ...data };
      return rows[idx];
    },
    async delete() { return true; },
    async bulkCreate(object: string, docs: any[]) {
      for (const d of docs) rowsOf(store, object).push({ ...d });
      return docs;
    },
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
    place: { type: 'location' },
  },
};

/** `sys_migration` as the ledger writer and both gates see it. */
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
  },
};

function boot(store: Store, probe: DriverProbe = { migrationUpdates: 0, migrationInserts: 0 }): ObjectQL {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver(store, probe), true);
  engine.registerApp({
    id: 'showcase_pkg',
    name: 'Showcase',
    objects: [TASK, FLAG_OBJECT],
  } as any);
  return engine;
}

/**
 * The row a REAL `os migrate … --apply` leaves behind: evidence by scan, no
 * `attested: datastore-created-empty` anywhere near it. This is the row #4769
 * deliberately refuses to touch, and the row this card is about.
 */
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
  };
}

const OFF_SHAPE_COVER = 'https://cdn.example.com/placeholder-cover.png';

function flagRow(store: Store, id: string): Record<string, unknown> | undefined {
  return rowsOf(store, 'sys_migration').find((r) => r.id === id);
}

/** The row as the spec predicates read it. */
function asFlag(row: Record<string, unknown> | undefined): DataMigrationFlag | null {
  if (!row) return null;
  return row as unknown as DataMigrationFlag;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the producer: a lax-admitted write records a deviation (#4797)', () => {
  it('marks the row the admitted value contradicts, and leaves verified_at standing', async () => {
    const store = newStore();
    rowsOf(store, 'sys_migration').push(scanCertificate(FILE_REFERENCES_MIGRATION_ID));
    const engine = boot(store);

    // The operator's escape hatch, on a deployment that HAS verified — the
    // only configuration in which this window exists at all.
    vi.stubEnv('OS_ALLOW_LAX_MEDIA_VALUES', '1');
    await expect(
      engine.insert('showcase_task', { id: 't1', title: 'Lax', cover: OFF_SHAPE_COVER }),
    ).resolves.toBeDefined();

    await vi.waitFor(() => {
      const row = flagRow(store, FILE_REFERENCES_MIGRATION_ID);
      expect(row?.deviation_observed_at).toBeTruthy();
      // The certificate itself is NOT torn up: a single write's observation
      // does not overturn a walk of the whole store.
      expect(row?.verified_at).toBeTruthy();
      expect(row?.blocking).toBe(0);
      // And it names the value, so an operator can find what closed the gate.
      const detail = JSON.parse(String(row?.deviation_detail ?? '{}'));
      expect(detail.observed).toBe('lax-admitted-violating-value');
      expect(detail).toMatchObject({ object: 'showcase_task', field: 'cover', type: 'image' });
    });
  });

  it('marks the migration whose contract was broken, and only that one', async () => {
    const store = newStore();
    rowsOf(store, 'sys_migration').push(scanCertificate(FILE_REFERENCES_MIGRATION_ID));
    rowsOf(store, 'sys_migration').push(scanCertificate(VALUE_SHAPES_MIGRATION_ID));
    const engine = boot(store);

    // A `location` is `{lat, lng}`; the display string is the legacy shape.
    vi.stubEnv('OS_ALLOW_LAX_VALUE_SHAPES', '1');
    await expect(
      engine.insert('showcase_task', { id: 't1', title: 'Map', place: '40.7128,-74.0060' }),
    ).resolves.toBeDefined();

    await vi.waitFor(() => {
      expect(flagRow(store, VALUE_SHAPES_MIGRATION_ID)?.deviation_observed_at).toBeTruthy();
    });
    // The file migration attested a different fact and was not contradicted —
    // borrowing the deviation across the two would withdraw authority nothing
    // disproved.
    expect(flagRow(store, FILE_REFERENCES_MIGRATION_ID)?.deviation_observed_at).toBeFalsy();
  });

  it('costs one ledger update per migration id per process, not one per lax write', async () => {
    const store = newStore();
    rowsOf(store, 'sys_migration').push(scanCertificate(FILE_REFERENCES_MIGRATION_ID));
    const probe: DriverProbe = { migrationUpdates: 0, migrationInserts: 0 };
    const engine = boot(store, probe);

    vi.stubEnv('OS_ALLOW_LAX_MEDIA_VALUES', '1');
    for (let i = 0; i < 5; i++) {
      await engine.insert('showcase_task', { id: `t${i}`, title: 'Lax', cover: OFF_SHAPE_COVER });
    }

    await vi.waitFor(() => {
      expect(flagRow(store, FILE_REFERENCES_MIGRATION_ID)?.deviation_observed_at).toBeTruthy();
    });
    // The marker is a latch, not a counter. Five admitted values, one write —
    // otherwise a lax deployment pays a ledger round-trip per row, which is
    // how a safety device gets switched off for being expensive.
    expect(probe.migrationUpdates).toBe(1);
  });
});

describe('the reversibility split: which authority the marker withdraws (#4797)', () => {
  it('withdraws the irreversible half and leaves the recoverable half intact', async () => {
    const store = newStore();
    rowsOf(store, 'sys_migration').push(scanCertificate(FILE_REFERENCES_MIGRATION_ID));
    const engine = boot(store);

    const before = asFlag(flagRow(store, FILE_REFERENCES_MIGRATION_ID));
    expect(isDataMigrationFlagVerified(before)).toBe(true);
    expect(authorisesIrreversibleAction(before)).toBe(true);

    vi.stubEnv('OS_ALLOW_LAX_MEDIA_VALUES', '1');
    await engine.insert('showcase_task', { id: 't1', title: 'Lax', cover: OFF_SHAPE_COVER });
    await vi.waitFor(() => {
      expect(flagRow(store, FILE_REFERENCES_MIGRATION_ID)?.deviation_observed_at).toBeTruthy();
    });

    const after = asFlag(flagRow(store, FILE_REFERENCES_MIGRATION_ID));
    // Recoverable behaviour — strict enforcement once the switch is off,
    // tombstoning a released file into its grace window — keeps its authority.
    expect(isDataMigrationFlagVerified(after)).toBe(true);
    // Unrecoverable behaviour — deleting the bytes — loses it.
    expect(authorisesIrreversibleAction(after)).toBe(false);
  });

  it('still enforces strictly once the escape hatch is off — the marker is not a second lax switch', async () => {
    const store = newStore();
    rowsOf(store, 'sys_migration').push(scanCertificate(FILE_REFERENCES_MIGRATION_ID));

    const lax = boot(store);
    vi.stubEnv('OS_ALLOW_LAX_MEDIA_VALUES', '1');
    await lax.insert('showcase_task', { id: 't1', title: 'Lax', cover: OFF_SHAPE_COVER });
    await vi.waitFor(() => {
      expect(flagRow(store, FILE_REFERENCES_MIGRATION_ID)?.deviation_observed_at).toBeTruthy();
    });
    vi.unstubAllEnvs();

    // Switch off, next process. The certificate still stands, so the write
    // path is strict — which is the whole reason the marker exists, and would
    // be undone by a marker that relaxed enforcement instead of reclamation.
    const strict = boot(store);
    await expect(
      strict.insert('showcase_task', { id: 't2', title: 'Bad', cover: OFF_SHAPE_COVER }),
    ).rejects.toThrow(/invalid image value/i);
  });
});

describe('the negative pins: nothing but the admit path may set the marker (#4797)', () => {
  it('a dry-run preview never marks — a preview that gates a later reclamation is a side effect', async () => {
    const store = newStore();
    rowsOf(store, 'sys_migration').push(scanCertificate(FILE_REFERENCES_MIGRATION_ID));
    const probe: DriverProbe = { migrationUpdates: 0, migrationInserts: 0 };
    const engine = boot(store, probe);

    // `validate()` reports the same admission as a WARNING on a lax
    // deployment. It writes nothing, so it must withdraw nothing.
    vi.stubEnv('OS_ALLOW_LAX_MEDIA_VALUES', '1');
    const preview = await engine.validate('showcase_task', {
      id: 't1', title: 'Preview', cover: OFF_SHAPE_COVER,
    });
    expect(preview.results?.[0]?.warnings?.length).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, 20));
    expect(flagRow(store, FILE_REFERENCES_MIGRATION_ID)?.deviation_observed_at).toBeFalsy();
    expect(probe.migrationUpdates).toBe(0);
  });

  it('a REJECTED write never marks — nothing was admitted, so nothing was contradicted', async () => {
    const store = newStore();
    rowsOf(store, 'sys_migration').push(scanCertificate(FILE_REFERENCES_MIGRATION_ID));
    const probe: DriverProbe = { migrationUpdates: 0, migrationInserts: 0 };
    const engine = boot(store, probe);

    // No escape hatch: the certificate holds and strict refuses the value.
    await expect(
      engine.insert('showcase_task', { id: 't1', title: 'Bad', cover: OFF_SHAPE_COVER }),
    ).rejects.toThrow(/invalid image value/i);

    await new Promise((r) => setTimeout(r, 20));
    expect(flagRow(store, FILE_REFERENCES_MIGRATION_ID)?.deviation_observed_at).toBeFalsy();
    expect(probe.migrationUpdates).toBe(0);
  });

  it('a conforming write never marks, escape hatch or not', async () => {
    const store = newStore();
    rowsOf(store, 'sys_migration').push(scanCertificate(FILE_REFERENCES_MIGRATION_ID));
    const probe: DriverProbe = { migrationUpdates: 0, migrationInserts: 0 };
    const engine = boot(store, probe);

    vi.stubEnv('OS_ALLOW_LAX_MEDIA_VALUES', '1');
    await engine.insert('showcase_task', {
      id: 't1', title: 'Fine', cover: 'file_01H0000000000000000000',
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(flagRow(store, FILE_REFERENCES_MIGRATION_ID)?.deviation_observed_at).toBeFalsy();
    expect(probe.migrationUpdates).toBe(0);
  });

  it('never inserts a row: no certificate means no authority to withdraw', async () => {
    const store = newStore();
    const probe: DriverProbe = { migrationUpdates: 0, migrationInserts: 0 };
    const engine = boot(store, probe); // ledger registered, but empty

    // Warn-first deployment: the value is admitted because nothing was ever
    // certified. Fabricating a row here would invent a migration run that
    // never happened, and reclamation is already closed by the missing row.
    await expect(
      engine.insert('showcase_task', { id: 't1', title: 'Legacy', cover: OFF_SHAPE_COVER }),
    ).resolves.toBeDefined();

    await new Promise((r) => setTimeout(r, 20));
    expect(rowsOf(store, 'sys_migration')).toHaveLength(0);
    expect(probe.migrationInserts).toBe(0);
    expect(probe.migrationUpdates).toBe(0);
  });

  it('leaves an already-unverified row alone — its verdict has been replaced, not weakened', async () => {
    const store = newStore();
    const failed = scanCertificate(FILE_REFERENCES_MIGRATION_ID);
    failed.verified_at = null;
    failed.blocking = 3;
    rowsOf(store, 'sys_migration').push(failed);
    const probe: DriverProbe = { migrationUpdates: 0, migrationInserts: 0 };
    const engine = boot(store, probe);

    await expect(
      engine.insert('showcase_task', { id: 't1', title: 'Legacy', cover: OFF_SHAPE_COVER }),
    ).resolves.toBeDefined();

    await new Promise((r) => setTimeout(r, 20));
    // Both gates are already closed by `verified_at: null`; a marker here
    // would be a diagnostic nobody reads, written on every lax deployment.
    expect(flagRow(store, FILE_REFERENCES_MIGRATION_ID)?.deviation_observed_at).toBeFalsy();
    expect(probe.migrationUpdates).toBe(0);
  });
});

describe('the witness window reopens when the certificate is re-earned (#4797)', () => {
  it('marks again after an in-process migration run cleared the marker', async () => {
    const store = newStore();
    rowsOf(store, 'sys_migration').push(scanCertificate(FILE_REFERENCES_MIGRATION_ID));
    const engine = boot(store);

    vi.stubEnv('OS_ALLOW_LAX_MEDIA_VALUES', '1');
    await engine.insert('showcase_task', { id: 't1', title: 'Lax', cover: OFF_SHAPE_COVER });
    await vi.waitFor(() => {
      expect(flagRow(store, FILE_REFERENCES_MIGRATION_ID)?.deviation_observed_at).toBeTruthy();
    });

    // The operator fixes the data and re-runs the migration in-process; the
    // run clears the marker and tells the engine to re-read.
    const row = flagRow(store, FILE_REFERENCES_MIGRATION_ID)!;
    row.deviation_observed_at = null;
    row.deviation_detail = null;
    engine.invalidateDataMigrationFlags();

    // A deviation AFTER that must be seen. Without reopening the window the
    // once-per-process latch would silence every later deviation for the life
    // of the process — a deployment could re-earn its gate and lose it again
    // with nothing noticing.
    await engine.insert('showcase_task', { id: 't2', title: 'Lax again', cover: OFF_SHAPE_COVER });
    await vi.waitFor(() => {
      expect(flagRow(store, FILE_REFERENCES_MIGRATION_ID)?.deviation_observed_at).toBeTruthy();
    });
  });
});
