// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20054 — remote mode constructs and runs without `better-sqlite3`.
 *
 * `package.json` declares `better-sqlite3` an OPTIONAL peer, and the README's
 * "Dependencies by Mode" table gives remote mode `@libsql/client` only
 * ("Vercel/Edge compatible — no native dependencies"). The code did not keep
 * that promise: `toKnexConfig`'s remote arm handed the `SqlDriver` base a
 * `better-sqlite3` Knex config on `:memory:`, and knex's `Client` constructor
 * loads a dialect's native driver whenever the config carries a `connection`.
 * So with the module absent, `new TursoDriver({ url: 'libsql://…' })` threw
 * knex's `npm install better-sqlite3` error before any remote call was made.
 *
 * The remote arm now builds the base's Knex with no `connection`: the SQLite
 * dialect's compiler, no native driver, no pool, no private database.
 *
 * ## How "absent" is staged
 *
 * `better-sqlite3` is installed here (local mode and the test doubles need it),
 * so each case below runs with `Module._load` refusing it as a missing module,
 * the way Node answers when the package is not installed. `_load` rather than
 * `_resolveFilename`: every CommonJS `require` passes through `_load`, and a
 * resolution cache can short-circuit `_resolveFilename` for a module some
 * earlier code in the process already loaded. The hook counts the load
 * attempts it refuses, so each case says HOW OFTEN the native module was
 * reached, not only whether something threw.
 *
 * ## What is pinned
 *
 * 1. The control: a local `:memory:` driver and a local `file:` driver still
 *    cannot be constructed without the module, and the failure names it. This
 *    also proves the hook is live; without it, the remote cases below would
 *    pass for the wrong reason.
 * 2. A remote driver constructs without the module, with zero load attempts.
 * 3. Remote CRUD through a real `@libsql/client` `file:` client works without
 *    the module, with zero load attempts, and the rows land in that file.
 * 4. `SqlDriver` methods the remote face does not override, and which still
 *    reach `this.knex`, never answer from a database that is not the remote
 *    one: each either fails or answers from the remote database. Which of the
 *    two, and with which envelope, is the inherited-methods card's decision.
 *    What this card owes is that removing the private `:memory:` database adds
 *    no silent answer. `introspectSchema()` used to answer "no tables" from it.
 *
 * Measured at this card's base with the placeholder config restored: cases 2,
 * 3 and 4 go red (the first two on knex's install error, the third on
 * `introspectSchema()` answering `[]`), and case 1 stays green.
 */

import Module from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { TursoDriver } from './index.js';

const NATIVE = 'better-sqlite3';

type ModuleLoad = (this: unknown, request: string, parent: unknown, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: ModuleLoad };

/**
 * Run `body` with every load of `better-sqlite3` refused as a missing module.
 * `attempts()` reads how many loads were refused so far. The original loader
 * is restored whatever `body` does.
 */
async function withoutNativeDriver<T>(body: (attempts: () => number) => Promise<T> | T): Promise<T> {
  const original = loader._load;
  let attempts = 0;
  loader._load = function (this: unknown, request, parent, isMain) {
    if (request === NATIVE || request.startsWith(`${NATIVE}/`)) {
      attempts += 1;
      const err = new Error(`Cannot find module '${request}'`) as Error & { code?: string };
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    }
    return original.call(this, request, parent, isMain);
  };
  try {
    return await body(() => attempts);
  } finally {
    loader._load = original;
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'turso-no-native-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const open: Array<{ driver?: TursoDriver; client?: Client }> = [];
afterEach(async () => {
  while (open.length) {
    const { driver, client } = open.pop()!;
    await driver?.disconnect().catch(() => {});
    client?.close();
  }
});

const OBJECT = {
  name: 'probe_t',
  fields: {
    name: { type: 'text' },
    n: { type: 'number' },
  },
};

describe('the control: local mode still needs better-sqlite3', () => {
  it('a local `:memory:` driver is not constructed without it, and the failure names it', async () => {
    await withoutNativeDriver((attempts) => {
      expect(() => new TursoDriver({ url: ':memory:' })).toThrow(NATIVE);
      expect(attempts()).toBeGreaterThan(0);
    });
  });

  it('a local `file:` driver is not constructed without it, and the failure names it', async () => {
    await withoutNativeDriver((attempts) => {
      expect(() => new TursoDriver({ url: `file:${join(scratch, 'local.db')}` })).toThrow(NATIVE);
      expect(attempts()).toBeGreaterThan(0);
    });
  });
});

describe('remote mode does not need better-sqlite3', () => {
  it('constructs without it, never trying to load it', async () => {
    await withoutNativeDriver((attempts) => {
      const driver = new TursoDriver({ url: 'libsql://probe-db.example.turso.io', authToken: 'x' });
      open.push({ driver });
      expect(driver.transportMode).toBe('remote');
      expect(attempts()).toBe(0);
    });
  });

  it('runs CRUD through a real @libsql/client `file:` client without it, never trying to load it', async () => {
    await withoutNativeDriver(async (attempts) => {
      const client = createClient({ url: `file:${join(scratch, 'remote-crud.db')}` });
      const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client });
      open.push({ driver, client });
      expect(driver.transportMode).toBe('remote');

      await driver.connect();
      await driver.initObjects([OBJECT]);
      await driver.create('probe_t', { id: 'a', name: 'x', n: 1 });
      await driver.bulkCreate('probe_t', [{ id: 'b', name: 'y', n: 2 }]);
      await driver.update('probe_t', 'a', { name: 'xx' });
      expect(await driver.count('probe_t', {})).toBe(2);
      const rows = await driver.find('probe_t', { orderBy: [{ field: 'id', order: 'asc' }] });
      expect(rows.map((r: Record<string, unknown>) => [r.id, r.name, r.n])).toEqual([
        ['a', 'xx', 1],
        ['b', 'y', 2],
      ]);
      await driver.delete('probe_t', 'b');

      // The rows are in the libsql file, not in some other database.
      const landed = await client.execute('select id, name from probe_t order by id');
      expect(landed.rows.map((r) => [r.id, r.name])).toEqual([['a', 'xx']]);

      await driver.disconnect();
      expect(attempts()).toBe(0);
    });
  });
});

