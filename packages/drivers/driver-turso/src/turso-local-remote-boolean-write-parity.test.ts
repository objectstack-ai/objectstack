// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Both faces of `TursoDriver` store a declared `Field.boolean` / `Field.toggle`
 * as a boolean whatever spelling a write door is handed, and refuse a value
 * that spells no boolean.
 *
 * The remote face never reaches `SqlDriver.create`: it puts the payload in its
 * storage form with `toRemoteWriteForms`, which is `formatInput`, the function
 * the local face's doors run. Neither face rewrote a string, so the text
 * `'true'` / `'false'` a caller handed `create` / `update` / `updateMany` landed
 * as TEXT. The remote face has no boot convergence for such a cell
 * (`SqlDriver.initObjects` never runs there), and SQLite compares TEXT with an
 * INTEGER as unequal, so the row satisfied `$ne: true` for good. A JS number
 * fared no better on the remote face's `toggle` column, whose affinity is TEXT:
 * `0` was bound as a REAL and stored as the text `'0.0'`, which reads as `true`.
 *
 * Both faces run over an embedded libSQL file: the local face by `file:` URL,
 * the remote face through a real `@libsql/client` handed in as its client. Each
 * stored cell is read back raw (`typeof`), so the assertion is about what is on
 * disk, not what the row read presents.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { lowerFilterCondition } from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';

const OBJECT = {
  name: 'bool_write_parity',
  fields: { label: { type: 'string' }, flag: { type: 'boolean' }, live: { type: 'toggle' } },
};

/** Accepted spellings and the boolean each one is stored as. */
const ACCEPTED: ReadonlyArray<readonly [unknown, boolean]> = [
  [true, true], [false, false], [1, true], [0, false], ['1', true], ['0', false],
  ['true', true], ['false', false], ['1.0', true], ['0.0', false],
];
const REFUSED: ReadonlyArray<unknown> = ['yes', 'TRUE', '', 2, ['true']];

type Door = 'create' | 'update' | 'upsert' | 'bulkCreate' | 'bulkUpdate' | 'updateMany';
const DOORS: readonly Door[] = ['create', 'update', 'upsert', 'bulkCreate', 'bulkUpdate', 'updateMany'];
const OPTS = { bypassTenantAudit: true } as const;

async function writeThrough(driver: TursoDriver, door: Door, id: string, value: unknown, seed: boolean): Promise<void> {
  const row = { id, label: door, flag: value, live: value };
  if (door === 'create') return void (await driver.create(OBJECT.name, row, OPTS));
  if (door === 'upsert') return void (await driver.upsert(OBJECT.name, row, undefined, OPTS));
  if (door === 'bulkCreate') return void (await driver.bulkCreate(OBJECT.name, [row], OPTS));
  await driver.create(OBJECT.name, { id, label: door, flag: seed, live: seed }, OPTS);
  const patch = { flag: value, live: value };
  if (door === 'update') await driver.update(OBJECT.name, id, patch, OPTS);
  else if (door === 'bulkUpdate') await driver.bulkUpdate(OBJECT.name, [{ id, data: patch }], OPTS);
  else await driver.updateMany(OBJECT.name, { where: { id } } as DriverQuery, patch, OPTS);
}

const label = (v: unknown) => JSON.stringify(v);

