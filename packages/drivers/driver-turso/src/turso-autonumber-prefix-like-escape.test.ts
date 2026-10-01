// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21163] The Turso faces, held to one answer for an autonumber prefix that
 * carries a `LIKE` metacharacter.
 *
 * The data table's MAX is read by two statements built from ONE escape helper
 * (`SqlDriver.escapeLikePrefix`, which writes a backslash before `\`, `%` and
 * `_`), and a backslash only escapes under a `LIKE` that declares it:
 *
 *  - **LOCAL (and embedded replica, same local engine)** inherits
 *    `SqlDriver.scanMaxNumericTail`, compiled through Knex. Knex declared no
 *    `ESCAPE`, and SQLite has no escape character otherwise, so `SO\_%` matched
 *    nothing against a stored `SO_0007` (measured on this face at `cb45469e`:
 *    the cold create issued `SO_0001`, and the re-seed after a bypass write
 *    could not move the counter, so the create was refused). Fixed in
 *    `driver-sql`, where the scan now binds the escape on every dialect.
 *  - **REMOTE** sends its own statement through the transport, and that one
 *    already declared `ESCAPE '\'` — so its legs below passed before the fix.
 *    They are here as the other half of the same claim: both faces read the
 *    one helper's output under a declared backslash, and answer the same
 *    number. Change the helper's escape character without moving both
 *    declarations and one half of this file reddens.
 *
 * Remote legs run over `makeLibsqlSqliteStub` — a real SQLite behind the
 * `@libsql/client` interface — so the `LIKE` is evaluated by SQLite, not
 * asserted as a string.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { TursoDriver } from './index.js';
import { makeLibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const TABLE = 'so_order';

const pad4 = (n: number) => String(n).padStart(4, '0');

const CASES = [
  { label: '`_` in the prefix', format: 'SO_{0000}', render: (n: number) => `SO_${pad4(n)}`, role: 'red before the fix on LOCAL' },
  { label: '`%` in the prefix', format: 'SO%{0000}', render: (n: number) => `SO%${pad4(n)}`, role: 'red before the fix on LOCAL' },
  { label: 'a plain prefix', format: 'SO-{0000}', render: (n: number) => `SO-${pad4(n)}`, role: 'control' },
] as const;

const objectWith = (format: string) =>
  ({
    name: TABLE,
    fields: {
      so_no: { type: 'autonumber', format, unique: true },
      title: { type: 'string' },
    },
  }) as any;

interface Face {
  driver: TursoDriver;
  /** Land rows by a path that never enters `fillAutoNumberFields`. */
  bypassInsert(values: string[]): Promise<void>;
}

async function localFace(format: string): Promise<Face> {
  const driver = new TursoDriver({ url: ':memory:' });
  expect(driver.transportMode).toBe('local');
  await driver.initObjects([objectWith(format)]);
  return {
    driver,
    bypassInsert: async (values) => {
      await (driver as any).knex(TABLE).insert(values.map((v) => ({ id: `bypass-${v}`, so_no: v, title: 'seed replay' })));
    },
  };
}

async function remoteFace(format: string): Promise<Face> {
  const stub = makeLibsqlSqliteStub();
  const driver = new TursoDriver({ url: 'libsql://example.turso.io', client: stub as never });
  expect(driver.transportMode).toBe('remote');
  await driver.connect();
  await driver.initObjects([objectWith(format)]);
  const insert = stub.raw.prepare(`insert into "${TABLE}" ("id", "so_no", "title") values (?, ?, ?)`);
  return {
    driver,
    bypassInsert: async (values) => {
      for (const v of values) insert.run(`bypass-${v}`, v, 'seed replay');
    },
  };
}

for (const [faceName, open] of [
  ['LOCAL', localFace],
  ['REMOTE', remoteFace],
] as const) {
  describe(`[#21163] TursoDriver ${faceName}: an autonumber prefix carrying a LIKE metacharacter`, () => {
    let face: Face | undefined;

    afterEach(async () => {
      await face?.driver.disconnect();
      face = undefined;
    });

    for (const c of CASES) {
      const role = faceName === 'REMOTE' ? 'passed before the fix' : c.role;

      it(`${c.label}: a COLD bootstrap seeds from the stored MAX (${role})`, async () => {
        face = await open(c.format);
        await face.bypassInsert([c.render(7)]);

        const created = await face.driver.create(TABLE, { title: 'first issued' });
        expect(created.so_no).toBe(c.render(8));
      });

      it(`${c.label}: the #5495 re-seed moves a warm counter past rows a bypass write landed (${role})`, async () => {
        face = await open(c.format);

        // Warmed on an EMPTY table, so this leg does not lean on the cold scan.
        expect((await face.driver.create(TABLE, { title: 'warm' })).so_no).toBe(c.render(1));

        await face.bypassInsert(Array.from({ length: 29 }, (_, i) => c.render(i + 2)));

        const created = await face.driver.create(TABLE, { title: 'after the seeds' });
        expect(created.so_no).toBe(c.render(31));
      });
    }
  });
}
