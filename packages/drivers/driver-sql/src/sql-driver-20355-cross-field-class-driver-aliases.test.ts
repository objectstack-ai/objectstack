// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20355] This driver's cross-field comparison class READS the spec's
 * classification (`crossFieldColumnVerdict`, `@objectstack/spec/data`) for
 * every declared `FieldType`, and layers above it only what the spec leaves to
 * a driver: its internal aliases, which are not `FieldType` members and which
 * the spec answers `undefined` for.
 *
 * The `FieldType` half needs no pin of its own any more — it IS the export,
 * which `filter-cross-field-comparison-class.test.ts` pins in the spec. The
 * #20347 parity test that held this driver's private copy equal to the export
 * over every declared pair retired with the copy. What this file pins is the
 * alias layer the rewire kept, read off the driver's own column sets:
 *
 * | declared `type` | class | why |
 * |---|---|---|
 * | `integer` / `int` / `float` | numeric | `NUMERIC_SCALAR_TYPES`' driver-internal aliases |
 * | `object` / `array` | none — refused | `JSON_COLUMN_TYPES`' driver-internal aliases |
 *
 * (The absent-type `string` default is not pinned: `createColumn` refuses a
 * field that declares no `type`, so no managed table carries one to compare.)
 *
 * Each cell is read from what the driver DOES — the comparison compiles and
 * runs, or it is refused in the `INVALID_FILTER` / 400 envelope — so an alias
 * the rewire reclassified shows up as an admitted refusal or a refused
 * admission, never as prose.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver, withheldFilterDiagnosticOf } from './index.js';
import type { FilterCondition } from '@objectstack/spec/data';

const OBJ = 'cfc_alias_probe';

const FIELDS: Record<string, Record<string, unknown>> = {
  id: { name: 'id', type: 'text' },
  f_number: { name: 'f_number', type: 'number' },
  f_integer: { name: 'f_integer', type: 'integer' },
  f_int: { name: 'f_int', type: 'int' },
  f_float: { name: 'f_float', type: 'float' },
  f_text: { name: 'f_text', type: 'text' },
  f_object: { name: 'f_object', type: 'object' },
  f_array: { name: 'f_array', type: 'array' },
  f_json: { name: 'f_json', type: 'json' },
};

type Observed = 'admitted' | 'refused';

const CELLS: ReadonlyArray<[target: string, ref: string, expected: Observed]> = [
  ['f_integer', 'f_number', 'admitted'],
  ['f_int', 'f_float', 'admitted'],
  ['f_float', 'f_number', 'admitted'],
  ['f_integer', 'f_text', 'refused'],
  ['f_object', 'f_text', 'refused'],
  ['f_text', 'f_array', 'refused'],
  ['f_object', 'f_object', 'refused'],
  ['f_object', 'f_json', 'refused'],
];

describe('[#20355] driver-sql cross-field class — the driver-internal aliases above the spec classification', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.initObjects([{ name: OBJ, fields: FIELDS } as never]);
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  async function observe(target: string, ref: string): Promise<Observed> {
    const where = { [target]: { $eq: { $field: ref } } } as FilterCondition;
    try {
      await driver.find(OBJ, { fields: ['id'], where });
      return 'admitted';
    } catch (e) {
      const err = e as { code?: unknown; status?: unknown };
      expect({ code: err.code, status: err.status }, `${target} vs ${ref}: ${String(e)}`)
        .toEqual({ code: 'INVALID_FILTER', status: 400 });
      expect(withheldFilterDiagnosticOf(e), `${target} vs ${ref}: not the cross-field boundary's refusal`)
        .toMatch(/stored as|no scalar stored column/);
      return 'refused';
    }
  }

  for (const [target, ref, expected] of CELLS) {
    it(`${target} vs ${ref}: ${expected}, in both orders`, async () => {
      expect(await observe(target, ref)).toBe(expected);
      expect(await observe(ref, target)).toBe(expected);
    });
  }
});
