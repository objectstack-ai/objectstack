// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The activation ledger's package backfill as the engine plugin runs it at
 * boot (ADR-0150 D8 row R4): the holder comes from the real `SchemaRegistry`
 * through the package-scoped resolver, so these pins read the same answer a
 * boot reads. The row-level rules (only null rows, only `package_id`, the
 * dry run) are pinned beside the function in `@objectstack/core`.
 *
 * Red line 2 (ambiguity reported, never guessed) is the `two holders` case;
 * it was ablated once (a first-candidate pick put back, the pin read red,
 * restored) and the reading is in the PR body, not kept as a test file.
 *
 * An item with more than one row is the upgrade case below, over a real SQLite
 * ledger and the real package-less index migration, booted twice. It was
 * ablated the same way (the duplicate check removed: the first boot bound the
 * first-stored row, the pin read red, restored), and so was the per-row write
 * isolation (a failed write rethrown: the row after it stayed null).
 */

import { DatabaseSync } from 'node:sqlite';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import {
  ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME,
  ensureActivationLedgerPackagelessIndex,
} from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
import { activationLedgerHolderOf, backfillActivationLedgerAtBoot } from './activation-ledger-backfill.js';

const TABLE = 'sys_metadata_activation';
const A = 'com.acme.alpha';
const B = 'com.acme.beta';

let registry: SchemaRegistry;

const install = (id: string) =>
  registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop() } as never, 'code');
const ship = (type: string, name: string, packageId: string) =>
  registry.registerItem(type, { name, label: `${packageId} ${type}` }, 'name' as never, packageId);
/** An item authored in this environment: the package-less bare slot. */
const author = (type: string, name: string) =>
  registry.registerItem(type, { name, label: `env ${type}`, _provenance: 'org' }, 'name' as never);

