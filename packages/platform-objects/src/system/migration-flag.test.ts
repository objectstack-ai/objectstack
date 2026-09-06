// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
// [#5855] The fake engine's `update` routes through the producer's OWN dispatch
// predicate (#5480), so this double cannot accept a call `ObjectQL.update`
// refuses. Imported from `@objectstack/metadata-core` (already a `dependencies`
// entry here) and not from `@objectstack/objectql`, which depends on this
// package — that import would close a dependency cycle turbo rejects, and is
// why this file's `update` entry sat in the gate's DEBT ledger until #5619 sank
// the predicate into a package that depends on neither side.
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import {
  CREATION_ATTESTED_MIGRATION_IDS,
  FILE_REFERENCES_MIGRATION_ID,
  NOTIFICATION_EVENT_MIGRATION_ID,
  VALUE_SHAPES_MIGRATION_ID,
} from '@objectstack/spec/system';
import {
  readDataMigrationFlag,
  isDataMigrationVerified,
  recordDataMigrationRun,
  attestFreshDatastore,
  CREATION_ATTESTATION_DETAIL,
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
    async update(object, data: any, options) {
      // `recordDataMigrationRun` updates an existing flag row by its `id` in
      // the payload — the shape `ObjectQL.update` routes `by-id`. Asserting it
      // here binds this double to that verdict instead of re-deciding it.
      assertEngineUpdateDispatch(data, options);
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

describe('fresh-datastore attestation (ADR-0104, 2026-07-30 addendum)', () => {
  it('attests every creation-attested migration, verified and blocking-free', async () => {
    const engine = fakeEngine();

    const attested = await attestFreshDatastore(engine);

    expect(attested).toEqual([...CREATION_ATTESTED_MIGRATION_IDS]);
    expect(engine.tables.sys_migration).toHaveLength(CREATION_ATTESTED_MIGRATION_IDS.length);
    for (const id of CREATION_ATTESTED_MIGRATION_IDS) {
      expect(await isDataMigrationVerified(engine, id)).toBe(true);
    }
  });

  it('records nothing as applied — no backfill ran, and none was needed', async () => {
    const engine = fakeEngine();

    await attestFreshDatastore(engine);

    const row = engine.tables.sys_migration[0];
    expect(row.applied_at).toBeNull();
    expect(row.blocking).toBe(0);
  });

  it('marks the row so evidence-by-birth is distinguishable from evidence-by-scan', async () => {
    const engine = fakeEngine();

    await attestFreshDatastore(engine);

    expect(JSON.parse(String(engine.tables.sys_migration[0].details))).toEqual(
      CREATION_ATTESTATION_DETAIL,
    );
  });

  /**
   * #15710 ruling 3. The ADR-0030 cut-over id is attested at birth like the
   * two ADR-0104 ids — a store created after the cut-over never held a legacy
   * inbox row — and in the SAME uniform shape: `applied_at: null`,
   * `blocking: 0`, `details.attested`, `verified_at` set for the birth fact.
   * What a RUN of that migration may claim (never `verified_at`) lives on the
   * id's docblock in `@objectstack/spec`; this pins that the writer treats it
   * as one more member and invents no per-id shape. Named by symbol, not by
   * iterating the array: the loop above would stay green with the member gone.
   */
  it('attests the ADR-0030 notification-event id at birth, in the uniform shape', async () => {
    const engine = fakeEngine();

    const attested = await attestFreshDatastore(engine);

    expect(attested).toContain(NOTIFICATION_EVENT_MIGRATION_ID);
    const row = engine.tables.sys_migration.find((r) => r.id === NOTIFICATION_EVENT_MIGRATION_ID)!;
    expect(row).toMatchObject({ applied_at: null, blocking: 0, advisory: 0 });
    expect(row.verified_at).toBeTruthy();
    expect(JSON.parse(String(row.details))).toEqual(CREATION_ATTESTATION_DETAIL);
    expect(await isDataMigrationVerified(engine, NOTIFICATION_EVENT_MIGRATION_ID)).toBe(true);
  });

  /**
   * The load-bearing safety property. An existing row means this store is not
   * one being created — whatever the caller believed — so attestation must
   * leave it exactly as it found it. Overwriting could only ever RAISE a gate
   * the deployment's own evidence had closed.
   */
  it('never overwrites an existing row, including one a failed run closed', async () => {
    const engine = fakeEngine([
      { id: MIGRATION, last_run_at: 'yesterday', verified_at: null, blocking: 7 },
    ]);

    const attested = await attestFreshDatastore(engine);

    expect(attested).not.toContain(MIGRATION);
    const row = engine.tables.sys_migration.find((r) => r.id === MIGRATION)!;
    expect(row).toMatchObject({ verified_at: null, blocking: 7, last_run_at: 'yesterday' });
    expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(false);
  });

  it('is idempotent — a second call adds nothing', async () => {
    const engine = fakeEngine();

    await attestFreshDatastore(engine);
    const second = await attestFreshDatastore(engine);

    expect(second).toEqual([]);
    expect(engine.tables.sys_migration).toHaveLength(CREATION_ATTESTED_MIGRATION_IDS.length);
  });

  it('does nothing when sys_migration is not registered (bare kernel)', async () => {
    const engine = fakeEngine([], { registered: false });

    expect(await attestFreshDatastore(engine)).toEqual([]);
    expect(engine.tables.sys_migration).toHaveLength(0);
  });

  it('a write failure warns and leaves the deployment lax — it never throws into a boot', async () => {
    const engine = fakeEngine();
    engine.insert = async () => {
      throw new Error('table locked');
    };
    const logger = { info: vi.fn(), warn: vi.fn() };

    await expect(attestFreshDatastore(engine, { logger })).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  /**
   * #4769. "Created empty" licenses a claim about CONTENT, and the boot doing
   * the attesting is also the boot doing the seeding — so the claim has to be
   * checked against what that boot has already written, not against the
   * emptiness it remembers. One admitted value is a complete disproof.
   */
  describe('a boot may not attest a contract it has already broken (#4769)', () => {
    const VIOLATED = {
      count: 10,
      first: {
        object: 'showcase_task',
        field: 'cover',
        type: 'image',
        detail: 'Expected an opaque sys_file id',
      },
    };

    it('does not attest an id this boot has written violating values for', async () => {
      const engine = fakeEngine();
      engine.valueShapeViolationsAdmitted = () => ({ [MIGRATION]: VIOLATED });
      const logger = { info: vi.fn(), warn: vi.fn() };

      const attested = await attestFreshDatastore(engine, { logger });

      expect(attested).not.toContain(MIGRATION);
      expect(engine.tables.sys_migration.find((r) => r.id === MIGRATION)).toBeUndefined();
      expect(await isDataMigrationVerified(engine, MIGRATION)).toBe(false);
      // The operator is told which value cost them the gate, and what closes it.
      const warning = String(logger.warn.mock.calls[0]?.[0] ?? '');
      expect(warning).toContain('showcase_task.cover');
      expect(warning).toContain('os migrate files-to-references --apply');
    });

    /**
     * The two ids are attested at the same moment on the same evidence, but
     * they stand for two different facts — a bad `cover` says nothing about
     * whether a `location` is well formed. One contradiction must not sink
     * the other gate, and must not spare its own.
     */
    it('declines only the contradicted id, and still attests the other', async () => {
      const engine = fakeEngine();
      engine.valueShapeViolationsAdmitted = () => ({ [MIGRATION]: VIOLATED });

      const attested = await attestFreshDatastore(engine);

      expect(attested).toEqual(
        CREATION_ATTESTED_MIGRATION_IDS.filter((id) => id !== MIGRATION) as unknown as string[],
      );
      expect(await isDataMigrationVerified(engine, 'adr-0104-value-shapes')).toBe(true);
    });

    it('attests normally when the boot admitted nothing', async () => {
      const engine = fakeEngine();
      engine.valueShapeViolationsAdmitted = () => ({});

      expect(await attestFreshDatastore(engine)).toEqual([...CREATION_ATTESTED_MIGRATION_IDS]);
    });

    it('an engine that cannot report reads as no counterexample (older build, fake)', async () => {
      const engine = fakeEngine();
      engine.valueShapeViolationsAdmitted = () => {
        throw new Error('not implemented');
      };

      expect(await attestFreshDatastore(engine)).toEqual([...CREATION_ATTESTED_MIGRATION_IDS]);
    });

    /**
     * #16067. The remedy sentence used to be a two-way branch whose `else`
     * gave `os migrate value-shapes` to every id that was not the file one.
     * These pins test that DEFAULT, which is where the defect lived — a pin
     * that only exercised the two ADR-0104 ids passed on the broken code, and
     * still would.
     *
     * ⚠️ Reachability, measured rather than assumed: the SHIPPED engine cannot
     * key this tally with a third id (`ObjectQL.noteAdmittedValueShapeViolation`
     * derives the key from a closed `'media' | 'value-shape'` union, and it is
     * the only writer of the map). But `valueShapeViolationsAdmitted` is an
     * OPTIONAL, duck-typed member of {@link MigrationFlagEngine} returning an
     * open `Record<string, …>` — any other engine satisfies it, as the doubles
     * in this very file do. So the default was one non-ObjectQL producer away
     * from being read by an operator, and "unreachable" was never a property
     * of the seam.
     */
    describe('the remedy is looked up, never defaulted (#16067)', () => {
      /** The mapping the operator-facing sentence must obey, restated here so
       *  a change to the production map has to be made twice, on purpose. */
      const REMEDY_BY_ID: Record<string, string> = {
        [FILE_REFERENCES_MIGRATION_ID]: 'files-to-references',
        [VALUE_SHAPES_MIGRATION_ID]: 'value-shapes',
      };

      it('an id with NO value-shape contract is never-contradictable, and is told to run nothing', async () => {
        const engine = fakeEngine();
        engine.valueShapeViolationsAdmitted = () => ({
          [NOTIFICATION_EVENT_MIGRATION_ID]: VIOLATED,
        });
        const logger = { info: vi.fn(), warn: vi.fn() };

        const attested = await attestFreshDatastore(engine, { logger });

        // A value-shape tally is evidence about value shapes. The ADR-0030
        // cut-over's fact — no legacy per-user inbox row here — is not one, so
        // this counterexample disproves nothing about it and the birth
        // observation still settles it.
        expect(attested).toContain(NOTIFICATION_EVENT_MIGRATION_ID);
        expect(await isDataMigrationVerified(engine, NOTIFICATION_EVENT_MIGRATION_ID)).toBe(true);

        const warnings = logger.warn.mock.calls.map((c) => String(c[0] ?? '')).join('\n');
        // ⭐ The card's pin: the operator is NOT sent to `os migrate
        // value-shapes`, which neither attests nor clears this id. There is no
        // `os migrate notification-event` to send them to either — that
        // cut-over is an operator call with no self-check — so the correct
        // sentence here is no sentence.
        expect(warnings).not.toContain('value-shapes');
        expect(warnings).toBe('');
      });

      /**
       * Total over the array, so a FOURTH member is judged the moment it is
       * added instead of inheriting whatever the last branch happened to say.
       */
      it.each([...CREATION_ATTESTED_MIGRATION_IDS])(
        'a contradiction for %s is never handed another migration\'s command',
        async (id) => {
          const engine = fakeEngine();
          engine.valueShapeViolationsAdmitted = () => ({ [id]: VIOLATED });
          const logger = { info: vi.fn(), warn: vi.fn() };

          const attested = await attestFreshDatastore(engine, { logger });
          const warnings = logger.warn.mock.calls.map((c) => String(c[0] ?? '')).join('\n');
          const own = REMEDY_BY_ID[id];

          if (own === undefined) {
            expect(attested).toContain(id);
            expect(warnings).toBe('');
          } else {
            expect(attested).not.toContain(id);
            expect(warnings).toContain(`os migrate ${own} --apply`);
          }

          // The half a bigger ternary would still get wrong: no id may ever be
          // prescribed a command that belongs to a different id.
          for (const [other, command] of Object.entries(REMEDY_BY_ID)) {
            if (other === id) continue;
            expect(warnings).not.toContain(`os migrate ${command}`);
          }
        },
      );
    });
  });
});
