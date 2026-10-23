// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25073] `issueAutonumbers` on the Turso REMOTE face: INHERITED from
 * `SqlDriver`, and it reaches the remote database.
 *
 * The member is `fillAutoNumberFields` on request plus `create()`'s #5495
 * re-seed, split where the engine must go on. Every piece of state it touches
 * already goes through this face's own overrides: `getNextSequenceValue`
 * (the remote counter statement, #21113), `autoNumberValueExists` and
 * `resyncSequenceToDataMax` (the remote re-seed). So the face needs no arm of
 * its own, and `REMOTE_FACE_ANSWERS` names it `inherited` — which
 * `turso-remote-inherited-members.test.ts` holds to the code (no redeclaration
 * on `TursoDriver`).
 *
 * Measured here on a real SQLite wearing the `@libsql/client` interface:
 * the number is issued from the same persistent counter the remote `create()`
 * draws from, `create()` writes the issued row through unchanged, and a
 * collision on an issued number re-seeds the remote counter and empties the
 * slot, so the next issue lands on MAX + 1.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { TursoDriver } from './index.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const NUMBERED_OBJECT = {
  name: 'crm_case',
  fields: {
    organization_id: { type: 'string' },
    case_number: { type: 'autonumber', format: 'CASE-{00000}', unique: true },
    title: { type: 'string' },
  },
};

const open: TursoDriver[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.disconnect().catch(() => {});
});

async function makeRemote() {
  const stub = makeLibsqlSqliteStub();
  const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
  open.push(driver);
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  await driver.initObjects([NUMBERED_OBJECT] as any);
  return { driver, stub };
}

const rowCount = (stub: LibsqlSqliteStub, where = '1=1', args: unknown[] = []) =>
  (stub.raw.prepare(`select count(*) as c from "crm_case" where ${where}`).all(...args) as Array<{ c: number }>)[0].c;

const lastValue = (stub: LibsqlSqliteStub): number =>
  Number((stub.raw.prepare('select last_value from "_objectstack_sequences"').all() as Array<{ last_value: number }>)[0].last_value);

const landByBypass = (stub: LibsqlSqliteStub, from: number, to: number) => {
  const insert = stub.raw.prepare(
    'insert into "crm_case" ("id", "organization_id", "case_number", "title") values (?, ?, ?, ?)',
  );
  for (let n = from; n <= to; n++) insert.run(`bypass-${n}`, 'orgA', `CASE-${String(n).padStart(5, '0')}`, `row ${n}`);
};

const refusal = (write: Promise<unknown>) =>
  write.then(
    (row) => { throw new Error(`expected a refusal, got ${JSON.stringify(row)}`); },
    (e) => e as Error,
  );

describe('[#25073] REMOTE: issueAutonumbers, inherited', () => {
  it('is inherited, not redeclared, on TursoDriver', () => {
    expect(Object.prototype.hasOwnProperty.call(TursoDriver.prototype, 'issueAutonumbers')).toBe(false);
    expect(typeof TursoDriver.prototype.issueAutonumbers).toBe('function');
  });

  it('issues from the counter the remote create() draws from, and create() writes the row as issued', async () => {
    const { driver, stub } = await makeRemote();
    await driver.create('crm_case', { organization_id: 'orgA', title: 'by create' });
    expect(lastValue(stub)).toBe(1);

    const row: Record<string, unknown> = { organization_id: 'orgA', title: 'ahead' };
    expect(await driver.issueAutonumbers('crm_case', [row])).toEqual([['case_number']]);
    expect(row.case_number).toBe('CASE-00002');
    expect(lastValue(stub)).toBe(2);

    const written = await driver.create('crm_case', row);
    expect(written.case_number).toBe('CASE-00002');
    expect(lastValue(stub)).toBe(2);
    expect(rowCount(stub, '"case_number" = ?', ['CASE-00002'])).toBe(1);
  });

  it('after a collision on an issued number, re-seeds the remote counter and empties the slot', async () => {
    const { driver, stub } = await makeRemote();
    await driver.create('crm_case', { organization_id: 'orgA', title: 'first' });
    landByBypass(stub, 2, 30);

    const row: Record<string, unknown> = { organization_id: 'orgA', title: 'after the replay' };
    await driver.issueAutonumbers('crm_case', [row]);
    expect(row.case_number).toBe('CASE-00002');
    const error = await refusal(driver.create('crm_case', row));
    expect(error.message).toMatch(/UNIQUE constraint failed/i);

    expect(await driver.issueAutonumbers('crm_case', [row], undefined, error)).toEqual([['case_number']]);
    expect(row).not.toHaveProperty('case_number');
    expect(lastValue(stub)).toBe(30);

    await driver.issueAutonumbers('crm_case', [row]);
    expect(row.case_number).toBe('CASE-00031');
    expect((await driver.create('crm_case', row)).case_number).toBe('CASE-00031');
    expect(rowCount(stub)).toBe(31);
  });

  it('answers nothing for a duplicate on a value the caller typed', async () => {
    const { driver } = await makeRemote();
    await driver.create('crm_case', { organization_id: 'orgA', title: 'typed', case_number: 'CASE-00500' });
    const row: Record<string, unknown> = { organization_id: 'orgA', title: 'dup', case_number: 'CASE-00500' };
    expect(await driver.issueAutonumbers('crm_case', [row])).toEqual([[]]);
    const error = await refusal(driver.create('crm_case', row));
    expect(await driver.issueAutonumbers('crm_case', [row], undefined, error)).toEqual([[]]);
    expect(row.case_number).toBe('CASE-00500');
  });
});