/** The registry as the boot hands it over, with the ledger object registered or not. */
const bootRegistry = (ledger = true) =>
  new Proxy(registry, {
    get(target, key) {
      if (key === 'getObject') return (name: string) => (ledger && name === TABLE ? { name: TABLE } : undefined);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

/** A stateful ledger: the backfill's one read answers every row, and `update` patches the row it addresses. */
function makeLedger(rows: Array<Record<string, unknown>>) {
  const table = rows.map((r) => ({ ...r }));
  const engine = {
    find: vi.fn(async () => table.map((r) => ({ ...r }))),
    update: vi.fn(async (_object: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      const row = table.find((r) => r.id === data.id);
      if (row) Object.assign(row, data);
      return data;
    }),
  };
  return { engine, table };
}

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

beforeEach(() => {
  registry = new SchemaRegistry();
  registry.logLevel = 'silent';
});

describe('activationLedgerHolderOf — the resolver\'s answer for a caller with no package', () => {
  it('names the one package holder', () => {
    install(A);
    ship('flow', 'nightly_sync', A);
    registry.sealBareNameHolders();
    expect(activationLedgerHolderOf(registry)('flow', 'nightly_sync')).toEqual({ kind: 'package', packageId: A });
  });

  it('names EVERY holder of a name two packages hold, and picks none', () => {
    install(A);
    install(B);
    ship('sharing_rule', 'share_open', A);
    ship('sharing_rule', 'share_open', B);
    registry.sealBareNameHolders();
    expect(activationLedgerHolderOf(registry)('sharing_rule', 'share_open')).toEqual({
      kind: 'ambiguous',
      candidates: [A, B],
    });
  });

  it('reads an item authored in this environment as the environment\'s, and a vanished name as unheld', () => {
    author('permission', 'env_set');
    registry.sealBareNameHolders();
    const holderOf = activationLedgerHolderOf(registry);
    expect(holderOf('permission', 'env_set')).toEqual({ kind: 'environment' });
    expect(holderOf('flow', 'no_such_flow')).toEqual({ kind: 'unheld' });
  });

  it('never asks the resolver about a type it does not address by package (a position, ADR-0150 D7)', () => {
    install(A);
    registry.sealBareNameHolders();
    // The resolver throws for an unaddressed type; the adapter answers before it.
    expect(activationLedgerHolderOf(registry)('position', 'crm_manager')).toEqual({ kind: 'unaddressed' });
  });
});

describe('backfillActivationLedgerAtBoot — once per boot, after the seal', () => {
  it('binds the one holder and leaves the ambiguous row alone, naming both holders in its warning', async () => {
    install(A);
    install(B);
    ship('flow', 'nightly_sync', A);
    ship('sharing_rule', 'share_open', A);
    ship('sharing_rule', 'share_open', B);
    registry.sealBareNameHolders();
    const { engine, table } = makeLedger([
      { id: 'r1', metadata_type: 'flow', name: 'nightly_sync', package_id: null, active: false },
      { id: 'r2', metadata_type: 'sharing_rule', name: 'share_open', package_id: null, active: false },
    ]);
    const log = logger();

    const report = await backfillActivationLedgerAtBoot(engine, bootRegistry(), log);

    expect(table[0]).toMatchObject({ package_id: A, active: false });
    expect(table[1].package_id).toBeNull();
    expect(report?.ambiguous).toEqual([{ metadataType: 'sharing_rule', name: 'share_open', candidates: [A, B] }]);
    const warning = String(log.warn.mock.calls[0]?.[0] ?? '');
    expect(warning).toContain("sharing_rule 'share_open'");
    expect(warning).toContain(A);
    expect(warning).toContain(B);
  });

  it('a second boot over the same ledger writes nothing', async () => {
    install(A);
    ship('flow', 'nightly_sync', A);
    registry.sealBareNameHolders();
    const { engine } = makeLedger([{ id: 'r1', metadata_type: 'flow', name: 'nightly_sync', package_id: null, active: false }]);

    await backfillActivationLedgerAtBoot(engine, bootRegistry(), logger());
    const second = await backfillActivationLedgerAtBoot(engine, bootRegistry(), logger());

    expect(engine.update).toHaveBeenCalledTimes(1);
    expect(second?.bound).toEqual([]);
  });

  it('does not run before the holders are sealed: a package could still register and change the answer', async () => {
    install(A);
    ship('flow', 'nightly_sync', A);
    const { engine } = makeLedger([{ id: 'r1', metadata_type: 'flow', name: 'nightly_sync', package_id: null }]);

    expect(await backfillActivationLedgerAtBoot(engine, bootRegistry(), logger())).toBeUndefined();
    expect(engine.find).not.toHaveBeenCalled();
  });

  it('does not run in a composition without the ledger object', async () => {
    registry.sealBareNameHolders();
    const { engine } = makeLedger([]);

    expect(await backfillActivationLedgerAtBoot(engine, bootRegistry(false), logger())).toBeUndefined();
    expect(engine.find).not.toHaveBeenCalled();
  });

  it('a ledger that cannot be read leaves the boot running and says what it did not do', async () => {
    registry.sealBareNameHolders();
    const engine = { find: vi.fn(async () => { throw new Error('no such table'); }), update: vi.fn() };
    const log = logger();

    expect(await backfillActivationLedgerAtBoot(engine, bootRegistry(), log)).toBeUndefined();
    expect(engine.update).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]?.[1]).toEqual({ error: 'no such table' });
  });
});

/**
 * The ledger as a real SQLite table carrying the declared key, as
 * `SqlDriver.syncDeclaredIndexes` builds `(metadata_type, package_id, name)`
 * there: a write that key refuses is refused here too, and the package-less
 * index migration (`@objectstack/metadata-protocol`) runs its real statements
 * against the same rows. `find` answers in storage order, as a driver does.
 */
function sqliteLedger(rows: Array<{ id: string; name: string; package_id: string | null; active: number }>) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE ${TABLE} (id TEXT PRIMARY KEY, metadata_type TEXT, name TEXT, package_id TEXT, active INTEGER)`);
  db.exec(
    `CREATE UNIQUE INDEX uniq_sys_metadata_activation_metadata_type_package_id_name ON ${TABLE} ` +
      '(metadata_type, package_id, name)',
  );
  for (const r of rows) {
    db.prepare(`INSERT INTO ${TABLE} (id, metadata_type, name, package_id, active) VALUES (?, 'flow', ?, ?, ?)`).run(
      r.id,
      r.name,
      r.package_id,
      r.active,
    );
  }
  const exec = async (sql: string) => (/^\s*select/i.test(sql) ? db.prepare(sql).all() : db.exec(sql));
  const engine = {
    find: vi.fn(async (_object: string, options?: any) => {
      if (Object.keys(options?.where ?? {}).length > 0) {
        throw new Error('sqliteLedger: the backfill reads the whole ledger; a scoped read is not modelled');
      }
      return db.prepare(`SELECT * FROM ${TABLE} ORDER BY rowid`).all();
    }),
    update: vi.fn(async (_object: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      const { id, ...patch } = data;
      const columns = Object.keys(patch);
      db.prepare(`UPDATE ${TABLE} SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
        ...columns.map((c) => patch[c]),
        id,
      );
      return data;
    }),
  };
  const packageOf = (id: string) =>
    (db.prepare(`SELECT package_id FROM ${TABLE} WHERE id = ?`).get(id) as { package_id: string | null } | undefined)
      ?.package_id;
  const indexExists = () =>
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(ACTIVATION_LEDGER_PACKAGELESS_INDEX_NAME) !==
    undefined;
  return { db, exec, engine, packageOf, indexExists };
}

