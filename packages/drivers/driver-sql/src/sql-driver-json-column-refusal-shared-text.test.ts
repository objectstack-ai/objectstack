// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21007] The JSON-column gate's set and words are `@objectstack/core`'s now —
 * this driver's `where` and `@objectstack/objectql`'s per-aggregation `filter`
 * refuse with ONE set and ONE sentence. This file pins the driver half of the
 * move: what it throws IS the shared text, and what it refuses IS the shared
 * set, on a real `SqlDriver` over SQLite.
 *
 * That the shared text is byte for byte what this driver printed before the move
 * is pinned beside the text itself (`@objectstack/core`'s
 * `json-column-operator-refusal.test.ts`, hashes captured from this driver at the
 * commit before). Together: this driver's refusal did not change by one byte.
 *
 * The per-operator content of the refusal (code, status, the prescription, every
 * lowering face) stays pinned in `sql-driver-json-column-operator-refusal.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JSON_COLUMN_INCOMPATIBLE_OPERATORS, jsonColumnOperatorRefusalText } from '@objectstack/core';
import { FILTER_OPERATORS, type FilterCondition } from '@objectstack/spec/data';
import { SqlDriver, withheldFilterDiagnosticOf } from './index.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const LIST_OPERATORS = new Set(['$in', '$nin']);

function comparandFor(op: string): unknown {
  if (LIST_OPERATORS.has(op)) return ['usr_1'];
  if (op === '$between') return ['a', 'b'];
  if (op === '$exists' || op === '$null' || op === '$empty') return true;
  return 'usr_1';
}

describe('[#21007] driver-sql — the JSON-column refusal is the shared set and the shared text', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.syncSchema('team', {
      name: 'team',
      fields: { name: { type: 'text' }, members: { type: 'lookup', reference: 'user', multiple: true } },
    } as any);
  });
  afterAll(async () => {
    await (driver as any)?.disconnect?.();
  });

  async function refusalOf(where: Record<string, unknown>): Promise<WireBearingError | null> {
    try {
      await driver.find('team', { where: where as FilterCondition });
      return null;
    } catch (e) {
      return e as WireBearingError;
    }
  }

  // Every declared operator, judged by whether the shared set names it — so a
  // member added to or dropped from the set moves this driver's answer with it.
  for (const op of FILTER_OPERATORS) {
    const refused = JSON_COLUMN_INCOMPATIBLE_OPERATORS.has(op);
    it(`${op}: ${refused ? 'refused with the shared text' : 'not this refusal'}`, async () => {
      const err = await refusalOf({ members: { [op]: comparandFor(op) } });
      const shared = jsonColumnOperatorRefusalText('members', op, false);
      if (!refused) {
        expect(err?.message ?? '').not.toBe(shared.message);
        return;
      }
      expect(err, 'refused').not.toBeNull();
      expect(err!.code).toBe('INVALID_FILTER');
      expect(err!.status).toBe(400);
      expect(err!.message).toBe(shared.message);
      expect(withheldFilterDiagnosticOf(err)).toBe(shared.diagnostic);
    });
  }

  it('the bare equality spelling: refused with the shared text, operator "="', async () => {
    const err = await refusalOf({ members: 'usr_1' });
    const shared = jsonColumnOperatorRefusalText('members', '=', true);
    expect(err?.code).toBe('INVALID_FILTER');
    expect(err?.status).toBe(400);
    expect(err?.message).toBe(shared.message);
    expect(withheldFilterDiagnosticOf(err)).toBe(shared.diagnostic);
  });
});
