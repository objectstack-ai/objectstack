/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:line_items` has a zod arm (objectui#10872): the last ADR-0080 public
 * block held, armed once `@objectstack/spec` 17.6.0 carried its
 * `ComponentPropsMap` row.
 *
 * ## The defect these pin
 *
 * `record:line_items` is registered (`@object-ui/plugin-form`), curated in
 * `PUBLIC_BLOCKS` and, since 17.6.0, declared by the spec. `AnyComponentSchema`
 * had no arm for it, so `safeValidateSchema` (then what `objectui validate` ran)
 * and the strict authoring face refused every document naming it with one
 * `invalid_union` at `type`, whatever the rest of the node said.
 *
 * ## What is pinned here, and what elsewhere
 *
 * The batch-1 rows read the arm as they read every public block:
 * `./public-block-arms-10872.test.ts` (the bag is the row, by reference; the
 * minimal and spec-valid documents pass both faces), and
 * `./flat-props-refusal-10872.test.ts` (each row member written flat is
 * refused by name). This file carries what this block adds: the row's own
 * requiredness through the arm, the node's `dataSource` binding, and the two
 * content-channel refusals. Every verdict is held to the INSTALLED spec's own
 * answer, read at run time.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ComponentPropsMap,
  ElementDataSourceSchema,
  PageComponentSchema,
  type RecordDetailsProps,
  type RecordLineItemsProps,
} from '@objectstack/spec/ui';

import {
  PublicBlockComponentSchema,
  RecordLineItemsBlockSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';
import type { RecordLineItemsBlockSchemaType } from '../zod/public-blocks.zod.js';
import { stripImportedDefaults } from '../zod/imported-defaults.js';

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[] };
type Result = { success: boolean; error?: { issues: z.core.$ZodIssue[] } };

const TYPE = 'record:line_items';

const FACES: ReadonlyArray<readonly [string, (document: unknown) => Result]> = [
  ['tolerant', (document) => safeValidateSchema(document)],
  ['strict', (document) => StrictAnyComponentSchema.safeParse(document)],
];

/** The spec's row for this block, as the published map carries it. */
const ROW = (ComponentPropsMap as unknown as Record<string, z.ZodType>)[TYPE];

/** The smallest bag the row accepts: its two required members. */
const MINIMAL_BAG = { relationshipField: 'order', columns: [{ name: 'qty' }] } as const;

const issuesOf = (result: Result): Issue[] => (result.success ? [] : (result.error!.issues as unknown as Issue[]));
const pathsOf = (result: Result): string[] => issuesOf(result).map((issue) => issue.path.join('.'));
const refusedAtType = (result: Result): boolean =>
  issuesOf(result).some((issue) => issue.code === 'invalid_union' && issue.path.join('.') === 'type');

describe('`record:line_items` validates by its spec row (objectui#10872)', () => {
  it('the row exists in the installed spec — the arm has something to read', () => {
    expect(ROW, 'ComponentPropsMap carries no record:line_items row').toBeDefined();
    expect(ROW.safeParse(MINIMAL_BAG).success).toBe(true);
  });

  it.each(FACES)('%s face: `type` is claimed — a bare node and the minimal bag both parse', (_face, judge) => {
    for (const document of [{ type: TYPE }, { type: TYPE, properties: { ...MINIMAL_BAG } }]) {
      const result = judge(document);
      expect(refusedAtType(result), JSON.stringify(document)).toBe(false);
      expect(result.success, JSON.stringify(document)).toBe(true);
    }
  });

  it.each(FACES)('%s face: the row\'s two required members are required in the bag, at their own path', (_face, judge) => {
    for (const missing of ['relationshipField', 'columns'] as const) {
      const bag: Record<string, unknown> = { ...MINIMAL_BAG };
      delete bag[missing];
      // The spec's own row refuses the same bag — the requiredness is the row's.
      expect(ROW.safeParse(bag).success, `row without ${missing}`).toBe(false);
      const result = judge({ type: TYPE, properties: bag });
      expect(result.success, missing).toBe(false);
      expect(pathsOf(result), missing).toContain(`properties.${missing}`);
    }
  });

  it.each(FACES)('%s face: `childObject` is optional, as the row declares it', (_face, judge) => {
    expect(ROW.safeParse(MINIMAL_BAG).success).toBe(true);
    expect(judge({ type: TYPE, properties: { ...MINIMAL_BAG } }).success).toBe(true);
    // Control: a wrong-typed `childObject` is the row's to refuse, at the member.
    const result = judge({ type: TYPE, properties: { ...MINIMAL_BAG, childObject: 7 } });
    expect(result.success).toBe(false);
    expect(pathsOf(result)).toContain('properties.childObject');
  });

  it.each(FACES)('%s face: a member the row does not declare is refused inside the bag, by name', (_face, judge) => {
    const result = judge({ type: TYPE, properties: { ...MINIMAL_BAG, inventedKey10872: true } });
    expect(result.success).toBe(false);
    const issue = issuesOf(result).find((i) => i.code === 'unrecognized_keys');
    expect(issue?.path.join('.')).toBe('properties');
    expect(issue?.keys).toEqual(['inventedKey10872']);
    expect(ROW.safeParse({ ...MINIMAL_BAG, inventedKey10872: true }).success).toBe(false);
  });

  it.each(FACES)('%s face: a row member written flat is refused by name, toward its bag member', (_face, judge) => {
    const result = judge({ type: TYPE, ...MINIMAL_BAG });
    expect(result.success).toBe(false);
    for (const key of ['relationshipField', 'columns']) {
      const issue = issuesOf(result).find((i) => i.path.join('.') === key);
      expect(issue?.code, key).toBe('invalid_type');
      expect(issue?.message, key).toContain(`properties.${key}`);
    }
  });
});

describe('`record:line_items` declares the node\'s `dataSource` binding, by reference (objectui#10872)', () => {
  /** A bound node with no `childObject` — the case the row makes `childObject` optional for. */
  const BOUND = { type: TYPE, dataSource: { object: 'order_line' }, properties: { ...MINIMAL_BAG } };

  it('the spec\'s own page component accepts the bound node (lit control)', () => {
    expect(PageComponentSchema.safeParse(BOUND).success).toBe(true);
  });

  it.each(FACES)('%s face: the bound node with no `childObject` parses', (_face, judge) => {
    expect(judge(BOUND).success).toBe(true);
  });

  it('the member is the spec\'s `ElementDataSourceSchema`, through the import boundary', () => {
    const member = (RecordLineItemsBlockSchema.shape.dataSource as unknown as z.ZodOptional).unwrap();
    const spec = ElementDataSourceSchema as unknown as z.ZodType;
    // The boundary has nothing to strip in this schema, so it hands back the
    // spec's own object; the spec publishes it as a lazy proxy, so the member
    // is compared by DEFINITION — the object behind the proxy, not a copy.
    expect(stripImportedDefaults(spec)).toBe(spec);
    expect((member as unknown as { _zod: { def: unknown } })._zod.def)
      .toBe((spec as unknown as { _zod: { def: unknown } })._zod.def);
  });

  it.each(FACES)('%s face: a binding the spec refuses is refused at `dataSource`', (_face, judge) => {
    for (const dataSource of ['order_line', { object: 'order_line', objectName: 'order_line' }, { object: 'o', limit: 0 }]) {
      const document = { ...BOUND, dataSource };
      // The spec refuses the same binding — the verdict is the spec's, not this face's.
      expect(PageComponentSchema.safeParse(document).success, JSON.stringify(dataSource)).toBe(false);
      const result = judge(document);
      expect(result.success, JSON.stringify(dataSource)).toBe(false);
      expect(pathsOf(result).some((path) => path === 'dataSource' || path.startsWith('dataSource.')), JSON.stringify(dataSource))
        .toBe(true);
    }
  });
});

describe('`record:line_items` refuses both content channels, by name (objectui#10872, the objectui#9256 method)', () => {
  const CONTENT = [{ type: 'element:text', properties: { content: 'measured' } }];

  it.each(['children', 'body'] as const)('`%s`: refused at its own path on both faces, naming what the block renders', (key) => {
    for (const [face, judge] of FACES) {
      const result = judge({ type: TYPE, properties: { ...MINIMAL_BAG }, [key]: CONTENT });
      expect(result.success, face).toBe(false);
      const issue = issuesOf(result).find((i) => i.path.join('.') === key);
      expect(issue?.code, face).toBe('invalid_type');
      expect(issue?.message, face).toContain('`record:line_items` reads NEITHER content channel');
      expect(issue?.message, face).toContain('LineItemsPanel');
    }
  });

  it('both members carry ONE string, and it is their `.describe()` text', () => {
    const shape = RecordLineItemsBlockSchema.shape as unknown as Record<string, { description?: string }>;
    expect(shape.children.description).toBeTruthy();
    expect(shape.body.description).toBe(shape.children.description);
  });

  it('the spec\'s own page component refuses a node-level `children` on this block (lit control)', () => {
    const spec = PageComponentSchema.safeParse({ type: TYPE, properties: { ...MINIMAL_BAG }, children: CONTENT });
    expect(spec.success).toBe(false);
    expect(issuesOf(spec as Result).flatMap((issue) => issue.keys ?? [])).toContain('children');
  });
});

/*
 * The arm's TYPE is named (`RecordLineItemsBlockSchemaType`) so declaration
 * emit prints it by reference; inlined, it tipped `AnyComponentSchema` past
 * TypeScript's serialization ceiling (TS7056) against `@objectstack/spec` built
 * from objectstack `main`. These compile-time rows pin that the naming changed
 * no type a consumer reads: the arm's input and output are the spec row's and
 * the spec binding's, read by reference. `tsc -p tsconfig.test.json` (the
 * package's `type-check`) is what evaluates them.
 */
type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type ArmIn = z.input<typeof RecordLineItemsBlockSchema>;
type ArmOut = z.output<typeof RecordLineItemsBlockSchema>;

type _TypeLiteral = Assert<Equal<ArmIn['type'], 'record:line_items'>>;
type _BagInputIsTheRow = Assert<Equal<ArmIn['properties'], z.input<typeof RecordLineItemsProps> | undefined>>;
type _BagOutputIsTheRow = Assert<Equal<ArmOut['properties'], z.output<typeof RecordLineItemsProps> | undefined>>;
type _BindingInputIsTheSpecs = Assert<Equal<ArmIn['dataSource'], z.input<typeof ElementDataSourceSchema> | undefined>>;
type _BindingOutputIsTheSpecs = Assert<Equal<ArmOut['dataSource'], z.output<typeof ElementDataSourceSchema> | undefined>>;
// The union carries the named type, so the derived node types read it.
type _UnionMemberIsTheNamedType = Assert<
  Equal<Extract<(typeof PublicBlockComponentSchema)['options'][number], RecordLineItemsBlockSchemaType>, RecordLineItemsBlockSchemaType>
>;
// Lit control: the equality distinguishes two rows, so the rows above can fail.
type _ControlAnotherRowIsNotEqual = Assert<
  Equal<ArmIn['properties'], z.input<typeof RecordDetailsProps> | undefined> extends true ? false : true
>;

describe('`record:line_items` — the named arm type is the arm (objectui#10872)', () => {
  it('the export is the very object the union carries', () => {
    const options = (PublicBlockComponentSchema as unknown as { options: unknown[] }).options;
    expect(options).toContain(RecordLineItemsBlockSchema);
  });
});