describe('an upgrade over two package-less rows for one packaged flow, and a third flow stored after them', () => {
  const APP = 'com.example.app183';
  let ledger: ReturnType<typeof sqliteLedger>;

  /** One boot's two steps, in boot order: the index at `kernel:ready`, the backfill at `kernel:bootstrapped`. */
  const boot = async () => {
    const log = logger();
    const index = await ensureActivationLedgerPackagelessIndex(ledger.exec, log, { client: 'better-sqlite3' });
    const report = await backfillActivationLedgerAtBoot(ledger.engine, bootRegistry(), log);
    return { index, report, log };
  };

  beforeEach(() => {
    install(APP);
    ship('flow', 'app183_switch', APP);
    ship('flow', 'app183_digest', APP);
    registry.sealBareNameHolders();
    ledger = sqliteLedger([
      { id: 'd1', name: 'app183_switch', package_id: null, active: 0 },
      { id: 'd2', name: 'app183_switch', package_id: null, active: 1 },
      { id: 'd3', name: 'app183_digest', package_id: null, active: 0 },
    ]);
  });

  afterEach(() => ledger.db.close());

  it('binds neither duplicate on the first boot or the second, the index keeps refusing, and the third flow is bound', async () => {
    for (let bootNumber = 1; bootNumber <= 2; bootNumber++) {
      const { index, report, log } = await boot();

      expect(index.status).toBe('conflict');
      expect(ledger.indexExists()).toBe(false);
      expect(ledger.packageOf('d1')).toBeNull();
      expect(ledger.packageOf('d2')).toBeNull();
      expect(ledger.packageOf('d3')).toBe(APP);
      expect(report?.duplicated).toEqual([{
        metadataType: 'flow',
        name: 'app183_switch',
        packageId: APP,
        rows: [{ id: 'd1', active: false }, { id: 'd2', active: true }],
      }]);
      expect(report?.failed).toEqual([]);
      // The backfill's own line names the item and both rows (the index's refusal is the other error line).
      const duplicateCall = log.error.mock.calls.find((c) => String(c[0]).includes('[ObjectQLPlugin]'));
      // The platform logger's shape: message, thrown error (none), meta.
      expect(duplicateCall?.[1]).toBeUndefined();
      expect(duplicateCall?.[2]).toEqual({ duplicated: report?.duplicated });
      const duplicateLine = String(duplicateCall?.[0]);
      expect(duplicateLine).toContain("flow 'app183_switch'");
      expect(duplicateLine).toContain('row d1');
      expect(duplicateLine).toContain('row d2');
      expect(log.warn).not.toHaveBeenCalled();
    }
  });

  it('once an operator deletes the row that should not apply, the next boot builds the index and binds the row left', async () => {
    await boot();
    ledger.db.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).run('d1');

    const { index, report, log } = await boot();

    expect(index.status).toBe('created');
    expect(ledger.indexExists()).toBe(true);
    expect(ledger.packageOf('d2')).toBe(APP);
    expect(report?.bound).toEqual([{ metadataType: 'flow', name: 'app183_switch', packageId: APP }]);
    expect(report?.duplicated).toEqual([]);
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('backfillActivationLedgerAtBoot — a row whose write fails', () => {
  it('is named with its error, and the rows stored after it are still bound', async () => {
    install(A);
    ship('flow', 'nightly_sync', A);
    ship('flow', 'weekly_sync', A);
    registry.sealBareNameHolders();
    const { engine, table } = makeLedger([
      { id: 'r1', metadata_type: 'flow', name: 'nightly_sync', package_id: null, active: false },
      { id: 'r2', metadata_type: 'flow', name: 'weekly_sync', package_id: null, active: false },
    ]);
    const update = engine.update.getMockImplementation()!;
    engine.update.mockImplementation(async (object: string, data: any, options?: any) => {
      if (data.id === 'r1') throw new Error('connection reset');
      return update(object, data, options);
    });
    const log = logger();

    const report = await backfillActivationLedgerAtBoot(engine, bootRegistry(), log);

    expect(table[0].package_id).toBeNull();
    expect(table[1].package_id).toBe(A);
    expect(report?.failed).toEqual([
      { metadataType: 'flow', name: 'nightly_sync', id: 'r1', packageId: A, error: 'connection reset' },
    ]);
    const warning = String(log.warn.mock.calls[0]?.[0] ?? '');
    expect(warning).toContain("flow 'nightly_sync'");
    expect(warning).toContain('row r1');
    expect(warning).toContain('connection reset');
  });
});

/**
 * [#32096] The one-shot boot (`runPlatformMigrations: false`, the CLI's
 * `bootSchemaStack`) repairs nothing behind the operator's back: the backfill
 * only names what the next served boot binds. The boot `os migrate plan`
 * makes over a real database is pinned in
 * `packages/cli/src/utils/schema-migrate.activation-ledger-backfill.integration.test.ts`.
 */
describe('backfillActivationLedgerAtBoot — on a one-shot boot', () => {
  const pending = () => {
    install(A);
    ship('flow', 'nightly_sync', A);
    registry.sealBareNameHolders();
    return makeLedger([{ id: 'r1', metadata_type: 'flow', name: 'nightly_sync', package_id: null, active: false }]);
  };

  it('writes nothing, and names in one line the row the next served boot binds and to which package', async () => {
    const { engine, table } = pending();
    const log = logger();

    const report = await backfillActivationLedgerAtBoot(engine, bootRegistry(), log, { runPlatformMigrations: false });

    expect(engine.update).not.toHaveBeenCalled();
    expect(table[0].package_id).toBeNull();
    expect(report?.bound).toMatchObject([{ metadataType: 'flow', name: 'nightly_sync', packageId: A }]);
    expect(log.info).toHaveBeenCalledTimes(1);
    const line = String(log.info.mock.calls[0]?.[0]);
    expect(line).toContain(`flow 'nightly_sync' → ${A}`);
    expect(line).toContain('next served boot');
    expect(line).not.toContain('now name');
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('a ledger it cannot read is not an upgrade that failed: debug only, no warning', async () => {
    registry.sealBareNameHolders();
    const engine = { find: vi.fn(async () => { throw new Error('no such table'); }), update: vi.fn() };
    const log = logger();

    expect(await backfillActivationLedgerAtBoot(engine, bootRegistry(), log, { runPlatformMigrations: false })).toBeUndefined();
    expect(engine.update).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledTimes(1);
    expect(log.debug.mock.calls[0]?.[1]).toEqual({ error: 'no such table' });
  });

  it('CONTROL: a boot that declares nothing, or declares it repairs (the served boot), binds the row', async () => {
    for (const options of [undefined, { runPlatformMigrations: true }]) {
      registry = new SchemaRegistry();
      registry.logLevel = 'silent';
      const { engine, table } = pending();
      await backfillActivationLedgerAtBoot(engine, bootRegistry(), logger(), options);
      expect(engine.update).toHaveBeenCalledTimes(1);
      expect(table[0].package_id).toBe(A);
    }
  });
});

describe('#32183 — a binding never moves with a reversible disable: the holder read judges every holder', () => {
  it('a disabled holder still counts: two holders stay ambiguous, a disabled sole holder is still the holder', () => {
    install(A);
    install(B);
    ship('flow', 'shared_flow', A);
    ship('flow', 'shared_flow', B);
    ship('flow', 'beta_flow', B);
    // [contract review S2] The reverse registration order: the disabled holder first.
    ship('flow', 'reversed_flow', B);
    ship('flow', 'reversed_flow', A);
    registry.sealBareNameHolders();
    registry.disablePackage(B);
    const holderOf = activationLedgerHolderOf(registry);
    expect(holderOf('flow', 'shared_flow')).toEqual({ kind: 'ambiguous', candidates: [A, B] });
    expect(holderOf('flow', 'reversed_flow')).toEqual({ kind: 'ambiguous', candidates: [B, A] });
    expect(holderOf('flow', 'beta_flow')).toEqual({ kind: 'package', packageId: B });
  });
});
