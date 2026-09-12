// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15989] The kernel→driver supply seam for the ADR-0104 media arm, from the
 * ENGINE's side — the ruling on #15041 step 2, as amended by the director
 * ruling (decision batch #120 item 1).
 *
 * The driver accepts `SqlDriverConfig.fileColumnsMoved` and has since PR
 * #17403. Nothing supplied it: the column was declared, the driver accepted
 * it, and no code anywhere read the one and handed it to the other. That gap
 * is what this file closes and what it pins.
 *
 * ## The one fact the arm may be keyed on
 *
 * ⛔ NOT the `adr-0104-file-references` flag alone. Every creation-attested
 * store since 17.0 — every dogfood boot included — carries that flag AND
 * JSON-quoted ids in a JSON column, so keying on it would read every existing
 * deployment as migrated and then write bare ids into a JSON column. The
 * evidence is `columns_moved_at`, written by the act that moves the columns,
 * and it is required IN ADDITION to the flag being verified: the stamp alone
 * would be a column move with nothing attesting the values inside.
 *
 * ## Every way of not knowing answers "not moved"
 *
 * No `sys_migration` object, no row, an unreadable table, a null or empty
 * stamp, an unverified row — all `false`. The driver's own half of that
 * property is pinned in `@objectstack/driver-sql`
 * (`sql-driver-15989-file-columns-moved-supply.test.ts`); this file pins the
 * engine's.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine';
import { FILE_REFERENCES_MIGRATION_ID } from '@objectstack/spec/system';
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

/** What the driver was handed, so a test can ask it the question later. */
interface ArmSink {
  /** The resolver `registerDriver` installed, if it installed one. */
  resolver: (() => Promise<boolean>) | null;
  installs: number;
}

function makeDriver(
  store: Store,
  opts: { sink?: ArmSink; readThrows?: boolean } = {},
): IDataDriver {
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => row[k] === v);
  };
  const driver: Record<string, unknown> = {
    name: 'default',
    version: '1.0.0',
    async connect() {},
    async disconnect() {},
    getSchemaSyncStats: () => ({ created: 0, existing: 2 }),
    async find(object: string, ast: any) {
      if (opts.readThrows) throw new Error('relation "sys_migration" does not exist');
      return rowsOf(store, object).filter((r) => matches(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      if (opts.readThrows) throw new Error('relation "sys_migration" does not exist');
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
  };
  if (opts.sink) {
    const sink = opts.sink;
    driver.setFileColumnsMovedResolver = (resolve: () => Promise<boolean>) => {
      sink.resolver = resolve;
      sink.installs += 1;
      return true;
    };
  }
  return driver as unknown as IDataDriver;
}

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
    columns_moved_at: { type: 'datetime' },
  },
};

const TASK = {
  name: 'showcase_task',
  fields: { id: { type: 'text' }, title: { type: 'text' }, cover: { type: 'image' } },
};

function boot(
  store: Store,
  opts: { sink?: ArmSink; readThrows?: boolean; withFlagObject?: boolean } = {},
): ObjectQL {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver(store, opts), true);
  engine.registerApp({
    id: 'showcase_pkg',
    name: 'Showcase',
    objects: opts.withFlagObject === false ? [TASK] : [TASK, FLAG_OBJECT],
  } as any);
  return engine;
}

const NOW = '2026-09-12T04:00:00.000Z';

/** A flag row, with whatever the case under test wants to vary. */
function flagRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: FILE_REFERENCES_MIGRATION_ID,
    last_run_at: NOW,
    verified_at: NOW,
    applied_at: NOW,
    blocking: 0,
    advisory: 0,
    details: null,
    columns_moved_at: null,
    ...over,
  };
}

describe('#15989 — haveFileColumnsMoved(): every way of not knowing answers false', () => {
  it('⛔ a VERIFIED flag with NO stamp is "not moved" — the flag alone may never key the arm', async () => {
    // The population this rule exists for: every creation-attested store since
    // 17.0 holds this exact row AND JSON-quoted ids in a JSON column.
    const store: Store = new Map();
    const engine = boot(store);
    rowsOf(store, 'sys_migration').push(flagRow());
    expect(await engine.isFileReferencesMigrationVerified()).toBe(true);
    expect(await engine.haveFileColumnsMoved()).toBe(false);
  });

  it('an EMPTY-STRING stamp is not a stamp', async () => {
    const store: Store = new Map();
    const engine = boot(store);
    rowsOf(store, 'sys_migration').push(flagRow({ columns_moved_at: '' }));
    expect(await engine.haveFileColumnsMoved()).toBe(false);
  });

  it('⛔ a stamp on an UNVERIFIED row does not move the arm either', async () => {
    // The stamp alone would be a column move with nothing attesting that the
    // values inside those columns were ever converted.
    const store: Store = new Map();
    const engine = boot(store);
    rowsOf(store, 'sys_migration').push(flagRow({ verified_at: null, columns_moved_at: NOW }));
    expect(await engine.isFileReferencesMigrationVerified()).toBe(false);
    expect(await engine.haveFileColumnsMoved()).toBe(false);
  });

  it('a stamp on a row with BLOCKING findings does not move the arm', async () => {
    const store: Store = new Map();
    const engine = boot(store);
    rowsOf(store, 'sys_migration').push(flagRow({ blocking: 3, columns_moved_at: NOW }));
    expect(await engine.haveFileColumnsMoved()).toBe(false);
  });

  it('NO ROW at all', async () => {
    const engine = boot(new Map());
    expect(await engine.haveFileColumnsMoved()).toBe(false);
  });

  it('NO sys_migration OBJECT registered — a kernel without the platform objects', async () => {
    const engine = boot(new Map(), { withFlagObject: false });
    expect(await engine.haveFileColumnsMoved()).toBe(false);
  });

  it('an UNREADABLE table', async () => {
    const store: Store = new Map();
    rowsOf(store, 'sys_migration').push(flagRow({ columns_moved_at: NOW }));
    const engine = boot(store, { readThrows: true });
    expect(await engine.haveFileColumnsMoved()).toBe(false);
  });

  it('⭐ CONTROL — a verified row WITH a stamp answers true, so the falses above are readings', async () => {
    const store: Store = new Map();
    const engine = boot(store);
    rowsOf(store, 'sys_migration').push(flagRow({ columns_moved_at: NOW }));
    expect(await engine.isFileReferencesMigrationVerified()).toBe(true);
    expect(await engine.haveFileColumnsMoved()).toBe(true);
  });
});

