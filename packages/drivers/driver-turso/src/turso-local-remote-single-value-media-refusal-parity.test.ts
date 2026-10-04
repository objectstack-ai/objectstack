// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21236] ONE `TursoDriver`, ONE refusal for a SINGLE-VALUE file-class field
 * stored as a JSON column: the media-column move on both transports, never
 * `$contains`.
 *
 * # Why this face is in the card
 *
 * The LOCAL face inherits `SqlDriver`, whose JSON-column gate now words its
 * refusal by the column's class (`SqlDriver.jsonColumnFieldClass`): a
 * single-value file-class field inside the ADR-0104 window reads the
 * media-column move. The REMOTE face refuses in `RemoteTransport.buildWhereSQL`
 * through the `JsonColumnResolver` the driver injects, and that resolver used to
 * answer only yes or no, so this face kept printing the `$contains` repair.
 * Measured on this harness before the change: `$startsWith` on a single `file`
 * field was refused with the `$contains` words on BOTH faces, and `$contains`
 * with the field's exact id answered no rows on both. Remote mode never moves
 * its media columns, so on that face such a field is a JSON column on every
 * deployment.
 *
 * # The invariant
 *
 * The remote face answers what the local face's `find()` answers, and both
 * answer the class's words from `@objectstack/core`'s
 * `jsonColumnOperatorRefusalText`, asserted by EQUALITY with the builder and
 * never by its literal sentence (the builder pins that by hash). A
 * `multiple: true` file field on the same object is the control: it keeps the
 * multi-value words on both faces.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { jsonColumnOperatorRefusalText, type JsonColumnFieldClass } from '@objectstack/core';
import { TursoDriver } from './turso-driver.js';
import { asLibsqlClient, makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const OBJECT = {
  name: 'media_gate_21236',
  fields: {
    att: { type: 'file' },
    pic: { type: 'image' },
    many_files: { type: 'file', multiple: true },
    title: { type: 'text' },
  },
} as const;

const ROWS = [
  { id: 'r1', att: 'fil_one', pic: 'fil_one', many_files: ['fil_one', 'fil_two'], title: 'a' },
  { id: 'r2', att: 'fil_two', pic: 'fil_two', many_files: ['fil_two'], title: 'b' },
  { id: 'r3', att: null, pic: null, many_files: null, title: 'c' },
];

type Face = 'local' | 'remote';
const FACES: readonly Face[] = ['local', 'remote'];

type Answer =
  | { rows: string[] }
  | { refused: { code: unknown; status: unknown; message: string } };

const answerOf = async (driver: TursoDriver, where: unknown): Promise<Answer> => {
  try {
    const rows = await driver.find(OBJECT.name, { where } as DriverQuery);
    return { rows: rows.map((r) => String(r.id)).sort() };
  } catch (e) {
    const err = e as { code?: unknown; status?: unknown; message: string };
    return { refused: { code: err.code, status: err.status, message: err.message } };
  }
};

const refusal = (field: string, op: string, bare: boolean, fieldClass: JsonColumnFieldClass): Answer => ({
  refused: {
    code: 'INVALID_FILTER',
    status: 400,
    message: jsonColumnOperatorRefusalText(field, op, bare, fieldClass).message,
  },
});

describe('[#21236] a single-value file-class field gets the media-column move on both TursoDriver faces', () => {
  let drivers: Record<Face, TursoDriver>;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    const local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    stub = makeLibsqlSqliteStub();
    const remote = new TursoDriver({ url: 'libsql://media-gate-21236.turso.io', client: asLibsqlClient(stub) });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');

    drivers = { local, remote };
    for (const driver of Object.values(drivers)) {
      await driver.initObjects([{ ...OBJECT, fields: { ...OBJECT.fields } }] as never);
      for (const row of ROWS) {
        await driver.create(OBJECT.name, { ...row }, { bypassTenantAudit: true } as never);
      }
    }
  }, 60_000);

  afterAll(async () => {
    await drivers.local.disconnect();
    await drivers.remote.disconnect();
    stub.close();
  });

  /** Assert `expected` on BOTH faces, and that the two faces agree. */
  const expectBothFaces = async (where: unknown, expected: Answer): Promise<void> => {
    const local = await answerOf(drivers.local, where);
    const remote = await answerOf(drivers.remote, where);
    expect(remote, `remote must answer what local answers for ${JSON.stringify(where)}`).toEqual(local);
    expect(local, `local, ${JSON.stringify(where)}`).toEqual(expected);
  };

  for (const field of ['att', 'pic'] as const) {
    for (const op of ['$startsWith', '$icontains', '$eq', '$in', '$ne']) {
      it(`${field} ${op}: the single-value-media words on both faces`, async () => {
        const comparand = op === '$in' ? ['fil_one'] : 'fil_one';
        await expectBothFaces({ [field]: { [op]: comparand } }, refusal(field, op, false, 'single-value-media'));
      });
    }
    it(`${field} bare equality: the single-value-media bare words on both faces`, async () => {
      await expectBothFaces({ [field]: 'fil_one' }, refusal(field, '=', true, 'single-value-media'));
    });
    it(`${field} { field: null }: the single-value-media bare words on both faces, and $null answers`, async () => {
      await expectBothFaces({ [field]: null }, refusal(field, '=', true, 'single-value-media'));
      await expectBothFaces({ [field]: { $null: true } }, { rows: ['r3'] });
    });
  }

  it('none of those messages prescribes $contains, which answers no rows on that column on both faces', async () => {
    for (const face of FACES) {
      const answer = await answerOf(drivers[face], { att: { $startsWith: 'fil_o' } });
      expect('refused' in answer && answer.refused.message, face).not.toContain('$contains');
    }
    await expectBothFaces({ att: { $contains: 'fil_one' } }, { rows: [] });
  });

  it('the control: a multi-valued file field keeps the multi-value words on both faces, and $contains is membership', async () => {
    await expectBothFaces(
      { many_files: { $startsWith: 'fil_o' } },
      refusal('many_files', '$startsWith', false, 'multi-value-or-json'),
    );
    await expectBothFaces(
      { many_files: { $startsWith: 'fil_o' } },
      { refused: { code: 'INVALID_FILTER', status: 400, message: jsonColumnOperatorRefusalText('many_files', '$startsWith', false).message } },
    );
    await expectBothFaces({ many_files: { $contains: 'fil_one' } }, { rows: ['r1'] });
  });
});
