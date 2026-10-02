// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21236] The JSON-column refusal on a SINGLE-VALUE file-class field inside the
 * ADR-0104 dual-encoding window prescribes the media-column move, not
 * `$contains`.
 *
 * ## The defect this file pins closed
 *
 * On a deployment whose media columns have not moved, this driver stores a
 * single-value `file` / `image` / `avatar` / `video` / `audio` field as a JSON
 * column holding one JSON string (`SqlDriver.isJsonField` →
 * `mediaColumnIsJson()`), so the JSON-column gate (#7398, widened by #21009)
 * refuses every operator in `JSON_COLUMN_INCOMPATIBLE_OPERATORS` there. The
 * refusal prescribed `$contains`, the membership repair a multi-valued field
 * takes. Measured on this harness before the change: `$contains` with the
 * field's exact id answered NO rows, so the prescribed repair answered nothing.
 * The repair that works is the move: once the columns have moved, the same
 * `$startsWith` and `$eq` answer rows and the gate does not fire.
 *
 * ## Three pins, as triage graded them
 *
 * - §1 inside the window, a single-value file-class field reads the
 *   `'single-value-media'` words: the move, never `$contains`;
 * - §2 the control, on the same driver: a `multiple: true` file field keeps the
 *   multi-value words byte for byte, and `$contains` answers its membership;
 * - §3 the columns moved: no refusal, and the operators answer rows.
 *
 * Refusals are asserted by the ADR-0112 `code` and `status` and by EQUALITY with
 * `@objectstack/core`'s `jsonColumnOperatorRefusalText` for the class, never by
 * the sentence's literal words, which that builder pins by hash.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JSON_COLUMN_INCOMPATIBLE_OPERATORS, jsonColumnOperatorRefusalText } from '@objectstack/core';
import { FILE_REFERENCE_TYPES, FILTER_OPERATORS, type FilterCondition } from '@objectstack/spec/data';
import type { DriverOptions } from '@objectstack/spec/data';
import { SqlDriver, withheldFilterDiagnosticOf } from './index.js';

// ⛔ Not `as any`: `check:query-options-erasure` counts every erased options bag.
const OPTS: DriverOptions = { bypassTenantAudit: true };

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const OBJECT = 'media_21236';

/** One single-value field per file-class type, plus the multi-valued control and a text column. */
const SINGLE_VALUE_MEDIA = [...FILE_REFERENCE_TYPES].map((type) => [type, `one_${type}`] as const);
const FIELDS: Record<string, Record<string, unknown>> = {
  title: { type: 'text' },
  many_files: { type: 'file', multiple: true },
  ...Object.fromEntries(SINGLE_VALUE_MEDIA.map(([type, name]) => [name, { type }])),
};

const ROWS = [
  { id: 'r1', title: 'a', many_files: ['fil_one', 'fil_two'], ...Object.fromEntries(SINGLE_VALUE_MEDIA.map(([, n]) => [n, 'fil_one'])) },
  { id: 'r2', title: 'b', many_files: ['fil_two'], ...Object.fromEntries(SINGLE_VALUE_MEDIA.map(([, n]) => [n, 'fil_two'])) },
  { id: 'r3', title: 'c', many_files: null, ...Object.fromEntries(SINGLE_VALUE_MEDIA.map(([, n]) => [n, null])) },
];

/** The `$`-operators of the refused set the spec declares, each with a comparand its arm binds. */
const REFUSED_DECLARED = FILTER_OPERATORS.filter((op) => JSON_COLUMN_INCOMPATIBLE_OPERATORS.has(op));
const comparandFor = (op: string): unknown => {
  if (op === '$in' || op === '$nin') return ['fil_one'];
  if (op === '$between') return ['fil_a', 'fil_z'];
  return 'fil_one';
};

async function driverOn(moved: boolean): Promise<SqlDriver> {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    ...(moved ? { fileColumnsMoved: true } : {}),
  });
  await driver.initObjects([{ name: OBJECT, fields: { ...FIELDS } }]);
  for (const row of ROWS) await driver.create(OBJECT, { ...row }, OPTS);
  return driver;
}

type Answer = { rows: string[] } | { refused: WireBearingError };

async function answerOf(driver: SqlDriver, where: Record<string, unknown>): Promise<Answer> {
  try {
    const rows = await driver.find(OBJECT, { where: where as FilterCondition }, OPTS);
    return { rows: rows.map((r: any) => String(r.id)).sort() };
  } catch (e) {
    return { refused: e as WireBearingError };
  }
}

