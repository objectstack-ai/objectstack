// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7872] `driver-memory` held to `FILTER_COMPARAND_TYPE_CASES` — the
 * comparand-type door, both directions, on the mingo path a real query runs.
 *
 * This is the driver the card was filed over: `{qty: {$eq: BigInt(100)}}`
 * escaped as a raw mingo `TypeError` out of `Query.compile` (mingo builds its
 * cache key with `JSON.stringify`, which refuses a BigInt), and five other
 * unsupported comparand types answered silent zero rows — on both faces.
 * NOTHING here patches the driver — that was the #5499 investment freeze's
 * call when this suite was written, and the freeze dissolved 2026-08-11 (head
 * note of `@objectstack/spec`'s `aggregation-conformance.ts`), so patching is
 * now unclaimed rather than forbidden. The suite's scope is unchanged either
 * way, because what it actually asserts is the door: `parseFilterAST`
 * (`@objectstack/spec/data`) refuses or narrows every comparand BEFORE the
 * driver runs, and this suite proves the inheritance —
 * door-validated input executes correctly (the bigint arrives as its exact
 * number, so mingo never sees one), door-refused input never reaches mingo at
 * all.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  FILTER_COMPARAND_TYPE_CASES,
  FILTER_COMPARAND_TYPE_ROWS,
  FILTER_STRING_STORED_COMPARAND_CASES,
  FILTER_STRING_STORED_COMPARAND_FIELDS,
  FILTER_STRING_STORED_COMPARAND_ROWS,
  parseFilterAST,
  type FilterCondition,
} from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';

const TABLE = 'comparand_conformance';

describe('[#7872] InMemoryDriver.find — comparand-type conformance (behind the door)', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    await driver.syncSchema(TABLE, {
      fields: {
        id: { type: 'text', name: 'id' },
        qty: { type: 'number', name: 'qty' },
        label: { type: 'text', name: 'label' },
        active: { type: 'boolean', name: 'active' },
        note: { type: 'text', name: 'note' },
      },
    });
    for (const row of FILTER_COMPARAND_TYPE_ROWS) await driver.create(TABLE, { ...row });
  });

  const ids = async (where: FilterCondition | undefined): Promise<string[]> => {
    const rows = await driver.find(TABLE, { fields: ['id'], where });
    return (rows as Array<Record<string, unknown>>)
      .map((r) => String(r.id))
      .sort((x, y) => x.localeCompare(y));
  };

  for (const c of FILTER_COMPARAND_TYPE_CASES) {
    if (c.verdict === 'door-refusal') {
      it(`${c.name} — refused at the door, before mingo runs`, () => {
        let caught: (Error & { code?: string; status?: number }) | null = null;
        try {
          parseFilterAST(c.filter());
        } catch (e) {
          caught = e as Error & { code?: string; status?: number };
        }
        expect(caught, c.note).not.toBeNull();
        expect(caught?.code, c.name).toBe(c.code);
        expect(caught?.status, c.name).toBe(400);
        for (const fragment of c.mustMention) expect(caught?.message).toContain(fragment);
      });
    } else if (c.verdict === 'matches') {
      it(c.name, async () => {
        expect(await ids(parseFilterAST(c.filter())), c.note).toEqual([...c.expected]);
      });
    } else {
      it(`${c.name} — executes without refusal`, async () => {
        await expect(ids(parseFilterAST(c.filter()))).resolves.toBeDefined();
      });
    }
  }

  it('the fixture really is both rows', async () => {
    expect(await ids(undefined)).toEqual(['1', '2']);
  });

  /**
   * The inheritance boundary, made visible: the SAME bigint filter that the
   * door narrows into a working query still crashes mingo when it is handed to
   * the driver DIRECTLY (no platform path does this — both doors run the door
   * walk — but direct construction is how #7872 measured it). This pin is what
   * proves the door is doing the work rather than mingo having quietly learned
   * BigInt; if mingo ever does, this test fails loudly and should be RETIRED
   * along with its sentence in the door's docblock — the door's own behaviour
   * above does not change either way.
   */
  it('the crash cell still exists on the direct path — the door is what stands in front of it', async () => {
    await expect(
      driver.find(TABLE, { where: { qty: { $eq: BigInt(100) } } as unknown as FilterCondition }),
    ).rejects.toThrow(/BigInt/);
  });
});

/**
 * [#29486] `FILTER_STRING_STORED_COMPARAND_CASES`, the driver's half: a number
 * or boolean comparand on a text- or option-family field reaches mingo already
 * narrowed to the string the write door stored (the engine's declared-type
 * door, pinned in `@objectstack/objectql`), so each case's `stored()` filter
 * must select exactly its rows here — and the as-written filter, handed to the
 * driver directly, still selects none of them: mingo compares `42` with `"42"`
 * strictly, which is the cell the door stands in front of.
 */
describe('[#29486] InMemoryDriver.find — a number or boolean comparand on a string-stored field, as the door hands it', () => {
  const STRING_TABLE = 'string_stored_conformance';
  let driver: InMemoryDriver;

  beforeAll(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    await driver.syncSchema(STRING_TABLE, { fields: FILTER_STRING_STORED_COMPARAND_FIELDS as never });
    for (const row of FILTER_STRING_STORED_COMPARAND_ROWS) await driver.create(STRING_TABLE, { ...row });
  });

  const ids = async (where: FilterCondition | undefined): Promise<string[]> => {
    const rows = await driver.find(STRING_TABLE, { fields: ['id'], where });
    return (rows as Array<Record<string, unknown>>)
      .map((r) => String(r.id))
      .sort((x, y) => x.localeCompare(y));
  };

  it('the fixture really is every row', async () => {
    expect(await ids(undefined)).toEqual(FILTER_STRING_STORED_COMPARAND_ROWS.map((r) => r.id));
  });

  for (const c of FILTER_STRING_STORED_COMPARAND_CASES) {
    it(c.name, async () => {
      expect(await ids(parseFilterAST(c.stored())), c.note).toEqual([...c.expected]);
    });
  }

  it('the strict cell still exists on the direct path — { code: 42 } handed to mingo matches no row', async () => {
    expect(await ids(parseFilterAST({ code: 42 }))).toEqual([]);
  });
});
