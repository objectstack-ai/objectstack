// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import { AUDIT_SEAL_LOCK_NAME, AUDIT_SEAL_LOCK_WAIT_MS, AUDIT_SEAL_PG_LOCK_KEY, holdAuditSealLock, type AuditSealLockEngine } from './seal-lock.js';
import { AuditSealer } from './sealer.js';
import { LocalCheckpointSigner } from './signer.js';
import { bindingCrypto, lockableStore, memoryEngine, MemoryStore, recordingLogger, sessionLockDatabase } from './seal-store.testkit.js';

/**
 * ADR-0154 D3 as amended (seat ruling 6885005594, E + B): what an
 * `os migrate audit-* --apply` run holds for its whole run so that no sealer
 * pass seals a row it rewrites — the audit seal lock, a database session lock
 * on the datasource that holds the audit rows — and what it does where the
 * database offers no such lock. The sealer's side (each pass try-locks it and
 * skips while it is held) is pinned with the sealer, in
 * `audit-seal-sealer.test.ts`; the two meet here, on one database.
 */

const SEALED = {
  name: 'sys_audit_log',
  fields: { id: { type: 'text' }, created_at: { type: 'datetime' }, tenant_id: { type: 'lookup' }, new_value: { type: 'textarea' } },
  lifecycle: { class: 'audit', seal: { valueFields: ['new_value'] } },
};
const PLAIN = { name: 'sys_activity', fields: {}, lifecycle: { class: 'audit' } };

/** An engine whose registry holds `objects`, each routed to the datasource `routes` names. */
const engineOf = (objects: ReadonlyArray<{ name: string; lifecycle?: unknown }>, routes: Record<string, unknown>): AuditSealLockEngine => ({
  registry: { getAllObjects: () => objects },
  getDriverForObject: (name: string) => routes[name],
});

const RUN = ['sys_audit_log', 'sys_activity'] as const;

describe('the lock: one name, one key, one wait (D3 amended)', () => {
  it('is pinned, so every version that seals or rewrites a sealed object takes the SAME lock', () => {
    expect(AUDIT_SEAL_LOCK_NAME).toBe('objectstack:audit-seal');
    expect(AUDIT_SEAL_PG_LOCK_KEY).toBe('-5564991198496822599');
  });

  it('waits ten minutes by default: a normal sealer pass — the windows newly due — seals in seconds (ruling item 6)', () => {
    expect(AUDIT_SEAL_LOCK_WAIT_MS).toBe(10 * 60_000);
  });
});

describe('an --apply run holds it on the datasource that holds the audit rows (E)', () => {
  it('on a sealed object\'s hot store — not the primary, where they differ — until it finishes', async () => {
    const hotDb = sessionLockDatabase();
    const primaryDb = sessionLockDatabase();
    const hot = lockableStore(new MemoryStore(), hotDb);
    const primary = lockableStore(new MemoryStore(), primaryDb);
    const warn = vi.fn();
    const hold = await holdAuditSealLock(engineOf([SEALED, PLAIN], { sys_audit_log: hot, sys_activity: primary }), {
      objects: RUN, sealerStopped: false, warn,
    });
    const taken = hotDb.statements.find((st) => st.sql === 'select pg_try_advisory_lock(?::bigint) as locked')!;
    expect(taken.bindings).toEqual([AUDIT_SEAL_PG_LOCK_KEY]);
    expect(hotDb.holder(AUDIT_SEAL_PG_LOCK_KEY)).toBe(taken.session);
    expect(primaryDb.statements).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    await expect(hold.finish()).resolves.toEqual({ lost: false });
    expect(hotDb.holder(AUDIT_SEAL_PG_LOCK_KEY)).toBeUndefined();
    expect(hotDb.open()).toEqual([]);
  });

  it('takes one lock per database: two sealed objects on one datasource share a session', async () => {
    const db = sessionLockDatabase();
    const hot = lockableStore(new MemoryStore(), db);
    const both = [SEALED, { ...PLAIN, lifecycle: { class: 'audit', seal: {} } }];
    const hold = await holdAuditSealLock(engineOf(both, { sys_audit_log: hot, sys_activity: hot }), { objects: RUN, sealerStopped: false, warn: vi.fn() });
    // The session's marker of the run, then the one lock.
    expect(db.statements.map((st) => st.sql)).toEqual([
      'select pg_try_advisory_lock(?::bigint) as marked',
      'select pg_try_advisory_lock(?::bigint) as locked',
    ]);
    await hold.finish();
  });

  it('a run whose objects declare no lifecycle.seal takes none and refuses nothing — on any database', async () => {
    const db = sessionLockDatabase();
    const hold = await holdAuditSealLock(
      engineOf([{ ...SEALED, lifecycle: { class: 'audit' } }, PLAIN], { sys_audit_log: lockableStore(new MemoryStore(), db), sys_activity: new MemoryStore() }),
      { objects: RUN, sealerStopped: false, warn: vi.fn() },
    );
    expect(db.statements).toEqual([]);
    await expect(hold.finish()).resolves.toEqual({ lost: false });
  });

  it('⛔ a failure to take it on a database that offers one is handed on — never read as "no lock"', async () => {
    const refused = new Error('postgres: Knex cannot be handed out');
    const hot = { dialectName: 'postgres', getKnex: () => { throw refused; } };
    await expect(holdAuditSealLock(engineOf([SEALED], { sys_audit_log: hot }), { objects: RUN, sealerStopped: true, warn: vi.fn() }))
      .rejects.toBe(refused);
  });

  it('a run whose lock\'s session ended before it finished says it lost it, and why that matters', async () => {
    const db = sessionLockDatabase();
    const hold = await holdAuditSealLock(engineOf([SEALED], { sys_audit_log: lockableStore(new MemoryStore(), db) }), {
      objects: RUN, sealerStopped: false, warn: vi.fn(),
    });
    db.kill(db.holder(AUDIT_SEAL_PG_LOCK_KEY)!);
    const finished = await hold.finish();
    expect(finished.lost).toBe(true);
    expect(finished.lost && finished.line).toMatch(/audit seal lock on the database of 'sys_audit_log' was lost.*os audit verify/);
  });
});

