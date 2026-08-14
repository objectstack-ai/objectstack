// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0104 / #4769 — a boot may not prove a contract it violates in that same
 * boot.
 *
 * The defect these pin was not a wrong value anywhere; it was a wrong ORDER.
 * A store created from empty was recorded as `verified` for both ADR-0104
 * migrations, because emptiness settles both facts — and then the same boot
 * seeded rows whose values contradict them. Every assertion in the ledger was
 * true at the instant it was written and false a second later. The visible
 * result: the FIRST boot ran warn-first and kept the data, every LATER boot
 * read the certificate, enforced it, and rejected the very rows its
 * predecessor had written. Same data, same code, one restart.
 *
 * So the timing is the subject, and the tests are written as BOOTS — two
 * engines over one store, the second one finding the tables the first created.
 * A single-boot test cannot see this defect at all: boot one is green in the
 * broken build too.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from './engine';
import {
  FILE_REFERENCES_MIGRATION_ID,
  VALUE_SHAPES_MIGRATION_ID,
} from '@objectstack/spec/system';
import type { IDataDriver } from '@objectstack/spec/contracts';

/** One process's view of a datastore that outlives it. */
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

/**
 * A driver over a store that survives "restarts", reporting the schema-sync
 * stats of the boot that owns it: `created` on the boot that made the tables,
 * `existing` on every boot after — which is exactly what
 * `wasDatastoreCreatedFromEmpty()` reads.
 */
function makeDriver(store: Store, stats: { created: number; existing: number }): IDataDriver {
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
    getSchemaSyncStats: () => stats,
    async find(object: string, ast: any) {
      return rowsOf(store, object).filter((r) => matches(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
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
    async bulkCreate(object: string, docs: any[]) {
      for (const d of docs) rowsOf(store, object).push({ ...d });
      return docs;
    },
    async syncSchema() {},
    async dropTable() {},
  } as unknown as IDataDriver;
}

/** The showcase shape that triggered #4769: a media field and a covered one. */
const TASK = {
  name: 'showcase_task',
  fields: {
    id: { type: 'text' },
    title: { type: 'text' },
    cover: { type: 'image' },
    place: { type: 'location' },
  },
};

/** Enough of `sys_migration` for the flag reader and the revocation write. */
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
  },
};

