// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21178] ONE `TursoDriver`, ONE answer on a JSON-stored column — the two
 * transports held against each other on the JSON-column half of the filter
 * contract: the operators such a column refuses, and what `$contains` /
 * `$notContains` mean there.
 *
 * # The defect this file pins closed
 *
 * LOCAL mode inherits `SqlDriver`, whose filter compiler refuses every operator
 * in `@objectstack/core`'s `JSON_COLUMN_INCOMPATIBLE_OPERATORS` on a column it
 * stores as JSON TEXT (#7398, the set widened by #21009) and answers
 * `$contains` / `$notContains` by MEMBERSHIP through `jsonMembershipPredicate`
 * (#17590 / #20987). REMOTE mode compiles in `RemoteTransport.buildWhereSQL`,
 * an independent emitter that read neither, so over the same multi-value
 * lookup holding `["u1","u2"]`, `["u2"]`, `["u3","u1"]` and `["u10"]` it
 * answered — measured on this harness before the change:
 *
 * | filter | remote, before | local (the contract) |
 * |---|---|---|
 * | `$contains: 'u1'` | r1, r3 AND r4 (`u10` by substring) | r1, r3 |
 * | `$notContains: 'u1'` | r2, r5 (dropped r4) | r2, r4, r5 |
 * | `$nin: ['u1']`, `$ne: 'u1'` | every row (fail-OPEN) | `INVALID_FILTER` / 400 |
 * | `$eq` / `$in` / bare equality | no row | `INVALID_FILTER` / 400 |
 * | `$lt` / `$lte` `'u1'` | r1-r4 (lexicographic) | `INVALID_FILTER` / 400 |
 * | `$startsWith: '['`, `$endsWith: ']'` | r1-r4 (the serialization) | `INVALID_FILTER` / 400 |
 * | `json` field `$contains: 'u1'` | text inside the object | no row (array-only) |
 *
 * Hosted tenant databases run only on the remote transport, so every one of
 * those rows was the answer a deployment got by holding a `libsql://` URL.
 *
 * # The invariant, and why it is asserted twice
 *
 * The remote face answers the same row set as the local face's `find()`, or
 * refuses with `INVALID_FILTER` / 400 — never a third, quieter answer. Each
 * case is held to that PARITY and, separately, to the canonical answer the
 * contract requires: parity alone is satisfiable by breaking both faces the
 * same way.
 *
 * # Read from the shared module, never from the card
 *
 * The refused set is iterated from `JSON_COLUMN_INCOMPATIBLE_OPERATORS` as it
 * stands, so a member added there is pinned on both faces with no edit here.
 * Refusals are asserted by the ADR-0112 `code` and `status` and by EQUALITY
 * with `jsonColumnOperatorRefusalText`'s output — never by the sentence's
 * literal words, which belong to that builder (#21067 rewrites them; these
 * pins move with it, not against it).
 *
 * The population is the driver's: `owners` is `multiple: true` on a
 * multi-capable type, `tags` an inherently multi-value option type, `payload`
 * a structured-JSON type — the three ways a field becomes a JSON column — and
 * `title` is the scalar control, whose answers must not move.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { JSON_COLUMN_INCOMPATIBLE_OPERATORS, jsonColumnOperatorRefusalText } from '@objectstack/core';
import { TursoDriver } from './turso-driver.js';
import { asLibsqlClient, makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const OBJECT = {
  name: 'json_gate_21178',
  fields: {
    owners: { type: 'lookup', reference: 'sys_user', multiple: true },
    tags: { type: 'tags' },
    payload: { type: 'json' },
    title: { type: 'text' },
  },
} as const;

const ROWS = [
  { id: 'r1', owners: ['u1', 'u2'], tags: ['a'], payload: { k: 'u1' }, title: 'u1' },
  { id: 'r2', owners: ['u2'], tags: ['b'], payload: { k: 'u2' }, title: 'u2' },
  { id: 'r3', owners: ['u3', 'u1'], tags: ['a', 'b'], payload: { k: 'u3' }, title: 'u3' },
  { id: 'r4', owners: ['u10'], tags: ['c'], payload: { k: 'u10' }, title: 'u10' },
  { id: 'r5', owners: null, tags: null, payload: null, title: null },
];

type Face = 'local' | 'remote';
const FACES: readonly Face[] = ['local', 'remote'];

/** What one face answered: the matched ids, or the refusal's wire identity. */
type Answer =
  | { rows: string[] }
  | { refused: { code: unknown; status: unknown; message: string } };

interface WireBearingError {
  code?: unknown;
  status?: unknown;
  message: string;
}

const answerOf = async (driver: TursoDriver, where: unknown): Promise<Answer> => {
  try {
    const rows = await driver.find(OBJECT.name, { where } as DriverQuery);
    return { rows: rows.map((r) => String(r.id)).sort() };
  } catch (e) {
    const err = e as WireBearingError;
    return { refused: { code: err.code, status: err.status, message: err.message } };
  }
};

/** The refusal the shared builder words for `op` on `field` — the expected wire identity. */
const jsonRefusal = (field: string, op: string, bare = false): Answer => ({
  refused: {
    code: 'INVALID_FILTER',
    status: 400,
    message: jsonColumnOperatorRefusalText(field, op, bare).message,
  },
});

/** A comparand each refused operator can bind, so its arm is reached rather than a comparand gate. */
const comparandFor = (op: string): unknown => {
  if (op === '$in' || op === '$nin' || op === 'in' || op === 'nin' || op === 'not_in' || op === 'notin') return ['u1'];
  if (op === '$between' || op === 'between') return ['a', 'z'];
  if (op === '$like' || op === '$ilike') return 'u1%';
  return 'u1';
};

describe('[#21178] a JSON-stored column gets ONE answer on both TursoDriver faces', () => {
  let drivers: Record<Face, TursoDriver>;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    const local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');

    stub = makeLibsqlSqliteStub();
    const remote = new TursoDriver({ url: 'libsql://json-gate-21178.turso.io', client: asLibsqlClient(stub) });
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

  // ─── §1 The refused set, iterated from the shared module ─────────────────

  describe('every operator in JSON_COLUMN_INCOMPATIBLE_OPERATORS is refused on a JSON column', () => {
    it('the set is non-empty and carries the card\'s operators (a vacuous loop is not a pin)', () => {
      for (const op of ['$eq', '$ne', '$in', '$nin', '$lt', '$lte', '$startsWith', '$endsWith']) {
        expect(JSON_COLUMN_INCOMPATIBLE_OPERATORS.has(op), op).toBe(true);
      }
      // The membership pair is the load-bearing ABSENCE: it is answered, not refused.
      expect(JSON_COLUMN_INCOMPATIBLE_OPERATORS.has('$contains')).toBe(false);
      expect(JSON_COLUMN_INCOMPATIBLE_OPERATORS.has('$notContains')).toBe(false);
    });

    for (const op of JSON_COLUMN_INCOMPATIBLE_OPERATORS) {
      if (!op.startsWith('$')) {
        // The bare infix spellings (`=`, `in`, …) are members because
        // `driver-sql`'s normalised arms answer them; inside an operator MAP
        // neither face reads them as operators, and both refuse the map as an
        // object comparand before any column question is asked. The pin is
        // that this stays a refusal on both faces — never rows.
        it(`${op} (bare infix spelling) in an operator map is refused on both faces`, async () => {
          for (const face of FACES) {
            const answer = await answerOf(drivers[face], { owners: { [op]: comparandFor(op) } });
            expect('refused' in answer, `${face} answered rows for ${op}`).toBe(true);
            if ('refused' in answer) {
              expect(answer.refused.code, face).toBe('INVALID_FILTER');
              expect(answer.refused.status, face).toBe(400);
            }
          }
        });
        continue;
      }
      it(`${op} on a multi-value lookup is refused with the shared sentence on both faces`, async () => {
        await expectBothFaces({ owners: { [op]: comparandFor(op) } }, jsonRefusal('owners', op));
      });
    }

    it('the bare equality spelling { field: value } is refused with the shared bare-spelling sentence', async () => {
      await expectBothFaces({ owners: 'u1' }, jsonRefusal('owners', '=', true));
    });

    it('the gate holds at every depth: under $and, $or and $not', async () => {
      const refusal = jsonRefusal('owners', '$nin');
      await expectBothFaces({ $and: [{ title: 'u1' }, { owners: { $nin: ['u1'] } }] }, refusal);
      await expectBothFaces({ $or: [{ title: 'u1' }, { owners: { $nin: ['u1'] } }] }, refusal);
      await expectBothFaces({ $not: { owners: { $nin: ['u1'] } } }, refusal);
    });

    it('the population is the driver\'s: an option-array type and a structured-JSON type refuse too', async () => {
      await expectBothFaces({ tags: { $nin: ['a'] } }, jsonRefusal('tags', '$nin'));
      await expectBothFaces({ payload: { $eq: 'u1' } }, jsonRefusal('payload', '$eq'));
    });

    it('a door other than find() refuses alike: count()', async () => {
      for (const face of FACES) {
        const err = await drivers[face]
          .count(OBJECT.name, { where: { owners: { $nin: ['u1'] } } } as DriverQuery)
          .then(() => null, (e: unknown) => e as WireBearingError);
        expect(err, `${face} counted a refused filter`).not.toBeNull();
        expect(err!.code, face).toBe('INVALID_FILTER');
        expect(err!.status, face).toBe(400);
        expect(err!.message, face).toBe(jsonColumnOperatorRefusalText('owners', '$nin', false).message);
      }
    });
  });

  // ─── §2 The membership pair ──────────────────────────────────────────────

  describe('$contains / $notContains answer membership on a JSON column', () => {
    it('u1 is a member of [u1,u2] and [u3,u1] — and NOT of [u10] (substring vs membership)', async () => {
      await expectBothFaces({ owners: { $contains: 'u1' } }, { rows: ['r1', 'r3'] });
    });

    it('u10 answers only the row holding it', async () => {
      await expectBothFaces({ owners: { $contains: 'u10' } }, { rows: ['r4'] });
    });

    it('$notContains is the exact complement, NULL row included', async () => {
      await expectBothFaces({ owners: { $notContains: 'u1' } }, { rows: ['r2', 'r4', 'r5'] });
    });

    it('an inherently multi-value option type answers membership the same way', async () => {
      await expectBothFaces({ tags: { $contains: 'a' } }, { rows: ['r1', 'r3'] });
    });

    it('a structured-JSON object has no members: its serialization is not searched', async () => {
      await expectBothFaces({ payload: { $contains: 'u1' } }, { rows: [] });
    });

    it('the binds stay aligned when membership composes with sibling predicates', async () => {
      // The membership construct binds its candidates before the sibling's
      // comparand; a misaligned bind list answers a different row or none.
      await expectBothFaces({ $and: [{ owners: { $contains: 'u1' } }, { title: 'u3' }] }, { rows: ['r3'] });
      await expectBothFaces({ $or: [{ owners: { $contains: 'u10' } }, { title: 'u2' }] }, { rows: ['r2', 'r4'] });
      await expectBothFaces({ $not: { owners: { $contains: 'u1' } } }, { rows: ['r2', 'r4', 'r5'] });
    });

    it('count() answers the same membership', async () => {
      for (const face of FACES) {
        const n = await drivers[face].count(OBJECT.name, { where: { owners: { $contains: 'u1' } } } as DriverQuery);
        expect(n, face).toBe(2);
      }
    });
  });

  // ─── §3 The scalar control ───────────────────────────────────────────────

  describe('control: a scalar text field keeps every answer it had', () => {
    it('$contains is still a substring test there', async () => {
      await expectBothFaces({ title: { $contains: 'u1' } }, { rows: ['r1', 'r4'] });
    });

    it('$nin / $eq / $startsWith still compile there', async () => {
      await expectBothFaces({ title: { $nin: ['u1'] } }, { rows: ['r2', 'r3', 'r4', 'r5'] });
      await expectBothFaces({ title: { $eq: 'u1' } }, { rows: ['r1'] });
      await expectBothFaces({ title: 'u1' }, { rows: ['r1'] });
      await expectBothFaces({ title: { $startsWith: 'u1' } }, { rows: ['r1', 'r4'] });
    });
  });

  // ─── §4 The presence questions stay answerable ──────────────────────────

  describe('presence on a JSON column is not a comparison: $null / $exists are answered alike', () => {
    it('$null and $exists answer the NULL row', async () => {
      await expectBothFaces({ owners: { $null: true } }, { rows: ['r5'] });
      await expectBothFaces({ owners: { $exists: true } }, { rows: ['r1', 'r2', 'r3', 'r4'] });
    });

    it('the EQUALITY spellings of a null comparand stay in the refused family, as locally', async () => {
      // The local face's gate reads the operator, not the comparand, so
      // `$eq: null`, `$ne: null` and the bare `{ field: null }` are refused on
      // a JSON column there; before #21178 the remote face answered the bare
      // one with the NULL row. `$null` / `$exists` above are the presence
      // spellings, and both faces answer them.
      await expectBothFaces({ owners: null }, jsonRefusal('owners', '=', true));
      await expectBothFaces({ owners: { $eq: null } }, jsonRefusal('owners', '$eq'));
      await expectBothFaces({ owners: { $ne: null } }, jsonRefusal('owners', '$ne'));
      // Control: on the scalar field the same three are answered, on both faces.
      await expectBothFaces({ title: null }, { rows: ['r5'] });
      await expectBothFaces({ title: { $eq: null } }, { rows: ['r5'] });
      await expectBothFaces({ title: { $ne: null } }, { rows: ['r1', 'r2', 'r3', 'r4'] });
    });
  });
});
