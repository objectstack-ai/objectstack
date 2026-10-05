// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21828] `DatabaseLoader` stamps and compares the content hash
 * `SysMetadataRepository` stamps on the same `sys_metadata` column,
 * `hashSpec(body, type)`, so the column carries one vocabulary and a
 * field-reorder-only `register` is persisted.
 *
 * Before this card the loader stamped `calculateChecksum` (bare hex, every map
 * sorted) and skipped its write whenever the new stamp equalled the stored
 * one. An `object` whose only change was the order of its `fields` hashed
 * equal, so `MetadataManager.register` refreshed the in-process cache with
 * the new order and the persisted row kept the old one.
 *
 * Driven through the door the card names, `MetadataManager.register`, onto
 * real SQLite (`driver-sqlite-wasm`, already a devDependency), and read back
 * from the rows, never from the loader's cache.
 *
 * Pins, per triage's grade on the card:
 *   §A a field-reorder-only `register` persists the new order;
 *   §B an unordered map's key swap still compares equal (no write, no history row);
 *   §C the upgrade: a row stamped under an older rule with an unchanged body
 *      is not rewritten, and a reorder against such a stamp is still persisted.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { hashSpec } from '@objectstack/metadata-core';
import { DatabaseLoader } from './database-loader.js';
import { MetadataManager } from '../metadata-manager.js';
import { calculateChecksum } from '../utils/metadata-history-utils.js';

type Row = Record<string, unknown>;

const TITLE = { type: 'text', label: 'Title' };
const AMOUNT = { type: 'number', label: 'Amount' };
const DUE = { type: 'date', label: 'Due' };

/** An object whose `fields` are in the order given, and nothing else differs. */
function invoice(order: ReadonlyArray<'title' | 'amount' | 'due'>): Row {
  const all = { title: TITLE, amount: AMOUNT, due: DUE };
  const fields: Row = {};
  for (const key of order) fields[key] = { ...all[key] };
  return { name: 'invoice', label: 'Invoice', fields };
}