describe('two datasources on one database: the run locks it once and never waits on itself (review 6894679963 M1)', () => {
  // Two datasources over ONE lock namespace: one Postgres database, or two schemas of one MySQL server, whose
  // GET_LOCK names are server-wide. Each opens its own session; the lock is the namespace's, not the session's.
  const BOTH_SEALED = [SEALED, { ...PLAIN, lifecycle: { class: 'audit', seal: {} } }];
  const LOCK_KEY = { postgres: AUDIT_SEAL_PG_LOCK_KEY, mysql: AUDIT_SEAL_LOCK_NAME } as const;

  for (const dialect of ['postgres', 'mysql'] as const) {
    it(`${dialect}: the --apply hold takes the lock on the first datasource, and the second is under it — no wait, no line`, async () => {
      const db = sessionLockDatabase(dialect);
      const audit = lockableStore(new MemoryStore(), db);
      const activity = lockableStore(new MemoryStore(), db);
      const warn = vi.fn();
      const hold = await holdAuditSealLock(engineOf(BOTH_SEALED, { sys_audit_log: audit, sys_activity: activity }), {
        objects: RUN, sealerStopped: false, warn, waitMs: 50,
      });
      expect(warn).not.toHaveBeenCalled();
      expect(db.statements.map((st) => st.sql)).not.toContain('set lock_timeout = 50');
      expect(db.statements.map((st) => st.sql)).not.toContain('select GET_LOCK(?, ?) as locked');
      // One session holds the lock; the second datasource's session was closed once it proved itself covered.
      const holder = db.holder(LOCK_KEY[dialect]);
      expect(holder).toBeDefined();
      expect(db.open()).toEqual([holder]);
      await expect(hold.finish()).resolves.toEqual({ lost: false });
      expect(db.holder(LOCK_KEY[dialect])).toBeUndefined();
      expect(db.open()).toEqual([]);
    });
  }

  it('a lost shared lock is reported for every object it covered', async () => {
    const db = sessionLockDatabase();
    const hold = await holdAuditSealLock(
      engineOf(BOTH_SEALED, { sys_audit_log: lockableStore(new MemoryStore(), db), sys_activity: lockableStore(new MemoryStore(), db) }),
      { objects: RUN, sealerStopped: false, warn: vi.fn(), waitMs: 50 },
    );
    db.kill(db.holder(AUDIT_SEAL_PG_LOCK_KEY)!);
    const finished = await hold.finish();
    expect(finished.lost && finished.line).toMatch(/database of 'sys_audit_log', 'sys_activity' was lost/);
  });

  it('⛔ the run\'s own lock on ANOTHER database is never read as cover: a held lock there is contention, waited for and refused', async () => {
    const mine = sessionLockDatabase();
    const theirs = sessionLockDatabase();
    const sealerPass = await theirs.hold(AUDIT_SEAL_PG_LOCK_KEY);
    const warn = vi.fn();
    const refusal = await holdAuditSealLock(
      engineOf(BOTH_SEALED, { sys_audit_log: lockableStore(new MemoryStore(), mine), sys_activity: lockableStore(new MemoryStore(), theirs) }),
      { objects: RUN, sealerStopped: false, warn, waitMs: 20 },
    ).then(() => null, (e: unknown) => e);
    expect((refusal as Error).message).toMatch(/^Refusing to rewrite 'sys_activity'.*after 20 ms/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(mine.open()).toEqual([]);
    expect(theirs.open()).toEqual([sealerPass.session]);
  });

  it('a pass of the sealer seals both objects, where the lock per datasource skipped every pass', async () => {
    const H = 60 * 60 * 1000;
    const DAY0 = Date.UTC(2026, 10, 10);
    const store = memoryEngine(BOTH_SEALED.map((o) => ({ ...o, fields: SEALED.fields })));
    const db = sessionLockDatabase();
    lockableStore(store.hot, db);
    // A second datasource over the same tables, on the same database.
    const activity = lockableStore({
      find: (object: string, query: Record<string, unknown>) => store.hot.find(object, query),
      count: (object: string, query?: Record<string, unknown>) => store.hot.count(object, query),
      create: (object: string, data: Record<string, unknown>) => store.hot.create(object, data),
      delete: (object: string, id: string) => store.hot.delete(object, id),
    }, db);
    store.engine.getDriverForObject = (object: string) => (object === 'sys_activity' ? activity : store.hot);
    const crypto = bindingCrypto();
    const logger = recordingLogger();
    const sealer = new AuditSealer({
      engine: store.engine, crypto, signer: () => new LocalCheckpointSigner({ engine: store.engine, crypto }), logger, now: () => DAY0 + 12 * H,
    });
    for (const object of RUN) {
      store.hot.table(object).push({ id: `${object}-r1`, created_at: new Date(DAY0 + 8 * H).toISOString(), tenant_id: 'org_a', new_value: '{}' });
    }
    expect(await sealer.runPass()).toBe(2);
    expect(new Set(store.hot.table('sys_audit_checkpoint').map((r) => r.sealed_object))).toEqual(new Set(RUN));
    expect(logger.lines.filter((l) => /audit seal lock/.test(l.message))).toEqual([]);
    expect(db.open()).toEqual([]);
  });
});

describe('N2: a database that offers no lock is refused before any wait on another', () => {
  it('⛔ refuses at once, with no wait line, when one sealed object is lockless and another\'s lock is held', async () => {
    const held = sessionLockDatabase();
    const sealerPass = await held.hold(AUDIT_SEAL_PG_LOCK_KEY);
    const lockless = lockableStore(new MemoryStore(), { ...sessionLockDatabase(), face: { dialectName: 'sqlite', getKnex: () => { throw new Error('never asked'); } } });
    const warn = vi.fn();
    const refusal = await holdAuditSealLock(
      engineOf([SEALED, { ...PLAIN, lifecycle: { class: 'audit', seal: {} } }], { sys_audit_log: lockableStore(new MemoryStore(), held), sys_activity: lockless }),
      { objects: RUN, sealerStopped: false, warn },
    ).then(() => null, (e: unknown) => e);
    expect((refusal as Error).message).toMatch(/^Refusing to rewrite 'sys_activity'.*--sealer-stopped/);
    expect(warn).not.toHaveBeenCalled();
    expect(held.statements.map((st) => st.sql)).not.toContain(`set lock_timeout = ${AUDIT_SEAL_LOCK_WAIT_MS}`);
    expect(held.open()).toEqual([sealerPass.session]);
  });
});

describe('contention: the run waits for a sealer pass in flight, then refuses (E)', () => {
  it('waits out a sealer pass in flight, with its default wait, and holds the lock only once the pass let it go', async () => {
    const H = 60 * 60 * 1000;
    const DAY0 = Date.UTC(2026, 10, 10);
    const store = memoryEngine([SEALED]);
    const db = sessionLockDatabase();
    lockableStore(store.hot, db);
    const crypto = bindingCrypto();
    const sealer = new AuditSealer({
      engine: store.engine, crypto, signer: () => new LocalCheckpointSigner({ engine: store.engine, crypto }),
      logger: recordingLogger(), now: () => DAY0 + 12 * H,
    });
    store.hot.table('sys_audit_log').push({ id: 'r1', created_at: new Date(DAY0 + 8 * H).toISOString(), tenant_id: 'org_a', new_value: '{}' });
    const events: string[] = [];
    const insert = store.engine.insert.bind(store.engine);
    store.engine.insert = async (...args: Parameters<typeof insert>) => {
      if (args[0] === 'sys_audit_checkpoint') events.push('checkpoint written');
      return insert(...args);
    };
    const warn = vi.fn();
    let holding: Promise<unknown> | undefined;
    const find = store.hot.find.bind(store.hot);
    store.hot.find = async (object, query) => {
      // The pass has the lock and is reading the window: the run starts now.
      if (!holding && object === 'sys_audit_log' && query.limit === 500) {
        holding = holdAuditSealLock(engineOf([SEALED], { sys_audit_log: store.hot }), { objects: RUN, sealerStopped: false, warn })
          .then((hold) => (events.push('run holds the lock'), hold));
      }
      return find(object, query);
    };
    expect(await sealer.runPass()).toBe(1);
    const hold = (await holding) as Awaited<ReturnType<typeof holdAuditSealLock>>;
    expect(events).toEqual(['checkpoint written', 'run holds the lock']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/holds the audit seal lock on the database of 'sys_audit_log'; waiting up to 600 s/);
    expect(db.statements.map((st) => st.sql)).toContain(`set lock_timeout = ${AUDIT_SEAL_LOCK_WAIT_MS}`);
    await hold.finish();
  });

  it('⛔ a wait that runs out refuses, naming the lock, and the run changed nothing', async () => {
    const db = sessionLockDatabase();
    const sealerPass = await db.hold(AUDIT_SEAL_PG_LOCK_KEY);
    const refusal = await holdAuditSealLock(engineOf([SEALED], { sys_audit_log: lockableStore(new MemoryStore(), db) }), {
      objects: RUN, sealerStopped: false, warn: vi.fn(), waitMs: 20,
    }).then(() => null, (e: unknown) => e);
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toMatch(/^Refusing to rewrite .*'sys_audit_log'.*'objectstack:audit-seal'.*after 20 ms, so this run changed nothing/);
    expect(db.open()).toEqual([sealerPass.session]);
  });

  it('a sealer pass skips while a run holds it, and seals once the run has finished', async () => {
    const H = 60 * 60 * 1000;
    const DAY0 = Date.UTC(2026, 10, 10);
    const store = memoryEngine([SEALED]);
    const db = sessionLockDatabase();
    lockableStore(store.hot, db);
    const crypto = bindingCrypto();
    const sealer = new AuditSealer({
      engine: store.engine, crypto, signer: () => new LocalCheckpointSigner({ engine: store.engine, crypto }),
      logger: recordingLogger(), now: () => DAY0 + 12 * H,
    });
    store.hot.table('sys_audit_log').push({ id: 'r1', created_at: new Date(DAY0 + 8 * H).toISOString(), tenant_id: 'org_a', new_value: '{}' });
    const hold = await holdAuditSealLock(engineOf([SEALED], { sys_audit_log: store.hot }), { objects: RUN, sealerStopped: false, warn: vi.fn() });
    expect(await sealer.runPass()).toBe(0);
    await hold.finish();
    expect(await sealer.runPass()).toBe(1);
  });
});

describe('B: where the database offers no session lock, an --apply run on a sealed object needs --sealer-stopped', () => {
  const lockless = () => lockableStore(new MemoryStore(), { ...sessionLockDatabase(), face: { dialectName: 'sqlite', getKnex: () => { throw new Error('never asked'); } } });

  it('⛔ is refused without it, before anything is written, naming the object and the flag', async () => {
    const warn = vi.fn();
    const refusal = await holdAuditSealLock(engineOf([SEALED, PLAIN], { sys_audit_log: lockless(), sys_activity: lockless() }), {
      objects: RUN, sealerStopped: false, warn,
    }).then(() => null, (e: unknown) => e);
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toMatch(/^Refusing to rewrite 'sys_audit_log'.*no session lock.*--sealer-stopped.*changed nothing/);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a driver with no Knex at all (a memory store) is a database with no session lock too', async () => {
    await expect(holdAuditSealLock(engineOf([SEALED], { sys_audit_log: new MemoryStore() }), { objects: RUN, sealerStopped: false, warn: vi.fn() }))
      .rejects.toThrow(/--sealer-stopped/);
  });

  it('only a SEALED object on such a database needs it: unsealed ones there, with the sealed one locked elsewhere, go ahead', async () => {
    const db = sessionLockDatabase();
    const hold = await holdAuditSealLock(engineOf([SEALED, PLAIN], { sys_audit_log: lockableStore(new MemoryStore(), db), sys_activity: lockless() }), {
      objects: RUN, sealerStopped: false, warn: vi.fn(),
    });
    expect(db.holder(AUDIT_SEAL_PG_LOCK_KEY)).toBeDefined();
    await hold.finish();
  });

  it('with --sealer-stopped it goes ahead, saying once that it rests on the operator\'s word', async () => {
    const warn = vi.fn();
    const hold = await holdAuditSealLock(engineOf([SEALED, PLAIN], { sys_audit_log: lockless(), sys_activity: lockless() }), {
      objects: RUN, sealerStopped: true, warn,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^--sealer-stopped: 'sys_audit_log' is rewritten without the audit seal lock/);
    await expect(hold.finish()).resolves.toEqual({ lost: false });
  });
});
