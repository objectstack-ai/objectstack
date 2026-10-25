/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `element:number` has a zod arm: its row by reference, and the node's
 * `dataSource` binding (objectui#10872 batch 2, objectui#12030).
 *
 * ## The defect these pin
 *
 * `element:number` is registered, curated by ADR-0080 and declared by the spec
 * (`ComponentPropsMap['element:number']`), and `AnyComponentSchema` carried no
 * arm for it — so `safeValidateSchema`, and `objectui validate` with it,
 * refused every `element:number` document with `invalid_union` at `type`,
 * whichever form it bound its object in.
 *
 * ## The query lives on the binding since `@objectstack/spec` 18
 *
 * Through 17.x the row REQUIRED a flat `object`, the spec's props gate waived
 * it beside `dataSource.object`, and this arm mirrored that waiver with a bag
 * that made `object` optional and a node refinement that put the requiredness
 * back. `@objectstack/spec` 18 retired the row's flat `object` and `filter` as
 * tombstones (objectstack#11509): the metric's object and filter are written on
 * the node-level `dataSource` binding only, the renderer reads nothing else
 * (objectui#11880), and the spec's gate no longer refuses a node that names no
 * object — it WARNS that such a node queries nothing. So the arm is the row by
 * reference, like every other public block, and every row below measures it
 * against the INSTALLED spec rather than a transcription.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ComponentPropsMap, ElementDataSourceSchema, PageComponentSchema } from '@objectstack/spec/ui';

import {
  ElementNumberBlockSchema,
  PublicBlockComponentSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';
import * as zodBarrel from '../zod/index.zod.js';
import { stripImportedDefaults } from '../zod/imported-defaults.js';

const TYPE = 'element:number';

/** The spec's row, as the published map carries it. */
const ROW = (ComponentPropsMap as unknown as Record<string, z.ZodObject>)[TYPE];

type Result = { success: boolean; error?: { issues: z.core.$ZodIssue[] } };

/** The two faces a document is judged on: the tolerant one, and the strict twin `objectui validate` runs. */
const FACES: ReadonlyArray<readonly [string, (document: unknown) => Result]> = [
  ['tolerant', (document) => safeValidateSchema(document)],
  ['strict', (document) => StrictAnyComponentSchema.safeParse(document)],
];

const pathsOf = (result: Result): string[] =>
  result.success ? [] : result.error!.issues.map((issue) => issue.path.join('.'));

const issuesAt = (result: Result, path: string): z.core.$ZodIssue[] =>
  result.success ? [] : result.error!.issues.filter((issue) => issue.path.join('.') === path);

/** The arm's `properties` member with its `.optional()` peeled off. */
const bag = (): z.ZodObject =>
  (ElementNumberBlockSchema.shape.properties as unknown as z.ZodOptional).unwrap() as unknown as z.ZodObject;

/** A bag the row accepts: everything but the query. */
const BAG = { aggregate: 'sum', field: 'total' } as const;

describe('`element:number` validates, with its query on the binding (objectui#10872 batch 2, objectui#12030)', () => {
  it('a `dataSource.object` document is accepted on both faces', () => {
    // Fixture control: the bag is valid by the spec's own row.
    expect(ROW.safeParse(BAG).success).toBe(true);
    const document = { type: TYPE, dataSource: { object: 'order' }, properties: { ...BAG } };
    expect(PageComponentSchema.safeParse(document).success).toBe(true);
    for (const [face, parse] of FACES) {
      expect(parse(document).success, face).toBe(true);
    }
  });

  it('a flat `properties.object` or `properties.filter` is refused BY NAME on both faces, as the row refuses it', () => {
    for (const [key, value] of [
      ['object', 'order'],
      ['filter', [{ field: 'status', operator: 'equals', value: 'won' }]],
    ] as const) {
      const properties = { ...BAG, [key]: value };
      // Control: the spec's own row refuses the same bag at the same member.
      expect(pathsOf(ROW.safeParse(properties) as Result), key).toEqual([key]);
      for (const [face, parse] of FACES) {
        const result = parse({ type: TYPE, dataSource: { object: 'order' }, properties });
        expect(result.success, `${face} ${key}`).toBe(false);
        expect(issuesAt(result, `properties.${key}`).map((issue) => issue.code), `${face} ${key}`)
          .toEqual(['invalid_type']);
      }
    }
  });

  it('a node that binds no object is NOT refused — the spec warns about it, it does not refuse it', () => {
    // The spec's gate reports a `dataSource.object`-less `element:number` as a
    // WARNING (it queries nothing), never as a parse refusal, and its node
    // schema accepts the node. This face follows the parse, not the lint.
    for (const document of [
      { type: TYPE, properties: { ...BAG } },
      { type: TYPE, dataSource: { object: '' }, properties: { ...BAG } },
      { type: TYPE },
    ]) {
      expect(PageComponentSchema.safeParse(document).success, JSON.stringify(document)).toBe(true);
      for (const [face, parse] of FACES) {
        expect(parse(document).success, `${face} ${JSON.stringify(document)}`).toBe(true);
      }
    }
  });

  it('a spec-invalid bag member is refused at the member, by reference', () => {
    const properties = { aggregate: 'count', format: 'roman' };
    // Control: the spec's own row refuses the same bag, at the same member.
    expect(pathsOf(ROW.safeParse(properties) as Result)).toContain('format');
    for (const [face, parse] of FACES) {
      const result = parse({ type: TYPE, properties });
      expect(result.success, face).toBe(false);
      expect(pathsOf(result), face).toContain('properties.format');
    }
  });

  it('an undeclared member inside the bag is refused by name — the row\'s strictness travels', () => {
    const result = safeValidateSchema({ type: TYPE, properties: { aggregate: 'count', inventedKey10872: 1 } });
    const [issue] = issuesAt(result, 'properties');
    expect(issue?.code).toBe('unrecognized_keys');
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual(['inventedKey10872']);
  });

  it('documents in the binding form validate, and so does the spec', () => {
    for (const document of [
      { type: TYPE, dataSource: { object: 'order' }, properties: { aggregate: 'count' } },
      { type: TYPE, dataSource: { object: 'order', limit: 100 }, properties: { aggregate: 'sum', field: 'total' } },
      {
        type: TYPE,
        dataSource: { object: 'task', filter: [{ field: 'status', operator: 'equals', value: 'won' }] },
        properties: { aggregate: 'count' },
      },
    ]) {
      // Control: the spec's node schema accepts each one, and its row the bag.
      expect(PageComponentSchema.safeParse(document).success, JSON.stringify(document)).toBe(true);
      expect(ROW.safeParse(document.properties).success, JSON.stringify(document)).toBe(true);
      for (const [face, parse] of FACES) {
        expect(parse(document).success, `${face} ${JSON.stringify(document)}`).toBe(true);
      }
    }
  });

  it('the arm is a named export of the barrel and a member of the public-block union', () => {
    expect(Object.values(zodBarrel as unknown as Record<string, unknown>)).toContain(ElementNumberBlockSchema);
    const options = (PublicBlockComponentSchema as unknown as { options: z.ZodObject[] }).options;
    expect(options).toContain(ElementNumberBlockSchema);
  });
});

/**
 * The differential: on every probe, the arm answers exactly what the spec's
 * node schema (`PageComponentSchema`, which judges `dataSource`) answers,
 * together with the spec's row over the bag (`specAccepts` below). Each probe
 * is its own row, so a regression names the document it broke.
 */
describe('`element:number` answers as the spec node schema plus its row do (objectui#10872 batch 2, objectui#12030)', () => {
  /** The spec's verdict: the node schema, and the row over a bag when there is one. */
  function specAccepts(node: Readonly<Record<string, unknown>>): boolean {
    if (!PageComponentSchema.safeParse(node).success) return false;
    const props = node.properties;
    if (props === undefined) return true;
    return ROW.safeParse(props).success;
  }

  const PROBES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['bare node', {}],
    ['bag, no binding', { properties: { ...BAG } }],
    ['bag, dataSource.object', { properties: { ...BAG }, dataSource: { object: 'order' } }],
    ['bag, empty dataSource.object', { properties: { ...BAG }, dataSource: { object: '' } }],
    ['bag, numeric dataSource.object', { properties: { ...BAG }, dataSource: { object: 42 } }],
    ['bag, dataSource a string', { properties: { ...BAG }, dataSource: 'order' }],
    ['bag, dataSource with an alias key', { properties: { ...BAG }, dataSource: { object: 'order', objectName: 'order' } }],
    ['flat object in the bag, dataSource.object', { properties: { object: 'order', aggregate: 'count' }, dataSource: { object: 'order' } }],
    ['flat object in the bag, no binding', { properties: { object: 'order', aggregate: 'count' } }],
    ['dataSource only, no bag', { dataSource: { object: 'order' } }],
    ['empty bag, dataSource.object', { properties: {}, dataSource: { object: 'order' } }],
    ['bag with a bad member, dataSource.object', { properties: { ...BAG, format: 'roman' }, dataSource: { object: 'order' } }],
    ['bag not a record', { properties: 'order' }],
  ];

  it.each(PROBES)('%s', (_name, fields) => {
    const node = { type: TYPE, ...fields };
    const spec = specAccepts(node);
    for (const [face, parse] of FACES) {
      expect(parse(node).success, face).toBe(spec);
    }
  });

  it('the probes include both verdicts (non-vacuity)', () => {
    const verdicts = PROBES.map(([, fields]) => specAccepts({ type: TYPE, ...fields }));
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });
});

describe('`element:number` reads the spec by reference (objectui#10872 batch 2, objectui#12030)', () => {
  it('the bag declares exactly the row\'s members, and is closed as the row is', () => {
    expect(Object.keys(bag().shape).sort()).toEqual(Object.keys(ROW.shape).sort());
    expect((bag() as unknown as { _zod: { def: { catchall?: { _zod: { def: { type: string } } } } } })._zod.def.catchall?._zod.def.type)
      .toBe('never');
  });

  it('every member IS the row\'s own member object — the retired `object` and `filter` included', () => {
    const rowShape = ROW.shape as Record<string, z.ZodType>;
    const bagShape = bag().shape as Record<string, z.ZodType>;
    for (const key of Object.keys(rowShape)) {
      expect(bagShape[key], key).toBe(rowShape[key]);
    }
    // Control: the row's own `object` refuses every value now, which is why no
    // waiver is left to mirror.
    for (const value of ['order', '', 1]) {
      expect(ROW.safeParse({ aggregate: 'count', object: value }).success, JSON.stringify(value)).toBe(false);
    }
    expect(ROW.safeParse({ aggregate: 'count' }).success).toBe(true);
  });

  it('`dataSource` is the spec\'s element binding, through the import boundary', () => {
    const member = (ElementNumberBlockSchema.shape.dataSource as unknown as z.ZodOptional).unwrap() as unknown as z.ZodObject;
    const spec = ElementDataSourceSchema as unknown as z.ZodObject;
    expect(Object.keys(member.shape).sort()).toEqual(Object.keys(spec.shape).sort());
    // Through `@objectstack/spec` 17.4.0 the boundary's `lazy` arm rebuilt this
    // one clean schema (the recursive filter clause sat under `filter`). 17.5.0
    // converged `filter` on the `ViewFilterRule` array, which reaches no
    // `z.lazy`, so the schema is clean and the boundary hands back the spec's
    // own object (objectui#11073; `REBUILT_CLEAN` in
    // `imported-defaults-8317.test.ts` is empty for the same reason).
    expect(stripImportedDefaults(spec)).toBe(spec);
    for (const probe of [{ object: 'order' }, { object: '' }, { object: 1 }, {}, { object: 'o', limit: 0 }, { object: 'o', objectName: 'o' }]) {
      expect(member.safeParse(probe).success, JSON.stringify(probe)).toBe(spec.safeParse(probe).success);
    }
  });

  /**
   * The binding's `filter` is the metric's filter. Each probe goes through
   * `dataSource.filter`, and each verdict is held to the spec's own schema — on
   * the member, and on the node through both faces. 17.5.0 converged `filter`
   * on the `ViewFilterRule` array `[{ field, operator, value }]`, and the
   * MongoDB-style record form, `$and` / `$or` included, is refused
   * (objectui#11073).
   */
  it.each([
    ['ViewFilterRule array filter', { object: 'o', filter: [{ field: 'status', operator: 'equals', value: 'won' }] }, true],
    ['record filter', { object: 'o', filter: { status: 'won' } }, false],
    ['nested $and / $or filter', { object: 'o', filter: { $and: [{ status: 'won' }, { $or: [{ amount: { $gt: 100 } }, { stage: { $in: ['a', 'b'] } }] }] } }, false],
    ['non-object filter', { object: 'o', filter: 5 }, false],
    ['non-object clause inside $and', { object: 'o', filter: { $and: [5] } }, false],
  ] as const)('`dataSource.filter` through the binding answers as the spec does: %s', (_name, probe, expected) => {
    const member = (ElementNumberBlockSchema.shape.dataSource as unknown as z.ZodOptional).unwrap() as unknown as z.ZodObject;
    const spec = ElementDataSourceSchema as unknown as z.ZodObject;
    // Non-vacuity: the spec's own verdict is the one this row names.
    expect(spec.safeParse(probe).success).toBe(expected);
    expect(member.safeParse(probe).success).toBe(expected);
    const node = { type: TYPE, properties: { aggregate: 'count' }, dataSource: probe };
    expect(PageComponentSchema.safeParse(node).success).toBe(expected);
    for (const [face, parse] of FACES) {
      expect(parse(node).success, face).toBe(expected);
    }
  });
});