describe('[#21828] DatabaseLoader stamps and compares hashSpec(body, type)', () => {
  let driver: SqliteWasmDriver;
  let manager: MetadataManager;

  beforeEach(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    const loader = new DatabaseLoader({ driver, trackHistory: true, cache: { enabled: false } });
    manager = new MetadataManager({ datasource: 'sqlite', loaders: [loader] });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  async function row(type: string, name: string): Promise<Row> {
    const found = await driver.findOne('sys_metadata', { where: { type, name } });
    expect(found, `${type}/${name} has a sys_metadata row`).toBeTruthy();
    return found as Row;
  }

  async function history(type: string, name: string): Promise<Row[]> {
    return (await driver.find('sys_metadata_history', { where: { type, name } })) as Row[];
  }

  function storedFieldOrder(r: Row): string[] {
    return Object.keys((JSON.parse(r.metadata as string) as { fields: Row }).fields);
  }

  /** Overwrite the stored stamp, as a row written under an older rule carries it. */
  async function restamp(r: Row, checksum: string): Promise<void> {
    await driver.update('sys_metadata', r.id as string, { checksum });
  }

  describe('§A a field-reorder-only register is persisted', () => {
    it('stores the new order, bumps the version and appends one history row', async () => {
      await manager.register('object', 'invoice', invoice(['title', 'amount', 'due']));
      await manager.register('object', 'invoice', invoice(['due', 'title', 'amount']));

      const r = await row('object', 'invoice');
      expect(storedFieldOrder(r)).toEqual(['due', 'title', 'amount']);
      expect(r.version).toBe(2);
      const h = await history('object', 'invoice');
      expect(h.map((x) => x.operation_type).sort()).toEqual(['create', 'update']);
    });

    it('stamps the row and its history row with the repository vocabulary, one value', async () => {
      await manager.register('object', 'invoice', invoice(['title', 'amount', 'due']));
      const first = await row('object', 'invoice');
      await manager.register('object', 'invoice', invoice(['due', 'title', 'amount']));
      const r = await row('object', 'invoice');

      expect(r.checksum).toBe(hashSpec(invoice(['due', 'title', 'amount']), 'object'));
      expect(r.checksum).not.toBe(first.checksum);
      const update = (await history('object', 'invoice')).find((x) => x.operation_type === 'update')!;
      expect(update.checksum).toBe(r.checksum);
      expect(update.previous_checksum).toBe(first.checksum);
    });

    it('a rollback restores the earlier order and stamps it in the same vocabulary', async () => {
      await manager.register('object', 'invoice', invoice(['title', 'amount', 'due']));
      await manager.register('object', 'invoice', invoice(['due', 'title', 'amount']));
      await manager.rollback('object', 'invoice', 1);

      const r = await row('object', 'invoice');
      expect(storedFieldOrder(r)).toEqual(['title', 'amount', 'due']);
      expect(r.checksum).toBe(hashSpec(invoice(['title', 'amount', 'due']), 'object'));
    });
  });

  describe('§B a key swap in an unordered map still compares equal', () => {
    it('object: swapping the keys around `fields` and inside a field writes nothing', async () => {
      await manager.register('object', 'invoice', {
        name: 'invoice',
        label: 'Invoice',
        fields: { title: { type: 'text', label: 'Title' } },
      });
      const before = await row('object', 'invoice');
      await manager.register('object', 'invoice', {
        fields: { title: { label: 'Title', type: 'text' } },
        label: 'Invoice',
        name: 'invoice',
      });

      const after = await row('object', 'invoice');
      expect(after.version).toBe(1);
      expect(after.checksum).toBe(before.checksum);
      expect(await history('object', 'invoice')).toHaveLength(1);
    });

    it('view: a type with no ordered map stays order-blind in every map', async () => {
      await manager.register('view', 'invoice_grid', {
        name: 'invoice_grid',
        label: 'Invoices',
        options: { density: 'compact', striped: true },
      });
      await manager.register('view', 'invoice_grid', {
        options: { striped: true, density: 'compact' },
        label: 'Invoices',
        name: 'invoice_grid',
      });

      const r = await row('view', 'invoice_grid');
      expect(r.version).toBe(1);
      expect(await history('view', 'invoice_grid')).toHaveLength(1);
    });
  });

  describe('§C the upgrade: content, not a stamp from an older rule, decides "unchanged"', () => {
    it('a row stamped by the old calculateChecksum with an unchanged body is not rewritten', async () => {
      const body = invoice(['title', 'amount', 'due']);
      await manager.register('object', 'invoice', body);
      const legacy = await calculateChecksum(body);
      await restamp(await row('object', 'invoice'), legacy);

      await manager.register('object', 'invoice', invoice(['title', 'amount', 'due']));

      const r = await row('object', 'invoice');
      expect(r.version).toBe(1);
      expect(r.checksum).toBe(legacy);
      expect(await history('object', 'invoice')).toHaveLength(1);
    });

    it('the same holds for a type with no ordered map', async () => {
      const body = { name: 'invoice_grid', label: 'Invoices' };
      await manager.register('view', 'invoice_grid', body);
      const legacy = await calculateChecksum(body);
      await restamp(await row('view', 'invoice_grid'), legacy);

      await manager.register('view', 'invoice_grid', { ...body });

      const r = await row('view', 'invoice_grid');
      expect(r.version).toBe(1);
      expect(r.checksum).toBe(legacy);
      expect(await history('view', 'invoice_grid')).toHaveLength(1);
    });

    it('a reorder INTO sorted key order against an order-blind stamp is persisted', async () => {
      // `hashSpec(body)` with no type is the order-blind `sha256:` stamp a row
      // carries when `SysMetadataRepository` wrote it before #21790. It IS the
      // hash of the sorted order, so a stamp comparison calls this reorder
      // "unchanged".
      await manager.register('object', 'invoice', invoice(['title', 'due', 'amount']));
      await restamp(await row('object', 'invoice'), hashSpec(invoice(['title', 'due', 'amount'])));

      await manager.register('object', 'invoice', invoice(['amount', 'due', 'title']));

      const r = await row('object', 'invoice');
      expect(storedFieldOrder(r)).toEqual(['amount', 'due', 'title']);
      expect(r.version).toBe(2);
      expect(r.checksum).toBe(hashSpec(invoice(['amount', 'due', 'title']), 'object'));
      expect(await history('object', 'invoice')).toHaveLength(2);
    });
  });
});
