// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0160 D7, seventh amendment — a stored `action` row whose `type` is the
 * retired `ask_ai` IS the action the conversion `action-type-ask-ai-removed`
 * deletes, so the stored seam yields no item of it. What this file pins on the
 * real store (`driver-sqlite-wasm`, read back from the rows):
 *
 *   - the read serves NOTHING for that row — `load` answers no data — while a
 *     live action row beside it is served as stored;
 *   - the row is still found BY NAME: `exists` answers true and `delete`
 *     takes it out, so the metadata API's delete door reaches it. A loader
 *     that resolved a row's identity through the converted body would find no
 *     name for it and leave it in the store for good;
 *   - a write of the same name still reads the row's object binding from its
 *     stored body, so the loader names the row's object and keeps the two
 *     bindings apart (red when identity is read through the converted body).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { DatabaseLoader } from './database-loader.js';

const ASK = { name: 'ask_about_ticket', label: 'Ask AI', objectName: 'ticket', type: 'ask_ai' };
const CLOSE = { name: 'close_ticket', label: 'Close', objectName: 'ticket', type: 'script', target: 'close_ticket' };

describe('DatabaseLoader — a stored ask_ai action row (ADR-0160 D7)', () => {
  let driver: SqliteWasmDriver;
  let loader: DatabaseLoader;

  const seed = (id: string, body: Record<string, unknown>) =>
    driver.create('sys_metadata', {
      id,
      type: 'action',
      name: body.name,
      state: 'active',
      version: 1,
      checksum: `seed_${id}`,
      source: 'database',
      package_id: null,
      metadata: JSON.stringify(body),
    });

  const storedNames = async () =>
    ((await driver.find('sys_metadata', { where: { type: 'action' } })) as Array<{ name: string }>)
      .map((r) => r.name)
      .sort();

  beforeEach(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    loader = new DatabaseLoader({ driver, cache: { enabled: false } });
    await loader.list('action');
    await seed('r_ask', ASK);
    await seed('r_close', CLOSE);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('serves nothing for the ask_ai row, and the live row beside it as stored', async () => {
    expect((await loader.load('action', 'ask_about_ticket')).data ?? null).toBeNull();
    expect((await loader.load('action', 'close_ticket')).data).toMatchObject(CLOSE);
  });

  it('still finds the row by name, and the delete door takes it out', async () => {
    expect(await loader.exists('action', 'ask_about_ticket')).toBe(true);
    await loader.delete('action', 'ask_about_ticket');
    expect(await storedNames()).toEqual(['close_ticket']);
    expect(await loader.exists('action', 'ask_about_ticket')).toBe(false);
  });

  it('a write of the same name still reads the row\'s own object binding, so the two bindings keep apart', async () => {
    // The row was written before the loader named objects (`bundle_member`
    // empty). Its object comes from its stored body, which the converted read
    // no longer has; a loader that took identity from that read would count
    // it object-less and leave it unnamed beside the new binding.
    await loader.save('action', 'ask_about_ticket', { ...CLOSE, name: 'ask_about_ticket', objectName: 'case' });
    const rows = (await driver.find('sys_metadata', { where: { type: 'action', name: 'ask_about_ticket' } })) as Array<{
      id: string;
      bundle_member: string | null;
    }>;
    expect(rows.map((r) => [r.id === 'r_ask' ? 'stored' : 'saved', r.bundle_member]).sort()).toEqual([
      ['saved', 'case'],
      ['stored', 'ticket'],
    ]);
  });
});