/**
 * Run `body` in one of the two installs: with `better-sqlite3` present (the
 * only install the old placeholder could run in, and the one where it
 * answered from its private database), or absent. `attempts()` is 0 when the
 * module is present, since nothing refuses it.
 */
async function inInstall<T>(absent: boolean, body: (attempts: () => number) => Promise<T>): Promise<T> {
  return absent ? withoutNativeDriver(body) : body(() => 0);
}

describe.each([
  { install: 'with better-sqlite3 installed', absent: false },
  { install: 'with better-sqlite3 absent', absent: true },
])('inherited methods that still reach Knex add no silent answer ($install)', ({ absent }) => {
  /**
   * A remote face over a real libsql `file:` client holding two rows in
   * `probe_t`. Each method below is a `SqlDriver` method `TursoDriver` does
   * not override for remote mode.
   */
  async function remoteWithRows() {
    const client = createClient({ url: `file:${join(scratch, `inherited-${absent}-${open.length}-${Date.now()}.db`)}` });
    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client });
    open.push({ driver, client });
    await driver.connect();
    await driver.initObjects([OBJECT]);
    await driver.bulkCreate('probe_t', [
      { id: 'a', name: 'x', n: 1 },
      { id: 'b', name: 'y', n: 2 },
    ]);
    return driver;
  }

  /** Settle a call into what it answered, or that it failed. */
  const settle = <T>(p: Promise<T>) =>
    p.then(
      (value) => ({ answered: true as const, value }),
      (error: unknown) => ({ answered: false as const, error }),
    );

  it('`introspectSchema()` fails, or lists the remote table — never "no tables"', async () => {
    await inInstall(absent, async (attempts) => {
      const driver = await remoteWithRows();
      const outcome = await settle(driver.introspectSchema());
      if (outcome.answered) expect(Object.keys(outcome.value.tables)).toContain('probe_t');
      else expect(outcome.error).toBeInstanceOf(Error);
      expect(attempts()).toBe(0);
    });
  });

  it('`distinct()` fails, or answers the remote values', async () => {
    await inInstall(absent, async (attempts) => {
      const driver = await remoteWithRows();
      const outcome = await settle(driver.distinct('probe_t', 'name'));
      if (outcome.answered) expect([...outcome.value].sort()).toEqual(['x', 'y']);
      else expect(outcome.error).toBeInstanceOf(Error);
      expect(attempts()).toBe(0);
    });
  });

  it('`findWithWindowFunctions()` fails, or answers the remote rows', async () => {
    await inInstall(absent, async (attempts) => {
      const driver = await remoteWithRows();
      const outcome = await settle(
        driver.findWithWindowFunctions('probe_t', {
          fields: ['id'],
          windowFunctions: [
            { function: 'row_number', alias: 'rn', over: { orderBy: [{ field: 'id', order: 'asc' }] } },
          ],
        } as never),
      );
      if (outcome.answered) expect(outcome.value).toHaveLength(2);
      else expect(outcome.error).toBeInstanceOf(Error);
      expect(attempts()).toBe(0);
    });
  });
});
