// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A seed reference written blank (`''`, or only whitespace) is NO reference —
 * measured on a REAL `SqlDriver` under a real `ObjectQL`.
 *
 * The engine's blank rule is `isMissing` (`@objectstack/core`,
 * `required-emptiness.ts`): `undefined`, `null`, and a string that is empty or
 * only whitespace. Its insert door (`normalizeBlankTypedValues`) stores such a
 * lookup as empty, and its required check refuses it. The seed loader used to
 * skip a reference only on `undefined` / `null`, so a blank one was resolved as
 * a natural key, missed, deferred, and reported after pass 2 as
 * `Deferred reference unresolved … = '' → … not found` — `errored: 1`,
 * `success: false` — for a row that had landed with the field empty. A replay
 * reported the same error again.
 *
 * Pinned here, against the engine that really normalizes and validates:
 *
 *  1. An OPTIONAL lookup written `''` or whitespace loads clean, the field is
 *     empty (by `isMissing`; the loader leaves the value as written), and a
 *     replay of the same seed skips without an error.
 *  2. A REQUIRED lookup written `''` is refused by the engine's own required
 *     check, in its own words, and never as "Deferred reference unresolved".
 *  3. A blank element of a `multiple: true` lookup is dropped like a `null`
 *     hole; the other elements resolve.
 *  4. Control: a real natural key still resolves to the target row's id.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMissing } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  captureExpectedReadRefusals,
  type ExpectedReadRefusalCapture,
} from './expected-read-refusal-noise.js';

const BOOK = {
  name: 'blank_ref_book',
  fields: { title: { type: 'text', required: true } },
};
const LOAN = {
  name: 'blank_ref_loan',
  fields: {
    name: { type: 'text', required: true },
    book: { type: 'lookup', reference: 'blank_ref_book' },
    books: { type: 'lookup', reference: 'blank_ref_book', multiple: true },
  },
};
const REQUIRED_LOAN = {
  name: 'blank_ref_required_loan',
  fields: {
    name: { type: 'text', required: true },
    book: { type: 'lookup', reference: 'blank_ref_book', required: true },
  },
};
const OBJECTS = [BOOK, LOAN, REQUIRED_LOAN];

const ENV = ['prod', 'dev', 'test'];
const SEED_CONFIG = {
  dryRun: false, haltOnError: false, multiPass: true,
  defaultMode: 'upsert', batchSize: 1000, transaction: false,
} as any;
const logger = { info() {}, warn() {}, error() {}, debug() {} };

/** The loans come FIRST, so a real key resolves only through pass 2 — the card's path. */
const BOOKS_SEED = {
  object: 'blank_ref_book', externalId: 'title', mode: 'upsert', env: ENV,
  records: [{ title: 'Dune' }, { title: 'Emma' }],
};
const LOANS_SEED = {
  object: 'blank_ref_loan', externalId: 'name', mode: 'upsert', env: ENV,
  records: [
    { name: 'loan-real', book: 'Dune' },
    { name: 'loan-empty', book: '' },
    { name: 'loan-whitespace', book: '   ' },
    { name: 'loan-multi', books: ['Dune', '', '  ', 'Emma'] },
  ],
};

const DEFERRED_UNRESOLVED = /Deferred reference unresolved/;

function metadataFor(objects: any[]) {
  const byName = new Map(objects.map((o) => [o.name, o]));
  return {
    getObject: async (name: string) => byName.get(name),
    listObjects: async () => objects,
    register: async () => {}, get: async (_t: string, n: string) => byName.get(n),
    list: async () => [], unregister: async () => {}, exists: async () => false, listNames: async () => [],
  } as any;
}

describe('a blank seed reference is no reference, on a REAL SqlDriver', () => {
  let dir: string | null = null;
  let engine: ObjectQL | null = null;
  let noise: ExpectedReadRefusalCapture | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
    // The engine refuses a name its registry does not hold before any driver,
    // so the absent tenancy table is never read; the capture asserts that.
    expect(noise?.tablesSeen() ?? ['no capture was installed']).toEqual([]);
    noise = null;
  });

  async function boot() {
    dir = mkdtempSync(join(tmpdir(), 'os-seed-blank-ref-'));
    const driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: join(dir, 'data.sqlite') },
      useNullAsDefault: true,
    });
    noise = captureExpectedReadRefusals(['sys_organization']);
    noise.captureDriver(driver);
    await driver.initObjects(OBJECTS);
    engine = new ObjectQL();
    noise.captureEngine(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of OBJECTS) engine.registry.registerObject(o as any);
    return { e: engine, loader: new SeedLoaderService(engine as any, metadataFor(OBJECTS), logger) };
  }

  it('loads an optional lookup written blank with no error, and a replay skips clean', async () => {
    const { e, loader } = await boot();

    const first = await loader.load({ seeds: [LOANS_SEED, BOOKS_SEED] as any, config: SEED_CONFIG });
    expect(first.errors.map((x: any) => x.message)).toEqual([]);
    expect(first.summary.totalErrored).toBe(0);
    expect(first.success).toBe(true);
    expect(first.summary.totalInserted).toBe(6);

    const books: any[] = await e.find('blank_ref_book', {});
    const dune = books.find((b) => b.title === 'Dune')!;
    const emma = books.find((b) => b.title === 'Emma')!;
    const loans: any[] = await e.find('blank_ref_loan', {});
    const byName = (n: string) => loans.find((l) => l.name === n)!;

    // Control: a real natural key resolves (through pass 2 — loans load first).
    expect(byName('loan-real').book).toBe(dune.id);
    // The card: the row lands and the blank field is empty — by the engine's
    // blank rule, not by a shape the loader picked: the value is left as
    // written, and what the insert door stores for a blank string-stored
    // lookup is the door's own (it does not null one).
    expect(isMissing(byName('loan-empty').book)).toBe(true);
    expect(isMissing(byName('loan-whitespace').book)).toBe(true);
    // A blank element is dropped like a null hole; the others resolve, in order.
    expect(byName('loan-multi').books).toEqual([dune.id, emma.id]);

    const replay = await loader.load({ seeds: [LOANS_SEED, BOOKS_SEED] as any, config: SEED_CONFIG });
    expect(replay.errors.map((x: any) => x.message)).toEqual([]);
    expect(replay.summary.totalErrored).toBe(0);
    expect(replay.success).toBe(true);
    expect(replay.summary.totalInserted).toBe(0);
    expect(replay.summary.totalUpdated).toBe(0);
    expect(replay.summary.totalSkipped).toBe(6);
    expect(await e.count('blank_ref_loan', {})).toBe(4);
  });

  it("refuses a REQUIRED lookup written '' through the engine's required check, never as unresolved", async () => {
    const { e, loader } = await boot();
    const seed = {
      object: 'blank_ref_required_loan', externalId: 'name', mode: 'upsert', env: ENV,
      records: [{ name: 'loan-required-empty', book: '' }],
    };

    const result = await loader.load({ seeds: [seed, BOOKS_SEED] as any, config: SEED_CONFIG });
    const messages = result.errors.map((x: any) => String(x.message));

    expect(result.success).toBe(false);
    expect(result.summary.totalErrored).toBe(1);
    expect(messages.some((m) => DEFERRED_UNRESOLVED.test(m))).toBe(false);
    // The engine's own required refusal names the field.
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/book/);
    expect(await e.count('blank_ref_required_loan', {})).toBe(0);
  });
});