/** Boot a process against `store`. `created` distinguishes boot 1 from boot 2. */
function boot(store: Store, opts: { created: boolean }): ObjectQL {
  const engine = new ObjectQL();
  engine.registerDriver(
    makeDriver(store, opts.created ? { created: 2, existing: 0 } : { created: 0, existing: 2 }),
    true,
  );
  engine.registerApp({
    id: 'showcase_pkg',
    name: 'Showcase',
    objects: [TASK, FLAG_OBJECT],
  } as any);
  return engine;
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

/** The showcase's own seed value: a URL where an opaque `sys_file` id belongs. */
const OFF_SHAPE_COVER = 'https://cdn.example.com/placeholder-cover.png';

describe('ADR-0104 fresh-datastore attestation vs. the boot that seeds (#4769)', () => {
  it('records the counterexample a warn-first admission creates, keyed by the migration it disproves', async () => {
    const store = newStore();
    const first = boot(store, { created: true });

    // Warn-first: no flag row, so the value is ADMITTED and now stored.
    await expect(
      first.insert('showcase_task', { id: 't1', title: 'Ship it', cover: OFF_SHAPE_COVER }),
    ).resolves.toBeDefined();

    const admitted = first.valueShapeViolationsAdmitted();
    expect(Object.keys(admitted)).toEqual([FILE_REFERENCES_MIGRATION_ID]);
    expect(admitted[FILE_REFERENCES_MIGRATION_ID].count).toBe(1);
    expect(admitted[FILE_REFERENCES_MIGRATION_ID].first).toMatchObject({
      object: 'showcase_task',
      field: 'cover',
      type: 'image',
    });
    // The media counterexample says nothing about the OTHER gate — two
    // migrations, two facts (the file flag never vouched for `location`).
    expect(admitted[VALUE_SHAPES_MIGRATION_ID]).toBeUndefined();
  });

  it('a covered-class admission disproves the value-shape migration, not the file one', async () => {
    const store = newStore();
    const first = boot(store, { created: true });

    // A `location` is `{lat, lng}`; a display string is the classic legacy shape.
    await expect(
      first.insert('showcase_task', { id: 't2', title: 'Map it', place: '40.7128,-74.0060' }),
    ).resolves.toBeDefined();

    const admitted = first.valueShapeViolationsAdmitted();
    expect(admitted[VALUE_SHAPES_MIGRATION_ID]?.count).toBe(1);
    expect(admitted[VALUE_SHAPES_MIGRATION_ID]?.first).toMatchObject({
      object: 'showcase_task',
      field: 'place',
    });
    expect(admitted[FILE_REFERENCES_MIGRATION_ID]).toBeUndefined();
  });

  it('a clean boot leaves no counterexample, so nothing stops it certifying', async () => {
    const store = newStore();
    const first = boot(store, { created: true });

    await expect(
      first.insert('showcase_task', { id: 't3', title: 'Fine', cover: 'file_01H0000000000000000000' }),
    ).resolves.toBeDefined();

    expect(first.valueShapeViolationsAdmitted()).toEqual({});
  });

  /**
   * THE REGRESSION. The certificate is already in the ledger when the seed
   * runs — the order #4769 reported — so declining to write it cannot help.
   * The boot that contradicts its own certificate revokes it, and the next
   * boot therefore never enforces a contract against data it inherited.
   */
  it('two boots, one dataset: the second must not reject what the first wrote', async () => {
    const store = newStore();

    // ── boot 1 ────────────────────────────────────────────────────────
    const first = boot(store, { created: true });
    // The seed starts before the attestation, so this boot's reading of the
    // ledger is "nothing recorded" — the state #4769 describes.
    await expect(
      first.insert('showcase_task', { id: 't0', title: 'First', cover: 'file_01H0000000000000000000' }),
    ).resolves.toBeDefined();
    // The attestation lands next (a store created empty is clean, and it is
    // — for another few milliseconds).
    rowsOf(store, 'sys_migration').push(creationAttestation(FILE_REFERENCES_MIGRATION_ID));
    // Then the seed writes the row that disproves it. Still admitted, because
    // this boot read the ledger before the certificate existed.
    await expect(
      first.insert('showcase_task', { id: 't1', title: 'Ship it', cover: OFF_SHAPE_COVER }),
    ).resolves.toBeDefined();

    // The ledger stops claiming what the store contradicts.
    await vi.waitFor(() => {
      const row = rowsOf(store, 'sys_migration').find((r) => r.id === FILE_REFERENCES_MIGRATION_ID);
      expect(row?.verified_at).toBeNull();
      expect(row?.blocking).toBeGreaterThan(0);
      // The revocation says why, without discarding how the row got there.
      const details = JSON.parse(String(row?.details ?? '{}'));
      expect(details.attested).toBe('datastore-created-empty');
      expect(details.revoked).toBe('boot-admitted-violating-value');
    });

    // ── boot 2: same store, tables already there ──────────────────────
    const second = boot(store, { created: false });
    expect(second.wasDatastoreCreatedFromEmpty()).toBe(false);

    // The seeder's upsert replays the same dataset. Before the fix this threw
    // `Cover Image has an invalid image value: Expected an opaque sys_file id`
    // — a deployment rejecting its own data because it had restarted once.
    await expect(
      second.update('showcase_task', { id: 't1', title: 'Ship it', cover: OFF_SHAPE_COVER }),
    ).resolves.toBeDefined();
    await expect(
      second.insert('showcase_task', { id: 't9', title: 'New row', cover: OFF_SHAPE_COVER }),
    ).resolves.toBeDefined();
  });

  /**
   * The control for the test above: enforcement is not disabled, it is
   * un-certified. A ledger row that stands — evidence by scan, from a real
   * `os migrate … --apply` — still makes boot 2 reject an off-shape value.
   */
  it('a certificate the boot never contradicted still enforces on the next boot', async () => {
    const store = newStore();

    const first = boot(store, { created: true });
    await expect(
      first.insert('showcase_task', { id: 't0', title: 'First', cover: 'file_01H0000000000000000000' }),
    ).resolves.toBeDefined();
    rowsOf(store, 'sys_migration').push(creationAttestation(FILE_REFERENCES_MIGRATION_ID));
    await expect(
      first.insert('showcase_task', { id: 't1', title: 'Clean', cover: 'file_01H0000000000000000001' }),
    ).resolves.toBeDefined();

    const row = rowsOf(store, 'sys_migration').find((r) => r.id === FILE_REFERENCES_MIGRATION_ID);
    expect(row?.verified_at).not.toBeNull();

    const second = boot(store, { created: false });
    await expect(
      second.insert('showcase_task', { id: 't2', title: 'Bad', cover: OFF_SHAPE_COVER }),
    ).rejects.toThrow(/invalid image value/i);
  });

  /**
   * A store this boot did NOT create carries history that is not ours to
   * vouch for either way: a verified row there is evidence by scan, and a
   * single write's observation must not overturn a walk of the whole store.
   *
   * That is still true, and it is the reason #4797 answers this case with a
   * deviation marker instead of a revocation — the certificate survives and
   * only the irreversible authority it carried is withheld. This test owns
   * the revocation half; the marker half is pinned in
   * `adr0104-lax-deviation-marker.test.ts`.
   */
  it('never revokes a flag on a store this boot did not create', async () => {
    const store = newStore();
    rowsOf(store, 'sys_migration').push(creationAttestation(FILE_REFERENCES_MIGRATION_ID));
    // Someone else's deployment, still lenient by operator choice.
    const engine = boot(store, { created: false });
    vi.stubEnv('OS_ALLOW_LAX_MEDIA_VALUES', '1');
    try {
      await expect(
        engine.insert('showcase_task', { id: 't1', title: 'Lax', cover: OFF_SHAPE_COVER }),
      ).resolves.toBeDefined();
      // Counted (the fact is true), and the CERTIFICATE is left alone.
      expect(engine.valueShapeViolationsAdmitted()[FILE_REFERENCES_MIGRATION_ID]?.count).toBe(1);
      const row = rowsOf(store, 'sys_migration').find((r) => r.id === FILE_REFERENCES_MIGRATION_ID);
      expect(row?.verified_at).not.toBeNull();
      expect(row?.blocking).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/**
 * #4769 second face — the memoized flag read.
 *
 * The first boot looked green partly by luck: a write that happened before
 * `sys_migration` existed cached "not verified" for the whole process. That is
 * not a read of the ledger, it is the absence of one, and freezing it makes a
 * boot's posture depend on which write happened first.
 */
describe('migration-flag memoization: a read that never happened is not an answer (#4769)', () => {
  /** Registers the business object only — `sys_migration` arrives later. */
  function bootWithoutLedger(store: Store): ObjectQL {
    const engine = new ObjectQL();
    engine.registerDriver(makeDriver(store, { created: 0, existing: 2 }), true);
    engine.registerApp({ id: 'p', name: 'P', objects: [TASK] } as any);
    return engine;
  }

  it('re-asks once the ledger exists, instead of freezing the pre-registration answer', async () => {
    const store = newStore();
    rowsOf(store, 'sys_migration').push(creationAttestation(FILE_REFERENCES_MIGRATION_ID));
    const engine = bootWithoutLedger(store);

    // The write that beat the platform objects to the boot: no ledger to ask,
    // so it is admitted — correct, and not something to remember.
    await expect(
      engine.insert('showcase_task', { id: 't1', title: 'Early', cover: OFF_SHAPE_COVER }),
    ).resolves.toBeDefined();

    // `sys_migration` registers (platform-objects' init) — no invalidation
    // call, because nothing here knows a stale answer is cached.
    engine.registerApp({ id: 'sys', name: 'Sys', objects: [FLAG_OBJECT] } as any);

    await expect(
      engine.insert('showcase_task', { id: 't2', title: 'Later', cover: OFF_SHAPE_COVER }),
    ).rejects.toThrow(/invalid image value/i);
  });

  it('still reads the ledger once per process per gate when it could actually be read', async () => {
    const store = newStore();
    const engine = boot(store, { created: false });
    const driver: any = (engine as any).drivers.get('default');
    const find = vi.spyOn(driver, 'find');

    await engine.insert('showcase_task', { id: 't1', cover: 'file_01H0000000000000000000' });
    await engine.insert('showcase_task', { id: 't2', cover: 'file_01H0000000000000000001' });
    await engine.insert('showcase_task', { id: 't3', cover: 'file_01H0000000000000000002' });

    // `showcase_task` declares both a media and a covered field, so both gates
    // are live — one read each, never one per write. The conclusive negative
    // (the ledger is readable and empty) IS memoized; only "could not ask" is
    // re-asked.
    const flagReads = find.mock.calls.filter((c: unknown[]) => c[0] === 'sys_migration');
    expect(flagReads).toHaveLength(2);
    expect(flagReads.map((c: any) => c[1]?.where?.id).sort()).toEqual(
      [FILE_REFERENCES_MIGRATION_ID, VALUE_SHAPES_MIGRATION_ID].sort(),
    );
  });
});