for (const face of ['local', 'remote'] as const) {
  describe(`TursoDriver ${face.toUpperCase()} — a boolean / toggle field is stored as a boolean whatever spelling it is written in`, () => {
    let dir: string;
    let driver: TursoDriver;
    let raw: Client;
    /** The cell form this face's columns store a boolean as: the remote `toggle` column has TEXT affinity. */
    const form = (field: 'flag' | 'live', b: boolean): [unknown, string] =>
      face === 'remote' && field === 'live' ? [b ? '1' : '0', 'text'] : [b ? 1 : 0, 'integer'];

    const cell = async (id: string): Promise<Array<[unknown, string]> | null> => {
      const rs = await raw.execute({
        sql: `select flag, typeof(flag) as t, live, typeof(live) as lt from ${OBJECT.name} where id = ?`,
        args: [id],
      });
      const r = rs.rows[0] as any;
      return r ? [[r.flag, r.t], [r.live, r.lt]] : null;
    };

    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), `bool-write-${face}-`));
      const file = join(dir, 'db.sqlite');
      if (face === 'local') {
        driver = new TursoDriver({ url: `file:${file}` });
        await driver.initObjects([OBJECT]);
      } else {
        driver = new TursoDriver({ url: 'libsql://bool-write.turso.io', client: createClient({ url: `file:${file}` }) });
        await driver.connect();
        await driver.syncSchema(OBJECT.name, OBJECT);
      }
      expect(driver.transportMode).toBe(face);
      raw = createClient({ url: `file:${file}` });
    });

    afterAll(async () => {
      raw.close();
      await driver.disconnect();
      rmSync(dir, { recursive: true, force: true });
    });

    for (const door of DOORS) {
      it(`${door}: every accepted spelling lands as its boolean`, async () => {
        const got: Record<string, unknown> = {};
        const want: Record<string, unknown> = {};
        for (const [i, [value, b]] of ACCEPTED.entries()) {
          const id = `${door}_ok_${i}`;
          await writeThrough(driver, door, id, value, !b);
          got[label(value)] = await cell(id);
          want[label(value)] = [form('flag', b), form('live', b)];
        }
        expect(got).toEqual(want);
      });

      it(`${door}: a value that spells no boolean is refused with VALIDATION_ERROR / 400 and writes nothing`, async () => {
        const got: Record<string, unknown> = {};
        const want: Record<string, unknown> = {};
        const inserts = door === 'create' || door === 'upsert' || door === 'bulkCreate';
        for (const [i, value] of REFUSED.entries()) {
          const id = `${door}_no_${i}`;
          const outcome = await writeThrough(driver, door, id, value, true).then(
            () => 'written',
            (e: any) => ({ code: e?.code, status: e?.status }),
          );
          got[label(value)] = { outcome, cell: await cell(id) };
          want[label(value)] = {
            outcome: { code: 'VALIDATION_ERROR', status: 400 },
            cell: inserts ? null : [form('flag', true), form('live', true)],
          };
        }
        expect(got).toEqual(want);
      });
    }

    it('bulkCreate: a refused row anywhere in the batch writes none of the batch', async () => {
      const batch = [
        { id: 'batch_a', label: 'batch', flag: 'true', live: true },
        { id: 'batch_b', label: 'batch', flag: 'yes', live: true },
        { id: 'batch_c', label: 'batch', flag: false, live: false },
      ];
      await expect(driver.bulkCreate(OBJECT.name, batch, OPTS)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      expect([await cell('batch_a'), await cell('batch_b'), await cell('batch_c')]).toEqual([null, null, null]);
    });

    it('a row written as the text true is never selected by $ne: true, $nin: [true] or $not of = true', async () => {
      await driver.create(OBJECT.name, { id: 'neg_text_true', label: 'neg', flag: 'true', live: 'true' }, OPTS);
      await driver.create(OBJECT.name, { id: 'neg_text_false', label: 'neg', flag: 'false', live: 'false' }, OPTS);
      await driver.create(OBJECT.name, { id: 'neg_bool_true', label: 'neg', flag: true, live: true }, OPTS);
      const ids = async (where: Record<string, unknown>) => {
        const lowered = lowerFilterCondition({ label: 'neg', ...where }, { isDatetimeColumn: () => false });
        return ((await driver.find(OBJECT.name, { where: lowered } as DriverQuery, OPTS)) as Array<{ id: string }>)
          .map((r) => r.id)
          .sort();
      };
      for (const field of ['flag', 'live']) {
        expect(await ids({ [field]: { $ne: true } })).toEqual(['neg_text_false']);
        expect(await ids({ [field]: { $nin: [true] } })).toEqual(['neg_text_false']);
        expect(await ids({ $not: { [field]: true } })).toEqual(['neg_text_false']);
        expect(await ids({ [field]: { $ne: false } })).toEqual(['neg_bool_true', 'neg_text_true']);
        expect(await driver.count(OBJECT.name, { where: lowerFilterCondition({ label: 'neg', [field]: { $ne: true } }, { isDatetimeColumn: () => false }) } as DriverQuery, OPTS)).toBe(1);
      }
    });
  });
}
