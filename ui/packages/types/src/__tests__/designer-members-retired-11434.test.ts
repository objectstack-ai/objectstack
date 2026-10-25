/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The designer members objectui#11434 retired stay retired, on both faces.
 *
 * ## The ruling these pin
 *
 * objectui#11434 settled every declared-and-unread member of the six
 * `@object-ui/plugin-designer` node declarations (`../designer.ts`) by the
 * maintainer's criterion: "does the mainstream have it? Yes ⇒ give it a reader.
 * No ⇒ retire it on both faces." Each member here was measured unread (a
 * non-test grep and a runtime probe through the real `SchemaRenderer` and
 * registry, unset against a distinctive value) and produced by nothing outside
 * test fixtures, and the seat ruled it RETIRE:
 *
 *   - `DataModelDesignerSchema.autoLayout` — auto-layout is an action; the
 *     toolbar already runs it on demand;
 *   - `ReportDesignerSchema.previewMode` — preview is a tool mode, not state a
 *     report document carries;
 *   - `DesignerComponent.parentId` — a second spelling of the tree `children`
 *     already carries;
 *   - `DataModelRelationship.onUpdate` — the platform's relationship contract
 *     has no update behaviour;
 *   - `BPMNNode.serviceEndpoint` — a service task references an
 *     implementation, not a URL;
 *   - `ObjectDefinition.relationships` — a relationship is a field;
 *     `@objectstack/spec`'s `ObjectSchema` refuses the array as an
 *     unrecognized key. Its element type `ObjectDefinitionRelationship` left
 *     the package with it;
 *   - `DesignerFieldDefinition.validationRules` — a spelling the spec's
 *     `FieldSchema` refuses as an unrecognized key. Its element type
 *     `DesignerValidationRule` left the package with it.
 *
 * Each is a `?: never` tombstone on the TypeScript face and a
 * `retirementTombstone` on the zod face, whose refusal names the key, the card
 * and what to write instead. (`DataModelRelationship.onDelete` is a tombstone
 * of the same shape, but a RESPELLING, not a retirement — its key has a live
 * successor, `deleteBehavior` — so it is pinned on its own, in
 * `designer-ondelete-respelled-11434.test.ts`.)
 *
 * ## Two instruments, and which half each one reads
 *
 * The `Expect` / `Equal` aliases and the `@ts-expect-error` directives are
 * TYPE-level: `tsc -p tsconfig.test.json` (the third leg of this package's
 * `type-check` script) reads them, and a revived member fails there — on an
 * unused directive or on a `false` row. vitest strips types and reads none of
 * it. The `safeValidateSchema` / `StrictAnyComponentSchema` rows are RUNTIME and
 * vitest reads them. A green run of either one alone says nothing about the
 * other.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import * as zodFace from '../zod/index.zod.js';
