// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The engine's own sort door and the Data API's sort door answer one question
 * — is this field's TYPE computed on read, with no column to order by — from
 * one source, `isVirtualSearchField` (`@objectstack/spec/data`).
 *
 * - The engine door, `assertOrderByIsMaterializable`, guards a caller that
 *   reaches `ObjectQL.find` / `findOne` directly (a hook, a flow).
 * - The Data API door, `assertSortFieldsExist`'s third verdict
 *   (`@objectstack/metadata-protocol`), guards everything reaching `findData`.
 *
 * The engine door used to test a `'formula'` literal of its own while the
 * Data API door read the spec's set. Both held `formula` alone, so they agreed
 * only while the spec's set did not grow. The day it grows without the engine,
 * the Data API refuses the new type and an in-process `find` sends the ORDER BY
 * to a driver with no column for it, which drops the sort and answers success.
 *
 * So this file copies no verdict table. For EVERY member of the spec's
 * `FieldType` it asks both doors and holds them to each other. It tells the
 * Data API door's third verdict from its fourth (an author's
 * `sortable: false`, read through the projection) without reading a sentence:
 * the sort names the field under test AND a companion that declares
 * `sortable: false`, and the third verdict names the computed field alone,
 * where the fourth names the companion. The engine door does not judge
 * `sortable: false` at all, so the companion never moves its answer.
 */

import { describe, it, expect, vi } from 'vitest';
// `findData` reaches `@objectstack/lint` only through a dynamic import; paid
// here at module scope so the first load lands during collection, not inside
// the first case's timeout.
import '@objectstack/lint';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { FieldType } from '@objectstack/spec/data';
import { assertOrderByIsMaterializable } from './engine-top-level.js';

const OBJECT = 'engine_sort_agreement';

/** Every field type the spec knows, as the enum lists them. */
const FIELD_TYPES: readonly string[] = FieldType.options;

const fieldOf = (type: string) => `f_${type}`;

/** A stored column whose author declared it unsortable: the Data API door's fourth verdict, by construction. */
const COMPANION = 'declared_unsortable';

const DEFINITION = {
  name: OBJECT,
  fields: {
    ...Object.fromEntries(FIELD_TYPES.map((type) => [fieldOf(type), { name: fieldOf(type), type }])),
    [COMPANION]: { name: COMPANION, type: 'text', sortable: false },
  },
};

const orderByOf = (type: string) => [
  { field: fieldOf(type), order: 'asc' as const },
  { field: COMPANION, order: 'asc' as const },
];

type Refusal = { code?: unknown; status?: unknown; field?: unknown; fields?: unknown };
const envelopeOf = (err: unknown) => {
  const r = err as Refusal;
  return { code: r.code, status: r.status, field: r.field, fields: r.fields };
};

/** The engine door's answer: the refusal it threw, or null when it lets the sort through. */
function engineDoor(type: string) {
  try {
    assertOrderByIsMaterializable(OBJECT, 'find', DEFINITION, orderByOf(type));
  } catch (err) {
    return envelopeOf(err);
  }
  return null;
}

/** The Data API door's answer to the same sort, over the same definition. */
async function dataApiDoor(type: string) {
  const find = vi.fn(async () => []);
  const engine = { registry: { getObject: (name: string) => (name === OBJECT ? DEFINITION : undefined) }, find };
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  try {
    await protocol.findData({ object: OBJECT, query: { orderBy: orderByOf(type) } });
  } catch (err) {
    return envelopeOf(err);
  }
  return null;
}

/** The computed-type verdict, as an envelope: what both doors answer for a computed field. */
const computedVerdict = (type: string) => ({
  code: 'INVALID_SORT', status: 400, field: fieldOf(type), fields: [fieldOf(type)],
});

const engineCallsComputed = (type: string) => engineDoor(type) !== null;

describe('the engine sort door and the Data API sort door agree on which field types are computed', () => {
  it('the table is not empty on either side: the engine door refuses some types and lets others through', () => {
    // Without both, every row below would agree about nothing.
    expect(FIELD_TYPES.filter(engineCallsComputed), 'field types the engine door refuses').not.toEqual([]);
    expect(FIELD_TYPES.filter((type) => !engineCallsComputed(type)), 'field types the engine door lets through')
      .not.toEqual([]);
  });

  it.each(FIELD_TYPES)('a `%s` field: the engine door refuses it exactly when the Data API door calls it computed', async (type) => {
    const engine = engineDoor(type);
    const dataApi = await dataApiDoor(type);
    // The Data API door always refuses this sort (the companion is unsortable);
    // the verdict that fires says which side of the question the type is on.
    const dataApiCallsComputed = JSON.stringify(dataApi?.fields) === JSON.stringify([fieldOf(type)]);
    expect({ type, engineCallsComputed: engine !== null }).toEqual({ type, engineCallsComputed: dataApiCallsComputed });
    if (dataApiCallsComputed) {
      // One wire envelope on both doors for the one condition.
      expect(engine).toEqual(computedVerdict(type));
      expect(dataApi).toEqual(computedVerdict(type));
    } else {
      // CONTROL: the Data API refused for the companion, by its fourth verdict.
      expect(dataApi).toEqual({ code: 'INVALID_SORT', status: 400, field: COMPANION, fields: [COMPANION] });
    }
  });
});
