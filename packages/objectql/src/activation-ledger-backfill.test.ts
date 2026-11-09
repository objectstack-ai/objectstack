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
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
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

const logger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

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
