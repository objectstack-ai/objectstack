/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `element:repeater` declares the node-level `dataSource` binding, by
 * reference to the spec's `ElementDataSourceSchema` (objectui#11880, the
 * repeater half; ruling objectstack-ai/objectstack#11509, A-narrow, objectui
 * first), and mirrors the spec gate's `object` waiver beside it
 * (objectui#12056).
 *
 * ## The defect these pin
 *
 * Since objectui#11880 the repeater's renderer reads the binding first, with
 * its flat `properties` query keys as the fallback until the spec's v18 pin
 * bump retires them. The arm declared no `dataSource`, so the published
 * strict face (`StrictAnyComponentSchema`) refused the node the designer and
 * the spec both accept — `properties.object` plus a node-level `dataSource` —
 * with `unrecognized_keys [dataSource]`, naming a key the renderer honours.
 *
 * ## Every face that moves, and the one that does not
 *
 *   - strict: ACCEPTS a well-formed binding beside the bag (it refused the key
 *     outright before), and still refuses a bogus node key.
 *   - tolerant (`safeValidateSchema`, `.passthrough()` at the node): it
 *     accepted any `dataSource` value before, judging nothing; it now judges
 *     the binding as the spec's own node schema does, so a malformed binding is
 *     refused at `dataSource` on both faces.
 *   - the TypeScript authoring face (`PublicBlockNodeOf<'element:repeater'>`,
 *     derived from the arm's shape) types `dataSource` as the spec's binding.
 *   - objectui#12056 made `properties.object` required only where no binding
 *     named the object, mirroring the spec props gate's waiver.
 *   - objectui#12030: `@objectstack/spec` 18 retired the row's flat query keys
 *     (`object`, `filter`, `sort`, `limit`; objectstack#11509) as tombstones,
 *     so the waiver has nothing left to excuse. The bag is the row by
 *     reference and refuses each flat key by name; the query is written on the
 *     binding alone; and a node that binds no object is accepted, because the
 *     spec's gate only WARNS that it queries nothing.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ComponentPropsMap, ElementDataSourceSchema, PageComponentSchema } from '@objectstack/spec/ui';
import type { ElementRepeaterPropsSchema as SpecElementRepeaterPropsSchema } from '@objectstack/spec/ui';

import { ElementRepeaterBlockSchema, StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';
import { stripImportedDefaults } from '../zod/imported-defaults.js';
import type { PublicBlockNodeOf } from '../authoring-nodes.js';

const TYPE = 'element:repeater';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The spec's row, as the published map carries it. */
const ROW = (ComponentPropsMap as unknown as Record<string, z.ZodObject>)[TYPE];

type Result = { success: boolean; error?: { issues: z.core.$ZodIssue[] } };

const FACES: ReadonlyArray<readonly [string, (document: unknown) => Result]> = [
  ['tolerant', (document) => safeValidateSchema(document)],
  ['strict', (document) => StrictAnyComponentSchema.safeParse(document)],
];

const issuesAt = (result: Result, path: string): z.core.$ZodIssue[] =>
  result.success ? [] : result.error!.issues.filter((issue) => issue.path.join('.') === path);

const BAG = { titleField: 'name', fields: ['email'] } as const;
const BINDING = {
  object: 'contact',
  filter: [{ field: 'status', operator: 'equals', value: 'active' }],
  sort: [{ field: 'name', order: 'asc' }],
  limit: 5,
} as const;

describe('`element:repeater` takes the node-level `dataSource` (objectui#11880)', () => {
  it('the designer-shaped node — a bag plus a binding — is accepted on every face', () => {
    const document = { type: TYPE, properties: { ...BAG }, dataSource: { ...BINDING } };
    // Controls: the spec's node schema, its row and its binding schema each
    // accept their part, so the verdicts below are the arm's own.
    expect(PageComponentSchema.safeParse(document).success).toBe(true);
    expect(ROW.safeParse(document.properties).success).toBe(true);
    expect(ElementDataSourceSchema.safeParse(document.dataSource).success).toBe(true);
    for (const [face, parse] of FACES) {
      expect(parse(document).success, face).toBe(true);
    }
  });

  it('a flat query key in the bag is refused BY NAME on both faces, as the row refuses it (objectui#12030)', () => {
    for (const [key, value] of [
      ['object', 'contact'],
      ['filter', [{ field: 'status', operator: 'equals', value: 'active' }]],
      ['sort', [{ field: 'name', order: 'asc' }]],
      ['limit', 5],
    ] as const) {
      const properties = { ...BAG, [key]: value };
      // Control: the spec's own row refuses the same bag, at the same member.
      expect(issuesAt(ROW.safeParse(properties) as Result, key).map((i) => i.code), key).toEqual(['invalid_type']);
      for (const [face, parse] of FACES) {
        const result = parse({ type: TYPE, properties, dataSource: { object: 'contact' } });
        expect(result.success, `${face} ${key}`).toBe(false);
        expect(issuesAt(result, `properties.${key}`).map((i) => i.code), `${face} ${key}`).toEqual(['invalid_type']);
      }
    }
  });

  it('a node that binds no object is NOT refused — the spec warns about it, it does not refuse it (objectui#12030)', () => {
    for (const dataSource of [undefined, { object: '' }]) {
      const document = { type: TYPE, properties: { titleField: 'name' }, ...(dataSource === undefined ? {} : { dataSource }) };
      // Control: the spec's node schema and its row accept the same node.
      expect(PageComponentSchema.safeParse(document).success, JSON.stringify(dataSource)).toBe(true);
      expect(ROW.safeParse(document.properties).success).toBe(true);
      for (const [face, parse] of FACES) {
        expect(parse(document).success, `${face} ${JSON.stringify(dataSource)}`).toBe(true);
      }
    }
  });

  it('control: a bogus node key beside the binding is still refused by the strict face', () => {
    const result = StrictAnyComponentSchema.safeParse({
      type: TYPE,
      properties: { ...BAG },
      dataSource: { object: 'contact' },
      inventedKey11880: 1,
    });
    expect(result.success).toBe(false);
    const keys = result.success
      ? []
      : result.error.issues.flatMap((issue) => ((issue as { keys?: string[] }).keys ?? []));
    expect(keys).toContain('inventedKey11880');
    expect(keys).not.toContain('dataSource');
  });

  it.each([
    ['a string', 'contact'],
    ['a non-string object', { object: 42 }],
    ['a member the binding does not declare', { object: 'contact', objectName: 'contact' }],
    ['the retired record-form filter', { object: 'contact', filter: { status: 'active' } }],
  ] as const)('a malformed binding (%s) is refused at `dataSource`, as the spec node schema refuses it', (_name, dataSource) => {
    const document = { type: TYPE, properties: { ...BAG }, dataSource };
    // Control: the spec's node schema refuses the same node.
    expect(PageComponentSchema.safeParse(document).success).toBe(false);
    for (const [face, parse] of FACES) {
      const result = parse(document);
      expect(result.success, face).toBe(false);
      expect(
        result.success ? [] : result.error!.issues.map((issue) => String(issue.path[0])),
        face,
      ).toContain('dataSource');
    }
  });
});

/**
 * The differential: on every probe the strict face answers what the spec
 * answers — its node schema (`PageComponentSchema`, which judges `dataSource`)
 * together with the spec's row over the bag, judged only when a bag is
 * present. objectui#12056 modelled the props gate's `object` waiver here; the
 * row retired the flat `object` at `@objectstack/spec` 18 (objectui#12030), so
 * there is no waiver left to model.
 */
describe('the strict face answers as the spec node schema plus its row do (objectui#11880, objectui#12030)', () => {
  const specAccepts = (node: Readonly<Record<string, unknown>>): boolean => {
    if (!PageComponentSchema.safeParse(node).success) return false;
    const bag = node.properties;
    if (bag === undefined) return true;
    return ROW.safeParse(bag).success;
  };

  const PROBES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['flat bag only', { properties: { ...BAG } }],
    ['bag and binding', { properties: { ...BAG }, dataSource: { ...BINDING } }],
    ['bag and binding naming a saved view', { properties: { ...BAG }, dataSource: { object: 'contact', view: 'active' } }],
    ['bag, binding', { properties: { titleField: 'name' }, dataSource: { object: 'contact' } }],
    ['flat object in the bag, binding', { properties: { object: 'contact', titleField: 'name' }, dataSource: { object: 'contact' } }],
    ['empty bag, binding (the designer-written node)', { properties: {}, dataSource: { object: 'contact', limit: 10 } }],
    ['bag, no binding', { properties: { titleField: 'name' } }],
    ['bag, empty binding name', { properties: { titleField: 'name' }, dataSource: { object: '' } }],
    ['bag with a retired member, binding', { properties: { titleField: 'name', limit: 'ten' }, dataSource: { object: 'contact' } }],
    ['binding only, no bag', { dataSource: { object: 'contact' } }],
    ['bag and a binding with an alias member', { properties: { ...BAG }, dataSource: { object: 'contact', objectName: 'contact' } }],
    ['bag and a binding that is a string', { properties: { ...BAG }, dataSource: 'contact' }],
    ['bag and a bogus node key', { properties: { ...BAG }, inventedKey11880: true }],
  ];

  it.each(PROBES)('%s', (_name, fields) => {
    const node = { type: TYPE, ...fields };
    expect(StrictAnyComponentSchema.safeParse(node).success).toBe(specAccepts(node));
  });

  it('the probes include both verdicts (non-vacuity)', () => {
    const verdicts = PROBES.map(([, fields]) => specAccepts({ type: TYPE, ...fields }));
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });
});

describe('`dataSource` on the repeater arm IS the spec\'s binding (objectui#11880)', () => {
  it('declared by reference, through the import boundary', () => {
    const member = (ElementRepeaterBlockSchema.shape as unknown as Record<string, z.ZodType>).dataSource as unknown as
      | z.ZodOptional
      | undefined;
    expect(member, 'the arm declares no `dataSource`').toBeDefined();
    const spec = ElementDataSourceSchema as unknown as z.ZodObject;
    // The import boundary hands back the spec's own schema (the binding has no
    // default and no `z.lazy`)…
    expect(stripImportedDefaults(spec)).toBe(spec);
    // …and the arm holds it: its DEFINITION is the spec's. Not `toBe(spec)`:
    // the spec publishes the binding as a lazy proxy whose methods run on the
    // real schema, so `.optional()` wraps the object behind the proxy, and the
    // definition is the identity that survives (the rule
    // `held-public-block-arms-10872.test.ts` applies to the rows).
    const inner = member!.unwrap() as unknown as z.ZodObject;
    expect((inner as unknown as { _zod: { def: unknown } })._zod.def)
      .toBe((spec as unknown as { _zod: { def: unknown } })._zod.def);
    expect(Object.keys(inner.shape).sort()).toEqual(Object.keys(spec.shape).sort());
  });

  it('the TypeScript authoring face types the binding as the spec\'s, and refuses a member it does not declare', () => {
    // objectui#12093: the object is named by the binding alone. The bag's flat
    // `object` is retired upstream; the pin below holds it to the installed row.
    const bound: PublicBlockNodeOf<'element:repeater'> = {
      type: TYPE,
      properties: { fields: ['name'] },
      dataSource: { object: 'contact', view: 'active', limit: 5 },
    };
    const aliased: PublicBlockNodeOf<'element:repeater'> = {
      type: TYPE,
      properties: {},
      // @ts-expect-error `objectName` is not a member of the spec's ElementDataSourceSchema
      dataSource: { object: 'contact', objectName: 'contact' },
    };
    // objectui#12056 / objectui#12030: the bag names no `object` (the row
    // retired it), so the node the page designer writes is a typed literal that
    // compiles.
    const bindingOnly: PublicBlockNodeOf<'element:repeater'> = {
      type: TYPE,
      properties: { titleField: 'name' },
      dataSource: { object: 'contact', limit: 10 },
    };
    expect([bound, aliased, bindingOnly].map((node) => node.type)).toEqual([TYPE, TYPE, TYPE]);
  });

  it('the bag\'s flat `object` type-checks exactly where the installed row takes it (objectui#12093)', () => {
    // objectstack#11509 retires the flat `object` (objectstack PR #22421: a tombstone
    // on objectstack `main`), and the installed release still declares it. This file
    // is compiled against both: by the pull-request type-check against the installed
    // spec, and by the Spec Main Shape Gate against `main`. So the pin is the ROW's
    // verdict held on the face, not either answer written down: where the row
    // refuses the key, the typed node refuses it. A re-forked `object: string` on
    // the bag turns this red on `main`; a bag that dropped the key while the row
    // still takes it turns it red on the installed spec.
    type FaceTakesFlatObject =
      { type: typeof TYPE; properties: { object: string } } extends PublicBlockNodeOf<'element:repeater'> ? true : false;
    type RowTakesFlatObject = { object: string } extends Pick<z.input<typeof SpecElementRepeaterPropsSchema>, 'object'>
      ? true
      : false;
    const verdict: Equal<FaceTakesFlatObject, RowTakesFlatObject> = true;
    expect(verdict).toBe(true);
  });
});

describe('the repeater bag is its row, by reference (objectui#12056, objectui#12030)', () => {
  /** The arm's `properties` member with its `.optional()` peeled off. */
  const bag = (): z.ZodObject =>
    ((ElementRepeaterBlockSchema.shape as unknown as Record<string, z.ZodType>).properties as unknown as z.ZodOptional)
      .unwrap() as unknown as z.ZodObject;

  it('the bag declares exactly the row\'s members, and is closed as the row is', () => {
    expect(Object.keys(bag().shape).sort()).toEqual(Object.keys(ROW.shape).sort());
    expect((bag() as unknown as { _zod: { def: { catchall?: { _zod: { def: { type: string } } } } } })._zod.def.catchall?._zod.def.type)
      .toBe('never');
  });

  it('every member IS the row\'s own member object — the retired flat query keys included', () => {
    const rowShape = ROW.shape as Record<string, z.ZodType>;
    const bagShape = bag().shape as Record<string, z.ZodType>;
    for (const key of Object.keys(rowShape)) {
      expect(bagShape[key], key).toBe(rowShape[key]);
    }
    // Control: the row no longer requires `object` — it refuses it — which is
    // why no waiver is left to mirror.
    expect(ROW.safeParse({ titleField: 'name' }).success).toBe(true);
    expect(ROW.safeParse({ titleField: 'name', object: 'contact' }).success).toBe(false);
  });
});