import {
  BPMNNodeSchema,
  DataModelDesignerSchema,
  DataModelRelationshipSchema,
  DesignerFieldDefinitionSchema,
  ObjectDefinitionSchema,
  ReportDesignerSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';
import type {
  BPMNNode,
  DataModelDesignerSchema as Ts_DataModelDesignerSchema,
  DataModelRelationship,
  DesignerComponent,
  DesignerFieldDefinition,
  ObjectDefinition,
  ReportDesignerSchema as Ts_ReportDesignerSchema,
} from '../designer';

/* ── Type-level pins: the `tsc` channel ────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type ShapeOf<M> = M extends { shape: infer S } ? S : never;
type InputOf<T> = T extends z.ZodType ? z.input<T> : never;

/**
 * Each retired member READS as `undefined` on the TypeScript face — `?: never`
 * without `exactOptionalPropertyTypes` is `never | undefined`, which collapses.
 * `Equal` separates that from the `boolean` / `string` / array types the
 * members carried, and, on the two `BaseSchema`-derived nodes, from the `any`
 * a DELETION left behind the index signature until objectui#8347 (a deletion
 * fails to compile at the indexed access now).
 */
export type assertionRetiredMembersReadAsTombstones = [
  Expect<Equal<Ts_DataModelDesignerSchema['autoLayout'], undefined>>,
  Expect<Equal<Ts_ReportDesignerSchema['previewMode'], undefined>>,
  Expect<Equal<DesignerComponent['parentId'], undefined>>,
  Expect<Equal<DataModelRelationship['onUpdate'], undefined>>,
  Expect<Equal<BPMNNode['serviceEndpoint'], undefined>>,
  Expect<Equal<ObjectDefinition['relationships'], undefined>>,
  Expect<Equal<DesignerFieldDefinition['validationRules'], undefined>>,
];

/**
 * The zod face agrees: each member accepts nothing but absence. (The recursive
 * `DesignerComponentSchema` has no `.shape`; `designer-zod-arms-10859.test.ts`
 * compares it to the declaration as a whole type, so its tombstone is held by
 * the TypeScript row above through that annotation.)
 */
export type assertionZodFaceAcceptsOnlyAbsence = [
  Expect<Equal<InputOf<ShapeOf<typeof DataModelDesignerSchema>['autoLayout']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof ReportDesignerSchema>['previewMode']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof DataModelRelationshipSchema>['onUpdate']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof BPMNNodeSchema>['serviceEndpoint']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof ObjectDefinitionSchema>['relationships']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof DesignerFieldDefinitionSchema>['validationRules']>, undefined>>,
];

/**
 * The non-vacuity twin: a live neighbour on each carrier keeps its real type on
 * both faces, so the rows above measure the retired members and not a file that
 * stopped resolving.
 */
export type assertionLiveNeighboursKeepTheirTypes = [
  Expect<Equal<Ts_DataModelDesignerSchema['showRelationshipLabels'], boolean | undefined>>,
  Expect<Equal<Ts_ReportDesignerSchema['showPropertyPanel'], boolean | undefined>>,
  Expect<Equal<DesignerComponent['zIndex'], number | undefined>>,
  Expect<Equal<DataModelRelationship['label'], string | undefined>>,
  Expect<Equal<BPMNNode['script'], string | undefined>>,
  Expect<Equal<ObjectDefinition['fieldCount'], number | undefined>>,
  Expect<Equal<DesignerFieldDefinition['referenceTo'], string | undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof DataModelRelationshipSchema>['label']>, string | undefined>>,
];

/* ── The two element types left both faces and the exports ────────────────── */

// @ts-expect-error retired (objectui#11434): no longer exported from the `@object-ui/types` root barrel.
type _RelationshipViaBarrel = import('../index.js').ObjectDefinitionRelationship;
// @ts-expect-error retired (objectui#11434), as above.
type _RuleViaBarrel = import('../index.js').DesignerValidationRule;
// @ts-expect-error retired (objectui#11434): `../designer` no longer declares it.
type _RelationshipViaModule = import('../designer.js').ObjectDefinitionRelationship;
// @ts-expect-error retired (objectui#11434), as above.
type _RuleViaModule = import('../designer.js').DesignerValidationRule;

// Controls, no directive: the same two query shapes resolve live neighbours, so
// the four errors above are readings of the two modules and not of a bad path.
type _ObjectViaBarrel = import('../index.js').ObjectDefinition;
type _OptionViaModule = import('../designer.js').DesignerFieldOption;

/* ── The `tsc` half on fresh literals ─────────────────────────────────────── */

const POSITION = { x: 0, y: 0, width: 100, height: 40 };

describe('authoring a retired designer member is a `tsc` error (objectui#11434)', () => {
  it('refuses the two retired node members — presence is the error, not the value', () => {
    const model: Ts_DataModelDesignerSchema = {
      type: 'data-model-designer',
      entities: [],
      relationships: [],
      // @ts-expect-error `autoLayout` is retired (objectui#11434) — use the toolbar's Auto Layout button
      autoLayout: true,
    };
    const report: Ts_ReportDesignerSchema = {
      type: 'report-designer',
      reportName: 'Pipeline',
      objectName: 'opportunity',
      sections: [],
      // @ts-expect-error `previewMode` is retired (objectui#11434) — preview is a tool mode
      previewMode: true,
    };
    expect([model.type, report.type]).toEqual(['data-model-designer', 'report-designer']);
  });

  it('refuses the five retired record members', () => {
    const component: DesignerComponent = {
      id: 'c',
      type: 'text',
      position: POSITION,
      props: {},
      // @ts-expect-error `parentId` is retired (objectui#11434) — nest the child in `children`
      parentId: 'p',
    };
    const relationship: DataModelRelationship = {
      id: 'r',
      sourceEntity: 'a',
      sourceField: 'id',
      targetEntity: 'b',
      targetField: 'a_id',
      type: 'one-to-many',
      // @ts-expect-error `onUpdate` is retired (objectui#11434) — the platform has no update behaviour
      onUpdate: 'cascade',
    };
    const node: BPMNNode = {
      id: 'n',
      type: 'service-task',
      label: 'Charge',
      position: { x: 0, y: 0 },
      // @ts-expect-error `serviceEndpoint` is retired (objectui#11434) — a service task references an implementation
      serviceEndpoint: 'https://example.invalid/charge',
    };
    const object: ObjectDefinition = {
      id: 'account',
      name: 'account',
      label: 'Account',
      // @ts-expect-error `relationships` is retired (objectui#11434) — declare a `lookup` field whose `referenceTo` names the related object
      relationships: [{ relatedObject: 'contact', type: 'one-to-many' }],
    };
    const field: DesignerFieldDefinition = {
      id: 'f',
      name: 'code',
      label: 'Code',
      type: 'text',
      // @ts-expect-error `validationRules` is retired (objectui#11434) — put min / max / minLength / maxLength in the field metadata
      validationRules: [{ type: 'maxLength', value: 10 }],
    };
    expect([component.id, relationship.id, node.id, object.id, field.id]).toEqual(['c', 'r', 'n', 'account', 'f']);
  });
});

/* ── The runtime half: refused by name, with the prescription ─────────────── */

/** The members each declaration REQUIRES, so a refusal is about the retired key alone. */
const ENTITY = { id: 'e', name: 'account', label: 'Account', fields: [], position: { x: 0, y: 0 } };
const RELATIONSHIP = {
  id: 'r',
  sourceEntity: 'e',
  sourceField: 'id',
  targetEntity: 'e',
  targetField: 'parent_id',
  type: 'one-to-many',
};
const BPMN = { id: 'n', type: 'service-task', label: 'Charge', position: { x: 0, y: 0 } };
const OBJECT = { id: 'account', name: 'account', label: 'Account' };
const FIELD = { id: 'f', name: 'code', label: 'Code', type: 'text' };
const COMPONENT = { id: 'c', type: 'text', position: POSITION, props: {} };

/**
 * One document per retired member: the node that carries it, the member set on
 * the record where it lives, and the issue path that names it. Every key is
 * spelled as a literal so a reader can see what is retired without running the
 * file.
 */
const CASES = [
  ['autoLayout', { type: 'data-model-designer', entities: [], relationships: [], autoLayout: true }, ['autoLayout']],
  ['previewMode', { type: 'report-designer', reportName: 'p', objectName: 'o', sections: [], previewMode: true }, ['previewMode']],
  [
    'parentId',
    { type: 'page-designer', canvas: { width: 1, height: 1 }, components: [{ ...COMPONENT, parentId: 'root' }] },
    ['components', 0, 'parentId'],
  ],
  [
    'onUpdate',
    { type: 'data-model-designer', entities: [ENTITY], relationships: [{ ...RELATIONSHIP, onUpdate: 'cascade' }] },
    ['relationships', 0, 'onUpdate'],
  ],
  [
    'serviceEndpoint',
    { type: 'process-designer', processName: 'p', nodes: [{ ...BPMN, serviceEndpoint: 'https://example.invalid' }], edges: [] },
    ['nodes', 0, 'serviceEndpoint'],
  ],
  [
    'relationships',
    { type: 'object-manager', objects: [{ ...OBJECT, relationships: [{ relatedObject: 'contact', type: 'one-to-many' }] }] },
    ['objects', 0, 'relationships'],
  ],
  [
    'validationRules',
    { type: 'field-designer', objectName: 'account', fields: [{ ...FIELD, validationRules: [{ type: 'maxLength', value: 10 }] }] },
    ['fields', 0, 'validationRules'],
  ],
] as const;

/** The same documents with the retired member removed — each must parse green. */
const CONTROLS = [
  { type: 'data-model-designer', entities: [ENTITY], relationships: [RELATIONSHIP] },
  { type: 'report-designer', reportName: 'p', objectName: 'o', sections: [] },
  { type: 'page-designer', canvas: { width: 1, height: 1 }, components: [COMPONENT] },
  { type: 'process-designer', processName: 'p', nodes: [BPMN], edges: [] },
  { type: 'object-manager', objects: [OBJECT] },
  { type: 'field-designer', objectName: 'account', fields: [FIELD] },
] as const;

describe('the zod face refuses each retired designer member by name (objectui#11434)', () => {
  it.each(CASES)('`%s` is refused on the rendering face, at its own path, with the prescription', (key, doc, path) => {
    const result = safeValidateSchema(doc);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === path.join('.'));
    expect(issue, JSON.stringify(result.error.issues)).toBeDefined();
    if (!issue) return;
    expect(issue.code).toBe('invalid_type');
    // The refusal names the key, the card, and what to write instead — the half
    // a bare `z.never()` would drop.
    expect(issue.message).toContain(`\`${key}\``);
    expect(issue.message).toContain('objectui#11434');
    expect(issue.message).toContain('Instead:');
  });

  it.each(CASES)('`%s` is refused on the strict authoring face, at its own path', (_key, doc, path) => {
    const result = StrictAnyComponentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.path.join('.'))).toContain(path.join('.'));
  });

  it('accepts each document WITHOUT the retired member, on both faces — the control', () => {
    for (const doc of CONTROLS) {
      const loose = safeValidateSchema(doc);
      expect(loose.success, JSON.stringify(loose.success ? null : loose.error.issues)).toBe(true);
      const strict = StrictAnyComponentSchema.safeParse(doc);
      expect(strict.success, JSON.stringify(strict.success ? null : strict.error.issues)).toBe(true);
    }
  });

  it('the two element types left the zod barrel; their carriers did not', () => {
    const exported = Object.keys(zodFace);
    expect(exported, 'the retired mirror is exported again').not.toContain('ObjectDefinitionRelationshipSchema');
    expect(exported, 'the retired mirror is exported again').not.toContain('DesignerValidationRuleSchema');
    // Lit controls: the namespace read is real, and the carriers still ship.
    expect(exported).toContain('ObjectDefinitionSchema');
    expect(exported).toContain('DesignerFieldDefinitionSchema');
  });
});