describe('#15989 — the two questions come off ONE read', () => {
  it('the verified answer and the moved answer share a memo slot', async () => {
    const store: Store = new Map();
    const engine = boot(store);
    rowsOf(store, 'sys_migration').push(flagRow({ columns_moved_at: NOW }));

    expect(await engine.haveFileColumnsMoved()).toBe(true);
    expect(await engine.isFileReferencesMigrationVerified()).toBe(true);

    // Mutate the store behind the memo. Neither answer may move, because the
    // row was read once — two reads could straddle an `--apply` and answer out
    // of one another's date.
    store.set('sys_migration', []);
    expect(await engine.haveFileColumnsMoved()).toBe(true);
    expect(await engine.isFileReferencesMigrationVerified()).toBe(true);

    // …and the documented way back, which must drop BOTH.
    engine.invalidateDataMigrationFlags();
    expect(await engine.haveFileColumnsMoved()).toBe(false);
    expect(await engine.isFileReferencesMigrationVerified()).toBe(false);
  });

  it('an INCONCLUSIVE read is not remembered — it keeps asking', async () => {
    // The ledger does not exist yet at the moment a boot first asks; a `false`
    // cached from that moment would outlive the table's creation.
    const store: Store = new Map();
    const engine = boot(store, { withFlagObject: false });
    expect(await engine.haveFileColumnsMoved()).toBe(false);
    // Register the object the second phase of a boot brings in, then stamp.
    engine.registerApp({ id: 'p2', name: 'P2', objects: [FLAG_OBJECT] } as any);
    rowsOf(store, 'sys_migration').push(flagRow({ columns_moved_at: NOW }));
    expect(await engine.haveFileColumnsMoved()).toBe(true);
  });
});

describe('#15989 — registerDriver hands the driver the question', () => {
  it('installs a resolver on a driver that has the seam, and it answers the ledger', async () => {
    const store: Store = new Map();
    const sink: ArmSink = { resolver: null, installs: 0 };
    const engine = boot(store, { sink });

    expect(sink.installs, 'the seam is offered at registration, not at first use').toBe(1);
    expect(typeof sink.resolver).toBe('function');

    // Nothing is read at install time — the row does not exist yet on a boot
    // that is about to create it.
    expect(await sink.resolver!()).toBe(false);

    rowsOf(store, 'sys_migration').push(flagRow({ columns_moved_at: NOW }));
    engine.invalidateDataMigrationFlags();
    expect(await sink.resolver!()).toBe(true);
  });

  it('⛔ a driver WITHOUT the seam is left alone, and still serves queries', async () => {
    // No `sink` ⇒ the fake exposes no `setFileColumnsMovedResolver` at all,
    // which is every driver that is not this repo's SQL one (memory, mongodb,
    // a third party's). Registration must neither throw nor invent the method,
    // and the driver must still WORK — asserted by a real round trip rather
    // than by a registry count, which would pass on an engine holding a driver
    // it can no longer reach.
    const store: Store = new Map();
    const engine = boot(store);
    const driverForCheck = makeDriver(store) as unknown as Record<string, unknown>;
    expect(driverForCheck.setFileColumnsMovedResolver, 'the control: the fake has no seam').toBeUndefined();
    await engine.insert('showcase_task', { id: 'q1', title: 'still works' });
    const rows = await engine.find('showcase_task', { where: { id: 'q1' } } as never);
    expect(rows.map((r: Record<string, unknown>) => r.id)).toEqual(['q1']);
  });

  it('a driver whose seam THROWS does not break its own registration', () => {
    const store: Store = new Map();
    const engine = new ObjectQL();
    const driver = makeDriver(store) as unknown as Record<string, unknown>;
    driver.setFileColumnsMovedResolver = () => {
      throw new Error('this driver refuses the resolver');
    };
    expect(() => engine.registerDriver(driver as unknown as IDataDriver, true)).not.toThrow();
  });
});