function expectRefusal(answer: Answer, expected: { message: string; diagnostic: string }, label: string): void {
  expect('refused' in answer, `${label}: refused`).toBe(true);
  if (!('refused' in answer)) return;
  expect(answer.refused.code, label).toBe('INVALID_FILTER');
  expect(answer.refused.status, label).toBe(400);
  expect(answer.refused.message, label).toBe(expected.message);
  expect(withheldFilterDiagnosticOf(answer.refused), label).toBe(expected.diagnostic);
}

describe('[#21236] driver-sql — inside the ADR-0104 window (media columns not moved)', () => {
  let driver: SqlDriver;
  beforeAll(async () => {
    driver = await driverOn(false);
  });
  afterAll(async () => {
    await driver?.disconnect?.();
  });

  it('the population is real: five single-value file-class types, and the refused set is non-empty', () => {
    expect(SINGLE_VALUE_MEDIA.map(([type]) => type).sort()).toEqual(['audio', 'avatar', 'file', 'image', 'video']);
    expect(REFUSED_DECLARED).toEqual(expect.arrayContaining(['$eq', '$in', '$startsWith', '$endsWith', '$icontains']));
  });

  describe('§1 a single-value file-class field reads the media-column move', () => {
    for (const [type, field] of SINGLE_VALUE_MEDIA) {
      it(`${type}: every refused operator, and the bare equality spelling`, async () => {
        for (const op of REFUSED_DECLARED) {
          const answer = await answerOf(driver, { [field]: { [op]: comparandFor(op) } });
          expectRefusal(answer, jsonColumnOperatorRefusalText(field, op, false, 'single-value-media'), `${type} ${op}`);
          if ('refused' in answer) expect(answer.refused.message, op).not.toContain('$contains');
        }
        expectRefusal(
          await answerOf(driver, { [field]: 'fil_one' }),
          jsonColumnOperatorRefusalText(field, '=', true, 'single-value-media'),
          `${type} bare`,
        );
      });
    }

    it('why the prescription moved: $contains with the exact id answers no rows on that column', async () => {
      expect(await answerOf(driver, { one_file: { $contains: 'fil_one' } })).toEqual({ rows: [] });
    });

    it('the presence spellings the refusal still names answer there', async () => {
      expect(await answerOf(driver, { one_file: { $null: true } })).toEqual({ rows: ['r3'] });
      expect(await answerOf(driver, { one_file: { $empty: true } })).toEqual({ rows: ['r3'] });
    });
  });

  describe('§2 the control: a multi-valued file field keeps the membership words', () => {
    it('every refused operator reads the multi-value class, byte for byte the default words', async () => {
      for (const op of REFUSED_DECLARED) {
        const answer = await answerOf(driver, { many_files: { [op]: comparandFor(op) } });
        const words = jsonColumnOperatorRefusalText('many_files', op, false);
        expect(jsonColumnOperatorRefusalText('many_files', op, false, 'multi-value-or-json'), op).toEqual(words);
        expectRefusal(answer, words, `many_files ${op}`);
      }
      expectRefusal(
        await answerOf(driver, { many_files: 'fil_one' }),
        jsonColumnOperatorRefusalText('many_files', '=', true),
        'many_files bare',
      );
    });

    it('and $contains answers its membership', async () => {
      expect(await answerOf(driver, { many_files: { $contains: 'fil_one' } })).toEqual({ rows: ['r1'] });
    });
  });
});

describe('[#21236] driver-sql — §3 the media columns moved: no refusal', () => {
  let driver: SqlDriver;
  beforeAll(async () => {
    driver = await driverOn(true);
  });
  afterAll(async () => {
    await driver?.disconnect?.();
  });

  for (const [type, field] of SINGLE_VALUE_MEDIA) {
    it(`${type}: the operators the window refused answer rows`, async () => {
      expect(await answerOf(driver, { [field]: { $startsWith: 'fil_o' } }), `${type} $startsWith`).toEqual({ rows: ['r1'] });
      expect(await answerOf(driver, { [field]: { $eq: 'fil_one' } }), `${type} $eq`).toEqual({ rows: ['r1'] });
      expect(await answerOf(driver, { [field]: 'fil_two' }), `${type} bare`).toEqual({ rows: ['r2'] });
    });
  }

  it('the multi-valued control is still refused with the membership words', async () => {
    expectRefusal(
      await answerOf(driver, { many_files: { $startsWith: 'fil_o' } }),
      jsonColumnOperatorRefusalText('many_files', '$startsWith', false),
      'many_files $startsWith (moved)',
    );
  });
});
