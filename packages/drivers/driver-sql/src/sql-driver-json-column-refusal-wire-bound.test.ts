// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21067] The JSON-column refusal reaches the caller WHOLE: run through the
 * envelope the REST `/data` door builds from a thrown refusal (`mapDataError`,
 * `@objectstack/types`), its `error` is every word the refusal wrote, on every
 * dialect cell.
 *
 * ## What the door cut
 *
 * The door cuts a 4xx message of 500 characters or more to 499 plus an
 * ellipsis, keeping the head. The withheld message this driver throws on a
 * multi-value or JSON field was 748 characters. Measured with that text back in
 * place, on SQLite and a live PostgreSQL 16.14 alike, the envelope ended
 * `Refused rather than compiled because the answ…`: no caller read the end of
 * the reason, or the sentence saying the field and the operator were withheld
 * and where the diagnostic went. The author-disclosed text (the diagnostic,
 * which the `'author'` provenance arm puts on the wire) was 643 characters for
 * a field named `owners`. It was cut for every field name, and from a
 * 10-character name on, the cut took the any-of example as well.
 *
 * ## What this file pins, per dialect cell
 *
 * For every `$` spelling in `JSON_COLUMN_INCOMPATIBLE_OPERATORS` and the bare
 * equality spelling, on a multi-value lookup, a `tags` field and a `json`
 * field:
 *
 * - an unmarked filter: `400` / `INVALID_FILTER`, and the envelope's `error` IS
 *   the shared withheld message — so it was not cut — carrying the `$contains`
 *   remedy, the presence spellings a `null` comparand needs, and the sentence
 *   saying where the field and the operator went;
 * - the same filter marked `'author'`: the envelope's `error` IS the shared
 *   diagnostic, whole, the remedy spelled with the field's own name.
 *
 * Compared with `jsonColumnOperatorRefusalText`'s output and the door's own
 * function, never a copy of the sentence or of the 500: a later rewording that
 * stays inside the bound leaves this file green, and one that does not turns
 * it red. The words themselves are pinned once, in `@objectstack/core`.
 *
 * The SQLite cell always runs. The PostgreSQL and MySQL cells run where
 * `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are set; the
 * `Temporal Conformance (live PG + MySQL)` job sets both and runs this
 * package's whole suite. Otherwise they are a named skip.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import { JSON_COLUMN_INCOMPATIBLE_OPERATORS, jsonColumnOperatorRefusalText } from '@objectstack/core';
import { mapDataError } from '@objectstack/types';
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import {
  DIALECT_CELLS,
  declareDialectCell,
  LIVE_CELL_TIMEOUT_MS,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/** Issue-prefixed: each live cell owns its table, dropped before and after. */
const OBJECT = 'os21067_wire';

/** Diagnostics-only; it never changes which rows a read touches. */
const BYPASS: DriverOptions = { bypassTenantAudit: true };

const FIELDS: Record<string, Record<string, unknown>> = {
  label: { type: 'text' },
  owners: { type: 'lookup', reference: 'os21067_owner', multiple: true },
  tags_: { type: 'tags' },
  meta: { type: 'json' },
};

/** The spellings a caller writes as an operator key: the `$` members of the set. */
const REFUSED_OPERATORS = [...JSON_COLUMN_INCOMPATIBLE_OPERATORS].filter((op) => op.startsWith('$'));

/** A comparand each operator's own contract accepts, so the refusal is always this gate's. */
function comparandFor(op: string): unknown {
  if (op === '$in' || op === '$nin') return ['u1', 'u9'];
  if (op === '$between') return ['a', 'b'];
  if (op === '$like' || op === '$ilike') return '%u1%';
  return 'u1';
}

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

async function refusalOf(run: () => Promise<unknown>): Promise<WireBearingError> {
  try {
    await run();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the driver to refuse this filter, but it resolved');
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, '[#21067] the JSON-column refusal on the wire', declareWireCell);
}

function declareWireCell(cell: DialectCell): void {
  describe(`[#21067] SqlDriver — the JSON-column refusal is whole in the /data door's envelope (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: Knex;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = driver.getKnex();
      await knexInstance.schema.dropTableIfExists(OBJECT);
      await driver.initObjects([{ name: OBJECT, fields: FIELDS } as never]);
      await driver.create(OBJECT, { id: '1', label: 'u1', owners: ['u1', 'u2'], tags_: ['red'], meta: ['a'] }, BYPASS);
    }, LIVE_CELL_TIMEOUT_MS);

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(OBJECT).catch(() => {});
      await driver?.disconnect?.();
    });

    /** What the `/data` door answers for the refusal `where` draws. */
    const wireOf = async (where: Record<string, unknown>) => {
      const err = await refusalOf(() => driver.find(OBJECT, { where: where as FilterCondition }, BYPASS));
      const { status, body } = mapDataError(err, OBJECT);
      return { status, code: body.code, error: String(body.error) };
    };

    for (const field of ['owners', 'tags_', 'meta']) {
      const spellings: ReadonlyArray<readonly [name: string, op: string, bare: boolean, condition: unknown]> = [
        ...REFUSED_OPERATORS.map((op) => [op, op, false, { [op]: comparandFor(op) }] as const),
        ['bare equality', '=', true, 'u1'],
      ];
      for (const [name, op, bare, condition] of spellings) {
        it(`${field} ${name}: the withheld message, whole, then the diagnostic, whole, for the author`, async () => {
          const shared = jsonColumnOperatorRefusalText(field, op, bare);

          const withheld = await wireOf({ [field]: condition });
          expect({ status: withheld.status, code: withheld.code }).toEqual({ status: 400, code: 'INVALID_FILTER' });
          // Equal to what the refusal wrote ⇒ the door's bound cut nothing.
          expect(withheld.error).toBe(shared.message);
          expect(withheld.error).toContain(
            '({ "$or": [{ "FIELD": { "$contains": "a" } }, { "FIELD": { "$contains": "b" } }] })',
          );
          expect(withheld.error).toContain('For no value, use "$null" or "$empty".');
          expect(withheld.error).toContain('withheld from the message; the full diagnostic is in the server log.');
          expect(withheld.error).not.toContain(`"${field}"`);

          const authored = await wireOf(markFilterSubtreeProvenance({ [field]: condition }, 'author'));
          expect({ status: authored.status, code: authored.code }).toEqual({ status: 400, code: 'INVALID_FILTER' });
          expect(authored.error).toBe(shared.diagnostic);
          expect(authored.error).toContain(
            `({ "$or": [{ "${field}": { "$contains": "a" } }, { "${field}": { "$contains": "b" } }] })`,
          );
        });
      }
    }
  });
}
